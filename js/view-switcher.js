(() => {
    const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
    const DEFAULT_PROJECT_NAME = "My Project";
    const VIEW_OPTIONS = [
        { id: "kanban", label: "Kanban" },
        { id: "gantt", label: "Gantt" },
        { id: "whiteboard", label: "Whiteboard" }
    ];
    const currentFileName = window.location.pathname
        .split("/")
        .pop()
        .replace(/\.html$/i, "");
    const currentView = VIEW_OPTIONS.some((view) => view.id === currentFileName)
        ? currentFileName
        : "kanban";
    let projectName = getCurrentProjectName();
    const switcher = document.createElement("div");
    const toggle = document.createElement("button");
    const chevron = document.createElement("span");
    const menu = document.createElement("nav");

    switcher.className = "view-switcher";
    toggle.className = "view-switcher-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Choose project view");
    toggle.setAttribute("aria-expanded", "false");
    chevron.className = "view-switcher-chevron";
    chevron.setAttribute("aria-hidden", "true");
    
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("height", "24px");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("width", "24px");
    svg.setAttribute("fill", "black");
    
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m280-400 200-200 200 200H280Z");
    
    svg.appendChild(path);
    chevron.appendChild(svg);
    menu.className = "view-switcher-menu";
    menu.setAttribute("aria-label", "Project views");
    menu.hidden = true;

    function getCurrentProjectName() {
        const projectFromUrl = new URLSearchParams(window.location.search)
            .get("project")
            ?.trim();
        const activeProject = window.localStorage
            .getItem(ACTIVE_BOARD_STORAGE_KEY)
            ?.trim();

        return projectFromUrl || activeProject || DEFAULT_PROJECT_NAME;
    }

    function syncProjectLinks() {
        projectName = getCurrentProjectName();
        menu.querySelectorAll("[data-view-id]").forEach((option) => {
            option.href = `${option.dataset.viewId}.html?project=${encodeURIComponent(projectName)}`;
        });
    }

    VIEW_OPTIONS.forEach((view) => {
        const option = document.createElement("a");

        option.className = "view-switcher-option";
        option.dataset.viewId = view.id;
        option.href = `${view.id}.html?project=${encodeURIComponent(projectName)}`;
        option.textContent = view.label;

        if (view.id === currentView) {
            option.setAttribute("aria-current", "page");
        }

        option.addEventListener("click", () => {
            window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, projectName);
        });

        menu.append(option);
    });

    function closeViewSwitcher(shouldFocusToggle = false) {
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");

        if (shouldFocusToggle) {
            toggle.focus();
        }
    }

    toggle.addEventListener("click", () => {
        const willOpen = menu.hidden;

        if (willOpen) {
            syncProjectLinks();
        }

        menu.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));

        if (willOpen) {
            menu.querySelector('[aria-current="page"]')?.focus();
        }
    });

    document.addEventListener("pointerdown", (event) => {
        if (!switcher.contains(event.target)) {
            closeViewSwitcher();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !menu.hidden) {
            closeViewSwitcher(true);
        }
    });

    toggle.append(chevron);
    switcher.append(menu, toggle);
    document.body.append(switcher);
})();
