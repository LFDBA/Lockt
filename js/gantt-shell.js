(() => {
    const DEFAULT_PROJECT_NAME = "My Project";
    const LEGACY_BOARD_KEY = "lockt.board.v1";
    const ACTIVE_PROJECT_KEY = "lockt:active-kanban-project";
    const PROJECTS_KEY = "lockt:kanban-projects";
    const PROJECT_METADATA_KEY = "lockt:kanban-project-metadata";
    const PROJECT_SETTINGS_KEY = "lockt:kanban-project-settings";
    const NEW_PROJECT_FOCUS_KEY = "lockt:new-kanban-project";
    const HOME_INITIALIZED_KEY = "lockt:home-initialized";
    const DEFAULT_URGENCY_DAYS = 7;
    const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
    const MAX_IMAGE_DIMENSION = 1600;
    const content = document.querySelector(".content");
    const backButton = document.querySelector(".back");
    const titleInput = document.querySelector(".project-title");
    const settingsButton = document.querySelector(".kanban-settings-button");
    const settingsPanel = document.querySelector(".kanban-settings-panel");
    const renameButton = document.querySelector(".rename-project-button");
    const urgencyInput = document.querySelector("#urgency-threshold");
    const backgroundInput = document.querySelector("#board-background-image");
    const removeBackgroundButton = document.querySelector(
        ".remove-background-image"
    );
    const backgroundStatus = document.querySelector(".background-image-status");
    const deleteButton = document.querySelector(".delete-board-button");
    const deleteDialog = document.querySelector(".delete-board-dialog");
    const deleteForm = document.querySelector(".delete-board-form");
    const deleteName = document.querySelector(".delete-board-name");
    const deleteConfirmation = document.querySelector(
        ".delete-board-confirmation"
    );
    const cancelDeletion = document.querySelector(".cancel-board-deletion");
    const confirmDeletion = document.querySelector(".confirm-board-deletion");

    let projectName = getProjectName();
    let urgencyDays = getUrgencyThreshold(projectName);
    let allowNavigation = false;

    function normalizeName(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    function getProjectName() {
        const projectFromUrl = normalizeName(
            new URLSearchParams(window.location.search).get("project")
        );
        const activeProject = normalizeName(
            window.localStorage.getItem(ACTIVE_PROJECT_KEY)
        );

        return projectFromUrl || activeProject || DEFAULT_PROJECT_NAME;
    }

    function readProjectNames() {
        try {
            const names = JSON.parse(
                window.localStorage.getItem(PROJECTS_KEY) || "[]"
            );

            return Array.isArray(names)
                ? names.map(normalizeName).filter(Boolean)
                : [];
        } catch (error) {
            console.warn("Unable to read saved project names", error);
            return [];
        }
    }

    function saveProjectNames(names) {
        window.localStorage.setItem(
            PROJECTS_KEY,
            JSON.stringify([...new Set(names)])
        );
    }

    function readObjectStorage(storageKey) {
        try {
            const value = JSON.parse(
                window.localStorage.getItem(storageKey) || "{}"
            );

            return value && typeof value === "object" && !Array.isArray(value)
                ? value
                : {};
        } catch (error) {
            console.warn(`Unable to read ${storageKey}`, error);
            return {};
        }
    }

    function saveObjectStorage(storageKey, value) {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
    }

    function readSettings() {
        return readObjectStorage(PROJECT_SETTINGS_KEY);
    }

    function getUrgencyThreshold(name) {
        const savedThreshold = readSettings()[name]?.urgencyThresholdDays;

        return Number.isInteger(savedThreshold) && savedThreshold >= 0
            ? Math.min(365, savedThreshold)
            : DEFAULT_URGENCY_DAYS;
    }

    function updateProjectSettings(changes) {
        const settings = readSettings();

        saveObjectStorage(PROJECT_SETTINGS_KEY, {
            ...settings,
            [projectName]: {
                ...(settings[projectName] || {}),
                ...changes
            }
        });
    }

    function syncTitle() {
        document.title = `${projectName} Gantt Chart`;

        if (titleInput) {
            titleInput.value = projectName;
            titleInput.setCustomValidity("");
        }
    }

    function getTitleValidationMessage(value) {
        const nextName = normalizeName(value);

        if (!nextName) return "Project title cannot be empty.";
        if (nextName === projectName) return "";

        if (nextName.startsWith("lockt:") || nextName === LEGACY_BOARD_KEY) {
            return "That project title is reserved.";
        }

        if (
            readProjectNames().includes(nextName) ||
            window.localStorage.getItem(nextName) !== null
        ) {
            return "A project with that title already exists.";
        }

        return "";
    }

    function rejectTitle(message) {
        if (!titleInput) return;

        titleInput.setCustomValidity(message);
        titleInput.reportValidity();
        titleInput.focus();
        titleInput.select();
    }

    function moveObjectRecord(storageKey, previousName, nextName, fallback = null) {
        const records = readObjectStorage(storageKey);
        const record = records[previousName] || fallback;
        const nextRecords = { ...records };

        delete nextRecords[previousName];

        if (record) {
            nextRecords[nextName] = record;
        }

        saveObjectStorage(storageKey, nextRecords);
    }

    function renameProject(value) {
        const nextName = normalizeName(value);
        const validationMessage = getTitleValidationMessage(value);

        if (validationMessage) {
            rejectTitle(validationMessage);
            return false;
        }

        if (nextName === projectName) {
            syncTitle();
            return true;
        }

        const previousName = projectName;
        const boardState = readBoardState(previousName) || { lists: [] };

        try {
            window.localStorage.setItem(nextName, JSON.stringify(boardState));
            window.localStorage.removeItem(previousName);

            if (previousName === DEFAULT_PROJECT_NAME) {
                window.localStorage.removeItem(LEGACY_BOARD_KEY);
            }

            saveProjectNames([
                ...readProjectNames().filter((name) => name !== previousName),
                nextName
            ]);
            moveObjectRecord(
                PROJECT_METADATA_KEY,
                previousName,
                nextName,
                { createdAt: new Date().toISOString() }
            );
            moveObjectRecord(PROJECT_SETTINGS_KEY, previousName, nextName);
            void window.LocktWhiteboardStorage?.move(previousName, nextName);

            projectName = nextName;
            window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectName);

            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set("project", projectName);
            window.history.replaceState(null, "", nextUrl);
            syncTitle();
            applyBackground();
            syncBackgroundControls();
            initializeGanttView();
            return true;
        } catch (error) {
            console.warn("Unable to rename project", error);
            rejectTitle("Unable to rename this project.");
            return false;
        }
    }

    function shouldBeUrgent(card) {
        if (
            typeof card?.dateValue !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(card.dateValue)
        ) {
            return false;
        }

        const dueDate = new Date(`${card.dateValue}T00:00:00`);
        const today = new Date();

        if (Number.isNaN(dueDate.getTime())) return false;

        today.setHours(0, 0, 0, 0);

        return (
            Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000) <=
            urgencyDays
        );
    }

    function refreshStoredUrgency() {
        const boardState = readBoardState(projectName);

        if (!boardState) return;

        boardState.lists.forEach((list) => {
            const cards = Array.isArray(list.cards) ? list.cards : [];

            cards.forEach((card) => {
                card.urgent = shouldBeUrgent(card);
            });
        });

        window.localStorage.setItem(projectName, JSON.stringify(boardState));
    }

    function getBackgroundImage() {
        const backgroundImage = readSettings()[projectName]?.backgroundImage;

        return typeof backgroundImage === "string" &&
            backgroundImage.startsWith("data:image/")
            ? backgroundImage
            : "";
    }

    function applyBackground() {
        if (!content) return;

        const backgroundImage = getBackgroundImage();

        content.classList.toggle("has-board-background", Boolean(backgroundImage));

        if (backgroundImage) {
            content.style.setProperty(
                "--board-background-image",
                `url("${backgroundImage}")`
            );
        } else {
            content.style.removeProperty("--board-background-image");
        }
    }

    function syncBackgroundControls(message = "") {
        const projectSettings = readSettings()[projectName] || {};
        const hasBackground = Boolean(getBackgroundImage());

        if (removeBackgroundButton) {
            removeBackgroundButton.hidden = !hasBackground;
        }

        if (!backgroundStatus) return;

        backgroundStatus.textContent = message || (hasBackground
            ? `Using ${projectSettings.backgroundImageName || "uploaded image"} as the background and fallback cover.`
            : "Also used as the cover unless a separate cover is chosen.");
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            const objectUrl = URL.createObjectURL(file);

            image.addEventListener("load", () => {
                URL.revokeObjectURL(objectUrl);
                resolve(image);
            });
            image.addEventListener("error", () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("That image could not be read."));
            });
            image.src = objectUrl;
        });
    }

    async function optimizeImage(file) {
        if (!file.type.startsWith("image/")) {
            throw new Error("Please choose an image file.");
        }

        if (file.size > MAX_IMAGE_BYTES) {
            throw new Error("Please choose an image smaller than 15 MB.");
        }

        const image = await loadImage(file);
        const scale = Math.min(
            1,
            MAX_IMAGE_DIMENSION / Math.max(image.width, image.height)
        );
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        if (!context) {
            throw new Error("This browser cannot prepare that image.");
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);

        let quality = 0.82;
        let optimizedImage = canvas.toDataURL("image/webp", quality);

        while (optimizedImage.length > 1_250_000 && quality > 0.52) {
            quality -= 0.08;
            optimizedImage = canvas.toDataURL("image/webp", quality);
        }

        return optimizedImage;
    }

    function closeSettings() {
        if (!settingsPanel || !settingsButton) return;

        settingsPanel.hidden = true;
        settingsButton.setAttribute("aria-expanded", "false");
    }

    function removeProjectRecord(storageKey, name) {
        const records = readObjectStorage(storageKey);
        const nextRecords = { ...records };

        delete nextRecords[name];
        saveObjectStorage(storageKey, nextRecords);
    }

    async function deleteProject() {
        try {
            window.localStorage.setItem(HOME_INITIALIZED_KEY, "true");
            window.localStorage.removeItem(projectName);

            if (projectName === DEFAULT_PROJECT_NAME) {
                window.localStorage.removeItem(LEGACY_BOARD_KEY);
            }

            saveProjectNames(
                readProjectNames().filter((name) => name !== projectName)
            );
            removeProjectRecord(PROJECT_METADATA_KEY, projectName);
            removeProjectRecord(PROJECT_SETTINGS_KEY, projectName);

            if (
                window.localStorage.getItem(ACTIVE_PROJECT_KEY) === projectName
            ) {
                window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
            }

            if (
                window.sessionStorage.getItem(NEW_PROJECT_FOCUS_KEY) === projectName
            ) {
                window.sessionStorage.removeItem(NEW_PROJECT_FOCUS_KEY);
            }

            await window.LocktWhiteboardStorage?.remove(projectName);
        } catch (error) {
            console.warn("Unable to delete project", error);
            return;
        }

        allowNavigation = true;
        window.location.href = "index.html";
    }

    function setupTitleEditor() {
        if (!titleInput) return;

        titleInput.addEventListener("input", () => {
            titleInput.setCustomValidity(
                getTitleValidationMessage(titleInput.value)
            );
        });
        titleInput.addEventListener("change", () => {
            renameProject(titleInput.value);
        });
        titleInput.addEventListener("blur", () => {
            const validationMessage = getTitleValidationMessage(titleInput.value);

            if (!validationMessage) return;

            titleInput.setCustomValidity(validationMessage);
            requestAnimationFrame(() => {
                if (!getTitleValidationMessage(titleInput.value)) return;

                titleInput.focus();
                titleInput.reportValidity();
                titleInput.select();
            });
        });
        titleInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                titleInput.blur();
            }

            if (event.key === "Escape") {
                event.preventDefault();
                syncTitle();
                titleInput.blur();
            }
        });
    }

    function setupSettings() {
        if (!settingsPanel || !settingsButton || !urgencyInput) return;

        urgencyInput.value = String(urgencyDays);

        renameButton?.addEventListener("click", () => {
            closeSettings();
            titleInput?.focus();
            titleInput?.select();
        });

        settingsButton.addEventListener("click", () => {
            const willOpen = settingsPanel.hidden;

            settingsPanel.hidden = !willOpen;
            settingsButton.setAttribute("aria-expanded", String(willOpen));

            if (willOpen) {
                urgencyInput.focus();
                urgencyInput.select();
            }
        });

        urgencyInput.addEventListener("input", () => {
            if (urgencyInput.value === "") return;

            const threshold = Number(urgencyInput.value);

            if (!Number.isFinite(threshold)) return;

            urgencyDays = Math.max(0, Math.min(365, Math.round(threshold)));
            updateProjectSettings({ urgencyThresholdDays: urgencyDays });
            refreshStoredUrgency();
            initializeGanttView();
        });

        urgencyInput.addEventListener("change", () => {
            urgencyInput.value = String(urgencyDays);
        });

        document.addEventListener("pointerdown", (event) => {
            if (
                settingsPanel.hidden ||
                settingsPanel.contains(event.target) ||
                settingsButton.contains(event.target)
            ) {
                return;
            }

            closeSettings();
        });

        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || settingsPanel.hidden) return;

            closeSettings();
            settingsButton.focus();
        });
    }

    function setupBackground() {
        applyBackground();
        syncBackgroundControls();

        backgroundInput?.addEventListener("change", async () => {
            const file = backgroundInput.files?.[0];

            if (!file) return;

            backgroundInput.disabled = true;
            syncBackgroundControls("Preparing image…");

            try {
                const backgroundImage = await optimizeImage(file);
                updateProjectSettings({
                    backgroundImage,
                    backgroundImageName: file.name
                });
                applyBackground();
                syncBackgroundControls();
            } catch (error) {
                syncBackgroundControls(
                    error instanceof Error
                        ? error.message
                        : "Unable to use that image."
                );
            } finally {
                backgroundInput.disabled = false;
                backgroundInput.value = "";
            }
        });

        removeBackgroundButton?.addEventListener("click", () => {
            const settings = readSettings();
            const projectSettings = { ...(settings[projectName] || {}) };

            delete projectSettings.backgroundImage;
            delete projectSettings.backgroundImageName;
            saveObjectStorage(PROJECT_SETTINGS_KEY, {
                ...settings,
                [projectName]: projectSettings
            });
            applyBackground();
            syncBackgroundControls();
        });
    }

    function setupDeletion() {
        if (
            !deleteButton ||
            !deleteDialog ||
            !deleteForm ||
            !deleteName ||
            !deleteConfirmation ||
            !confirmDeletion
        ) {
            return;
        }

        deleteButton.addEventListener("click", () => {
            closeSettings();
            deleteName.textContent = projectName;
            deleteConfirmation.value = "";
            confirmDeletion.disabled = true;
            deleteDialog.showModal();
            requestAnimationFrame(() => deleteConfirmation.focus());
        });

        deleteConfirmation.addEventListener("input", () => {
            confirmDeletion.disabled = deleteConfirmation.value !== projectName;
        });
        cancelDeletion?.addEventListener("click", () => deleteDialog.close());
        deleteForm.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (deleteConfirmation.value !== projectName) return;

            deleteDialog.close();
            await deleteProject();
        });
        deleteDialog.addEventListener("click", (event) => {
            if (event.target === deleteDialog) deleteDialog.close();
        });
        deleteDialog.addEventListener("close", () => {
            deleteConfirmation.value = "";
            confirmDeletion.disabled = true;
        });
    }

    window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectName);
    syncTitle();
    setupTitleEditor();
    setupSettings();
    setupBackground();
    setupDeletion();
    refreshStoredUrgency();
    initializeGanttView();

    backButton?.addEventListener("click", () => {
        if (!renameProject(titleInput?.value || "")) return;

        allowNavigation = true;
        window.location.href = "index.html";
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;

        refreshStoredUrgency();
        initializeGanttView();
    });

    window.addEventListener("beforeunload", (event) => {
        if (allowNavigation || renameProject(titleInput?.value || projectName)) {
            return;
        }

        event.preventDefault();
        event.returnValue = "";
    });
})();
