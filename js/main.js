const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const PROJECTS_STORAGE_KEY = "lockt:kanban-projects";
const PROJECT_METADATA_STORAGE_KEY = "lockt:kanban-project-metadata";
const PROJECT_SETTINGS_STORAGE_KEY = "lockt:kanban-project-settings";
const NEW_PROJECT_FOCUS_STORAGE_KEY = "lockt:new-kanban-project";
const HOME_INITIALIZED_STORAGE_KEY = "lockt:home-initialized";
const MAX_COVER_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_COVER_IMAGE_DIMENSION = 1200;
const PROJECT_COLOURS = ["#c88f6b", "#9eae94", "#b9a078", "#8fa9a3"];
const creationDateFormatter = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
});

const HOME_TEMPLATES = {
    "web-development": {
        name: "Web Development",
        lists: [
            createTemplateList("Backlog", "#b8a4cc"),
            createTemplateList("Building", "#93aaa2"),
            createTemplateList("Review", "#c4ad8c"),
            createTemplateList("Done", "#a7b99a")
        ]
    },
    personal: {
        name: "Personal",
        lists: [
            createTemplateList("To Do", "#b8a4cc"),
            createTemplateList("Doing", "#93aaa2"),
            createTemplateList("Done", "#a7b99a")
        ]
    },
    management: {
        name: "Management",
        lists: [
            createTemplateList("Planned", "#c4ad8c"),
            createTemplateList("Active", "#93aaa2"),
            createTemplateList("Review", "#b8a4cc"),
            createTemplateList("Done", "#a7b99a")
        ]
    },
    flexible: {
        name: "Flexible",
        lists: [
            createTemplateList("To Do", "#b8a4cc"),
            createTemplateList("Doing", "#93aaa2"),
            createTemplateList("Done", "#a7b99a")
        ]
    }
};

const projectContextMenu = document.querySelector(".project-context-menu");
const changeProjectCoverMenuItem = document.querySelector(
    ".change-project-cover-menu-item"
);
const deleteProjectMenuItem = document.querySelector(
    ".delete-project-menu-item"
);
const projectViewDialog = document.querySelector(".project-view-dialog");
const projectViewName = document.querySelector(".project-view-name");
const projectViewButtons = [
    ...document.querySelectorAll("[data-project-view]")
];
const closeProjectViewButton = document.querySelector(".close-project-view");
const projectCoverDialog = document.querySelector(".project-cover-dialog");
const projectCoverName = document.querySelector(".project-cover-name");
const projectCoverImageInput = document.querySelector(
    ".project-cover-image-input"
);
const projectCoverStatus = document.querySelector(".project-cover-status");
const projectCoverColourButtons = [
    ...document.querySelectorAll("[data-cover-colour]")
];
const resetProjectCoverButton = document.querySelector(".reset-project-cover");
const closeProjectCoverButton = document.querySelector(".close-project-cover");
const deleteProjectDialog = document.querySelector(".delete-project-dialog");
const deleteProjectForm = document.querySelector(".delete-project-form");
const deleteProjectName = document.querySelector(".delete-project-name");
const deleteProjectConfirmation = document.querySelector(
    ".delete-project-confirmation"
);
const cancelProjectDeletion = document.querySelector(
    ".cancel-project-deletion"
);
const confirmProjectDeletion = document.querySelector(
    ".confirm-project-deletion"
);

let contextProjectName = "";
let pendingViewProjectName = "";
let pendingCoverProjectName = "";
let pendingDeletionProjectName = "";

function createTemplateList(title, backgroundColor) {
    return { title, backgroundColor, cards: [] };
}

function normalizeProjectName(projectName) {
    return typeof projectName === "string" ? projectName.trim() : "";
}

function readProjectNames() {
    try {
        const savedProjectNames = JSON.parse(
            window.localStorage.getItem(PROJECTS_STORAGE_KEY) || "[]"
        );

        return Array.isArray(savedProjectNames)
            ? savedProjectNames.map(normalizeProjectName).filter(Boolean)
            : [];
    } catch (error) {
        console.warn("Unable to read saved project names", error);
        return [];
    }
}

function saveProjectNames(projectNames) {
    try {
        window.localStorage.setItem(
            PROJECTS_STORAGE_KEY,
            JSON.stringify([...new Set(projectNames)])
        );
        return true;
    } catch (error) {
        console.warn("Unable to save project names", error);
        return false;
    }
}


function readProjectMetadata() {
    try {
        const metadata = JSON.parse(
            window.localStorage.getItem(PROJECT_METADATA_STORAGE_KEY) || "{}"
        );

        return metadata && typeof metadata === "object" && !Array.isArray(metadata)
            ? metadata
            : {};
    } catch (error) {
        console.warn("Unable to read project metadata", error);
        return {};
    }
}

function saveProjectMetadata(metadata) {
    try {
        window.localStorage.setItem(
            PROJECT_METADATA_STORAGE_KEY,
            JSON.stringify(metadata)
        );
        return true;
    } catch (error) {
        console.warn("Unable to save project metadata", error);
        return false;
    }
}

function readProjectSettings() {
    try {
        const settings = JSON.parse(
            window.localStorage.getItem(PROJECT_SETTINGS_STORAGE_KEY) || "{}"
        );

        return settings && typeof settings === "object" && !Array.isArray(settings)
            ? settings
            : {};
    } catch (error) {
        console.warn("Unable to read project settings", error);
        return {};
    }
}

function getProjectBackgroundImage(projectName) {
    const backgroundImage = readProjectSettings()[projectName]?.backgroundImage;

    return typeof backgroundImage === "string" &&
        backgroundImage.startsWith("data:image/")
        ? backgroundImage
        : "";
}

function getProjectCover(projectName) {
    const projectSettings = readProjectSettings()[projectName] || {};
    const customCoverImage = projectSettings.coverImage;
    const customCoverColour = projectSettings.coverColour;

    if (
        projectSettings.coverMode === "image" &&
        typeof customCoverImage === "string" &&
        customCoverImage.startsWith("data:image/")
    ) {
        return { type: "image", value: customCoverImage, custom: true };
    }

    if (
        projectSettings.coverMode === "colour" &&
        typeof customCoverColour === "string" &&
        /^#[0-9a-f]{6}$/i.test(customCoverColour)
    ) {
        return { type: "colour", value: customCoverColour, custom: true };
    }

    const backgroundImage = getProjectBackgroundImage(projectName);

    return backgroundImage
        ? { type: "image", value: backgroundImage, custom: false }
        : { type: "default", value: "", custom: false };
}

function saveProjectCover(projectName, coverMode, value, fileName = "") {
    try {
        const settings = readProjectSettings();
        const projectSettings = { ...(settings[projectName] || {}) };

        delete projectSettings.coverImage;
        delete projectSettings.coverImageName;
        delete projectSettings.coverColour;

        projectSettings.coverMode = coverMode;

        if (coverMode === "image") {
            projectSettings.coverImage = value;
            projectSettings.coverImageName = fileName;
        } else if (coverMode === "colour") {
            projectSettings.coverColour = value;
        }

        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                [projectName]: projectSettings
            })
        );
        return true;
    } catch (error) {
        console.warn("Unable to save the project cover", error);
        return false;
    }
}

function resetProjectCover(projectName) {
    try {
        const settings = readProjectSettings();
        const projectSettings = { ...(settings[projectName] || {}) };

        delete projectSettings.coverMode;
        delete projectSettings.coverImage;
        delete projectSettings.coverImageName;
        delete projectSettings.coverColour;

        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                [projectName]: projectSettings
            })
        );
        return true;
    } catch (error) {
        console.warn("Unable to reset the project cover", error);
        return false;
    }
}

function getProjectCreationDate(projectName) {
    const metadata = readProjectMetadata();
    const savedCreationDate = metadata[projectName]?.createdAt;

    if (
        typeof savedCreationDate === "string" &&
        !Number.isNaN(Date.parse(savedCreationDate))
    ) {
        return savedCreationDate;
    }

    const createdAt = new Date().toISOString();

    saveProjectMetadata({
        ...metadata,
        [projectName]: {
            ...(metadata[projectName] || {}),
            createdAt
        }
    });

    return createdAt;
}

function looksLikeBoardStorageValue(value) {
    try {
        const parsedValue = JSON.parse(value);
        return parsedValue && Array.isArray(parsedValue.lists);
    } catch {
        return false;
    }
}

function getKanbanProjectNames() {
    const projectNames = new Set(readProjectNames());

    for (let index = 0; index < window.localStorage.length; index += 1) {
        const storageKey = window.localStorage.key(index);

        if (
            storageKey &&
            storageKey !== LEGACY_BOARD_STORAGE_KEY &&
            !storageKey.startsWith("lockt:") &&
            looksLikeBoardStorageValue(window.localStorage.getItem(storageKey))
        ) {
            projectNames.add(storageKey);
        }
    }

    if (
        (projectNames.size === 0 &&
            !window.localStorage.getItem(HOME_INITIALIZED_STORAGE_KEY)) ||
        window.localStorage.getItem(DEFAULT_BOARD_STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY)
    ) {
        projectNames.add(DEFAULT_BOARD_STORAGE_KEY);
    }

    return [...projectNames];
}

function markProjectOpened(projectName) {
    const metadata = readProjectMetadata();

    saveProjectMetadata({
        ...metadata,
        [projectName]: {
            ...(metadata[projectName] || {}),
            createdAt: getProjectCreationDate(projectName),
            lastOpenedAt: new Date().toISOString()
        }
    });
}

function selectProject(projectName) {
    window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, projectName);
    markProjectOpened(projectName);
}

function getAvailableProjectName(baseName = "Untitled Project") {
    const projectNames = new Set(getKanbanProjectNames());

    if (!projectNames.has(baseName)) {
        return baseName;
    }

    let suffix = 2;

    while (projectNames.has(`${baseName} ${suffix}`)) {
        suffix += 1;
    }

    return `${baseName} ${suffix}`;
}

function registerProject(projectName) {
    if (!saveProjectNames([...readProjectNames(), projectName])) return false;

    getProjectCreationDate(projectName);
    selectProject(projectName);
    return true;
}

function openProject(projectName) {
    window.location.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
}

function createNewProject() {
    const projectName = getAvailableProjectName();

    if (!registerProject(projectName)) return;

    try {
        window.sessionStorage.setItem(NEW_PROJECT_FOCUS_STORAGE_KEY, projectName);
    } catch (error) {
        console.warn("Unable to mark the new project for editing", error);
    }

    openProject(projectName);
}

function createProjectFromTemplate(templateKey) {
    const selectedTemplate = HOME_TEMPLATES[templateKey];

    if (!selectedTemplate) return;

    const projectName = getAvailableProjectName(selectedTemplate.name);

    if (!registerProject(projectName)) return;

    try {
        window.localStorage.setItem(
            projectName,
            JSON.stringify({ lists: selectedTemplate.lists })
        );
    } catch (error) {
        console.warn("Unable to create project from template", error);
        return;
    }

    openProject(projectName);
}

function getProjectColour(projectName) {
    const colourIndex = [...projectName].reduce(
        (total, character) => total + character.charCodeAt(0),
        0
    );

    return PROJECT_COLOURS[colourIndex % PROJECT_COLOURS.length];
}

function getProjectActivityTime(projectName) {
    const projectMetadata = readProjectMetadata()[projectName] || {};
    const activityDate = projectMetadata.lastOpenedAt || projectMetadata.createdAt;
    const activityTime = Date.parse(activityDate);

    return Number.isNaN(activityTime) ? 0 : activityTime;
}

function loadCoverImage(file) {
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

async function optimizeCoverImage(file) {
    if (!file.type.startsWith("image/")) {
        throw new Error("Please choose an image file.");
    }

    if (file.size > MAX_COVER_IMAGE_BYTES) {
        throw new Error("Please choose an image smaller than 15 MB.");
    }

    const image = await loadCoverImage(file);
    const scale = Math.min(
        1,
        MAX_COVER_IMAGE_DIMENSION / Math.max(image.width, image.height)
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

    while (optimizedImage.length > 900_000 && quality > 0.52) {
        quality -= 0.08;
        optimizedImage = canvas.toDataURL("image/webp", quality);
    }

    if (!optimizedImage.startsWith("data:image/")) {
        throw new Error("That image could not be prepared.");
    }

    return optimizedImage;
}

function refreshHomeProjects() {
    const searchTerm = document.querySelector(".project-search input")?.value || "";

    renderHomeProjects();
    filterHomeCards(searchTerm);
}

function syncProjectCoverDialog(projectName) {
    const projectSettings = readProjectSettings()[projectName] || {};
    const projectCover = getProjectCover(projectName);

    projectCoverColourButtons.forEach((colourButton) => {
        colourButton.setAttribute(
            "aria-pressed",
            String(
                projectSettings.coverMode === "colour" &&
                    colourButton.dataset.coverColour === projectCover.value
            )
        );
    });

    if (!projectCoverStatus) return;

    if (projectCover.custom && projectCover.type === "image") {
        projectCoverStatus.textContent = `Using ${projectSettings.coverImageName || "a custom image"}.`;
    } else if (projectCover.custom && projectCover.type === "colour") {
        projectCoverStatus.textContent = "Using a preset colour.";
    } else if (projectCover.type === "image") {
        projectCoverStatus.textContent = "Currently using the board background.";
    } else {
        projectCoverStatus.textContent = "Currently using the default project colour.";
    }
}

function openProjectViewDialog(projectName) {
    if (!projectViewDialog || !projectViewName) return;

    pendingViewProjectName = projectName;
    projectViewName.textContent = projectName;
    projectViewDialog.showModal();

    requestAnimationFrame(() => {
        projectViewButtons[0]?.focus();
    });
}

function openProjectCoverDialog(projectName) {
    if (!projectCoverDialog || !projectCoverName) return;

    pendingCoverProjectName = projectName;
    projectCoverName.textContent = projectName;

    if (projectCoverImageInput) {
        projectCoverImageInput.value = "";
        projectCoverImageInput.disabled = false;
    }

    syncProjectCoverDialog(projectName);
    projectCoverDialog.showModal();

    requestAnimationFrame(() => {
        projectCoverColourButtons[0]?.focus();
    });
}

function closeProjectContextMenu() {
    if (!projectContextMenu) return;

    projectContextMenu.hidden = true;
    contextProjectName = "";
}

function openProjectContextMenu(event, projectName, projectCard) {
    if (!projectContextMenu) return;

    event.preventDefault();
    contextProjectName = projectName;
    projectContextMenu.hidden = false;
    projectContextMenu.style.left = "0px";
    projectContextMenu.style.top = "0px";

    const cardBounds = projectCard.getBoundingClientRect();
    const menuBounds = projectContextMenu.getBoundingClientRect();
    const requestedX = event.clientX || cardBounds.left + cardBounds.width / 2;
    const requestedY = event.clientY || cardBounds.top + cardBounds.height / 2;
    const left = Math.max(
        8,
        Math.min(requestedX, window.innerWidth - menuBounds.width - 8)
    );
    const top = Math.max(
        8,
        Math.min(requestedY, window.innerHeight - menuBounds.height - 8)
    );

    projectContextMenu.style.left = `${left}px`;
    projectContextMenu.style.top = `${top}px`;
    (changeProjectCoverMenuItem || deleteProjectMenuItem)?.focus();
}

function openDeleteProjectDialog(projectName) {
    if (
        !deleteProjectDialog ||
        !deleteProjectName ||
        !deleteProjectConfirmation ||
        !confirmProjectDeletion
    ) {
        return;
    }

    pendingDeletionProjectName = projectName;
    deleteProjectName.textContent = projectName;
    deleteProjectConfirmation.value = "";
    confirmProjectDeletion.disabled = true;
    deleteProjectDialog.showModal();

    requestAnimationFrame(() => {
        deleteProjectConfirmation.focus();
    });
}

function removeProjectFromObjectStorage(storageKey, projectName) {
    try {
        const savedRecords = JSON.parse(
            window.localStorage.getItem(storageKey) || "{}"
        );
        const records =
            savedRecords &&
            typeof savedRecords === "object" &&
            !Array.isArray(savedRecords)
                ? savedRecords
                : {};
        const nextRecords = { ...records };

        delete nextRecords[projectName];
        window.localStorage.setItem(storageKey, JSON.stringify(nextRecords));
    } catch (error) {
        console.warn(`Unable to remove ${projectName} from ${storageKey}`, error);
    }
}

async function deleteProject(projectName) {
    try {
        window.localStorage.setItem(HOME_INITIALIZED_STORAGE_KEY, "true");
        window.localStorage.removeItem(projectName);

        if (projectName === DEFAULT_BOARD_STORAGE_KEY) {
            window.localStorage.removeItem(LEGACY_BOARD_STORAGE_KEY);
        }

        saveProjectNames(
            readProjectNames().filter((savedProjectName) => {
                return savedProjectName !== projectName;
            })
        );
        removeProjectFromObjectStorage(
            PROJECT_METADATA_STORAGE_KEY,
            projectName
        );
        removeProjectFromObjectStorage(
            PROJECT_SETTINGS_STORAGE_KEY,
            projectName
        );

        if (
            window.localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY) === projectName
        ) {
            window.localStorage.removeItem(ACTIVE_BOARD_STORAGE_KEY);
        }

        if (
            window.sessionStorage.getItem(NEW_PROJECT_FOCUS_STORAGE_KEY) ===
            projectName
        ) {
            window.sessionStorage.removeItem(NEW_PROJECT_FOCUS_STORAGE_KEY);
        }

        await window.LocktWhiteboardStorage?.remove(projectName);
    } catch (error) {
        console.warn("Unable to delete project", error);
        return;
    }

    renderHomeProjects();
    filterHomeCards(
        document.querySelector(".project-search input")?.value || ""
    );
}

function createProjectCard(projectName, projectIndex) {
    const link = document.createElement("a");
    const preview = document.createElement("span");
    const title = document.createElement("span");
    const creationDate = document.createElement("time");
    const createdAt = getProjectCreationDate(projectName);
    const projectCover = getProjectCover(projectName);

    link.className = "home-project-card";
    link.dataset.searchableName = projectName;
    link.dataset.projectName = projectName;
    link.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
    link.style.setProperty(
        "--project-colour",
        projectCover.type === "colour"
            ? projectCover.value
            : PROJECT_COLOURS[projectIndex % PROJECT_COLOURS.length] ||
                  getProjectColour(projectName)
    );
    preview.className = "project-card-preview";

    if (projectCover.type === "image") {
        preview.classList.add("has-project-cover");
        preview.style.setProperty(
            "--project-cover-image",
            `url("${projectCover.value}")`
        );
    }

    title.className = "project-card-title";
    title.textContent = projectName;
    creationDate.className = "project-created-date";
    creationDate.dateTime = createdAt;
    creationDate.textContent = creationDateFormatter.format(new Date(createdAt));

    link.addEventListener("click", (event) => {
        event.preventDefault();
        openProjectViewDialog(projectName);
    });
    link.addEventListener("contextmenu", (event) => {
        openProjectContextMenu(event, projectName, link);
    });
    link.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
            openProjectContextMenu(event, projectName, link);
        }
    });

    preview.append(creationDate, title);
    link.append(preview);

    return link;
}

function createNewProjectCard() {
    const button = document.createElement("button");
    const preview = document.createElement("span");
    const helper = document.createElement("span");
    const title = document.createElement("span");

    button.className = "home-project-card new-project";
    button.dataset.searchableName = "New Project";
    button.type = "button";
    preview.className = "project-card-preview";
    helper.className = "project-created-date";
    helper.textContent = "Start something new";
    title.className = "project-card-title";
    title.textContent = "+ New Project";

    preview.append(helper, title);
    button.append(preview);
    button.addEventListener("click", createNewProject);

    return button;
}

function updateEmptyMessage(gridSelector, messageSelector, cardSelector) {
    const cards = [...document.querySelectorAll(`${gridSelector} ${cardSelector}`)];
    const message = document.querySelector(messageSelector);

    if (!message) return;

    message.hidden = cards.some((card) => !card.hidden);
}

function filterHomeCards(searchTerm) {
    const normalizedSearchTerm = searchTerm.trim().toLocaleLowerCase();

    document.querySelectorAll("[data-searchable-name]").forEach((card) => {
        card.hidden = !card.dataset.searchableName
            .toLocaleLowerCase()
            .includes(normalizedSearchTerm);
    });

    updateEmptyMessage(".recent-boards", ".recents-empty", ".home-project-card");
    updateEmptyMessage(".template-grid", ".templates-empty", ".template-card");
    updateEmptyMessage(".all-projects", ".projects-empty", ".home-project-card");
}

function renderHomeProjects() {
    const recentBoards = document.querySelector(".recent-boards");
    const allProjects = document.querySelector(".all-projects");

    if (!recentBoards || !allProjects) return;

    const projectNames = getKanbanProjectNames()
        .map((projectName) => {
            getProjectCreationDate(projectName);
            return projectName;
        })
        .sort((firstProject, secondProject) => {
            return (
                getProjectActivityTime(secondProject) -
                getProjectActivityTime(firstProject)
            );
        });

    recentBoards.replaceChildren(
        ...projectNames.slice(0, 4).map(createProjectCard)
    );
    allProjects.replaceChildren(
        ...projectNames.map(createProjectCard),
        createNewProjectCard()
    );

    window.localStorage.setItem(HOME_INITIALIZED_STORAGE_KEY, "true");
}

document.querySelectorAll(".template-card").forEach((templateCard) => {
    templateCard.addEventListener("click", () => {
        createProjectFromTemplate(templateCard.dataset.template);
    });
});

document.querySelector(".project-search input")?.addEventListener("input", (event) => {
    filterHomeCards(event.currentTarget.value);
});

projectViewButtons.forEach((viewButton) => {
    viewButton.addEventListener("click", () => {
        const projectName = pendingViewProjectName;
        const selectedView = viewButton.dataset.projectView;

        if (
            !projectName ||
            !["kanban", "gantt", "whiteboard"].includes(selectedView)
        ) {
            return;
        }

        selectProject(projectName);
        projectViewDialog?.close();
        window.location.href = `${selectedView}.html?project=${encodeURIComponent(projectName)}`;
    });
});

closeProjectViewButton?.addEventListener("click", () => {
    projectViewDialog?.close();
});

projectViewDialog?.addEventListener("click", (event) => {
    if (event.target === projectViewDialog) {
        projectViewDialog.close();
    }
});

projectViewDialog?.addEventListener("close", () => {
    pendingViewProjectName = "";
});

changeProjectCoverMenuItem?.addEventListener("click", () => {
    const projectName = contextProjectName;

    closeProjectContextMenu();

    if (projectName) {
        openProjectCoverDialog(projectName);
    }
});

projectCoverImageInput?.addEventListener("change", async () => {
    const selectedFile = projectCoverImageInput.files?.[0];
    const projectName = pendingCoverProjectName;

    if (!selectedFile || !projectName) return;

    projectCoverImageInput.disabled = true;

    if (projectCoverStatus) {
        projectCoverStatus.textContent = "Preparing image…";
    }

    try {
        const optimizedImage = await optimizeCoverImage(selectedFile);
        const wasSaved = saveProjectCover(
            projectName,
            "image",
            optimizedImage,
            selectedFile.name
        );

        if (!wasSaved) {
            throw new Error("There is not enough browser storage for that image.");
        }

        projectCoverDialog?.close();
        refreshHomeProjects();
    } catch (error) {
        if (projectCoverStatus) {
            projectCoverStatus.textContent =
                error instanceof Error
                    ? error.message
                    : "Unable to use that image.";
        }
    } finally {
        projectCoverImageInput.disabled = false;
        projectCoverImageInput.value = "";
    }
});

projectCoverColourButtons.forEach((colourButton) => {
    colourButton.addEventListener("click", () => {
        if (!pendingCoverProjectName) return;

        const wasSaved = saveProjectCover(
            pendingCoverProjectName,
            "colour",
            colourButton.dataset.coverColour || ""
        );

        if (!wasSaved) {
            if (projectCoverStatus) {
                projectCoverStatus.textContent = "Unable to save that cover colour.";
            }
            return;
        }

        projectCoverDialog?.close();
        refreshHomeProjects();
    });
});

resetProjectCoverButton?.addEventListener("click", () => {
    if (!pendingCoverProjectName) return;

    if (!resetProjectCover(pendingCoverProjectName)) {
        if (projectCoverStatus) {
            projectCoverStatus.textContent = "Unable to reset this cover.";
        }
        return;
    }

    projectCoverDialog?.close();
    refreshHomeProjects();
});

closeProjectCoverButton?.addEventListener("click", () => {
    projectCoverDialog?.close();
});

projectCoverDialog?.addEventListener("click", (event) => {
    if (event.target === projectCoverDialog) {
        projectCoverDialog.close();
    }
});

projectCoverDialog?.addEventListener("close", () => {
    pendingCoverProjectName = "";

    if (projectCoverImageInput) {
        projectCoverImageInput.value = "";
    }
});

deleteProjectMenuItem?.addEventListener("click", () => {
    const projectName = contextProjectName;

    closeProjectContextMenu();

    if (projectName) {
        openDeleteProjectDialog(projectName);
    }
});

deleteProjectConfirmation?.addEventListener("input", () => {
    if (!confirmProjectDeletion) return;

    confirmProjectDeletion.disabled =
        deleteProjectConfirmation.value !== pendingDeletionProjectName;
});

cancelProjectDeletion?.addEventListener("click", () => {
    deleteProjectDialog?.close();
});

deleteProjectForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (
        !pendingDeletionProjectName ||
        deleteProjectConfirmation?.value !== pendingDeletionProjectName
    ) {
        return;
    }

    const projectName = pendingDeletionProjectName;

    deleteProjectDialog?.close();
    await deleteProject(projectName);
});

deleteProjectDialog?.addEventListener("click", (event) => {
    if (event.target === deleteProjectDialog) {
        deleteProjectDialog.close();
    }
});

deleteProjectDialog?.addEventListener("close", () => {
    pendingDeletionProjectName = "";
    deleteProjectConfirmation.value = "";
});

document.addEventListener("pointerdown", (event) => {
    if (!projectContextMenu?.contains(event.target)) {
        closeProjectContextMenu();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !projectContextMenu?.hidden) {
        closeProjectContextMenu();
    }
});

window.addEventListener("resize", closeProjectContextMenu);
window.addEventListener("scroll", closeProjectContextMenu, true);

renderHomeProjects();
