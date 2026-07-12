const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const PROJECTS_STORAGE_KEY = "lockt:kanban-projects";

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

function looksLikeBoardStorageValue(value) {
    try {
        const parsedValue = JSON.parse(value);
        return parsedValue && Array.isArray(parsedValue.lists);
    } catch {
        return false;
    }
}

function getKanbanProjectNames() {
    const projectNames = new Set([DEFAULT_BOARD_STORAGE_KEY]);

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

    return [...projectNames];
}

function selectProject(projectName) {
    window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, projectName);
}

function createProjectCard(projectName) {
    const recentBoard = document.createElement("div");
    const link = document.createElement("a");
    const preview = document.createElement("div");
    const title = document.createElement("h3");

    recentBoard.className = "recent-board";
    link.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
    preview.className = "board-preview kanban";
    title.textContent = projectName;

    link.addEventListener("click", () => {
        selectProject(projectName);
    });

    link.append(preview, title);
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

renderKanbanProjects();
