const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const PROJECTS_STORAGE_KEY = "lockt:kanban-projects";
const PROJECT_METADATA_STORAGE_KEY = "lockt:kanban-project-metadata";
const NEW_PROJECT_FOCUS_STORAGE_KEY = "lockt:new-kanban-project";
const creationDateFormatter = new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric"
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

    try {
        window.localStorage.setItem(
            PROJECT_METADATA_STORAGE_KEY,
            JSON.stringify({
                ...metadata,
                [projectName]: { createdAt }
            })
        );
    } catch (error) {
        console.warn("Unable to save project metadata", error);
    }

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
    const projectNames = new Set();

    readProjectNames().forEach((projectName) => {
        projectNames.add(projectName);
    });

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
        projectNames.size === 0 ||
        window.localStorage.getItem(DEFAULT_BOARD_STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY)
    ) {
        projectNames.add(DEFAULT_BOARD_STORAGE_KEY);
    }

    return [...projectNames];
}

function selectProject(projectName) {
    window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, projectName);
}

function getAvailableProjectName() {
    const projectNames = new Set(getKanbanProjectNames());
    const baseName = "Untitled Project";

    if (!projectNames.has(baseName)) {
        return baseName;
    }

    let suffix = 2;

    while (projectNames.has(`${baseName} ${suffix}`)) {
        suffix += 1;
    }

    return `${baseName} ${suffix}`;
}

function createNewProject() {
    const projectName = getAvailableProjectName();

    if (!saveProjectNames([...readProjectNames(), projectName])) return;

    getProjectCreationDate(projectName);
    selectProject(projectName);

    try {
        window.sessionStorage.setItem(
            NEW_PROJECT_FOCUS_STORAGE_KEY,
            projectName
        );
    } catch (error) {
        console.warn("Unable to mark the new project for editing", error);
    }

    window.location.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
}

function createProjectCard(projectName) {
    const recentBoard = document.createElement("div");
    const link = document.createElement("a");
    const preview = document.createElement("div");
    const title = document.createElement("h3");
    const creationDate = document.createElement("time");
    const createdAt = getProjectCreationDate(projectName);

    recentBoard.className = "recent-board";
    link.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
    preview.className = "board-preview kanban";
    title.textContent = projectName;
    creationDate.className = "board-creation-date";
    creationDate.dateTime = createdAt;
    creationDate.textContent = `Created ${creationDateFormatter.format(
        new Date(createdAt)
    )}`;

    link.addEventListener("click", () => {
        selectProject(projectName);
    });

    link.append(preview, title, creationDate);
    recentBoard.append(link);

    return recentBoard;
}

function renderKanbanProjects() {
    const recentBoards = document.querySelector(".recent-boards");

    if (!recentBoards) return;

    recentBoards.replaceChildren(
        ...getKanbanProjectNames().map(createProjectCard)
    );
}

document.querySelector(".back")?.addEventListener("click", () => {
    window.history.back();
});

document.querySelector(".new-project")?.addEventListener("click", () => {
    createNewProject();
});

renderKanbanProjects();
