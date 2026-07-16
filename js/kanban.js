const addListButton = document.querySelector(".add-list");
const template = document.querySelector("#list-template");
const listsRow = document.querySelector(".lists-row");
const trash = document.querySelector("#trash");
const alertBox = document.querySelector("#alert");
const cardEditorBackdrop = document.querySelector("#card-editor-backdrop");
const projectTitleInput = document.querySelector(".project-title");
const settingsButton = document.querySelector(".kanban-settings-button");
const settingsPanel = document.querySelector(".kanban-settings-panel");
const renameProjectButton = document.querySelector(".rename-project-button");
const urgencyThresholdInput = document.querySelector("#urgency-threshold");
const boardContent = document.querySelector(".content");
const backgroundImageInput = document.querySelector("#board-background-image");
const removeBackgroundImageButton = document.querySelector(
    ".remove-background-image"
);
const backgroundImageStatus = document.querySelector(
    ".background-image-status"
);
const deleteBoardButton = document.querySelector(".delete-board-button");
const deleteBoardDialog = document.querySelector(".delete-board-dialog");
const deleteBoardForm = document.querySelector(".delete-board-form");
const deleteBoardName = document.querySelector(".delete-board-name");
const deleteBoardConfirmation = document.querySelector(
    ".delete-board-confirmation"
);
const cancelBoardDeletion = document.querySelector(".cancel-board-deletion");
const confirmBoardDeletion = document.querySelector(
    ".confirm-board-deletion"
);

let draggedCard = null;
let draggedFromList = null;
let actionHistory = [];
let activeCardDrag = null;
let activeListDrag = null;
let pendingListDrag = null;
let activeCardNewListGhost = null;
let activeCardEditor = null;
let allowBoardNavigation = false;
let dragAutoScrollFrame = 0;
let dragAutoScrollVelocity = 0;

const colours = ["#b8a4cc", "#a3c9c9", "#8fa99d", "#a7b99a", "#c9a3a3"];
let lastListColour = null;
const DROP_ANIMATION_MS = 180;
const CARD_EDITOR_TRANSITION_MS = 240;
const LIST_DRAG_THRESHOLD = 6;
const DRAG_AUTO_SCROLL_EDGE = 76;
const DRAG_AUTO_SCROLL_MAX_SPEED = 18;
const EMPTY_CARD_DATE_LABEL = "No due date";
const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const PROJECTS_STORAGE_KEY = "lockt:kanban-projects";
const PROJECT_METADATA_STORAGE_KEY = "lockt:kanban-project-metadata";
const PROJECT_SETTINGS_STORAGE_KEY = "lockt:kanban-project-settings";
const NEW_PROJECT_FOCUS_STORAGE_KEY = "lockt:new-kanban-project";
const HOME_INITIALIZED_STORAGE_KEY = "lockt:home-initialized";
const DEFAULT_URGENCY_THRESHOLD_DAYS = 7;
const MAX_BACKGROUND_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_BACKGROUND_IMAGE_DIMENSION = 1600;
let BOARD_STORAGE_KEY = getSelectedBoardStorageKey();
let urgencyThresholdDays = getProjectUrgencyThreshold(BOARD_STORAGE_KEY);
const cardDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
});

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
    } catch (error) {
        console.warn("Unable to save project names", error);
    }
}

function ensureProjectCreationDate(projectName) {
    try {
        const savedMetadata = JSON.parse(
            window.localStorage.getItem(PROJECT_METADATA_STORAGE_KEY) || "{}"
        );
        const metadata =
            savedMetadata &&
            typeof savedMetadata === "object" &&
            !Array.isArray(savedMetadata)
                ? savedMetadata
                : {};
        const savedCreationDate = metadata[projectName]?.createdAt;

        if (
            typeof savedCreationDate === "string" &&
            !Number.isNaN(Date.parse(savedCreationDate))
        ) {
            return;
        }

        window.localStorage.setItem(
            PROJECT_METADATA_STORAGE_KEY,
            JSON.stringify({
                ...metadata,
                [projectName]: { createdAt: new Date().toISOString() }
            })
        );
    } catch (error) {
        console.warn("Unable to save project metadata", error);
    }
}

function rememberProjectName(projectName) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (!normalizedProjectName) return;

    ensureProjectCreationDate(normalizedProjectName);

    const projectNames = readProjectNames();

    if (!projectNames.includes(normalizedProjectName)) {
        saveProjectNames([...projectNames, normalizedProjectName]);
    }
}

function moveProjectCreationDate(previousName, nextName) {
    try {
        const savedMetadata = JSON.parse(
            window.localStorage.getItem(PROJECT_METADATA_STORAGE_KEY) || "{}"
        );
        const metadata =
            savedMetadata &&
            typeof savedMetadata === "object" &&
            !Array.isArray(savedMetadata)
                ? savedMetadata
                : {};
        const creationMetadata = metadata[previousName] || {
            createdAt: new Date().toISOString()
        };
        const metadataWithoutPreviousName = { ...metadata };

        delete metadataWithoutPreviousName[previousName];
        window.localStorage.setItem(
            PROJECT_METADATA_STORAGE_KEY,
            JSON.stringify({
                ...metadataWithoutPreviousName,
                [nextName]: creationMetadata
            })
        );
    } catch (error) {
        console.warn("Unable to rename project metadata", error);
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

function getProjectUrgencyThreshold(projectName) {
    const savedThreshold = readProjectSettings()[projectName]?.urgencyThresholdDays;

    return Number.isInteger(savedThreshold) && savedThreshold >= 0
        ? Math.min(365, savedThreshold)
        : DEFAULT_URGENCY_THRESHOLD_DAYS;
}

function saveProjectUrgencyThreshold(projectName, thresholdDays) {
    try {
        const settings = readProjectSettings();

        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                [projectName]: {
                    ...(settings[projectName] || {}),
                    urgencyThresholdDays: thresholdDays
                }
            })
        );
    } catch (error) {
        console.warn("Unable to save the urgency threshold", error);
    }
}

function getProjectBackgroundImage(projectName) {
    const backgroundImage = readProjectSettings()[projectName]?.backgroundImage;

    return typeof backgroundImage === "string" &&
        backgroundImage.startsWith("data:image/")
        ? backgroundImage
        : "";
}

function saveProjectBackgroundImage(projectName, backgroundImage, fileName) {
    try {
        const settings = readProjectSettings();

        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                [projectName]: {
                    ...(settings[projectName] || {}),
                    backgroundImage,
                    backgroundImageName: fileName
                }
            })
        );
        return true;
    } catch (error) {
        console.warn("Unable to save the board background", error);
        return false;
    }
}

function removeProjectBackgroundImage(projectName) {
    try {
        const settings = readProjectSettings();
        const projectSettings = { ...(settings[projectName] || {}) };

        delete projectSettings.backgroundImage;
        delete projectSettings.backgroundImageName;

        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settings,
                [projectName]: projectSettings
            })
        );
        return true;
    } catch (error) {
        console.warn("Unable to remove the board background", error);
        return false;
    }
}

function applyProjectBackgroundImage() {
    if (!boardContent) return;

    const backgroundImage = getProjectBackgroundImage(BOARD_STORAGE_KEY);

    boardContent.classList.toggle("has-board-background", Boolean(backgroundImage));

    if (backgroundImage) {
        boardContent.style.setProperty(
            "--board-background-image",
            `url("${backgroundImage}")`
        );
    } else {
        boardContent.style.removeProperty("--board-background-image");
    }
}

function syncBackgroundImageControls(message = "") {
    const projectSettings = readProjectSettings()[BOARD_STORAGE_KEY] || {};
    const hasBackgroundImage = Boolean(getProjectBackgroundImage(BOARD_STORAGE_KEY));

    if (removeBackgroundImageButton) {
        removeBackgroundImageButton.hidden = !hasBackgroundImage;
    }

    if (!backgroundImageStatus) return;

    if (message) {
        backgroundImageStatus.textContent = message;
        return;
    }

    backgroundImageStatus.textContent = hasBackgroundImage
        ? `Using ${projectSettings.backgroundImageName || "uploaded image"} as the background and fallback cover.`
        : "Also used as the cover unless a separate cover is chosen.";
}

function loadBackgroundImage(file) {
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

async function optimizeBackgroundImage(file) {
    if (!file.type.startsWith("image/")) {
        throw new Error("Please choose an image file.");
    }

    if (file.size > MAX_BACKGROUND_IMAGE_BYTES) {
        throw new Error("Please choose an image smaller than 15 MB.");
    }

    const image = await loadBackgroundImage(file);
    const scale = Math.min(
        1,
        MAX_BACKGROUND_IMAGE_DIMENSION / Math.max(image.width, image.height)
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

    if (!optimizedImage.startsWith("data:image/")) {
        throw new Error("That image could not be prepared.");
    }

    return optimizedImage;
}

function moveProjectSettings(previousName, nextName) {
    try {
        const settings = readProjectSettings();
        const currentProjectSettings = settings[previousName];

        if (!currentProjectSettings) return;

        const settingsWithoutPreviousName = { ...settings };
        delete settingsWithoutPreviousName[previousName];
        window.localStorage.setItem(
            PROJECT_SETTINGS_STORAGE_KEY,
            JSON.stringify({
                ...settingsWithoutPreviousName,
                [nextName]: currentProjectSettings
            })
        );
    } catch (error) {
        console.warn("Unable to rename project settings", error);
    }
}

function getSelectedBoardStorageKey() {
    const projectFromUrl = normalizeProjectName(
        new URLSearchParams(window.location.search).get("project")
    );

    if (projectFromUrl) {
        window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, projectFromUrl);
        rememberProjectName(projectFromUrl);
        return projectFromUrl;
    }

    const activeProject = normalizeProjectName(
        window.localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY)
    );

    return activeProject || DEFAULT_BOARD_STORAGE_KEY;
}

function syncBoardTitle() {
    document.title = `${BOARD_STORAGE_KEY} Board`;

    if (projectTitleInput) {
        projectTitleInput.value = BOARD_STORAGE_KEY;
        projectTitleInput.setCustomValidity("");
    }
}

function rejectProjectTitle(message) {
    if (!projectTitleInput) return;

    projectTitleInput.setCustomValidity(message);
    projectTitleInput.reportValidity();
    projectTitleInput.focus();
    projectTitleInput.select();
}

function getProjectTitleValidationMessage(projectName) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (!normalizedProjectName) {
        return "Project title cannot be empty.";
    }

    if (normalizedProjectName === BOARD_STORAGE_KEY) {
        return "";
    }

    if (
        normalizedProjectName.startsWith("lockt:") ||
        normalizedProjectName === LEGACY_BOARD_STORAGE_KEY
    ) {
        return "That project title is reserved.";
    }

    if (
        readProjectNames().includes(normalizedProjectName) ||
        window.localStorage.getItem(normalizedProjectName) !== null
    ) {
        return "A project with that title already exists.";
    }

    return "";
}

function renameBoard(nextProjectName) {
    const normalizedProjectName = normalizeProjectName(nextProjectName);
    const validationMessage = getProjectTitleValidationMessage(nextProjectName);

    if (validationMessage) {
        rejectProjectTitle(validationMessage);
        return false;
    }

    if (normalizedProjectName === BOARD_STORAGE_KEY) {
        syncBoardTitle();
        return true;
    }

    const previousProjectName = BOARD_STORAGE_KEY;

    try {
        window.localStorage.setItem(
            normalizedProjectName,
            JSON.stringify(getBoardState())
        );
        window.localStorage.removeItem(previousProjectName);

        if (previousProjectName === DEFAULT_BOARD_STORAGE_KEY) {
            window.localStorage.removeItem(LEGACY_BOARD_STORAGE_KEY);
        }

        saveProjectNames([
            ...readProjectNames().filter((name) => name !== previousProjectName),
            normalizedProjectName
        ]);
        moveProjectCreationDate(previousProjectName, normalizedProjectName);
        moveProjectSettings(previousProjectName, normalizedProjectName);
        void window.LocktWhiteboardStorage?.move(
            previousProjectName,
            normalizedProjectName
        );

        BOARD_STORAGE_KEY = normalizedProjectName;
        window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, BOARD_STORAGE_KEY);

        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("project", BOARD_STORAGE_KEY);
        window.history.replaceState(null, "", nextUrl);
        syncBoardTitle();
        return true;
    } catch (error) {
        console.warn("Unable to rename project", error);
        rejectProjectTitle("Unable to rename this project.");
        return false;
    }
}

function setupProjectTitleEditor() {
    if (!projectTitleInput) return;

    projectTitleInput.addEventListener("input", () => {
        projectTitleInput.setCustomValidity(
            getProjectTitleValidationMessage(projectTitleInput.value)
        );
    });
    projectTitleInput.addEventListener("change", () => {
        renameBoard(projectTitleInput.value);
    });
    projectTitleInput.addEventListener("blur", () => {
        const validationMessage = getProjectTitleValidationMessage(
            projectTitleInput.value
        );

        if (!validationMessage) return;

        projectTitleInput.setCustomValidity(validationMessage);

        requestAnimationFrame(() => {
            const currentValidationMessage = getProjectTitleValidationMessage(
                projectTitleInput.value
            );

            if (!currentValidationMessage) return;

            projectTitleInput.setCustomValidity(currentValidationMessage);
            projectTitleInput.focus();
            projectTitleInput.reportValidity();
            projectTitleInput.select();
        });
    });
    projectTitleInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            projectTitleInput.blur();
        }

        if (event.key === "Escape") {
            event.preventDefault();
            syncBoardTitle();
            projectTitleInput.blur();
        }
    });
}

function focusNewProjectTitle() {
    if (!projectTitleInput) return;

    let newProjectName = "";

    try {
        newProjectName = window.sessionStorage.getItem(
            NEW_PROJECT_FOCUS_STORAGE_KEY
        );
    } catch (error) {
        console.warn("Unable to read the new project editing state", error);
    }

    if (newProjectName !== BOARD_STORAGE_KEY) {
        return;
    }

    try {
        window.sessionStorage.removeItem(NEW_PROJECT_FOCUS_STORAGE_KEY);
    } catch (error) {
        console.warn("Unable to clear the new project editing state", error);
    }

    requestAnimationFrame(() => {
        projectTitleInput.focus();
        projectTitleInput.select();
    });
}

function closeKanbanSettings() {
    if (!settingsPanel || !settingsButton) return;

    settingsPanel.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
}

function setupKanbanSettings() {
    if (!settingsPanel || !settingsButton || !urgencyThresholdInput) return;

    urgencyThresholdInput.value = String(urgencyThresholdDays);

    renameProjectButton?.addEventListener("click", () => {
        closeKanbanSettings();
        projectTitleInput?.focus();
        projectTitleInput?.select();
    });

    settingsButton.addEventListener("click", () => {
        const willOpen = settingsPanel.hidden;

        settingsPanel.hidden = !willOpen;
        settingsButton.setAttribute("aria-expanded", String(willOpen));

        if (willOpen) {
            urgencyThresholdInput.focus();
            urgencyThresholdInput.select();
        }
    });

    urgencyThresholdInput.addEventListener("input", () => {
        if (urgencyThresholdInput.value === "") return;

        const parsedThreshold = Number(urgencyThresholdInput.value);

        if (!Number.isFinite(parsedThreshold)) return;

        urgencyThresholdDays = Math.max(
            0,
            Math.min(365, Math.round(parsedThreshold))
        );
        saveProjectUrgencyThreshold(
            BOARD_STORAGE_KEY,
            urgencyThresholdDays
        );
        refreshCardUrgency();
        saveBoardState();
    });

    urgencyThresholdInput.addEventListener("change", () => {
        urgencyThresholdInput.value = String(urgencyThresholdDays);
    });

    document.addEventListener("pointerdown", (event) => {
        if (
            settingsPanel.hidden ||
            settingsPanel.contains(event.target) ||
            settingsButton.contains(event.target)
        ) {
            return;
        }

        closeKanbanSettings();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || settingsPanel.hidden) return;

        closeKanbanSettings();
        settingsButton.focus();
    });

    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;

        refreshCardUrgency();
        saveBoardState();
    });
}

function setupBackgroundImageSettings() {
    applyProjectBackgroundImage();
    syncBackgroundImageControls();

    backgroundImageInput?.addEventListener("change", async () => {
        const selectedFile = backgroundImageInput.files?.[0];

        if (!selectedFile) return;

        backgroundImageInput.disabled = true;
        syncBackgroundImageControls("Preparing image…");

        try {
            const optimizedImage = await optimizeBackgroundImage(selectedFile);
            const wasSaved = saveProjectBackgroundImage(
                BOARD_STORAGE_KEY,
                optimizedImage,
                selectedFile.name
            );

            if (!wasSaved) {
                throw new Error(
                    "There is not enough browser storage for that image."
                );
            }

            applyProjectBackgroundImage();
            syncBackgroundImageControls();
        } catch (error) {
            syncBackgroundImageControls(
                error instanceof Error
                    ? error.message
                    : "Unable to use that image."
            );
        } finally {
            backgroundImageInput.disabled = false;
            backgroundImageInput.value = "";
        }
    });

    removeBackgroundImageButton?.addEventListener("click", () => {
        if (!removeProjectBackgroundImage(BOARD_STORAGE_KEY)) {
            syncBackgroundImageControls("Unable to remove the background image.");
            return;
        }

        applyProjectBackgroundImage();
        syncBackgroundImageControls();
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

async function deleteCurrentBoard() {
    const projectName = BOARD_STORAGE_KEY;

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

    allowBoardNavigation = true;
    window.location.href = "index.html";
}

function setupBoardDeletion() {
    if (
        !deleteBoardButton ||
        !deleteBoardDialog ||
        !deleteBoardForm ||
        !deleteBoardName ||
        !deleteBoardConfirmation ||
        !confirmBoardDeletion
    ) {
        return;
    }

    deleteBoardButton.addEventListener("click", () => {
        closeKanbanSettings();
        deleteBoardName.textContent = BOARD_STORAGE_KEY;
        deleteBoardConfirmation.value = "";
        confirmBoardDeletion.disabled = true;
        deleteBoardDialog.showModal();

        requestAnimationFrame(() => {
            deleteBoardConfirmation.focus();
        });
    });

    deleteBoardConfirmation.addEventListener("input", () => {
        confirmBoardDeletion.disabled =
            deleteBoardConfirmation.value !== BOARD_STORAGE_KEY;
    });

    cancelBoardDeletion?.addEventListener("click", () => {
        deleteBoardDialog.close();
    });

    deleteBoardForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (deleteBoardConfirmation.value !== BOARD_STORAGE_KEY) return;

        deleteBoardDialog.close();
        await deleteCurrentBoard();
    });

    deleteBoardDialog.addEventListener("click", (event) => {
        if (event.target === deleteBoardDialog) {
            deleteBoardDialog.close();
        }
    });

    deleteBoardDialog.addEventListener("close", () => {
        deleteBoardConfirmation.value = "";
        confirmBoardDeletion.disabled = true;
    });
}

document.querySelector(".back")?.addEventListener("click", () => {
    if (!renameBoard(projectTitleInput?.value || "")) return;

    allowBoardNavigation = true;
    window.location.href = "index.html";
});

window.addEventListener("beforeunload", (event) => {
    if (
        allowBoardNavigation ||
        renameBoard(projectTitleInput?.value || BOARD_STORAGE_KEY)
    ) {
        return;
    }

    event.preventDefault();
    event.returnValue = "";
});

function getRandomListColour() {
    const availableColours = colours.filter((colour) => {
        return colour !== lastListColour;
    });

    const randomColour = availableColours[
        Math.floor(Math.random() * availableColours.length)
    ];

    lastListColour = randomColour;
    return randomColour;
}

function getListAfterPointer(pointerX, pointerY) {
    const otherLists = [
        ...listsRow.querySelectorAll(
            '.list:not(.list-placeholder):not([data-ghost-list="true"])'
        )
    ];
    const isVerticalLayout =
        window.getComputedStyle(listsRow).display === "grid";

    return otherLists.reduce(
        (closest, list) => {
            const bounds = list.getBoundingClientRect();
            const pointerPosition = isVerticalLayout ? pointerY : pointerX;
            const listStart = isVerticalLayout ? bounds.top : bounds.left;
            const listSize = isVerticalLayout ? bounds.height : bounds.width;
            const offset = pointerPosition - listStart - listSize / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset, element: list };
            }

            return closest;
        },
        { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
}

function recordAction(action) {
    actionHistory.push(action);
}

function insertNodeAt(parent, node, nextSibling = null) {
    if (!parent || !node) return;

    if (nextSibling && nextSibling.parentElement === parent) {
        parent.insertBefore(node, nextSibling);
        return;
    }

    if (parent === listsRow && addListButton.parentElement === parent) {
        parent.insertBefore(node, addListButton);
        return;
    }

    parent.appendChild(node);
}

function readBoardState() {
    try {
        const savedBoardState =
            window.localStorage.getItem(BOARD_STORAGE_KEY) ||
            (BOARD_STORAGE_KEY === DEFAULT_BOARD_STORAGE_KEY
                ? window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY)
                : null);

        if (!savedBoardState) {
            return null;
        }

        const parsedBoardState = JSON.parse(savedBoardState);

        if (!parsedBoardState || !Array.isArray(parsedBoardState.lists)) {
            return null;
        }

        return parsedBoardState;
    } catch (error) {
        console.warn("Unable to read saved board state", error);
        return null;
    }
}

function getCardTitleText(card) {
    const description = card.querySelector("p");

    if (!description) {
        return "";
    }

    return (description.innerText || description.textContent || "")
        .replace(/\r\n/g, "\n")
        .trim();
}

function getCardData(card) {
    const date = card.querySelector(".date");
    const dateLabel = date?.textContent?.trim() || EMPTY_CARD_DATE_LABEL;
    const dateValue = getCardDateValue(card);

    return {
        title: getCardTitleText(card),
        startDateValue: normalizeDateValue(card.dataset.startDateValue || ""),
        dateValue,
        dateLabel,
        isEmptyDate:
            date?.classList.contains("is-empty") ||
            dateLabel === EMPTY_CARD_DATE_LABEL,
        urgent: card.classList.contains("urgent")
    };
}

function getListData(list) {
    const titleInput = list.querySelector(".list-title");
    const cardsContainer = list.querySelector(".list-cards");
    const themeNeutralBackground = list.style
        .getPropertyValue("--lockt-list-colour")
        .trim();

    return {
        title: titleInput?.value || "",
        backgroundColor:
            themeNeutralBackground ||
            list.style.backgroundColor ||
            window.getComputedStyle(list).backgroundColor,
        cards: cardsContainer
            ? [...cardsContainer.querySelectorAll(".card")].map(getCardData)
            : []
    };
}

function getBoardState() {
    const lists = [...listsRow.children].filter((element) => {
        return (
            element.classList.contains("list") &&
            element.dataset.ghostList !== "true"
        );
    });

    return {
        lists: lists.map(getListData)
    };
}

function saveBoardState() {
    try {
        refreshCardUrgency();
        rememberProjectName(BOARD_STORAGE_KEY);
        window.localStorage.setItem(
            BOARD_STORAGE_KEY,
            JSON.stringify(getBoardState())
        );
    } catch (error) {
        console.warn("Unable to save board state", error);
    }
}

function clearDragHighlights() {
    document.querySelectorAll(".list-cards").forEach((container) => {
        container.classList.remove("drag-over");
    });

    trash.classList.remove("drag-over");
}

function captureDragPointer(pointerId) {
    if (!Number.isInteger(pointerId)) return null;

    try {
        listsRow.setPointerCapture(pointerId);
        return listsRow;
    } catch (error) {
        return null;
    }
}

function releaseDragPointerCapture(dragState) {
    const captureElement = dragState?.captureElement;
    const pointerId = dragState?.pointerId;

    if (!captureElement || !Number.isInteger(pointerId)) return;

    try {
        if (captureElement.hasPointerCapture(pointerId)) {
            captureElement.releasePointerCapture(pointerId);
        }
    } catch (error) {
        // The browser may already have released capture after pointerup.
    }
}

function stopDragAutoScroll() {
    dragAutoScrollVelocity = 0;

    if (dragAutoScrollFrame) {
        window.cancelAnimationFrame(dragAutoScrollFrame);
        dragAutoScrollFrame = 0;
    }
}

function runDragAutoScroll() {
    if (!activeCardDrag && !activeListDrag) {
        stopDragAutoScroll();
        return;
    }

    if (dragAutoScrollVelocity) {
        window.scrollBy(0, dragAutoScrollVelocity);
    }

    dragAutoScrollFrame = window.requestAnimationFrame(runDragAutoScroll);
}

function updateDragAutoScroll(pointerY) {
    const viewportHeight = window.innerHeight;
    let nextVelocity = 0;

    if (pointerY < DRAG_AUTO_SCROLL_EDGE) {
        const strength = 1 - pointerY / DRAG_AUTO_SCROLL_EDGE;
        nextVelocity = -Math.max(
            2,
            Math.round(DRAG_AUTO_SCROLL_MAX_SPEED * strength)
        );
    } else if (pointerY > viewportHeight - DRAG_AUTO_SCROLL_EDGE) {
        const strength =
            (pointerY - (viewportHeight - DRAG_AUTO_SCROLL_EDGE)) /
            DRAG_AUTO_SCROLL_EDGE;
        nextVelocity = Math.max(
            2,
            Math.round(DRAG_AUTO_SCROLL_MAX_SPEED * strength)
        );
    }

    dragAutoScrollVelocity = nextVelocity;

    if (!dragAutoScrollFrame) {
        dragAutoScrollFrame = window.requestAnimationFrame(runDragAutoScroll);
    }
}

function stopListPointerTracking() {
    window.removeEventListener("pointermove", handleListPointerMove);
    window.removeEventListener("pointerup", handleListPointerUp);
    window.removeEventListener("pointercancel", handleListPointerCancel);

    releaseDragPointerCapture(activeListDrag);
    stopDragAutoScroll();
    document.body.classList.remove("list-drag-active");
    clearDragHighlights();
}

function stopPendingListPointerTracking() {
    window.removeEventListener("pointermove", handlePendingListPointerMove);
    window.removeEventListener("pointerup", handlePendingListPointerUp);
    window.removeEventListener("pointercancel", handlePendingListPointerCancel);
}

function resetListDragState() {
    activeListDrag = null;
}

function resetPendingListDragState() {
    pendingListDrag = null;
}

function resetCardNewListGhostState() {
    activeCardNewListGhost = null;
}

function formatDateInputValue(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function normalizeDateValue(dateValue) {
    if (typeof dateValue !== "string" || !dateValue.trim()) {
        return "";
    }

    const trimmedDateValue = dateValue.trim();
    const parsedDate = new Date(`${trimmedDateValue}T00:00:00`);

    if (Number.isNaN(parsedDate.getTime())) {
        return "";
    }

    return formatDateInputValue(parsedDate);
}

function deriveDateValueFromLabel(dateLabel) {
    if (typeof dateLabel !== "string") {
        return "";
    }

    const trimmedLabel = dateLabel.replace(/^◷\s*/, "").trim();

    if (!trimmedLabel || trimmedLabel === EMPTY_CARD_DATE_LABEL) {
        return "";
    }

    const fallbackYear = new Date().getFullYear();
    const parsedDate = new Date(`${trimmedLabel}, ${fallbackYear} 00:00:00`);

    if (Number.isNaN(parsedDate.getTime())) {
        return "";
    }

    return formatDateInputValue(parsedDate);
}

function getCardDateValue(card) {
    const date = card.querySelector(".date");

    if (!date) {
        return "";
    }

    const normalizedDateValue = normalizeDateValue(date.dataset.dateValue || "");

    if (normalizedDateValue) {
        date.dataset.dateValue = normalizedDateValue;
        return normalizedDateValue;
    }

    const derivedDateValue = deriveDateValueFromLabel(
        date.textContent?.trim() || ""
    );

    if (derivedDateValue) {
        date.dataset.dateValue = derivedDateValue;
    }

    return derivedDateValue;
}

function shouldCardBeUrgent(card) {
    const dateValue = getCardDateValue(card);

    if (!dateValue) return false;

    const dueDate = new Date(`${dateValue}T00:00:00`);
    const today = new Date();

    if (Number.isNaN(dueDate.getTime())) return false;

    today.setHours(0, 0, 0, 0);

    const daysUntilDue = Math.ceil(
        (dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
    );

    return daysUntilDue <= urgencyThresholdDays;
}

function refreshCardUrgency() {
    document.querySelectorAll(".card").forEach((card) => {
        card.classList.toggle("urgent", shouldCardBeUrgent(card));
    });
}

function renderCardDisplayContent(card, cardData = {}) {
    const title = typeof cardData.title === "string" ? cardData.title.trim() : "";
    const fallbackDateLabel =
        typeof cardData.dateLabel === "string" && cardData.dateLabel.trim()
            ? cardData.dateLabel.trim()
            : EMPTY_CARD_DATE_LABEL;
    const dateValue =
        normalizeDateValue(cardData.dateValue) ||
        deriveDateValueFromLabel(fallbackDateLabel);
    const startDateValue = normalizeDateValue(
        typeof cardData.startDateValue === "string"
            ? cardData.startDateValue
            : card.dataset.startDateValue || ""
    );
    const options = document.createElement("div");
    const dragHandle = document.createElement("button");
    const description = document.createElement("p");
    const date = document.createElement("div");

    if (typeof cardData.urgent === "boolean") {
        card.classList.toggle("urgent", cardData.urgent);
    }

    if (startDateValue) {
        card.dataset.startDateValue = startDateValue;
    } else {
        delete card.dataset.startDateValue;
    }

    options.className = "card-options";
    options.textContent = "•••";
    options.setAttribute("role", "button");
    options.setAttribute("aria-label", "Edit card");
    options.tabIndex = 0;

    dragHandle.className = "card-drag-handle";
    dragHandle.type = "button";
    dragHandle.textContent = "⠿";
    dragHandle.setAttribute(
        "aria-label",
        "Drag " + (title || "task")
    );

    description.textContent = title;
    date.className = "date";
    date.textContent = dateValue ? formatCardDate(dateValue) : fallbackDateLabel;

    if (dateValue) {
        date.dataset.dateValue = dateValue;
    } else if (fallbackDateLabel === EMPTY_CARD_DATE_LABEL) {
        date.classList.add("is-empty");
    }

    card.replaceChildren(options, dragHandle, description, date);
    setupCardOptions(options);
}

function renderCardEditorContent(card) {
    const fields = document.createElement("div");
    const titleInput = document.createElement("input");
    const dateInput = document.createElement("input");

    fields.className = "card-editor-fields";

    titleInput.className = "card-title-editor";
    titleInput.type = "text";
    titleInput.maxLength = 120;
    titleInput.placeholder = "Card title";
    titleInput.value = getCardTitleText(card);
    titleInput.setAttribute("aria-label", "Card title");

    dateInput.className = "card-date-editor";
    dateInput.type = "date";
    dateInput.value = getCardDateValue(card);
    dateInput.setAttribute("aria-label", "Due date");

    fields.append(titleInput, dateInput);
    card.replaceChildren(fields);

    return {
        titleInput,
        dateInput
    };
}

function openCardEditor(card) {
    if (!card || activeCardEditor || !cardEditorBackdrop) {
        return;
    }

    if (activeCardDrag) {
        clearCardDrag();
    }

    if (activeListDrag) {
        clearListDrag();
    }

    if (pendingListDrag) {
        clearPendingListDrag();
    }

    const bounds = card.getBoundingClientRect();
    const placeholder = card.cloneNode(true);
    const translateX = window.innerWidth / 2 - (bounds.left + bounds.width / 2);
    const translateY = window.innerHeight / 2 - (bounds.top + bounds.height / 2);

    resetCardCloneState(placeholder);
    placeholder.classList.add("card-editor-placeholder");
    placeholder.style.height = `${bounds.height}px`;
    placeholder.style.minHeight = `${bounds.height}px`;

    card.replaceWith(placeholder);
    document.body.appendChild(card);

    card.classList.add("card-editor-active");
    card.style.left = `${bounds.left}px`;
    card.style.top = `${bounds.top}px`;
    card.style.width = `${bounds.width}px`;
    card.style.minHeight = `${bounds.height}px`;
    card.style.setProperty("--card-editor-translate-x", `${translateX}px`);
    card.style.setProperty("--card-editor-translate-y", `${translateY}px`);

    const { titleInput, dateInput } = renderCardEditorContent(card);

    activeCardEditor = {
        card,
        placeholder,
        titleInput,
        dateInput
    };

    cardEditorBackdrop.hidden = false;
    document.body.classList.add("card-editor-open");

    requestAnimationFrame(() => {
        cardEditorBackdrop.classList.add("show");
        card.classList.add("is-open");
        titleInput.focus();
        titleInput.select();
    });
}

function closeCardEditor({ focusOptions = false } = {}) {
    if (!activeCardEditor || !cardEditorBackdrop) {
        return;
    }

    const { card, placeholder, titleInput, dateInput } = activeCardEditor;

    renderCardDisplayContent(card, {
        title: titleInput.value,
        dateValue: dateInput.value,
        urgent: card.classList.contains("urgent")
    });

    card.classList.remove("is-open");
    cardEditorBackdrop.classList.remove("show");

    window.setTimeout(() => {
        if (!activeCardEditor || activeCardEditor.card !== card) {
            return;
        }

        card.classList.remove("card-editor-active");
        card.style.removeProperty("left");
        card.style.removeProperty("top");
        card.style.removeProperty("width");
        card.style.removeProperty("min-height");
        card.style.removeProperty("--card-editor-translate-x");
        card.style.removeProperty("--card-editor-translate-y");
        document.body.classList.remove("card-editor-open");
        cardEditorBackdrop.hidden = true;

        if (placeholder.isConnected) {
            placeholder.replaceWith(card);
        }

        activeCardEditor = null;
        saveBoardState();

        if (focusOptions) {
            card.querySelector(".card-options")?.focus();
        }
    }, CARD_EDITOR_TRANSITION_MS);
}

function ensureCardNewListGhost() {
    if (activeCardNewListGhost?.list?.isConnected) {
        return activeCardNewListGhost;
    }

    const list = buildListElement({
        title: "",
        cards: []
    });
    const container = list.querySelector(".list-cards");
    const titleInput = list.querySelector(".list-title");

    list.dataset.ghostList = "true";
    list.classList.add("list-ghost");
    titleInput.value = "";
    titleInput.placeholder = "New List";

    listsRow.insertBefore(list, addListButton);
    addListButton.classList.add("is-hidden");

    activeCardNewListGhost = {
        list,
        container,
        titleInput
    };

    return activeCardNewListGhost;
}

function removeCardNewListGhost() {
    if (!activeCardNewListGhost) return;

    activeCardNewListGhost.list.remove();
    addListButton.classList.remove("is-hidden");
    resetCardNewListGhostState();
}

function finalizeCardNewListGhost() {
    if (!activeCardNewListGhost) {
        return null;
    }

    const ghostList = activeCardNewListGhost;

    ghostList.list.classList.remove("list-ghost");
    ghostList.list.style.backgroundColor = getRandomListColour();
    delete ghostList.list.dataset.ghostList;
    addListButton.classList.remove("is-hidden");

    recordAction({
        type: "list-add",
        list: ghostList.list
    });

    resetCardNewListGhostState();

    return ghostList;
}

function clearListDrag({ restore = true } = {}) {
    if (!activeListDrag) return;

    const { list, placeholder, preview } = activeListDrag;

    preview.remove();

    if (restore && placeholder.isConnected) {
        placeholder.replaceWith(list);
    }

    stopListPointerTracking();
    resetListDragState();
}

function clearPendingListDrag() {
    if (!pendingListDrag) return;

    stopPendingListPointerTracking();
    resetPendingListDragState();
}

function stopCardPointerTracking() {
    window.removeEventListener("pointermove", handleCardPointerMove);
    window.removeEventListener("pointerup", handleCardPointerUp);
    window.removeEventListener("pointercancel", handleCardPointerCancel);

    releaseDragPointerCapture(activeCardDrag);
    stopDragAutoScroll();
    document.body.classList.remove("card-drag-active");
    clearDragHighlights();
}

function resetCardDragState() {
    activeCardDrag = null;
    draggedCard = null;
    draggedFromList = null;
}

function clearCardDrag() {
    if (!activeCardDrag) return;

    activeCardDrag.preview.remove();
    stopCardPointerTracking();
    resetCardDragState();
}

function showDeleteAlert() {
    alertBox.classList.add("show");

    setTimeout(() => {
        alertBox.classList.remove("show");
    }, 5000);
}

function getPointerDropTarget(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);

    if (!target) {
        return { container: null, overTrash: false };
    }

    if (target.closest("#trash")) {
        return { container: null, overTrash: true };
    }

    const ghostList = target.closest('[data-ghost-list="true"]');

    if (ghostList) {
        return {
            container: ghostList.querySelector(".list-cards"),
            overTrash: false
        };
    }

    if (activeCardDrag && target.closest(".add-list")) {
        return {
            container: ensureCardNewListGhost().container,
            overTrash: false
        };
    }

    return {
        container: target.closest(".list-cards"),
        overTrash: false
    };
}

function movePlaceholderToPointer(
    container,
    placeholder,
    pointerX,
    pointerY
) {
    const nextCard = getCardAfterPointer(container, pointerX, pointerY);

    if (nextCard) {
        container.insertBefore(placeholder, nextCard);
    } else {
        container.appendChild(placeholder);
    }
}

function updateCardPreviewPosition(clientX, clientY) {
    if (!activeCardDrag) return;

    activeCardDrag.preview.style.left = `${
        clientX - activeCardDrag.pointerOffsetX
    }px`;
    activeCardDrag.preview.style.top = `${
        clientY - activeCardDrag.pointerOffsetY
    }px`;
}

function handleCardPointerMove(event) {
    if (
        !activeCardDrag ||
        event.pointerId !== activeCardDrag.pointerId
    ) {
        return;
    }

    event.preventDefault();
    updateCardPreviewPosition(event.clientX, event.clientY);
    updateDragAutoScroll(event.clientY);
    clearDragHighlights();

    const { container, overTrash } = getPointerDropTarget(
        event.clientX,
        event.clientY
    );

    if (overTrash) {
        trash.classList.add("drag-over");
        return;
    }

    if (!container) return;

    container.classList.add("drag-over");
    movePlaceholderToPointer(
        container,
        activeCardDrag.placeholder,
        event.clientX,
        event.clientY
    );

    if (
        activeCardNewListGhost &&
        container !== activeCardNewListGhost.container
    ) {
        removeCardNewListGhost();
    }
}

function updateListPreviewPosition(clientX, clientY) {
    if (!activeListDrag) return;

    activeListDrag.preview.style.left = `${
        clientX - activeListDrag.pointerOffsetX
    }px`;
    activeListDrag.preview.style.top = `${
        clientY - activeListDrag.pointerOffsetY
    }px`;
}

function moveListPlaceholderToPointer(pointerX, pointerY) {
    if (!activeListDrag) return;

    const nextList = getListAfterPointer(pointerX, pointerY);

    if (nextList) {
        listsRow.insertBefore(activeListDrag.placeholder, nextList);
        return;
    }

    listsRow.insertBefore(activeListDrag.placeholder, addListButton);
}

function handleListPointerMove(event) {
    if (
        !activeListDrag ||
        event.pointerId !== activeListDrag.pointerId
    ) {
        return;
    }

    event.preventDefault();
    updateListPreviewPosition(event.clientX, event.clientY);
    updateDragAutoScroll(event.clientY);
    clearDragHighlights();

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);

    if (overTrash) {
        trash.classList.add("drag-over");
        return;
    }

    moveListPlaceholderToPointer(event.clientX, event.clientY);
}

function beginListDrag(listDrag, clientX, clientY) {
    const { list, pointerId, pointerOffsetX, pointerOffsetY } = listDrag;
    const bounds = list.getBoundingClientRect();
    const preview = list.cloneNode(true);
    const placeholder = list.cloneNode(true);

    resetListCloneState(preview);
    resetListCloneState(placeholder);

    preview.classList.add("list-preview");
    preview.style.width = `${bounds.width}px`;
    preview.style.height = `${bounds.height}px`;
    preview.style.minHeight = `${bounds.height}px`;
    preview.style.transformOrigin = `${pointerOffsetX}px ${pointerOffsetY}px`;

    placeholder.classList.add("list-placeholder");
    placeholder.style.height = `${bounds.height}px`;
    placeholder.style.minHeight = `${bounds.height}px`;

    list.querySelector(".list-title")?.blur();
    list.replaceWith(placeholder);
    document.body.appendChild(preview);

    activeListDrag = {
        list,
        placeholder,
        preview,
        pointerId,
        pointerOffsetX,
        pointerOffsetY,
        captureElement: captureDragPointer(pointerId)
    };

    updateListPreviewPosition(clientX, clientY);

    requestAnimationFrame(() => {
        preview.classList.add("is-tilted");
    });

    window.addEventListener("pointermove", handleListPointerMove);
    window.addEventListener("pointerup", handleListPointerUp);
    window.addEventListener("pointercancel", handleListPointerCancel);

    document.body.classList.add("list-drag-active");
}

function handlePendingListPointerMove(event) {
    if (!pendingListDrag || event.pointerId !== pendingListDrag.pointerId) {
        return;
    }

    const travelledX = event.clientX - pendingListDrag.startX;
    const travelledY = event.clientY - pendingListDrag.startY;

    if (Math.hypot(travelledX, travelledY) < LIST_DRAG_THRESHOLD) {
        return;
    }

    const pendingDrag = pendingListDrag;

    clearPendingListDrag();
    beginListDrag(pendingDrag, event.clientX, event.clientY);
    event.preventDefault();
}

function handlePendingListPointerUp(event) {
    if (!pendingListDrag || event.pointerId !== pendingListDrag.pointerId) {
        return;
    }

    clearPendingListDrag();
}

function handlePendingListPointerCancel(event) {
    if (!pendingListDrag || event.pointerId !== pendingListDrag.pointerId) {
        return;
    }

    clearPendingListDrag();
}

function resetCardCloneState(cardElement) {
    cardElement.classList.remove(
        "card-drop-settle",
        "card-preview",
        "card-placeholder",
        "is-tilted",
        "is-dropping",
        "is-settling"
    );
}

function resetListCloneState(listElement) {
    listElement.classList.remove(
        "list-drop-settle",
        "list-preview",
        "list-placeholder",
        "is-tilted",
        "is-dropping",
        "is-settling"
    );

    listElement
        .querySelectorAll(
            ".card-drop-settle, .card-preview, .card-placeholder, .is-tilted, .is-dropping, .is-settling"
        )
        .forEach((element) => {
            element.classList.remove(
                "card-drop-settle",
                "card-preview",
                "card-placeholder",
                "is-tilted",
                "is-dropping",
                "is-settling"
            );
        });
}

function animateDroppedCard(card) {
    card.classList.remove("card-drop-settle");
    void card.offsetWidth;
    card.classList.add("card-drop-settle");
    card.addEventListener(
        "animationend",
        () => {
            card.classList.remove("card-drop-settle");
        },
        { once: true }
    );
}

function finishCardDrop({ deleteCard = false } = {}) {
    if (!activeCardDrag) return;

    const cardDrag = activeCardDrag;
    const { card, placeholder, preview, sourceList } = cardDrag;
    const ghostList = activeCardNewListGhost;
    const droppedInGhost =
        ghostList && placeholder.parentElement === ghostList.container;

    stopCardPointerTracking();
    resetCardDragState();

    if (deleteCard) {
        const restoreParent = droppedInGhost
            ? sourceList
            : placeholder.parentElement || sourceList;

        recordAction({
            type: "card-delete",
            card,
            parent: restoreParent,
            nextSibling: droppedInGhost ? null : placeholder.nextElementSibling
        });

        placeholder.remove();
        preview.remove();
        removeCardNewListGhost();
        saveBoardState();
        showDeleteAlert();
        return;
    }

    let newListTitleInput = null;

    if (ghostList) {
        if (droppedInGhost) {
            newListTitleInput = finalizeCardNewListGhost()?.titleInput || null;
        } else {
            removeCardNewListGhost();
        }
    }

    const targetBounds = placeholder.getBoundingClientRect();

    placeholder.classList.add("is-settling");
    preview.classList.add("is-dropping");
    preview.style.left = `${targetBounds.left}px`;
    preview.style.top = `${targetBounds.top}px`;
    preview.style.width = `${targetBounds.width}px`;
    preview.style.height = `${targetBounds.height}px`;
    preview.style.minHeight = `${targetBounds.height}px`;

    window.setTimeout(() => {
        placeholder.replaceWith(card);
        animateDroppedCard(card);
        preview.remove();
        saveBoardState();

        if (newListTitleInput) {
            newListTitleInput.focus();
        }
    }, DROP_ANIMATION_MS);
}

function finishListDrop({ deleteList = false } = {}) {
    if (!activeListDrag) return;

    const listDrag = activeListDrag;
    const { list, placeholder, preview } = listDrag;

    if (deleteList) {
        recordAction({
            type: "list-delete",
            list,
            parent: placeholder.parentElement || listsRow,
            nextSibling: placeholder.nextElementSibling
        });

        placeholder.remove();
        preview.remove();
        stopListPointerTracking();
        resetListDragState();
        saveBoardState();
        showDeleteAlert();
        return;
    }

    preview.remove();
    placeholder.replaceWith(list);
    stopListPointerTracking();
    resetListDragState();
    saveBoardState();
}

function handleCardPointerUp(event) {
    if (
        !activeCardDrag ||
        event.pointerId !== activeCardDrag.pointerId
    ) {
        return;
    }

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);
    finishCardDrop({ deleteCard: overTrash });
}

function handleListPointerUp(event) {
    if (
        !activeListDrag ||
        event.pointerId !== activeListDrag.pointerId
    ) {
        return;
    }

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);

    finishListDrop({ deleteList: overTrash });
}

function handleCardPointerCancel(event) {
    if (
        !activeCardDrag ||
        event.pointerId !== activeCardDrag.pointerId
    ) {
        return;
    }

    finishCardDrop();
}

function handleListPointerCancel(event) {
    if (
        !activeListDrag ||
        event.pointerId !== activeListDrag.pointerId
    ) {
        return;
    }

    clearListDrag();
}

function formatCardDate(dateValue) {
    if (!dateValue) {
        return EMPTY_CARD_DATE_LABEL;
    }

    const parsedDate = new Date(`${dateValue}T00:00:00`);

    if (Number.isNaN(parsedDate.getTime())) {
        return EMPTY_CARD_DATE_LABEL;
    }

    return `◷ ${cardDateFormatter.format(parsedDate)}`;
}

function createCardElement(title, dateValue) {
    const formattedDate = formatCardDate(dateValue);

    return buildCardElement({
        title,
        dateValue,
        dateLabel: formattedDate,
        isEmptyDate: formattedDate === EMPTY_CARD_DATE_LABEL
    });
}

function buildCardElement(cardData = {}) {
    const card = document.createElement("div");

    card.className = "card";

    if (cardData.urgent) {
        card.classList.add("urgent");
    }

    renderCardDisplayContent(card, cardData);

    setupCard(card);

    return card;
}

function buildListElement(listData = {}) {
    const clone = template.content.cloneNode(true);
    const list = clone.querySelector(".list");
    const titleInput = clone.querySelector(".list-title");
    const cardsContainer = clone.querySelector(".list-cards");
    const cards = Array.isArray(listData.cards) ? listData.cards : [];

    titleInput.value = typeof listData.title === "string" ? listData.title : "";
    titleInput.placeholder = "New List";
    cardsContainer.replaceChildren();

    cards.forEach((cardData) => {
        cardsContainer.appendChild(buildCardElement(cardData));
    });

    if (typeof listData.backgroundColor === "string" && listData.backgroundColor) {
        list.style.backgroundColor = listData.backgroundColor;
    }

    setupList(list);

    return list;
}

function applyBoardState(boardState) {
    [...listsRow.children]
        .filter((element) => element.classList.contains("list"))
        .forEach((list) => {
            list.remove();
        });

    boardState.lists.forEach((listData) => {
        const list = buildListElement(listData);
        listsRow.insertBefore(list, addListButton);
    });

    refreshCardUrgency();
    actionHistory = [];
}

function initializeBoard() {
    rememberProjectName(BOARD_STORAGE_KEY);
    window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, BOARD_STORAGE_KEY);
    syncBoardTitle();
    setupProjectTitleEditor();
    setupKanbanSettings();
    setupBackgroundImageSettings();
    setupBoardDeletion();
    focusNewProjectTitle();

    const savedBoardState = readBoardState();

    if (savedBoardState) {
        applyBoardState(savedBoardState);
        return;
    }

    document.querySelectorAll(".card").forEach((card) => {
        renderCardDisplayContent(card, getCardData(card));
        setupCard(card);
    });
    document.querySelectorAll(".list").forEach(setupList);
    refreshCardUrgency();
    saveBoardState();
}

function closeCardComposer(list, shouldFocusButton = false) {
    if (!list) return;

    const composer = list.querySelector(".card-composer");
    const addCardButton = list.querySelector(".add-card");

    if (composer) {
        composer.remove();
    }

    if (addCardButton) {
        addCardButton.classList.remove("is-hidden");

        if (shouldFocusButton) {
            addCardButton.focus();
        }
    }
}

function openCardComposer(list) {
    if (!list) return;

    const existingComposer = list.querySelector(".card-composer");

    if (existingComposer) {
        existingComposer.querySelector(".card-input")?.focus();
        return;
    }

    const container = list.querySelector(".list-cards");
    const addCardButton = list.querySelector(".add-card");

    if (!container || !addCardButton) return;

    const composer = document.createElement("form");

    composer.className = "card-composer";
    composer.innerHTML = `
        <textarea
            class="card-input"
            name="title"
            rows="3"
            maxlength="120"
            placeholder="What needs doing?"
        ></textarea>
        <input
            class="card-date-input"
            name="dueDate"
            type="date"
            aria-label="Due date"
        />
        <div class="card-composer-actions">
            <button class="card-submit" type="submit">Add card</button>
            <button class="card-cancel" type="button">Cancel</button>
        </div>
    `;

    addCardButton.classList.add("is-hidden");
    addCardButton.insertAdjacentElement("beforebegin", composer);

    const titleInput = composer.querySelector(".card-input");
    const dateInput = composer.querySelector(".card-date-input");
    const submitButton = composer.querySelector(".card-submit");
    const cancelButton = composer.querySelector(".card-cancel");

    function syncSubmitState() {
        submitButton.disabled = !titleInput.value.trim();
    }

    titleInput.addEventListener("input", syncSubmitState);
    titleInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            composer.requestSubmit();
        }
    });

    composer.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeCardComposer(list, true);
        }
    });

    cancelButton.addEventListener("click", () => {
        closeCardComposer(list, true);
    });

    composer.addEventListener("submit", (event) => {
        event.preventDefault();

        const title = titleInput.value.trim();

        if (!title) {
            titleInput.focus();
            return;
        }

        const newCard = createCardElement(title, dateInput.value);

        container.appendChild(newCard);
        closeCardComposer(list);
        saveBoardState();
        newCard.scrollIntoView({
            block: "nearest",
            inline: "nearest"
        });
    });

    syncSubmitState();

    requestAnimationFrame(() => {
        titleInput.focus();
    });
}

function setupAddCardButton(button) {
    button.addEventListener("click", () => {
        openCardComposer(button.closest(".list"));
    });
}

function setupList(list) {
    const container = list.querySelector(".list-cards");
    const addCardButton = list.querySelector(".add-card");
    const titleInput = list.querySelector(".list-title");
    const dragHandle = list.querySelector(".list-header span");

    if (container) {
        setupContainer(container);
    }

    if (addCardButton) {
        setupAddCardButton(addCardButton);
    }

    if (titleInput) {
        titleInput.addEventListener("input", saveBoardState);
        titleInput.addEventListener("change", saveBoardState);
    }

    if (dragHandle) {
        dragHandle.classList.add("list-drag-handle");
        dragHandle.setAttribute("role", "button");
        dragHandle.setAttribute("aria-label", "Drag list");
    }

    setupListDrag(list);
}

document.addEventListener("keydown", (event) => {
    if (activeCardEditor) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeCardEditor({ focusOptions: true });
        }

        return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        const lastAction = actionHistory.pop();

        if (!lastAction) return;

        if (lastAction.type === "card-delete") {
            insertNodeAt(
                lastAction.parent,
                lastAction.card,
                lastAction.nextSibling
            );
            saveBoardState();
            return;
        }

        if (lastAction.type === "list-delete") {
            insertNodeAt(
                lastAction.parent,
                lastAction.list,
                lastAction.nextSibling
            );
            saveBoardState();
            return;
        }

        if (lastAction.type === "list-add" && lastAction.list.isConnected) {
            lastAction.list.remove();
            saveBoardState();
        }
    }
});

function setupCard(card) {
    card.draggable = false;

    card.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    card.addEventListener("click", (event) => {
        if (
            !window.matchMedia("(max-width: 760px)").matches ||
            event.target.closest(".card-drag-handle, .card-options") ||
            activeCardDrag ||
            activeCardEditor
        ) {
            return;
        }

        openCardEditor(card);
    });

    card.addEventListener("pointerdown", (event) => {
        if (card === activeCardEditor?.card) {
            return;
        }

        const isTouchPointer = event.pointerType === "touch";
        const usedTouchHandle = event.target.closest(".card-drag-handle");

        if (
            event.button !== 0 ||
            event.target.closest(".card-options") ||
            (isTouchPointer && !usedTouchHandle)
        ) {
            return;
        }

        if (activeCardDrag) {
            clearCardDrag();
        }

        const bounds = card.getBoundingClientRect();
        const pointerOffsetX = event.clientX - bounds.left;
        const pointerOffsetY = event.clientY - bounds.top;
        const preview = card.cloneNode(true);
        const placeholder = card.cloneNode(true);

        draggedCard = card;
        draggedFromList = card.parentElement;

        resetCardCloneState(preview);
        resetCardCloneState(placeholder);

        preview.classList.add("card-preview");
        preview.style.width = `${bounds.width}px`;
        preview.style.height = `${bounds.height}px`;
        preview.style.minHeight = `${bounds.height}px`;
        preview.style.transformOrigin = `${pointerOffsetX}px ${pointerOffsetY}px`;

        placeholder.classList.add("card-placeholder");
        placeholder.style.height = `${bounds.height}px`;
        placeholder.style.minHeight = `${bounds.height}px`;

        card.replaceWith(placeholder);
        document.body.appendChild(preview);

        activeCardDrag = {
            card,
            placeholder,
            preview,
            sourceList: draggedFromList,
            pointerId: event.pointerId,
            pointerOffsetX,
            pointerOffsetY,
            captureElement: captureDragPointer(event.pointerId)
        };

        updateCardPreviewPosition(event.clientX, event.clientY);

        requestAnimationFrame(() => {
            preview.classList.add("is-tilted");
        });

        window.addEventListener("pointermove", handleCardPointerMove);
        window.addEventListener("pointerup", handleCardPointerUp);
        window.addEventListener("pointercancel", handleCardPointerCancel);

        document.body.classList.add("card-drag-active");
        event.preventDefault();
    });
}

function setupListDrag(list) {
    list.draggable = false;

    list.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    list.addEventListener("pointerdown", (event) => {
        const isTouchPointer = event.pointerType === "touch";
        const usedTouchHandle = event.target.closest(".list-drag-handle");

        if (
            event.button !== 0 ||
            event.target.closest(".card, .card-composer, button, textarea") ||
            event.target.closest("input:not(.list-title)") ||
            (isTouchPointer && !usedTouchHandle)
        ) {
            return;
        }

        if (activeCardDrag) {
            clearCardDrag();
        }

        if (activeListDrag) {
            clearListDrag();
        }

        if (pendingListDrag) {
            clearPendingListDrag();
        }

        const bounds = list.getBoundingClientRect();
        const pointerOffsetX = event.clientX - bounds.left;
        const pointerOffsetY = event.clientY - bounds.top;

        pendingListDrag = {
            list,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            pointerOffsetX,
            pointerOffsetY
        };

        window.addEventListener("pointermove", handlePendingListPointerMove);
        window.addEventListener("pointerup", handlePendingListPointerUp);
        window.addEventListener("pointercancel", handlePendingListPointerCancel);

        if (isTouchPointer) {
            event.preventDefault();
        }
    });
}

function setupCardOptions(options) {
    options.setAttribute("role", "button");
    options.setAttribute("aria-label", "Edit card");
    options.tabIndex = 0;

    options.addEventListener("click", (event) => {
        event.stopPropagation();
        openCardEditor(options.closest(".card"));
    });

    options.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }

        event.preventDefault();
        openCardEditor(options.closest(".card"));
    });
}

function setupContainer(container) {
    container.addEventListener("dragover", (event) => {
        event.preventDefault();

        if (!draggedCard) return;

        container.classList.add("drag-over");

        const nextCard = getCardAfterPointer(
            container,
            event.clientX,
            event.clientY
        );

        if (nextCard) {
            container.insertBefore(draggedCard, nextCard);
        } else {
            container.appendChild(draggedCard);
        }
    });

    container.addEventListener("dragleave", (event) => {
        if (!container.contains(event.relatedTarget)) {
            container.classList.remove("drag-over");
        }
    });

    container.addEventListener("drop", (event) => {
        event.preventDefault();
        container.classList.remove("drag-over");
    });
}

function setupTrash(container) {
    container.addEventListener("dragover", (event) => {
        event.preventDefault();

        if (!draggedCard) return;

        container.classList.add("drag-over");
    });

    container.addEventListener("dragleave", (event) => {
        if (!container.contains(event.relatedTarget)) {
            container.classList.remove("drag-over");
        }
    });

    container.addEventListener("drop", (event) => {
        event.preventDefault();

        if (!draggedCard || !draggedFromList) return;

        recordAction({
            type: "card-delete",
            card: draggedCard,
            parent: draggedFromList,
            nextSibling: null
        });

        draggedCard.remove();
        saveBoardState();
        container.classList.remove("drag-over");
        showDeleteAlert();
    });
}

function getCardAfterPointer(container, pointerX, pointerY) {
    const otherCards = [
        ...container.querySelectorAll(".card:not(.card-placeholder)")
    ];
    const containerStyle = window.getComputedStyle(container);
    const isGridLayout = containerStyle.display === "grid";

    if (isGridLayout && otherCards.length) {
        const sortedCards = [...otherCards].sort((firstCard, secondCard) => {
            const firstBounds = firstCard.getBoundingClientRect();
            const secondBounds = secondCard.getBoundingClientRect();
            const rowDifference = firstBounds.top - secondBounds.top;

            return Math.abs(rowDifference) > 4
                ? rowDifference
                : firstBounds.left - secondBounds.left;
        });
        const rows = [];

        sortedCards.forEach((card) => {
            const bounds = card.getBoundingClientRect();
            const currentRow = rows.at(-1);

            if (!currentRow || Math.abs(currentRow.top - bounds.top) > 4) {
                rows.push({
                    top: bounds.top,
                    centreY: bounds.top + bounds.height / 2,
                    cards: [{ card, bounds }]
                });
                return;
            }

            currentRow.cards.push({ card, bounds });
        });

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            const nextRow = rows[rowIndex + 1];
            const rowBoundary = nextRow
                ? (row.centreY + nextRow.centreY) / 2
                : Number.POSITIVE_INFINITY;

            if (pointerY >= rowBoundary) continue;

            const nextCardInRow = row.cards.find(({ bounds }) => {
                return pointerX < bounds.left + bounds.width / 2;
            });

            return nextCardInRow?.card || nextRow?.cards[0]?.card || null;
        }

        return null;
    }

    return otherCards.reduce(
        (closest, card) => {
            const bounds = card.getBoundingClientRect();
            const offset = pointerY - bounds.top - bounds.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset, element: card };
            }

            return closest;
        },
        { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
}

function createList() {
    const clone = template.content.cloneNode(true);
    const list = clone.querySelector(".list");
    const titleInput = clone.querySelector(".list-title");

    list.style.backgroundColor = getRandomListColour();

    titleInput.value = "";
    titleInput.placeholder = "New List";

    clone.querySelectorAll(".card").forEach(setupCard);
    clone.querySelectorAll(".card-options").forEach(setupCardOptions);
    setupList(list);

    listsRow.insertBefore(clone, addListButton);
    recordAction({
        type: "list-add",
        list
    });
    saveBoardState();

    requestAnimationFrame(() => {
        titleInput.focus();
    });
}

initializeBoard();
setupTrash(trash);

addListButton.addEventListener("click", () => {
    createList();
});

cardEditorBackdrop?.addEventListener("click", () => {
    closeCardEditor();
});
