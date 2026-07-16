(() => {
    "use strict";

    const DRAWING_TOOLS = [
        { id: "select", label: "Select", shortcut: "V" },
        { id: "pen", label: "Pen", shortcut: "B" },
        { id: "line", label: "Line", shortcut: "L" },
        { id: "rectangle", label: "Rect", shortcut: "R" },
        { id: "circle", label: "Circle", shortcut: "O" },
        { id: "ellipse", label: "Ellipse", shortcut: "I" },
        { id: "text", label: "Text", shortcut: "T" },
        { id: "highlighter", label: "Highlight", shortcut: "H" },
        { id: "eraser", label: "Erase", shortcut: "E" },
        { id: "note", label: "Sticky", shortcut: "N" },
        { id: "pan", label: "Pan", shortcut: "Space" }
    ];
    const INK_PALETTE = [
        "#2f2925",
        "#3f6b59",
        "#bd6b45",
        "#a33f38",
        "#5266a7",
        "#7c4e91"
    ];
    const HIGHLIGHTER_PALETTE = [
        "#f2c84b",
        "#ff9f40",
        "#ff7668",
        "#69cef1",
        "#79d98b",
        "#c79ce8"
    ];
    const STICKY_PALETTE = [
        { id: "yellow", color: "#fff2a6", label: "Yellow" },
        { id: "blue", color: "#dceff4", label: "Blue" },
        { id: "peach", color: "#f3d2bc", label: "Peach" },
        { id: "green", color: "#d9e9d3", label: "Green" },
        { id: "lilac", color: "#e4d8ed", label: "Lilac" }
    ];
    const SHAPE_TOOLS = new Set(["line", "rectangle", "circle", "ellipse"]);
    const VALID_STROKE_KINDS = new Set([
        "pen",
        "highlighter",
        ...SHAPE_TOOLS
    ]);

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

    const WHITEBOARD_DB_NAME = "lockt-whiteboards";
    const WHITEBOARD_DB_VERSION = 1;
    const WHITEBOARD_STORE = "whiteboards";
    const WHITEBOARD_FALLBACK_PREFIX = "lockt:whiteboard:";
    const AUTOSAVE_DELAY_MS = 420;
    const VIEW_AUTOSAVE_DELAY_MS = 850;

    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 12;
    const MAX_ITEM_SIZE = 7200;
    const MAX_UNDO_STEPS = 150;
    const HIGHLIGHTER_SIZE_MULTIPLIER = 2.4;
    const HIGHLIGHTER_MIN_SIZE = 8;
    const STROKE_INDEX_CELL_SIZE = 2048;
    const MAX_INDEX_CELLS_PER_STROKE = 128;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const taskDateFormatter = new Intl.DateTimeFormat("en-NZ", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });

    const dom = {
        content: document.querySelector(".whiteboard-page"),
        backButton: document.querySelector(".back"),
        titleInput: document.querySelector(".project-title"),
        settingsButton: document.querySelector(".kanban-settings-button"),
        settingsPanel: document.querySelector(".kanban-settings-panel"),
        renameButton: document.querySelector(".rename-project-button"),
        urgencyInput: document.querySelector("#urgency-threshold"),
        backgroundInput: document.querySelector("#board-background-image"),
        removeBackgroundButton: document.querySelector(".remove-background-image"),
        backgroundStatus: document.querySelector(".background-image-status"),
        deleteButton: document.querySelector(".delete-board-button"),
        deleteDialog: document.querySelector(".delete-board-dialog"),
        deleteForm: document.querySelector(".delete-board-form"),
        deleteName: document.querySelector(".delete-board-name"),
        deleteConfirmation: document.querySelector(".delete-board-confirmation"),
        cancelDeletion: document.querySelector(".cancel-board-deletion"),
        confirmDeletion: document.querySelector(".confirm-board-deletion"),
        toolGroup: document.querySelector("#toolGroup"),
        colorPalette: document.querySelector("#colorPalette"),
        highlighterControls: document.querySelector("#highlighterControls"),
        highlighterPalette: document.querySelector("#highlighterPalette"),
        highlighterOpacity: document.querySelector("#highlighterOpacity"),
        highlighterOpacityReadout: document.querySelector("#highlighterOpacityReadout"),
        stickyControls: document.querySelector("#stickyControls"),
        stickyPalette: document.querySelector("#stickyPalette"),
        kanbanTaskToggle: document.querySelector("#kanbanTaskToggle"),
        kanbanTaskCount: document.querySelector("#kanbanTaskCount"),
        kanbanTaskTray: document.querySelector("#kanbanTaskTray"),
        kanbanTaskTrayClose: document.querySelector("#kanbanTaskTrayClose"),
        kanbanTaskList: document.querySelector("#kanbanTaskList"),
        kanbanTaskDropMessage: document.querySelector("#kanbanTaskDropMessage"),
        strokeSize: document.querySelector("#strokeSize"),
        strokeSizeReadout: document.querySelector("#strokeSizeReadout"),
        undoButton: document.querySelector("#undoButton"),
        zoomOutButton: document.querySelector("#zoomOutButton"),
        zoomInButton: document.querySelector("#zoomInButton"),
        resetViewButton: document.querySelector("#resetViewButton"),
        zoomReadout: document.querySelector("#zoomReadout"),
        saveState: document.querySelector("#saveState"),
        statusMessage: document.querySelector("#statusMessage"),
        viewport: document.querySelector("#boardViewport"),
        gridCanvas: document.querySelector("#gridCanvas"),
        boardCanvas: document.querySelector("#boardCanvas"),
        interactionCanvas: document.querySelector("#interactionCanvas"),
        worldLayer: document.querySelector("#worldLayer")
    };

    if (
        !dom.viewport ||
        !dom.gridCanvas ||
        !dom.boardCanvas ||
        !dom.interactionCanvas ||
        !dom.worldLayer
    ) {
        console.error("The whiteboard canvas could not be initialized.");
        return;
    }

    const gridContext = dom.gridCanvas.getContext("2d");
    const inkContext = dom.boardCanvas.getContext("2d");
    const interactionContext = dom.interactionCanvas.getContext("2d");

    if (!gridContext || !inkContext || !interactionContext) {
        setSaveState("Canvas unavailable", "error");
        return;
    }

    let projectName = getProjectName();
    let urgencyDays = getUrgencyThreshold(projectName);
    let allowNavigation = false;
    let databasePromise = null;
    let autosaveTimer = 0;
    let saveQueue = Promise.resolve();
    let rafHandle = 0;
    let inkRafHandle = 0;
    let interactionRafHandle = 0;
    let resizeObserver = null;
    let draggedKanbanTask = null;
    let activeKanbanTaskPointerDrag = null;
    let suppressKanbanTaskClick = false;

    const state = {
        ready: false,
        tool: "pen",
        activeColor: INK_PALETTE[0],
        strokeSize: 4,
        highlighterColor: HIGHLIGHTER_PALETTE[0],
        highlighterOpacity: 0.12,
        stickyColor: STICKY_PALETTE[0].id,
        view: {
            x: 220,
            y: 130,
            zoom: 1
        },
        strokes: [],
        items: [],
        selectedItemId: null,
        interaction: null,
        spacePan: false,
        nextId: 1,
        statusTimer: 0
    };

    const history = {
        undoStack: [],
        pendingNoteEdit: null,
        pendingTextEdit: null
    };
    const strokeRenderCache = new WeakMap();
    const strokeSpatialIndex = {
        dirty: true,
        cells: new Map(),
        globalStrokes: [],
        order: new WeakMap()
    };

    void initialize();

    async function initialize() {
        rememberProjectName(projectName);
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectName);
        syncTitle();
        buildToolbar();
        setupKanbanTaskTray();
        bindCanvasEvents();
        bindShellEvents();
        setupSettings();
        setupBackground();
        setupDeletion();
        observeViewportResize();
        resizeCanvas();
        updateToolbar();
        applyBackground();

        try {
            const snapshot = await readWhiteboardSnapshot(projectName);
            if (snapshot) {
                applySnapshot(snapshot);
                setStatus("Whiteboard restored.");
            } else {
                setStatus("Blank whiteboard ready. Draw anywhere.");
            }
            setSaveState("Saved", "saved");
        } catch (error) {
            console.warn("Unable to restore the whiteboard", error);
            setSaveState("Using this session", "error");
            setStatus("Whiteboard ready, but saved work could not be loaded.");
        }

        state.ready = true;
        renderBoardItems();
        renderKanbanTaskTray();
        invalidateStrokeSpatialIndex();
        requestRender();
    }

    function buildToolbar() {
        dom.toolGroup.innerHTML = "";
        DRAWING_TOOLS.forEach((tool) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "toolbar-button";
            button.dataset.tool = tool.id;
            button.textContent = tool.label;
            button.title = `${tool.label} (${tool.shortcut})`;
            button.setAttribute("aria-label", `${tool.label} tool`);
            dom.toolGroup.append(button);
        });

        buildPalette(dom.colorPalette, INK_PALETTE, "color", "Ink");
        buildPalette(
            dom.highlighterPalette,
            HIGHLIGHTER_PALETTE,
            "highlighterColor",
            "Highlighter"
        );

        dom.stickyPalette.innerHTML = "";
        STICKY_PALETTE.forEach((entry) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "color-swatch";
            button.dataset.stickyColor = entry.id;
            button.style.backgroundColor = entry.color;
            button.setAttribute("aria-label", `${entry.label} sticky`);
            dom.stickyPalette.append(button);
        });
    }

    function buildPalette(container, colours, dataName, label) {
        container.innerHTML = "";
        colours.forEach((colour) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "color-swatch";
            button.dataset[dataName] = colour;
            button.style.backgroundColor = colour;
            button.setAttribute("aria-label", `${label} colour ${colour}`);
            container.append(button);
        });
    }

    function setupKanbanTaskTray() {
        if (
            !dom.kanbanTaskToggle ||
            !dom.kanbanTaskTray ||
            !dom.kanbanTaskList
        ) {
            return;
        }

        dom.kanbanTaskToggle.addEventListener("click", () => {
            setKanbanTaskTrayOpen(dom.kanbanTaskTray.hidden);
        });
        dom.kanbanTaskTrayClose?.addEventListener("click", () => {
            setKanbanTaskTrayOpen(false);
            dom.kanbanTaskToggle.focus();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || dom.kanbanTaskTray.hidden) return;
            setKanbanTaskTrayOpen(false);
            dom.kanbanTaskToggle.focus();
        });
    }

    function setKanbanTaskTrayOpen(isOpen) {
        if (!dom.kanbanTaskTray || !dom.kanbanTaskToggle) return;
        dom.kanbanTaskTray.hidden = !isOpen;
        dom.kanbanTaskToggle.setAttribute("aria-expanded", String(isOpen));
        if (isOpen) renderKanbanTaskTray();
    }

    function readKanbanTaskGroups() {
        try {
            const board = JSON.parse(
                window.localStorage.getItem(projectName) || "{}"
            );
            if (!Array.isArray(board?.lists)) return [];

            return board.lists.flatMap((list, listIndex) => {
                const cards = Array.isArray(list?.cards) ? list.cards : [];
                if (!cards.length) return [];
                const listTitle = String(list?.title || "Untitled list").trim() ||
                    "Untitled list";
                const listColour = isCssColour(list?.backgroundColor)
                    ? list.backgroundColor
                    : "#9fb4a9";
                const tasks = cards.flatMap((card, cardIndex) => {
                    const title = String(card?.title || "").trim();
                    if (!title) return [];
                    const startDateValue = normalizeTaskDateValue(
                        card?.startDateValue
                    );
                    const dueDateValue = normalizeTaskDateValue(card?.dateValue);
                    const task = {
                        title,
                        listTitle,
                        listColour,
                        startDateValue,
                        dueDateValue,
                        urgent:
                            Boolean(card?.urgent) ||
                            isKanbanTaskUrgent(dueDateValue),
                        sourceListIndex: listIndex,
                        sourceCardIndex: cardIndex
                    };
                    task.taskKey = createKanbanTaskKey(task);
                    return [task];
                });
                return tasks.length
                    ? [{ listTitle, listColour, tasks }]
                    : [];
            });
        } catch (error) {
            console.warn("Unable to read Kanban tasks for the whiteboard", error);
            return [];
        }
    }

    function renderKanbanTaskTray() {
        if (!dom.kanbanTaskList || !dom.kanbanTaskCount) return;
        const groups = readKanbanTaskGroups();
        const taskCount = groups.reduce(
            (total, group) => total + group.tasks.length,
            0
        );
        dom.kanbanTaskCount.textContent = String(taskCount);
        dom.kanbanTaskList.replaceChildren();

        if (!taskCount) {
            const empty = document.createElement("p");
            empty.className = "kanban-task-empty";
            empty.textContent = "No Kanban tasks yet. Add a task in Kanban, then it will appear here.";
            dom.kanbanTaskList.append(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        groups.forEach((group) => {
            const section = document.createElement("section");
            const heading = document.createElement("h3");
            const dot = document.createElement("span");
            const headingText = document.createElement("span");
            section.className = "kanban-task-group";
            section.style.setProperty("--task-list-colour", group.listColour);
            heading.className = "kanban-task-group-title";
            dot.className = "kanban-task-group-colour";
            headingText.textContent = group.listTitle;
            heading.append(dot, headingText);
            section.append(heading);

            group.tasks.forEach((task) => {
                const button = document.createElement("button");
                const title = document.createElement("span");
                const meta = document.createElement("span");
                const date = document.createElement("span");
                const placementCount = document.createElement("span");
                button.type = "button";
                button.className = "kanban-source-task";
                button.draggable = false;
                button.dataset.taskKey = task.taskKey;
                button.style.setProperty("--task-list-colour", task.listColour);
                button.title = "Drag onto the whiteboard, or click to place in the centre";
                title.className = "kanban-source-task-title";
                title.textContent = task.title;
                meta.className = "kanban-source-task-meta";
                date.textContent = task.dueDateValue
                    ? `Due ${formatKanbanTaskDate(task.dueDateValue)}`
                    : "No due date";
                placementCount.className = "kanban-source-placement-count";
                meta.append(date, placementCount);

                if (task.urgent) {
                    const urgent = document.createElement("span");
                    urgent.className = "kanban-source-task-urgent";
                    urgent.textContent = "Urgent";
                    meta.append(urgent);
                }

                button.append(title, meta);
                button.addEventListener("pointerdown", (event) => {
                    beginKanbanTaskPointerDrag(event, task, button);
                });
                button.addEventListener("click", () => {
                    if (suppressKanbanTaskClick) {
                        suppressKanbanTaskClick = false;
                        return;
                    }
                    const centre = screenToWorld(
                        dom.viewport.clientWidth * 0.5,
                        dom.viewport.clientHeight * 0.5
                    );
                    createTaskNoteAt(centre.x - 160, centre.y - 110, task);
                });
                section.append(button);
            });
            fragment.append(section);
        });
        dom.kanbanTaskList.append(fragment);
        syncKanbanTaskPlacementCounts();
    }

    function beginKanbanTaskPointerDrag(event, task, source) {
        if (event.button !== 0 || activeKanbanTaskPointerDrag) return;
        activeKanbanTaskPointerDrag = {
            pointerId: event.pointerId,
            task,
            source,
            startX: event.clientX,
            startY: event.clientY,
            dragging: false,
            overBoard: false,
            preview: null
        };
        source.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", moveKanbanTaskPointerDrag, {
            passive: false
        });
        window.addEventListener("pointerup", finishKanbanTaskPointerDrag);
        window.addEventListener("pointercancel", cancelKanbanTaskPointerDrag);
    }

    function moveKanbanTaskPointerDrag(event) {
        const drag = activeKanbanTaskPointerDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;

        if (!drag.dragging) {
            const distance = Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY
            );
            if (distance < 7) return;

            drag.dragging = true;
            draggedKanbanTask = drag.task;
            drag.source.classList.add("is-dragging");
            drag.preview = drag.source.cloneNode(true);
            drag.preview.classList.add("kanban-task-drag-preview");
            drag.preview.classList.remove("is-dragging");
            drag.preview.style.width = `${drag.source.getBoundingClientRect().width}px`;
            document.body.append(drag.preview);
        }

        event.preventDefault();
        drag.preview.style.left = `${event.clientX + 14}px`;
        drag.preview.style.top = `${event.clientY + 14}px`;
        drag.overBoard = isPointOverWhiteboard(
            event.clientX,
            event.clientY
        );
        dom.viewport.classList.toggle("task-drop-ready", drag.overBoard);
    }

    function finishKanbanTaskPointerDrag(event) {
        const drag = activeKanbanTaskPointerDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;

        if (drag.dragging) {
            event.preventDefault();
            suppressKanbanTaskClick = true;
            window.setTimeout(() => {
                suppressKanbanTaskClick = false;
            }, 300);

            if (isPointOverWhiteboard(event.clientX, event.clientY)) {
                const point = clientToWorld(event.clientX, event.clientY);
                createTaskNoteAt(
                    point.x - 160,
                    point.y - 110,
                    drag.task
                );
            }
        }
        cleanupKanbanTaskPointerDrag();
    }

    function cancelKanbanTaskPointerDrag(event) {
        if (
            activeKanbanTaskPointerDrag &&
            activeKanbanTaskPointerDrag.pointerId === event.pointerId
        ) {
            cleanupKanbanTaskPointerDrag();
        }
    }

    function cleanupKanbanTaskPointerDrag() {
        const drag = activeKanbanTaskPointerDrag;
        if (drag) {
            drag.source.classList.remove("is-dragging");
            drag.preview?.remove();
            if (drag.source.hasPointerCapture?.(drag.pointerId)) {
                drag.source.releasePointerCapture(drag.pointerId);
            }
        }
        activeKanbanTaskPointerDrag = null;
        window.removeEventListener("pointermove", moveKanbanTaskPointerDrag);
        window.removeEventListener("pointerup", finishKanbanTaskPointerDrag);
        window.removeEventListener("pointercancel", cancelKanbanTaskPointerDrag);
        clearKanbanTaskDropState();
    }

    function isPointOverWhiteboard(clientX, clientY) {
        const viewportBounds = dom.viewport.getBoundingClientRect();
        const withinViewport =
            clientX >= viewportBounds.left &&
            clientX <= viewportBounds.right &&
            clientY >= viewportBounds.top &&
            clientY <= viewportBounds.bottom;
        if (!withinViewport) return false;

        if (!dom.kanbanTaskTray?.hidden) {
            const trayBounds = dom.kanbanTaskTray.getBoundingClientRect();
            if (
                clientX >= trayBounds.left &&
                clientX <= trayBounds.right &&
                clientY >= trayBounds.top &&
                clientY <= trayBounds.bottom
            ) {
                return false;
            }
        }
        return true;
    }

    function syncKanbanTaskPlacementCounts() {
        if (!dom.kanbanTaskList) return;
        const placementCounts = new Map();
        state.items.forEach((item) => {
            if (item.type !== "task" || !item.taskKey) return;
            placementCounts.set(
                item.taskKey,
                (placementCounts.get(item.taskKey) || 0) + 1
            );
        });
        dom.kanbanTaskList
            .querySelectorAll("[data-task-key]")
            .forEach((button) => {
                const count = placementCounts.get(button.dataset.taskKey) || 0;
                const label = button.querySelector(
                    ".kanban-source-placement-count"
                );
                if (label) label.textContent = count ? `On board ×${count}` : "";
            });
    }

    function handleKanbanTaskDragOver(event) {
        if (!draggedKanbanTask || event.target.closest(".kanban-task-tray")) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        dom.viewport.classList.add("task-drop-ready");
    }

    function handleKanbanTaskDragLeave(event) {
        if (
            event.relatedTarget instanceof Node &&
            dom.viewport.contains(event.relatedTarget)
        ) {
            return;
        }
        dom.viewport.classList.remove("task-drop-ready");
    }

    function handleKanbanTaskDrop(event) {
        if (event.target.closest(".kanban-task-tray")) return;
        let task = draggedKanbanTask;
        if (!task) {
            try {
                task = JSON.parse(
                    event.dataTransfer.getData(
                        "application/x-lockt-kanban-task"
                    )
                );
            } catch {
                task = null;
            }
        }
        if (!task?.title) return;

        event.preventDefault();
        const point = clientToWorld(event.clientX, event.clientY);
        createTaskNoteAt(point.x - 160, point.y - 110, task);
        clearKanbanTaskDropState();
    }

    function clearKanbanTaskDropState() {
        draggedKanbanTask = null;
        dom.viewport.classList.remove("task-drop-ready");
    }

    function createKanbanTaskKey(task) {
        return [
            task.sourceListIndex,
            task.sourceCardIndex,
            task.listTitle,
            task.title,
            task.startDateValue,
            task.dueDateValue
        ].join("::");
    }

    function normalizeTaskDateValue(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return "";
        }
        const parsedDate = new Date(`${value}T00:00:00`);
        return Number.isNaN(parsedDate.getTime()) ? "" : value;
    }

    function formatKanbanTaskDate(value) {
        const normalizedValue = normalizeTaskDateValue(value);
        if (!normalizedValue) return "No date";
        return taskDateFormatter.format(
            new Date(`${normalizedValue}T00:00:00`)
        );
    }

    function isKanbanTaskUrgent(dueDateValue) {
        const normalizedValue = normalizeTaskDateValue(dueDateValue);
        if (!normalizedValue) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(`${normalizedValue}T00:00:00`);
        return Math.ceil(
            (dueDate.getTime() - today.getTime()) / 86_400_000
        ) <= urgencyDays;
    }

    function bindCanvasEvents() {
        dom.toolGroup.addEventListener("click", (event) => {
            const button = event.target.closest("[data-tool]");
            if (button) setTool(button.dataset.tool);
        });

        dom.colorPalette.addEventListener("click", (event) => {
            const button = event.target.closest("[data-color]");
            if (!button) return;
            state.activeColor = button.dataset.color;
            updateToolbar();
            schedulePersist();
        });

        dom.highlighterPalette.addEventListener("click", (event) => {
            const button = event.target.closest("[data-highlighter-color]");
            if (!button) return;
            state.highlighterColor = button.dataset.highlighterColor;
            updateToolbar();
            schedulePersist();
        });

        dom.stickyPalette.addEventListener("click", (event) => {
            const button = event.target.closest("[data-sticky-color]");
            if (!button) return;
            state.stickyColor = button.dataset.stickyColor;
            updateToolbar();
            schedulePersist();
        });

        dom.strokeSize.addEventListener("input", () => {
            state.strokeSize = clamp(Number(dom.strokeSize.value), 1, 24);
            updateToolbar();
            schedulePersist();
        });

        dom.highlighterOpacity.addEventListener("input", () => {
            state.highlighterOpacity = clamp(
                Number(dom.highlighterOpacity.value),
                0.04,
                0.4
            );
            updateToolbar();
            schedulePersist();
        });

        dom.undoButton.addEventListener("click", undoLastAction);
        dom.zoomInButton.addEventListener("click", () => zoomAtScreenPoint(1.16));
        dom.zoomOutButton.addEventListener("click", () => zoomAtScreenPoint(1 / 1.16));
        dom.resetViewButton.addEventListener("click", resetView);

        dom.viewport.addEventListener("wheel", handleWheel, { passive: false });
        dom.viewport.addEventListener("contextmenu", (event) => event.preventDefault());
        dom.viewport.addEventListener("pointerdown", handlePointerDown);
        dom.viewport.addEventListener("pointermove", handlePointerMove);
        dom.viewport.addEventListener("pointerup", handlePointerUp);
        dom.viewport.addEventListener("pointercancel", handlePointerUp);
        dom.viewport.addEventListener("dblclick", handleDoubleClick);
        dom.viewport.addEventListener("dragover", handleKanbanTaskDragOver);
        dom.viewport.addEventListener("dragleave", handleKanbanTaskDragLeave);
        dom.viewport.addEventListener("drop", handleKanbanTaskDrop);

        dom.worldLayer.addEventListener("pointerdown", handleWorldPointerDown);
        dom.worldLayer.addEventListener("input", handleWorldInput);
        dom.worldLayer.addEventListener("click", handleWorldClick);
        dom.worldLayer.addEventListener("focusin", handleWorldFocusIn);
        dom.worldLayer.addEventListener("focusout", handleWorldFocusOut);

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        window.addEventListener("resize", resizeCanvas);
        window.addEventListener("blur", () => {
            if (!state.spacePan) return;
            state.spacePan = false;
            updateToolbar();
        });
        window.addEventListener("pagehide", () => {
            void persistNow({ quiet: true });
        });
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                void persistNow({ quiet: true });
            } else {
                renderKanbanTaskTray();
            }
        });
        window.addEventListener("storage", (event) => {
            if (event.key === projectName) renderKanbanTaskTray();
        });
    }

    function observeViewportResize() {
        if (!("ResizeObserver" in window) || resizeObserver) return;
        resizeObserver = new ResizeObserver(resizeCanvas);
        resizeObserver.observe(dom.viewport);
    }

    function handleWheel(event) {
        if (!state.ready) return;
        event.preventDefault();

        if (event.ctrlKey || event.metaKey) {
            zoomAtScreenPoint(
                Math.exp(-event.deltaY * 0.0016),
                event.clientX,
                event.clientY
            );
            return;
        }

        state.view.x += event.deltaX;
        state.view.y += event.deltaY;
        requestRender();
        updateZoomReadout();
        schedulePersist(VIEW_AUTOSAVE_DELAY_MS);
    }

    function handlePointerDown(event) {
        if (!state.ready || ![0, 1, 2].includes(event.button)) return;
        if (event.target.closest(".kanban-task-tray")) return;

        const rightButton = event.button === 2;
        const middleButton = event.button === 1;
        const activeTool = rightButton ? "eraser" : getEffectiveTool(event);
        const point = clientToWorld(event.clientX, event.clientY);
        const clickedInteractive = event.target.closest(
            ".board-item, textarea, input, button"
        );

        if (clickedInteractive && activeTool !== "pan" && !middleButton && !rightButton) {
            return;
        }

        dom.viewport.setPointerCapture(event.pointerId);

        if (middleButton || activeTool === "pan") {
            state.interaction = {
                type: "pan",
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                viewX: state.view.x,
                viewY: state.view.y
            };
            dom.viewport.classList.add("is-panning");
            setStatus("Panning whiteboard.");
            return;
        }

        if (activeTool === "note") {
            createNoteAt(point.x - 150, point.y - 95);
            setTool("select");
            return;
        }

        if (activeTool === "text") {
            const textItemId = createTextAt(point.x - 140, point.y - 72);
            setTool("select");
            focusTextItem(textItemId);
            setStatus("Text box added. Start typing.");
            return;
        }

        if (activeTool === "eraser") {
            state.interaction = {
                type: "erase",
                pointerId: event.pointerId,
                removedStrokes: []
            };
            eraseAt(point.x, point.y, state.interaction.removedStrokes);
            return;
        }

        if (activeTool === "select") {
            state.selectedItemId = null;
            syncSelectionState();
            return;
        }

        if (isShapeKind(activeTool)) {
            const shapePoint = { ...point, pressure: 0.6 };
            state.interaction = {
                type: "shape",
                pointerId: event.pointerId,
                stroke: {
                    id: nextId("stroke"),
                    kind: activeTool,
                    color: state.activeColor,
                    size: state.strokeSize,
                    opacity: 1,
                    points: [shapePoint, { ...shapePoint }]
                }
            };
            requestInteractionRender();
            setStatus(`Drawing ${activeTool}.`);
            return;
        }

        if (activeTool === "pen" || activeTool === "highlighter") {
            const stroke = {
                id: nextId("stroke"),
                kind: activeTool,
                color:
                    activeTool === "highlighter"
                        ? state.highlighterColor
                        : state.activeColor,
                size:
                    activeTool === "highlighter"
                        ? Math.max(
                            state.strokeSize * HIGHLIGHTER_SIZE_MULTIPLIER,
                            HIGHLIGHTER_MIN_SIZE
                        )
                        : state.strokeSize,
                opacity:
                    activeTool === "highlighter"
                        ? state.highlighterOpacity
                        : 1,
                points: []
            };
            state.interaction = {
                type: "draw",
                pointerId: event.pointerId,
                stroke
            };
            collectStrokePoints(stroke, event);
            requestInteractionRender();
        }
    }

    function handlePointerMove(event) {
        const interaction = state.interaction;
        if (!interaction || interaction.pointerId !== event.pointerId) return;

        if (interaction.type === "pan") {
            state.view.x = interaction.viewX + event.clientX - interaction.startX;
            state.view.y = interaction.viewY + event.clientY - interaction.startY;
            requestRender();
            updateZoomReadout();
            return;
        }

        if (interaction.type === "draw") {
            collectStrokePoints(interaction.stroke, event);
            requestInteractionRender();
            return;
        }

        if (interaction.type === "shape") {
            interaction.stroke.points[1] = {
                ...clientToWorld(event.clientX, event.clientY),
                pressure: 0.6
            };
            strokeRenderCache.delete(interaction.stroke);
            requestInteractionRender();
            return;
        }

        if (interaction.type === "erase") {
            const point = clientToWorld(event.clientX, event.clientY);
            eraseAt(point.x, point.y, interaction.removedStrokes);
            return;
        }

        if (interaction.type === "drag-item") {
            const item = getItemById(interaction.itemId);
            if (!item) return;
            const point = clientToWorld(event.clientX, event.clientY);
            item.x = interaction.itemX + point.x - interaction.startWorldX;
            item.y = interaction.itemY + point.y - interaction.startWorldY;
            updateItemElement(item);
            return;
        }

        if (interaction.type === "resize-item") {
            const item = getItemById(interaction.itemId);
            if (!item) return;
            const point = clientToWorld(event.clientX, event.clientY);
            item.width = clamp(
                interaction.itemWidth + point.x - interaction.startWorldX,
                180,
                MAX_ITEM_SIZE
            );
            item.height = clamp(
                interaction.itemHeight + point.y - interaction.startWorldY,
                item.type === "note" ? 160 : item.type === "task" ? 170 : 120,
                MAX_ITEM_SIZE
            );
            updateItemElement(item);
        }
    }

    function handlePointerUp(event) {
        const interaction = state.interaction;

        if (interaction && interaction.pointerId === event.pointerId) {
            if (interaction.type === "draw") {
                simplifyCurrentStroke(interaction.stroke);
                if (interaction.stroke.points.length) {
                    state.strokes.push(interaction.stroke);
                    invalidateStrokeSpatialIndex();
                    pushHistoryAction({
                        type: "add-stroke",
                        strokeId: interaction.stroke.id
                    });
                }
                requestInkRender();
            } else if (interaction.type === "shape") {
                interaction.stroke.points[1] = {
                    ...clientToWorld(event.clientX, event.clientY),
                    pressure: 0.6
                };
                strokeRenderCache.delete(interaction.stroke);
                if (isMeaningfulShape(interaction.stroke)) {
                    state.strokes.push(interaction.stroke);
                    invalidateStrokeSpatialIndex();
                    pushHistoryAction({
                        type: "add-stroke",
                        strokeId: interaction.stroke.id
                    });
                }
                requestInkRender();
            } else if (
                interaction.type === "erase" &&
                interaction.removedStrokes.length
            ) {
                pushHistoryAction({
                    type: "erase-strokes",
                    removed: interaction.removedStrokes
                });
            } else if (
                (interaction.type === "drag-item" ||
                    interaction.type === "resize-item") &&
                hasItemBoundsChanged(
                    getItemById(interaction.itemId),
                    interaction.beforeBounds
                )
            ) {
                pushHistoryAction({
                    type: "transform-item",
                    itemId: interaction.itemId,
                    before: interaction.beforeBounds
                });
            } else if (interaction.type === "pan") {
                schedulePersist(VIEW_AUTOSAVE_DELAY_MS);
            }

            state.interaction = null;
            dom.viewport.classList.remove("is-panning");
        }

        if (dom.viewport.hasPointerCapture(event.pointerId)) {
            dom.viewport.releasePointerCapture(event.pointerId);
        }
        requestInteractionRender();
    }

    function handleDoubleClick(event) {
        const itemNode = event.target.closest(".board-item");
        const item = getItemById(itemNode?.dataset.id);
        if (!item) return;

        const viewportWidth = dom.viewport.clientWidth;
        const viewportHeight = dom.viewport.clientHeight;
        state.view.zoom = clamp(
            Math.min(
                (viewportWidth * 0.78) / item.width,
                (viewportHeight * 0.78) / item.height
            ),
            0.08,
            MAX_ZOOM
        );
        state.view.x =
            viewportWidth * 0.5 -
            (item.x + item.width * 0.5) * state.view.zoom;
        state.view.y =
            viewportHeight * 0.52 -
            (item.y + item.height * 0.5) * state.view.zoom;
        requestRender();
        updateZoomReadout();
        schedulePersist(VIEW_AUTOSAVE_DELAY_MS);
        setStatus("Focused the selected card.");
    }

    function handleWorldPointerDown(event) {
        if (event.button !== 0 || getEffectiveTool(event) !== "select") return;

        const itemNode = event.target.closest(".board-item");
        if (!itemNode) return;
        const itemId = itemNode.dataset.id;
        const item = getItemById(itemId);
        if (!item) return;

        state.selectedItemId = itemId;
        syncSelectionState();

        if (event.target.closest("[data-delete-item]")) {
            removeItem(itemId);
            return;
        }

        const point = clientToWorld(event.clientX, event.clientY);

        if (event.target.closest("[data-resize-handle]")) {
            dom.viewport.setPointerCapture(event.pointerId);
            state.interaction = {
                type: "resize-item",
                pointerId: event.pointerId,
                itemId,
                startWorldX: point.x,
                startWorldY: point.y,
                itemWidth: item.width,
                itemHeight: item.height,
                beforeBounds: getItemBounds(item)
            };
            setStatus("Resizing card.");
            return;
        }

        if (!event.target.closest("[data-drag-handle]")) return;

        dom.viewport.setPointerCapture(event.pointerId);
        state.interaction = {
            type: "drag-item",
            pointerId: event.pointerId,
            itemId,
            startWorldX: point.x,
            startWorldY: point.y,
            itemX: item.x,
            itemY: item.y,
            beforeBounds: getItemBounds(item)
        };
        setStatus("Moving card.");
    }

    function handleWorldInput(event) {
        const itemNode = event.target.closest(".board-item");
        const item = getItemById(itemNode?.dataset.id);
        if (!item) return;

        if (item.type === "note" && event.target.matches("[data-note-title]")) {
            item.title = event.target.value;
            const titleNode = itemNode.querySelector(".topbar-title");
            if (titleNode) titleNode.textContent = item.title || "Sticky note";
        } else if (
            item.type === "note" &&
            event.target.matches("[data-note-body]")
        ) {
            item.body = event.target.value;
        } else if (
            item.type === "text" &&
            event.target.matches("[data-text-body]")
        ) {
            item.text = event.target.value;
            const titleNode = itemNode.querySelector(".topbar-title");
            if (titleNode) titleNode.textContent = getTextItemLabel(item.text);
        }

        schedulePersist();
    }

    function handleWorldClick(event) {
        if (event.target.closest(".board-item")) return;
        state.selectedItemId = null;
        syncSelectionState();
    }

    function handleWorldFocusIn(event) {
        const itemNode = event.target.closest(".board-item");
        const item = getItemById(itemNode?.dataset.id);
        if (!item) return;

        if (
            item.type === "note" &&
            event.target.matches("[data-note-title], [data-note-body]")
        ) {
            history.pendingNoteEdit = {
                itemId: item.id,
                before: {
                    title: item.title || "",
                    body: item.body || ""
                }
            };
        } else if (
            item.type === "text" &&
            event.target.matches("[data-text-body]")
        ) {
            history.pendingTextEdit = {
                itemId: item.id,
                before: { text: item.text || "" }
            };
        }
    }

    function handleWorldFocusOut(event) {
        if (event.target.matches("[data-note-title], [data-note-body]")) {
            commitPendingNoteEdit();
        } else if (event.target.matches("[data-text-body]")) {
            commitPendingTextEdit();
        }
    }

    function handleKeyDown(event) {
        const key = event.key.toLowerCase();
        const commandKey = event.ctrlKey || event.metaKey;

        if (commandKey && !event.altKey && key === "s") {
            event.preventDefault();
            if (state.interaction) {
                setStatus("Finish the current gesture before saving.");
            } else {
                void persistNow();
            }
            return;
        }

        if (
            commandKey &&
            !event.altKey &&
            key === "z" &&
            !isTypingTarget(event.target)
        ) {
            event.preventDefault();
            if (state.interaction) {
                setStatus("Finish the current gesture before undoing.");
            } else {
                undoLastAction();
            }
            return;
        }

        if (event.repeat) return;

        if (event.code === "Space" && !isTypingTarget(event.target)) {
            state.spacePan = true;
            updateToolbar();
            event.preventDefault();
            return;
        }

        if (isTypingTarget(event.target)) return;

        const shortcutTools = {
            b: "pen",
            l: "line",
            r: "rectangle",
            o: "circle",
            i: "ellipse",
            t: "text",
            h: "highlighter",
            e: "eraser",
            v: "select",
            n: "note"
        };

        if (shortcutTools[key]) {
            setTool(shortcutTools[key]);
        } else if (key === "delete" || key === "backspace") {
            if (state.selectedItemId) {
                event.preventDefault();
                removeItem(state.selectedItemId);
            }
        } else if (commandKey && key === "0") {
            event.preventDefault();
            resetView();
        }
    }

    function handleKeyUp(event) {
        if (event.code !== "Space") return;
        state.spacePan = false;
        updateToolbar();
    }

    function setTool(toolId) {
        if (!DRAWING_TOOLS.some((tool) => tool.id === toolId)) return;
        state.tool = toolId;
        updateToolbar();

        const messages = {
            select: "Select, move, resize, or edit cards.",
            pen: "Pen ready.",
            line: "Drag between two points to draw a line.",
            rectangle: "Drag between opposite corners.",
            circle: "Drag outward from the circle centre.",
            ellipse: "Drag between opposite corners.",
            text: "Click the board to place a text box.",
            highlighter: "Highlighter ready.",
            eraser: "Drag over ink to erase it. Right-click also erases.",
            note: "Click the board to place a sticky note.",
            pan: "Drag to pan the whiteboard."
        };
        setStatus(messages[toolId]);
    }

    function updateToolbar() {
        const activeTool = state.spacePan ? "pan" : state.tool;
        dom.toolGroup.querySelectorAll("[data-tool]").forEach((button) => {
            const isActive = button.dataset.tool === activeTool;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
        dom.colorPalette.querySelectorAll("[data-color]").forEach((button) => {
            button.classList.toggle("active", button.dataset.color === state.activeColor);
        });
        dom.highlighterPalette
            .querySelectorAll("[data-highlighter-color]")
            .forEach((button) => {
                button.classList.toggle(
                    "active",
                    button.dataset.highlighterColor === state.highlighterColor
                );
            });
        dom.stickyPalette
            .querySelectorAll("[data-sticky-color]")
            .forEach((button) => {
                button.classList.toggle(
                    "active",
                    button.dataset.stickyColor === state.stickyColor
                );
            });

        dom.strokeSize.value = String(state.strokeSize);
        dom.strokeSizeReadout.value = String(state.strokeSize);
        dom.strokeSizeReadout.textContent = String(state.strokeSize);
        dom.highlighterOpacity.value = String(state.highlighterOpacity);
        const opacityLabel = `${Math.round(state.highlighterOpacity * 100)}%`;
        dom.highlighterOpacityReadout.value = opacityLabel;
        dom.highlighterOpacityReadout.textContent = opacityLabel;
        dom.highlighterControls.hidden = state.tool !== "highlighter";
        dom.stickyControls.hidden = state.tool !== "note";
        dom.worldLayer.classList.toggle("select-mode", activeTool === "select");
        dom.viewport.dataset.tool = activeTool;
        updateZoomReadout();
        updateUndoButton();
    }

    function updateZoomReadout() {
        const percent = state.view.zoom * 100;
        dom.zoomReadout.value =
            percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`;
        dom.zoomReadout.textContent = dom.zoomReadout.value;
    }

    function updateUndoButton() {
        dom.undoButton.disabled = history.undoStack.length === 0;
    }

    function resizeCanvas() {
        const rect = dom.viewport.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        [dom.gridCanvas, dom.boardCanvas, dom.interactionCanvas].forEach((canvas) => {
            const width = Math.max(1, Math.round(rect.width * DPR));
            const height = Math.max(1, Math.round(rect.height * DPR));
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
        });
        requestRender();
    }

    function requestRender() {
        if (inkRafHandle) {
            window.cancelAnimationFrame(inkRafHandle);
            inkRafHandle = 0;
        }
        if (rafHandle) return;

        rafHandle = window.requestAnimationFrame(() => {
            rafHandle = 0;
            renderCanvas();
        });
    }

    function requestInkRender() {
        if (rafHandle || inkRafHandle) return;
        inkRafHandle = window.requestAnimationFrame(() => {
            inkRafHandle = 0;
            renderInk(dom.viewport.clientWidth, dom.viewport.clientHeight);
            renderInteractionInk(dom.viewport.clientWidth, dom.viewport.clientHeight);
        });
    }

    function requestInteractionRender() {
        if (interactionRafHandle) return;
        interactionRafHandle = window.requestAnimationFrame(() => {
            interactionRafHandle = 0;
            renderInteractionInk(
                dom.viewport.clientWidth,
                dom.viewport.clientHeight
            );
        });
    }

    function renderCanvas() {
        const width = dom.viewport.clientWidth;
        const height = dom.viewport.clientHeight;
        updateWorldTransform();
        renderGrid(width, height);
        renderInk(width, height);
        renderInteractionInk(width, height);
    }

    function renderGrid(width, height) {
        gridContext.setTransform(DPR, 0, 0, DPR, 0, 0);
        gridContext.clearRect(0, 0, width, height);

        const zoom = state.view.zoom;
        let screenSpacing = 44 * zoom;
        while (screenSpacing < 24) screenSpacing *= 2;
        while (screenSpacing > 96) screenSpacing /= 2;
        const worldSpacing = screenSpacing / zoom;
        const visibleMin = screenToWorld(0, 0);
        const visibleMax = screenToWorld(width, height);
        const startX = Math.floor(visibleMin.x / worldSpacing) * worldSpacing;
        const endX = Math.ceil(visibleMax.x / worldSpacing) * worldSpacing;
        const startY = Math.floor(visibleMin.y / worldSpacing) * worldSpacing;
        const endY = Math.ceil(visibleMax.y / worldSpacing) * worldSpacing;

        gridContext.fillStyle = "rgba(59, 83, 72, 0.17)";
        const radius = Math.max(0.7, Math.min(1.8, zoom * 0.9));
        for (let x = startX; x <= endX; x += worldSpacing) {
            for (let y = startY; y <= endY; y += worldSpacing) {
                const screen = worldToScreen(x, y);
                gridContext.beginPath();
                gridContext.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
                gridContext.fill();
            }
        }
    }

    function renderInk(width, height) {
        inkContext.setTransform(DPR, 0, 0, DPR, 0, 0);
        inkContext.clearRect(0, 0, width, height);
        const visibleBounds = getVisibleWorldBounds(width, height);
        inkContext.save();
        inkContext.translate(state.view.x, state.view.y);
        inkContext.scale(state.view.zoom, state.view.zoom);
        getVisibleStrokes(visibleBounds).forEach((stroke) => {
            renderStroke(inkContext, stroke, visibleBounds);
        });
        inkContext.restore();
    }

    function renderInteractionInk(width, height) {
        interactionContext.setTransform(DPR, 0, 0, DPR, 0, 0);
        interactionContext.clearRect(0, 0, width, height);
        const interaction = state.interaction;
        if (!interaction || !["draw", "shape"].includes(interaction.type)) return;

        const visibleBounds = getVisibleWorldBounds(width, height);
        interactionContext.save();
        interactionContext.translate(state.view.x, state.view.y);
        interactionContext.scale(state.view.zoom, state.view.zoom);
        if (strokeIntersectsBounds(interaction.stroke, visibleBounds)) {
            renderStroke(interactionContext, interaction.stroke, visibleBounds);
        }
        interactionContext.restore();
    }

    function getVisibleWorldBounds(width, height) {
        return {
            minX: -state.view.x / state.view.zoom,
            minY: -state.view.y / state.view.zoom,
            maxX: (width - state.view.x) / state.view.zoom,
            maxY: (height - state.view.y) / state.view.zoom
        };
    }

    function renderStroke(context, stroke, visibleBounds) {
        if (!stroke.points.length) return;

        if (isShapeKind(stroke.kind)) {
            renderShapeStroke(context, stroke);
            return;
        }

        if (stroke.kind === "highlighter") {
            renderHighlighterStroke(context, stroke, visibleBounds);
            return;
        }

        if (stroke.size * state.view.zoom <= 2) {
            renderLowDetailPenStroke(context, stroke, visibleBounds);
            return;
        }

        const pointRanges = getVisiblePointRanges(
            stroke.points,
            visibleBounds,
            stroke.size
        );
        if (!pointRanges.length) return;

        context.save();
        context.fillStyle = stroke.color;
        context.globalAlpha = stroke.opacity;
        pointRanges.forEach(([startIndex, endIndex]) => {
            renderDetailedPenPointRange(context, stroke, startIndex, endIndex);
        });
        context.restore();
    }

    function renderShapeStroke(context, stroke) {
        const start = stroke.points[0];
        const end = stroke.points[1] || start;

        context.save();
        context.strokeStyle = stroke.color;
        context.globalAlpha = stroke.opacity;
        context.lineWidth = stroke.size;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();

        if (stroke.kind === "line") {
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
        } else if (stroke.kind === "rectangle") {
            context.rect(start.x, start.y, end.x - start.x, end.y - start.y);
        } else if (stroke.kind === "circle") {
            context.arc(
                start.x,
                start.y,
                Math.hypot(end.x - start.x, end.y - start.y),
                0,
                Math.PI * 2
            );
        } else {
            context.ellipse(
                (start.x + end.x) * 0.5,
                (start.y + end.y) * 0.5,
                Math.abs(end.x - start.x) * 0.5,
                Math.abs(end.y - start.y) * 0.5,
                0,
                0,
                Math.PI * 2
            );
        }

        context.stroke();
        context.restore();
    }

    function isShapeKind(kind) {
        return SHAPE_TOOLS.has(kind);
    }

    function renderDetailedPenPointRange(context, stroke, startIndex, endIndex) {
        const pointCount = endIndex - startIndex + 1;

        if (pointCount === 1) {
            const point = stroke.points[startIndex];
            context.beginPath();
            context.arc(
                point.x,
                point.y,
                getStrokeRadius(stroke, point.pressure),
                0,
                Math.PI * 2
            );
            context.fill();
            return;
        }

        if (pointCount === 2) {
            stampLine(
                context,
                stroke,
                stroke.points[startIndex],
                stroke.points[endIndex]
            );
            return;
        }

        for (let index = startIndex + 1; index < endIndex; index += 1) {
            const previous = stroke.points[index - 1];
            const current = stroke.points[index];
            const next = stroke.points[index + 1];
            stampQuadratic(
                context,
                stroke,
                midpoint(previous, current),
                current,
                midpoint(current, next)
            );
        }
    }

    function renderLowDetailPenStroke(context, stroke, visibleBounds) {
        const detail = getLowDetailStroke(stroke);
        const pointRanges = getVisiblePointRanges(
            detail.points,
            visibleBounds,
            stroke.size
        );
        if (!pointRanges.length) return;

        context.save();
        context.strokeStyle = stroke.color;
        context.fillStyle = stroke.color;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = getStrokeRadius(stroke, detail.pressure) * 2;
        context.globalAlpha = stroke.opacity;

        if (detail.points.length === 1) {
            context.beginPath();
            context.arc(
                detail.points[0].x,
                detail.points[0].y,
                context.lineWidth * 0.5,
                0,
                Math.PI * 2
            );
            context.fill();
            context.restore();
            return;
        }

        context.beginPath();
        pointRanges.forEach(([startIndex, endIndex]) => {
            appendSmoothPointRange(
                context,
                detail.points,
                startIndex,
                endIndex
            );
        });
        context.stroke();
        context.restore();
    }

    function renderHighlighterStroke(context, stroke, visibleBounds) {
        const pointRanges = getVisiblePointRanges(
            stroke.points,
            visibleBounds,
            stroke.size * 0.5
        );
        if (!pointRanges.length) return;

        context.save();
        context.strokeStyle = stroke.color;
        context.fillStyle = stroke.color;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = stroke.size;
        context.globalAlpha = stroke.opacity;
        context.globalCompositeOperation = "multiply";

        if (stroke.points.length === 1) {
            const point = stroke.points[0];
            context.beginPath();
            context.arc(point.x, point.y, stroke.size * 0.5, 0, Math.PI * 2);
            context.fill();
            context.restore();
            return;
        }

        context.beginPath();
        pointRanges.forEach(([startIndex, endIndex]) => {
            appendSmoothPointRange(
                context,
                stroke.points,
                startIndex,
                endIndex
            );
        });
        context.stroke();
        context.restore();
    }

    function appendSmoothPointRange(context, points, startIndex, endIndex) {
        context.moveTo(points[startIndex].x, points[startIndex].y);
        if (endIndex - startIndex === 1) {
            context.lineTo(points[endIndex].x, points[endIndex].y);
            return;
        }

        for (let index = startIndex + 1; index < endIndex; index += 1) {
            const current = points[index];
            const next = points[index + 1];
            const end = midpoint(current, next);
            context.quadraticCurveTo(current.x, current.y, end.x, end.y);
        }
        context.lineTo(points[endIndex].x, points[endIndex].y);
    }

    function stampQuadratic(context, stroke, start, control, end) {
        const distance =
            Math.hypot(control.x - start.x, control.y - start.y) +
            Math.hypot(end.x - control.x, end.y - control.y);
        const steps = Math.max(4, Math.ceil(distance * 1.5));
        let lastPoint = start;

        for (let step = 1; step <= steps; step += 1) {
            const progress = step / steps;
            const point = sampleQuadratic(start, control, end, progress);
            const pressure = lerp(
                start.pressure ?? control.pressure ?? 0.6,
                end.pressure ?? control.pressure ?? 0.6,
                progress
            );
            stampLine(context, stroke, lastPoint, { ...point, pressure });
            lastPoint = { ...point, pressure };
        }
    }

    function stampLine(context, stroke, start, end) {
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const steps = Math.max(1, Math.ceil(distance / 1.2));

        for (let step = 0; step <= steps; step += 1) {
            const progress = step / steps;
            const x = lerp(start.x, end.x, progress);
            const y = lerp(start.y, end.y, progress);
            const pressure = lerp(
                start.pressure ?? 0.6,
                end.pressure ?? 0.6,
                progress
            );
            context.beginPath();
            context.arc(
                x,
                y,
                getStrokeRadius(stroke, pressure),
                0,
                Math.PI * 2
            );
            context.fill();
        }
    }

    function collectStrokePoints(stroke, event) {
        const samples = event.getCoalescedEvents
            ? event.getCoalescedEvents()
            : [event];
        const minimumPointDistance = getMinimumPointDistance(stroke);

        samples.forEach((sample) => {
            const point = clientToWorld(sample.clientX, sample.clientY);
            const pressure = getPressure(sample);
            const previous = stroke.points[stroke.points.length - 1];

            if (
                previous &&
                Math.hypot(previous.x - point.x, previous.y - point.y) <
                    minimumPointDistance
            ) {
                previous.pressure = pressure;
                return;
            }
            stroke.points.push({ ...point, pressure });
        });
        strokeRenderCache.delete(stroke);
    }

    function simplifyCurrentStroke(stroke) {
        if (stroke.points.length < 3) return;

        const simplified = [stroke.points[0]];
        const minimumMove = getMinimumPointDistance(stroke) * 1.4;
        for (let index = 1; index < stroke.points.length - 1; index += 1) {
            const previous = simplified[simplified.length - 1];
            const current = stroke.points[index];
            const next = stroke.points[index + 1];
            const moveA = Math.hypot(
                current.x - previous.x,
                current.y - previous.y
            );
            const moveB = Math.hypot(next.x - current.x, next.y - current.y);
            if (moveA + moveB > minimumMove) simplified.push(current);
        }
        simplified.push(stroke.points[stroke.points.length - 1]);
        stroke.points = simplified;
        strokeRenderCache.delete(stroke);
    }

    function isMeaningfulShape(stroke) {
        const start = stroke.points[0];
        const end = stroke.points[1];
        return Boolean(
            start &&
            end &&
            Math.hypot(end.x - start.x, end.y - start.y) * state.view.zoom >= 2
        );
    }

    function getVisiblePointRanges(points, visibleBounds, strokePadding) {
        if (!points.length) return [];

        const margin = strokePadding + 2 / state.view.zoom;
        const bounds = {
            minX: visibleBounds.minX - margin,
            minY: visibleBounds.minY - margin,
            maxX: visibleBounds.maxX + margin,
            maxY: visibleBounds.maxY + margin
        };

        if (points.length === 1) {
            return pointIntersectsBounds(points[0], bounds) ? [[0, 0]] : [];
        }

        const ranges = [];
        for (let index = 0; index < points.length - 1; index += 1) {
            if (!segmentBoundsIntersect(points[index], points[index + 1], bounds)) {
                continue;
            }

            const startIndex = Math.max(0, index - 1);
            const endIndex = Math.min(points.length - 1, index + 2);
            const previousRange = ranges[ranges.length - 1];
            if (previousRange && startIndex <= previousRange[1] + 1) {
                previousRange[1] = Math.max(previousRange[1], endIndex);
            } else {
                ranges.push([startIndex, endIndex]);
            }
        }
        return ranges;
    }

    function pointIntersectsBounds(point, bounds) {
        return (
            point.x >= bounds.minX &&
            point.x <= bounds.maxX &&
            point.y >= bounds.minY &&
            point.y <= bounds.maxY
        );
    }

    function segmentBoundsIntersect(start, end, bounds) {
        return (
            Math.max(start.x, end.x) >= bounds.minX &&
            Math.min(start.x, end.x) <= bounds.maxX &&
            Math.max(start.y, end.y) >= bounds.minY &&
            Math.min(start.y, end.y) <= bounds.maxY
        );
    }

    function invalidateStrokeSpatialIndex() {
        strokeSpatialIndex.dirty = true;
    }

    function getVisibleStrokes(visibleBounds) {
        if (strokeSpatialIndex.dirty) rebuildStrokeSpatialIndex();

        const candidates = new Set(strokeSpatialIndex.globalStrokes);
        const minCellX = Math.floor(
            visibleBounds.minX / STROKE_INDEX_CELL_SIZE
        );
        const maxCellX = Math.floor(
            visibleBounds.maxX / STROKE_INDEX_CELL_SIZE
        );
        const minCellY = Math.floor(
            visibleBounds.minY / STROKE_INDEX_CELL_SIZE
        );
        const maxCellY = Math.floor(
            visibleBounds.maxY / STROKE_INDEX_CELL_SIZE
        );

        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
            for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                const strokes = strokeSpatialIndex.cells.get(`${cellX}:${cellY}`);
                if (strokes) strokes.forEach((stroke) => candidates.add(stroke));
            }
        }

        return Array.from(candidates)
            .filter((stroke) => strokeIntersectsBounds(stroke, visibleBounds))
            .sort(
                (strokeA, strokeB) =>
                    strokeSpatialIndex.order.get(strokeA) -
                    strokeSpatialIndex.order.get(strokeB)
            );
    }

    function rebuildStrokeSpatialIndex() {
        strokeSpatialIndex.cells = new Map();
        strokeSpatialIndex.globalStrokes = [];
        strokeSpatialIndex.order = new WeakMap();

        state.strokes.forEach((stroke, index) => {
            const bounds = getStrokeBounds(stroke);
            if (!bounds) return;
            strokeSpatialIndex.order.set(stroke, index);

            const minCellX = Math.floor(bounds.minX / STROKE_INDEX_CELL_SIZE);
            const maxCellX = Math.floor(bounds.maxX / STROKE_INDEX_CELL_SIZE);
            const minCellY = Math.floor(bounds.minY / STROKE_INDEX_CELL_SIZE);
            const maxCellY = Math.floor(bounds.maxY / STROKE_INDEX_CELL_SIZE);
            const cellCount =
                (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);

            if (
                !Number.isFinite(cellCount) ||
                cellCount > MAX_INDEX_CELLS_PER_STROKE
            ) {
                strokeSpatialIndex.globalStrokes.push(stroke);
                return;
            }

            for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
                for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                    const key = `${cellX}:${cellY}`;
                    const strokes = strokeSpatialIndex.cells.get(key);
                    if (strokes) {
                        strokes.push(stroke);
                    } else {
                        strokeSpatialIndex.cells.set(key, [stroke]);
                    }
                }
            }
        });

        strokeSpatialIndex.dirty = false;
    }

    function removeStrokeFromSpatialIndex(stroke) {
        if (strokeSpatialIndex.dirty) return;

        const globalIndex = strokeSpatialIndex.globalStrokes.indexOf(stroke);
        if (globalIndex >= 0) {
            strokeSpatialIndex.globalStrokes.splice(globalIndex, 1);
            strokeSpatialIndex.order.delete(stroke);
            return;
        }

        const bounds = getStrokeBounds(stroke);
        if (!bounds) return;
        const minCellX = Math.floor(bounds.minX / STROKE_INDEX_CELL_SIZE);
        const maxCellX = Math.floor(bounds.maxX / STROKE_INDEX_CELL_SIZE);
        const minCellY = Math.floor(bounds.minY / STROKE_INDEX_CELL_SIZE);
        const maxCellY = Math.floor(bounds.maxY / STROKE_INDEX_CELL_SIZE);

        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
            for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
                const key = `${cellX}:${cellY}`;
                const strokes = strokeSpatialIndex.cells.get(key);
                if (!strokes) continue;
                const index = strokes.indexOf(stroke);
                if (index >= 0) strokes.splice(index, 1);
                if (!strokes.length) strokeSpatialIndex.cells.delete(key);
            }
        }
        strokeSpatialIndex.order.delete(stroke);
    }

    function strokeIntersectsBounds(stroke, visibleBounds) {
        const bounds = getStrokeBounds(stroke);
        return Boolean(
            bounds &&
            bounds.maxX >= visibleBounds.minX &&
            bounds.minX <= visibleBounds.maxX &&
            bounds.maxY >= visibleBounds.minY &&
            bounds.minY <= visibleBounds.maxY
        );
    }

    function getStrokeBounds(stroke) {
        if (!stroke.points.length) return null;

        const cache = getStrokeRenderCache(stroke);
        if (cache.bounds) return cache.bounds;

        if (stroke.kind === "circle") {
            const center = stroke.points[0];
            const edge = stroke.points[1] || center;
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            const padding = stroke.size * 0.5;
            cache.bounds = {
                minX: center.x - radius - padding,
                minY: center.y - radius - padding,
                maxX: center.x + radius + padding,
                maxY: center.y + radius + padding
            };
            return cache.bounds;
        }

        let minX = stroke.points[0].x;
        let maxX = stroke.points[0].x;
        let minY = stroke.points[0].y;
        let maxY = stroke.points[0].y;
        let padding =
            stroke.kind === "highlighter" || isShapeKind(stroke.kind)
                ? stroke.size * 0.5
                : 0;

        stroke.points.forEach((point) => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
            if (stroke.kind !== "highlighter" && !isShapeKind(stroke.kind)) {
                padding = Math.max(
                    padding,
                    getStrokeRadius(stroke, point.pressure ?? 0.6)
                );
            }
        });

        cache.bounds = {
            minX: minX - padding,
            minY: minY - padding,
            maxX: maxX + padding,
            maxY: maxY + padding
        };
        return cache.bounds;
    }

    function getLowDetailStroke(stroke) {
        const cache = getStrokeRenderCache(stroke);
        const lodLevel = Math.max(
            0,
            Math.ceil(Math.log2(1 / state.view.zoom))
        );
        const cachedDetail = cache.lowDetailPoints.get(lodLevel);
        if (cachedDetail) return cachedDetail;

        const points = simplifyPoints(stroke.points, 0.75 * 2 ** lodLevel);
        const detail = {
            points,
            pressure:
                points.reduce(
                    (total, point) => total + (point.pressure ?? 0.6),
                    0
                ) / points.length
        };
        cache.lowDetailPoints.set(lodLevel, detail);
        return detail;
    }

    function getStrokeRenderCache(stroke) {
        let cache = strokeRenderCache.get(stroke);
        if (!cache) {
            cache = { bounds: null, lowDetailPoints: new Map() };
            strokeRenderCache.set(stroke, cache);
        }
        return cache;
    }

    function simplifyPoints(points, tolerance) {
        if (points.length <= 2) return points;

        const keep = new Uint8Array(points.length);
        keep[0] = 1;
        keep[points.length - 1] = 1;
        const ranges = [[0, points.length - 1]];
        const toleranceSquared = tolerance * tolerance;

        while (ranges.length) {
            const [startIndex, endIndex] = ranges.pop();
            let furthestIndex = -1;
            let furthestDistanceSquared = toleranceSquared;

            for (let index = startIndex + 1; index < endIndex; index += 1) {
                const distanceSquared = pointToSegmentDistanceSquared(
                    points[index],
                    points[startIndex],
                    points[endIndex]
                );
                if (distanceSquared > furthestDistanceSquared) {
                    furthestDistanceSquared = distanceSquared;
                    furthestIndex = index;
                }
            }

            if (furthestIndex >= 0) {
                keep[furthestIndex] = 1;
                ranges.push(
                    [startIndex, furthestIndex],
                    [furthestIndex, endIndex]
                );
            }
        }

        return points.filter((point, index) => keep[index]);
    }

    function pointToSegmentDistanceSquared(point, start, end) {
        const deltaX = end.x - start.x;
        const deltaY = end.y - start.y;
        if (deltaX === 0 && deltaY === 0) {
            return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
        }

        const projection = clamp(
            ((point.x - start.x) * deltaX +
                (point.y - start.y) * deltaY) /
                (deltaX * deltaX + deltaY * deltaY),
            0,
            1
        );
        const projectedX = start.x + projection * deltaX;
        const projectedY = start.y + projection * deltaY;
        return (
            (point.x - projectedX) ** 2 + (point.y - projectedY) ** 2
        );
    }

    function eraseAt(x, y, removedStrokes = null) {
        const threshold = 18 / state.view.zoom;
        const nearbyStrokes = getVisibleStrokes({
            minX: x - threshold,
            minY: y - threshold,
            maxX: x + threshold,
            maxY: y + threshold
        });
        const strokeToRemove = nearbyStrokes.find((stroke) =>
            hitTestStroke(stroke, x, y, threshold)
        );
        const index = strokeToRemove
            ? state.strokes.indexOf(strokeToRemove)
            : -1;
        if (index < 0) return;

        const [stroke] = state.strokes.splice(index, 1);
        removeStrokeFromSpatialIndex(stroke);
        if (removedStrokes) {
            removedStrokes.push({ index, stroke: cloneStroke(stroke) });
        }
        requestInkRender();
    }

    function hitTestStroke(stroke, x, y, threshold) {
        const effectiveThreshold = threshold + stroke.size * 0.5;

        if (stroke.kind === "circle") {
            const center = stroke.points[0];
            const edge = stroke.points[1] || center;
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            return (
                Math.abs(Math.hypot(x - center.x, y - center.y) - radius) <=
                effectiveThreshold
            );
        }

        if (stroke.kind === "ellipse") {
            const start = stroke.points[0];
            const end = stroke.points[1] || start;
            const centerX = (start.x + end.x) * 0.5;
            const centerY = (start.y + end.y) * 0.5;
            const radiusX = Math.abs(end.x - start.x) * 0.5;
            const radiusY = Math.abs(end.y - start.y) * 0.5;
            if (!radiusX || !radiusY) {
                return (
                    pointToSegmentDistance(x, y, start, end) <= effectiveThreshold
                );
            }

            const deltaX = x - centerX;
            const deltaY = y - centerY;
            const insideOuter =
                deltaX ** 2 / (radiusX + effectiveThreshold) ** 2 +
                    deltaY ** 2 / (radiusY + effectiveThreshold) ** 2 <=
                1;
            const insideInner =
                radiusX > effectiveThreshold &&
                radiusY > effectiveThreshold &&
                deltaX ** 2 / (radiusX - effectiveThreshold) ** 2 +
                    deltaY ** 2 / (radiusY - effectiveThreshold) ** 2 <
                    1;
            return insideOuter && !insideInner;
        }

        if (stroke.kind === "rectangle") {
            const start = stroke.points[0];
            const end = stroke.points[1] || start;
            const corners = [
                start,
                { x: end.x, y: start.y },
                end,
                { x: start.x, y: end.y }
            ];
            return corners.some((corner, index) =>
                pointToSegmentDistance(
                    x,
                    y,
                    corner,
                    corners[(index + 1) % corners.length]
                ) <= effectiveThreshold
            );
        }

        for (let index = 0; index < stroke.points.length; index += 1) {
            const point = stroke.points[index];
            if (Math.hypot(point.x - x, point.y - y) <= effectiveThreshold) {
                return true;
            }
            const next = stroke.points[index + 1];
            if (
                next &&
                pointToSegmentDistance(x, y, point, next) <= effectiveThreshold
            ) {
                return true;
            }
        }
        return false;
    }

    function resetView() {
        state.view.x = 220;
        state.view.y = 130;
        state.view.zoom = 1;
        requestRender();
        updateZoomReadout();
        schedulePersist(VIEW_AUTOSAVE_DELAY_MS);
        setStatus("View reset.");
    }

    function zoomAtScreenPoint(factor, clientX = null, clientY = null) {
        const rect = dom.viewport.getBoundingClientRect();
        const localX = clientX == null ? rect.width * 0.5 : clientX - rect.left;
        const localY = clientY == null ? rect.height * 0.5 : clientY - rect.top;
        const worldPoint = screenToWorld(localX, localY);
        const nextZoom = clamp(state.view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        state.view.zoom = nextZoom;
        state.view.x = localX - worldPoint.x * nextZoom;
        state.view.y = localY - worldPoint.y * nextZoom;
        requestRender();
        updateZoomReadout();
        schedulePersist(VIEW_AUTOSAVE_DELAY_MS);
    }

    function getEffectiveTool(event) {
        if (state.spacePan) return "pan";
        if (event?.pointerType === "touch" && state.tool === "pen") return "pan";
        return state.tool;
    }

    function screenToWorld(x, y) {
        return {
            x: (x - state.view.x) / state.view.zoom,
            y: (y - state.view.y) / state.view.zoom
        };
    }

    function clientToWorld(clientX, clientY) {
        const rect = dom.viewport.getBoundingClientRect();
        return screenToWorld(clientX - rect.left, clientY - rect.top);
    }

    function worldToScreen(x, y) {
        return {
            x: x * state.view.zoom + state.view.x,
            y: y * state.view.zoom + state.view.y
        };
    }

    function getPressure(event) {
        if (event.pointerType === "pen" && event.pressure > 0) {
            return clamp(event.pressure, 0.16, 1.2);
        }
        return event.pointerType === "mouse" ? 0.55 : 0.72;
    }

    function getMinimumPointDistance(stroke) {
        return stroke.kind === "highlighter"
            ? Math.max(1.1, stroke.size * 0.1)
            : 0.2;
    }

    function getStrokeRadius(stroke, pressure) {
        const base = stroke.size * (stroke.kind === "highlighter" ? 0.52 : 0.48);
        return base * (0.45 + pressure * 0.9);
    }

    function updateWorldTransform() {
        dom.worldLayer.style.transform = `matrix(${state.view.zoom}, 0, 0, ${state.view.zoom}, ${state.view.x}, ${state.view.y})`;
    }

    function createNoteAt(x, y) {
        const colour = getStickyColour(state.stickyColor);
        const note = {
            id: nextId("item"),
            type: "note",
            x,
            y,
            width: 300,
            height: 250,
            colourId: colour.id,
            colour: colour.color,
            title: "Sticky note",
            body: ""
        };
        state.items.push(note);
        state.selectedItemId = note.id;
        pushHistoryAction({ type: "add-item", itemId: note.id });
        renderBoardItems();
        focusNoteItem(note.id);
        setStatus(`${colour.label} sticky added.`);
    }

    function createTextAt(x, y) {
        const textItem = {
            id: nextId("item"),
            type: "text",
            x,
            y,
            width: 280,
            height: 144,
            text: "",
            color: state.activeColor,
            fontSize: 27
        };
        state.items.push(textItem);
        state.selectedItemId = textItem.id;
        pushHistoryAction({ type: "add-item", itemId: textItem.id });
        renderBoardItems();
        return textItem.id;
    }

    function createTaskNoteAt(x, y, taskData) {
        const startDateValue = normalizeTaskDateValue(
            taskData?.startDateValue
        );
        const dueDateValue = normalizeTaskDateValue(
            taskData?.dueDateValue || taskData?.dateValue
        );
        const task = {
            title: String(taskData?.title || "Untitled task").trim() ||
                "Untitled task",
            listTitle: String(taskData?.listTitle || "Kanban").trim() ||
                "Kanban",
            listColour: isCssColour(taskData?.listColour)
                ? taskData.listColour
                : "#9fb4a9",
            startDateValue,
            dueDateValue,
            urgent:
                Boolean(taskData?.urgent) ||
                isKanbanTaskUrgent(dueDateValue),
            sourceListIndex: finiteNumber(taskData?.sourceListIndex, -1),
            sourceCardIndex: finiteNumber(taskData?.sourceCardIndex, -1)
        };
        task.taskKey =
            typeof taskData?.taskKey === "string" && taskData.taskKey
                ? taskData.taskKey
                : createKanbanTaskKey(task);

        const item = {
            id: nextId("item"),
            type: "task",
            x,
            y,
            width: 320,
            height: 220,
            ...task,
            importedAt: new Date().toISOString()
        };
        state.items.push(item);
        state.selectedItemId = item.id;
        pushHistoryAction({ type: "add-item", itemId: item.id });
        setTool("select");
        renderBoardItems();
        setStatus(`Added “${item.title}” from Kanban.`);
    }

    function renderBoardItems() {
        dom.worldLayer.innerHTML = "";
        updateWorldTransform();

        const fragment = document.createDocumentFragment();
        state.items.forEach((item) => {
            const element = document.createElement("article");
            element.className = "board-item";
            element.dataset.id = item.id;
            element.dataset.type = item.type;
            element.style.transform = `translate(${item.x}px, ${item.y}px)`;
            element.style.width = `${item.width}px`;
            element.style.height = `${item.height}px`;

            if (item.id === state.selectedItemId) {
                element.classList.add("selected");
            }

            if (item.type === "note") {
                element.style.setProperty(
                    "--note-color",
                    item.colour || getStickyColour(item.colourId).color
                );
                element.innerHTML = `
                    <div class="item-topbar" data-drag-handle>
                        <div class="topbar-meta">
                            <span class="topbar-chip">Sticky</span>
                            <span class="topbar-title">${escapeHtml(item.title || "Sticky note")}</span>
                        </div>
                        <button type="button" class="item-delete" data-delete-item aria-label="Delete sticky">×</button>
                    </div>
                    <div class="note-content">
                        <input class="note-title" data-note-title value="${escapeAttribute(item.title || "")}" aria-label="Sticky title">
                        <textarea class="note-body" data-note-body aria-label="Sticky note">${escapeHtml(item.body || "")}</textarea>
                    </div>
                    <button type="button" class="resize-handle" data-resize-handle aria-label="Resize sticky"></button>
                `;
            } else if (item.type === "task") {
                element.style.setProperty(
                    "--task-colour",
                    item.listColour || "#9fb4a9"
                );
                const startDate = item.startDateValue
                    ? `<span>Start: ${escapeHtml(formatKanbanTaskDate(item.startDateValue))}</span>`
                    : "";
                const dueDate = item.dueDateValue
                    ? `<span>Due: ${escapeHtml(formatKanbanTaskDate(item.dueDateValue))}</span>`
                    : "<span>No due date</span>";
                const urgent = item.urgent
                    ? '<span class="task-note-urgent">Urgent</span>'
                    : "";
                element.innerHTML = `
                    <div class="item-topbar" data-drag-handle>
                        <div class="topbar-meta">
                            <span class="topbar-chip">Task</span>
                            <span class="topbar-title">${escapeHtml(item.listTitle || "Kanban")}</span>
                        </div>
                        <button type="button" class="item-delete" data-delete-item aria-label="Delete task note">×</button>
                    </div>
                    <div class="task-note-content">
                        <h3 class="task-note-title">${escapeHtml(item.title || "Untitled task")}</h3>
                        <span class="task-note-list">${escapeHtml(item.listTitle || "Kanban")}</span>
                        <div class="task-note-dates">${startDate}${dueDate}</div>
                        <div class="task-note-footer">
                            <span class="task-note-source">From Kanban</span>
                            ${urgent}
                        </div>
                    </div>
                    <button type="button" class="resize-handle" data-resize-handle aria-label="Resize task note"></button>
                `;
            } else {
                element.style.setProperty(
                    "--text-item-color",
                    item.color || state.activeColor
                );
                element.style.setProperty(
                    "--text-item-font-size",
                    `${clamp(item.fontSize || 27, 16, 72)}px`
                );
                element.innerHTML = `
                    <div class="item-topbar" data-drag-handle>
                        <div class="topbar-meta">
                            <span class="topbar-chip">Text</span>
                            <span class="topbar-title">${escapeHtml(getTextItemLabel(item.text))}</span>
                        </div>
                        <button type="button" class="item-delete" data-delete-item aria-label="Delete text">×</button>
                    </div>
                    <div class="text-card-content">
                        <textarea class="text-body" data-text-body placeholder="Type here…" aria-label="Text box">${escapeHtml(item.text || "")}</textarea>
                    </div>
                    <button type="button" class="resize-handle" data-resize-handle aria-label="Resize text"></button>
                `;
            }
            fragment.append(element);
        });
        dom.worldLayer.append(fragment);
        syncSelectionState();
        syncKanbanTaskPlacementCounts();
    }

    function updateItemElement(item) {
        const node = getItemNode(item.id);
        if (!node) return;
        node.style.transform = `translate(${item.x}px, ${item.y}px)`;
        node.style.width = `${item.width}px`;
        node.style.height = `${item.height}px`;
        node.classList.toggle("selected", item.id === state.selectedItemId);
    }

    function syncSelectionState() {
        dom.worldLayer.querySelectorAll(".board-item").forEach((node) => {
            node.classList.toggle(
                "selected",
                node.dataset.id === state.selectedItemId
            );
        });
    }

    function removeItem(itemId) {
        const removal = removeItemFromState(itemId);
        if (!removal) return;
        pushHistoryAction({
            type: "remove-item",
            item: cloneItem(removal.item),
            index: removal.index
        });
        renderBoardItems();
        setStatus("Card removed. Ctrl+Z restores it.");
    }

    function removeItemFromState(itemId) {
        const index = state.items.findIndex((item) => item.id === itemId);
        if (index < 0) return null;
        const [item] = state.items.splice(index, 1);
        if (state.selectedItemId === itemId) state.selectedItemId = null;
        return { item, index };
    }

    function removeStrokeById(strokeId) {
        const index = state.strokes.findIndex((stroke) => stroke.id === strokeId);
        if (index < 0) return false;
        const [stroke] = state.strokes.splice(index, 1);
        removeStrokeFromSpatialIndex(stroke);
        return true;
    }

    function pushHistoryAction(action) {
        if (!action) return;
        history.undoStack.push(action);
        if (history.undoStack.length > MAX_UNDO_STEPS) {
            history.undoStack.shift();
        }
        updateUndoButton();
        schedulePersist();
    }

    function commitPendingNoteEdit() {
        const pendingEdit = history.pendingNoteEdit;
        history.pendingNoteEdit = null;
        if (!pendingEdit) return;

        const item = getItemById(pendingEdit.itemId);
        if (!item || item.type !== "note") return;
        const current = {
            title: item.title || "",
            body: item.body || ""
        };
        if (
            current.title === pendingEdit.before.title &&
            current.body === pendingEdit.before.body
        ) {
            return;
        }
        pushHistoryAction({
            type: "edit-note",
            itemId: item.id,
            before: pendingEdit.before
        });
    }

    function commitPendingTextEdit() {
        const pendingEdit = history.pendingTextEdit;
        history.pendingTextEdit = null;
        if (!pendingEdit) return;

        const item = getItemById(pendingEdit.itemId);
        if (!item || item.type !== "text") return;
        if ((item.text || "") === pendingEdit.before.text) return;
        pushHistoryAction({
            type: "edit-text",
            itemId: item.id,
            before: pendingEdit.before
        });
    }

    function undoLastAction() {
        commitPendingNoteEdit();
        commitPendingTextEdit();
        const action = history.undoStack.pop();
        updateUndoButton();

        if (!action) {
            setStatus("Nothing left to undo.");
            return;
        }

        if (action.type === "add-stroke") {
            removeStrokeById(action.strokeId);
            requestInkRender();
        } else if (action.type === "erase-strokes") {
            for (let index = action.removed.length - 1; index >= 0; index -= 1) {
                const removed = action.removed[index];
                state.strokes.splice(
                    clamp(removed.index, 0, state.strokes.length),
                    0,
                    cloneStroke(removed.stroke)
                );
            }
            invalidateStrokeSpatialIndex();
            requestInkRender();
        } else if (action.type === "add-item") {
            if (removeItemFromState(action.itemId)) renderBoardItems();
        } else if (action.type === "remove-item") {
            state.items.splice(
                clamp(action.index, 0, state.items.length),
                0,
                cloneItem(action.item)
            );
            state.selectedItemId = action.item.id;
            renderBoardItems();
        } else if (action.type === "transform-item") {
            const item = getItemById(action.itemId);
            if (item) {
                Object.assign(item, action.before);
                state.selectedItemId = item.id;
                renderBoardItems();
            }
        } else if (action.type === "edit-note") {
            const item = getItemById(action.itemId);
            if (item?.type === "note") {
                item.title = action.before.title;
                item.body = action.before.body;
                state.selectedItemId = item.id;
                renderBoardItems();
            }
        } else if (action.type === "edit-text") {
            const item = getItemById(action.itemId);
            if (item?.type === "text") {
                item.text = action.before.text;
                state.selectedItemId = item.id;
                renderBoardItems();
            }
        }

        schedulePersist();
        setStatus("Last whiteboard change undone.");
    }

    function getItemById(itemId) {
        return state.items.find((item) => item.id === itemId);
    }

    function getItemNode(itemId) {
        return dom.worldLayer.querySelector(
            `.board-item[data-id="${CSS.escape(itemId)}"]`
        );
    }

    function getItemBounds(item) {
        return {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height
        };
    }

    function hasItemBoundsChanged(item, beforeBounds) {
        return Boolean(
            item &&
            beforeBounds &&
            (item.x !== beforeBounds.x ||
                item.y !== beforeBounds.y ||
                item.width !== beforeBounds.width ||
                item.height !== beforeBounds.height)
        );
    }

    function cloneItem(item) {
        return { ...item };
    }

    function cloneStroke(stroke) {
        return {
            ...stroke,
            points: stroke.points.map((point) => ({ ...point }))
        };
    }

    function getStickyColour(colourId) {
        return (
            STICKY_PALETTE.find((entry) => entry.id === colourId) ||
            STICKY_PALETTE[0]
        );
    }

    function getTextItemLabel(text) {
        const preview = String(text || "").replace(/\s+/g, " ").trim();
        return preview || "Typed text";
    }

    function focusNoteItem(itemId) {
        window.requestAnimationFrame(() => {
            const field = getItemNode(itemId)?.querySelector("[data-note-title]");
            if (!(field instanceof HTMLInputElement)) return;
            field.focus();
            field.select();
        });
    }

    function focusTextItem(itemId) {
        window.requestAnimationFrame(() => {
            const field = getItemNode(itemId)?.querySelector("[data-text-body]");
            if (!(field instanceof HTMLTextAreaElement)) return;
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
        });
    }

    function schedulePersist(delay = AUTOSAVE_DELAY_MS) {
        if (!state.ready) return;
        window.clearTimeout(autosaveTimer);
        setSaveState("Unsaved", "saving");
        autosaveTimer = window.setTimeout(() => {
            void persistNow();
        }, delay);
    }

    async function persistNow({ quiet = false } = {}) {
        if (!state.ready) return;
        window.clearTimeout(autosaveTimer);
        autosaveTimer = 0;
        const snapshot = captureSnapshot();
        const snapshotProjectName = projectName;

        if (!quiet) setSaveState("Saving…", "saving");

        saveQueue = saveQueue
            .catch(() => undefined)
            .then(() => writeWhiteboardSnapshot(snapshotProjectName, snapshot));

        try {
            await saveQueue;
            if (!quiet && snapshotProjectName === projectName) {
                setSaveState("Saved", "saved");
            }
        } catch (error) {
            console.warn("Unable to save the whiteboard", error);
            if (!quiet) setSaveState("Save failed", "error");
        }
    }

    function captureSnapshot() {
        return {
            version: 1,
            updatedAt: new Date().toISOString(),
            tool: state.tool,
            activeColor: state.activeColor,
            strokeSize: state.strokeSize,
            highlighterColor: state.highlighterColor,
            highlighterOpacity: state.highlighterOpacity,
            stickyColor: state.stickyColor,
            view: { ...state.view },
            strokes: state.strokes.map(cloneStroke),
            items: state.items.map(cloneItem),
            nextId: state.nextId
        };
    }

    function applySnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== "object") return;

        if (DRAWING_TOOLS.some((tool) => tool.id === snapshot.tool)) {
            state.tool = snapshot.tool;
        }
        if (INK_PALETTE.includes(snapshot.activeColor)) {
            state.activeColor = snapshot.activeColor;
        } else if (isCssColour(snapshot.activeColor)) {
            state.activeColor = snapshot.activeColor;
        }
        state.strokeSize = clamp(finiteNumber(snapshot.strokeSize, 4), 1, 24);
        if (isCssColour(snapshot.highlighterColor)) {
            state.highlighterColor = snapshot.highlighterColor;
        }
        state.highlighterOpacity = clamp(
            finiteNumber(snapshot.highlighterOpacity, 0.12),
            0.04,
            0.4
        );
        if (STICKY_PALETTE.some((entry) => entry.id === snapshot.stickyColor)) {
            state.stickyColor = snapshot.stickyColor;
        }

        state.view = {
            x: finiteNumber(snapshot.view?.x, 220),
            y: finiteNumber(snapshot.view?.y, 130),
            zoom: clamp(finiteNumber(snapshot.view?.zoom, 1), MIN_ZOOM, MAX_ZOOM)
        };
        state.strokes = sanitizeStrokes(snapshot.strokes);
        state.items = sanitizeItems(snapshot.items);
        state.nextId = Math.max(
            Math.floor(finiteNumber(snapshot.nextId, 1)),
            getMinimumNextId(state.strokes, state.items),
            1
        );
        state.selectedItemId = null;
        history.undoStack = [];
        history.pendingNoteEdit = null;
        history.pendingTextEdit = null;
        updateToolbar();
    }

    function sanitizeStrokes(strokes) {
        if (!Array.isArray(strokes)) return [];
        return strokes.flatMap((stroke) => {
            if (
                !stroke ||
                !VALID_STROKE_KINDS.has(stroke.kind) ||
                !Array.isArray(stroke.points)
            ) {
                return [];
            }

            const points = stroke.points.flatMap((point) => {
                if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
                    return [];
                }
                return [{
                    x: point.x,
                    y: point.y,
                    pressure: clamp(finiteNumber(point.pressure, 0.6), 0.05, 1.5)
                }];
            });
            const minimumPoints = isShapeKind(stroke.kind) ? 2 : 1;
            if (points.length < minimumPoints) return [];

            return [{
                id: typeof stroke.id === "string" ? stroke.id : nextId("stroke"),
                kind: stroke.kind,
                color: isCssColour(stroke.color) ? stroke.color : INK_PALETTE[0],
                size: clamp(finiteNumber(stroke.size, 4), 0.5, 100),
                opacity: clamp(finiteNumber(stroke.opacity, 1), 0.02, 1),
                points
            }];
        });
    }

    function sanitizeItems(items) {
        if (!Array.isArray(items)) return [];
        return items.flatMap((item) => {
            if (!item || !["note", "text", "task"].includes(item.type)) return [];
            const base = {
                id: typeof item.id === "string" ? item.id : nextId("item"),
                type: item.type,
                x: finiteNumber(item.x, 0),
                y: finiteNumber(item.y, 0),
                width: clamp(finiteNumber(item.width, 280), 180, MAX_ITEM_SIZE),
                height: clamp(
                    finiteNumber(
                        item.height,
                        item.type === "note" ? 250 : item.type === "task" ? 220 : 144
                    ),
                    item.type === "note" ? 160 : item.type === "task" ? 170 : 120,
                    MAX_ITEM_SIZE
                )
            };

            if (item.type === "note") {
                const colour = getStickyColour(item.colourId);
                return [{
                    ...base,
                    colourId: colour.id,
                    colour: isCssColour(item.colour) ? item.colour : colour.color,
                    title: String(item.title || ""),
                    body: String(item.body || "")
                }];
            }

            if (item.type === "task") {
                const task = {
                    title: String(item.title || "Untitled task"),
                    listTitle: String(item.listTitle || "Kanban"),
                    listColour: isCssColour(item.listColour)
                        ? item.listColour
                        : "#9fb4a9",
                    startDateValue: normalizeTaskDateValue(
                        item.startDateValue
                    ),
                    dueDateValue: normalizeTaskDateValue(
                        item.dueDateValue
                    ),
                    urgent: Boolean(item.urgent),
                    sourceListIndex: finiteNumber(item.sourceListIndex, -1),
                    sourceCardIndex: finiteNumber(item.sourceCardIndex, -1)
                };
                task.taskKey =
                    typeof item.taskKey === "string" && item.taskKey
                        ? item.taskKey
                        : createKanbanTaskKey(task);
                return [{
                    ...base,
                    ...task,
                    importedAt:
                        typeof item.importedAt === "string"
                            ? item.importedAt
                            : ""
                }];
            }

            return [{
                ...base,
                text: String(item.text || ""),
                color: isCssColour(item.color) ? item.color : INK_PALETTE[0],
                fontSize: clamp(finiteNumber(item.fontSize, 27), 16, 72)
            }];
        });
    }

    function getMinimumNextId(strokes, items) {
        let highestId = 0;
        [...strokes, ...items].forEach((entry) => {
            const match = /-(\d+)$/.exec(String(entry?.id || ""));
            if (match) highestId = Math.max(highestId, Number(match[1]));
        });
        return highestId + 1;
    }

    function openWhiteboardDatabase() {
        if (databasePromise) return databasePromise;
        databasePromise = new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is unavailable."));
                return;
            }

            const request = window.indexedDB.open(
                WHITEBOARD_DB_NAME,
                WHITEBOARD_DB_VERSION
            );
            request.onupgradeneeded = () => {
                const database = request.result;
                if (!database.objectStoreNames.contains(WHITEBOARD_STORE)) {
                    database.createObjectStore(WHITEBOARD_STORE, {
                        keyPath: "projectName"
                    });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error("Database failed."));
            request.onblocked = () => reject(new Error("Database upgrade was blocked."));
        });
        return databasePromise;
    }

    async function readWhiteboardSnapshot(name) {
        try {
            const database = await openWhiteboardDatabase();
            const record = await runDatabaseRequest(
                database,
                "readonly",
                (store) => store.get(name)
            );
            if (record?.snapshot) return record.snapshot;
        } catch (error) {
            console.warn("IndexedDB read failed; checking the fallback", error);
        }

        try {
            const fallback = window.localStorage.getItem(
                `${WHITEBOARD_FALLBACK_PREFIX}${name}`
            );
            return fallback ? JSON.parse(fallback) : null;
        } catch (error) {
            console.warn("Unable to read the whiteboard fallback", error);
            return null;
        }
    }

    async function writeWhiteboardSnapshot(name, snapshot) {
        try {
            const database = await openWhiteboardDatabase();
            await runDatabaseRequest(database, "readwrite", (store) =>
                store.put({
                    projectName: name,
                    updatedAt: snapshot.updatedAt,
                    snapshot
                })
            );
            try {
                window.localStorage.removeItem(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
            } catch (error) {
                console.warn("Unable to clear the whiteboard fallback", error);
            }
            return;
        } catch (error) {
            databasePromise = null;
            console.warn("IndexedDB write failed; using local storage", error);
        }

        window.localStorage.setItem(
            `${WHITEBOARD_FALLBACK_PREFIX}${name}`,
            JSON.stringify(snapshot)
        );
    }

    async function deleteWhiteboardSnapshot(name) {
        try {
            const database = await openWhiteboardDatabase();
            await runDatabaseRequest(database, "readwrite", (store) =>
                store.delete(name)
            );
        } catch (error) {
            console.warn("Unable to remove the IndexedDB whiteboard", error);
        }
        try {
            window.localStorage.removeItem(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
        } catch (error) {
            console.warn("Unable to remove the whiteboard fallback", error);
        }
    }

    function runDatabaseRequest(database, mode, operation) {
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(WHITEBOARD_STORE, mode);
            const request = operation(transaction.objectStore(WHITEBOARD_STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || transaction.error);
            transaction.onabort = () => reject(transaction.error || new Error("Database transaction aborted."));
        });
    }

    async function moveWhiteboardSnapshot(previousName, nextName) {
        window.clearTimeout(autosaveTimer);
        autosaveTimer = 0;
        const snapshot = captureSnapshot();
        saveQueue = saveQueue
            .catch(() => undefined)
            .then(async () => {
                await writeWhiteboardSnapshot(nextName, snapshot);
                await deleteWhiteboardSnapshot(previousName);
            });
        try {
            await saveQueue;
            if (projectName === nextName) setSaveState("Saved", "saved");
        } catch (error) {
            console.warn("Unable to move the whiteboard after renaming", error);
            setSaveState("Rename save failed", "error");
        }
    }

    function bindShellEvents() {
        dom.titleInput?.addEventListener("input", () => {
            dom.titleInput.setCustomValidity(
                getTitleValidationMessage(dom.titleInput.value)
            );
        });
        dom.titleInput?.addEventListener("change", () => {
            renameProject(dom.titleInput.value);
        });
        dom.titleInput?.addEventListener("blur", () => {
            const validationMessage = getTitleValidationMessage(
                dom.titleInput.value
            );
            if (!validationMessage) return;

            dom.titleInput.setCustomValidity(validationMessage);
            window.requestAnimationFrame(() => {
                const currentMessage = getTitleValidationMessage(
                    dom.titleInput.value
                );
                if (!currentMessage) return;
                dom.titleInput.setCustomValidity(currentMessage);
                dom.titleInput.focus();
                dom.titleInput.reportValidity();
                dom.titleInput.select();
            });
        });
        dom.titleInput?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                dom.titleInput.blur();
            } else if (event.key === "Escape") {
                event.preventDefault();
                syncTitle();
                dom.titleInput.blur();
            }
        });

        dom.backButton?.addEventListener("click", async () => {
            if (!renameProject(dom.titleInput?.value || "")) return;
            allowNavigation = true;
            await persistNow({ quiet: true });
            window.location.href = "index.html";
        });

        document.addEventListener(
            "click",
            async (event) => {
                const link = event.target.closest("a[href]");
                if (!link || allowNavigation) return;
                if (!renameProject(dom.titleInput?.value || "")) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    return;
                }

                event.preventDefault();
                event.stopImmediatePropagation();
                allowNavigation = true;
                window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectName);
                await persistNow({ quiet: true });
                window.location.href = link.href;
            },
            true
        );

        window.addEventListener("beforeunload", (event) => {
            if (allowNavigation || renameProject(dom.titleInput?.value || projectName)) {
                return;
            }
            event.preventDefault();
            event.returnValue = "";
        });

        focusNewProjectTitle();
    }

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

    function syncTitle() {
        document.title = `${projectName} Whiteboard`;
        if (!dom.titleInput) return;
        dom.titleInput.value = projectName;
        dom.titleInput.setCustomValidity("");
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
        if (!dom.titleInput) return;
        dom.titleInput.setCustomValidity(message);
        dom.titleInput.reportValidity();
        dom.titleInput.focus();
        dom.titleInput.select();
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
        try {
            const storedBoard = window.localStorage.getItem(previousName);
            window.localStorage.setItem(
                nextName,
                storedBoard || JSON.stringify({ lists: [] })
            );
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
            moveObjectRecord(
                PROJECT_SETTINGS_KEY,
                previousName,
                nextName
            );

            projectName = nextName;
            window.localStorage.setItem(ACTIVE_PROJECT_KEY, projectName);
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.set("project", projectName);
            window.history.replaceState(null, "", nextUrl);
            syncTitle();
            applyBackground();
            syncBackgroundControls();
            renderKanbanTaskTray();
            void moveWhiteboardSnapshot(previousName, nextName);
            return true;
        } catch (error) {
            console.warn("Unable to rename project", error);
            rejectTitle("Unable to rename this project.");
            return false;
        }
    }

    function focusNewProjectTitle() {
        if (!dom.titleInput) return;
        try {
            if (
                window.sessionStorage.getItem(NEW_PROJECT_FOCUS_KEY) !==
                projectName
            ) {
                return;
            }
            window.sessionStorage.removeItem(NEW_PROJECT_FOCUS_KEY);
        } catch (error) {
            console.warn("Unable to read new-project focus state", error);
            return;
        }

        window.requestAnimationFrame(() => {
            dom.titleInput.focus();
            dom.titleInput.select();
        });
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
            console.warn("Unable to read project names", error);
            return [];
        }
    }

    function saveProjectNames(names) {
        window.localStorage.setItem(
            PROJECTS_KEY,
            JSON.stringify([...new Set(names.map(normalizeName).filter(Boolean))])
        );
    }

    function rememberProjectName(name) {
        const normalizedName = normalizeName(name);
        if (!normalizedName) return;
        const names = readProjectNames();
        if (!names.includes(normalizedName)) {
            saveProjectNames([...names, normalizedName]);
        }

        const metadata = readObjectStorage(PROJECT_METADATA_KEY);
        const createdAt = metadata[normalizedName]?.createdAt;
        if (
            typeof createdAt !== "string" ||
            Number.isNaN(Date.parse(createdAt))
        ) {
            saveObjectStorage(PROJECT_METADATA_KEY, {
                ...metadata,
                [normalizedName]: { createdAt: new Date().toISOString() }
            });
        }
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

    function moveObjectRecord(
        storageKey,
        previousName,
        nextName,
        fallback = null
    ) {
        const records = readObjectStorage(storageKey);
        const record = records[previousName] || fallback;
        const nextRecords = { ...records };
        delete nextRecords[previousName];
        if (record) nextRecords[nextName] = record;
        saveObjectStorage(storageKey, nextRecords);
    }

    function removeProjectRecord(storageKey, name) {
        const records = readObjectStorage(storageKey);
        const nextRecords = { ...records };
        delete nextRecords[name];
        saveObjectStorage(storageKey, nextRecords);
    }

    function getUrgencyThreshold(name) {
        const threshold = readObjectStorage(PROJECT_SETTINGS_KEY)[name]
            ?.urgencyThresholdDays;
        return Number.isInteger(threshold) && threshold >= 0
            ? Math.min(365, threshold)
            : DEFAULT_URGENCY_DAYS;
    }

    function updateProjectSettings(changes) {
        const settings = readObjectStorage(PROJECT_SETTINGS_KEY);
        saveObjectStorage(PROJECT_SETTINGS_KEY, {
            ...settings,
            [projectName]: {
                ...(settings[projectName] || {}),
                ...changes
            }
        });
    }

    function refreshStoredUrgency() {
        try {
            const rawBoard = window.localStorage.getItem(projectName);
            if (!rawBoard) return;
            const board = JSON.parse(rawBoard);
            if (!Array.isArray(board?.lists)) return;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            board.lists.forEach((list) => {
                if (!Array.isArray(list?.cards)) return;
                list.cards.forEach((card) => {
                    if (
                        typeof card?.dateValue !== "string" ||
                        !/^\d{4}-\d{2}-\d{2}$/.test(card.dateValue)
                    ) {
                        card.urgent = false;
                        return;
                    }
                    const dueDate = new Date(`${card.dateValue}T00:00:00`);
                    card.urgent =
                        !Number.isNaN(dueDate.getTime()) &&
                        Math.ceil(
                            (dueDate.getTime() - today.getTime()) / 86_400_000
                        ) <= urgencyDays;
                });
            });
            window.localStorage.setItem(projectName, JSON.stringify(board));
        } catch (error) {
            console.warn("Unable to refresh task urgency", error);
        }
    }

    function closeSettings() {
        if (!dom.settingsPanel || !dom.settingsButton) return;
        dom.settingsPanel.hidden = true;
        dom.settingsButton.setAttribute("aria-expanded", "false");
    }

    function setupSettings() {
        if (!dom.settingsPanel || !dom.settingsButton || !dom.urgencyInput) {
            return;
        }
        dom.urgencyInput.value = String(urgencyDays);

        dom.renameButton?.addEventListener("click", () => {
            closeSettings();
            dom.titleInput?.focus();
            dom.titleInput?.select();
        });

        dom.settingsButton.addEventListener("click", () => {
            const willOpen = dom.settingsPanel.hidden;
            dom.settingsPanel.hidden = !willOpen;
            dom.settingsButton.setAttribute("aria-expanded", String(willOpen));
            if (willOpen) {
                dom.urgencyInput.focus();
                dom.urgencyInput.select();
            }
        });

        dom.urgencyInput.addEventListener("input", () => {
            if (dom.urgencyInput.value === "") return;
            const threshold = Number(dom.urgencyInput.value);
            if (!Number.isFinite(threshold)) return;
            urgencyDays = Math.max(0, Math.min(365, Math.round(threshold)));
            updateProjectSettings({ urgencyThresholdDays: urgencyDays });
            refreshStoredUrgency();
        });
        dom.urgencyInput.addEventListener("change", () => {
            dom.urgencyInput.value = String(urgencyDays);
        });

        document.addEventListener("pointerdown", (event) => {
            if (
                dom.settingsPanel.hidden ||
                dom.settingsPanel.contains(event.target) ||
                dom.settingsButton.contains(event.target)
            ) {
                return;
            }
            closeSettings();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key !== "Escape" || dom.settingsPanel.hidden) return;
            closeSettings();
            dom.settingsButton.focus();
        });
    }

    function getBackgroundImage() {
        const backgroundImage = readObjectStorage(PROJECT_SETTINGS_KEY)[projectName]
            ?.backgroundImage;
        return typeof backgroundImage === "string" &&
            backgroundImage.startsWith("data:image/")
            ? backgroundImage
            : "";
    }

    function applyBackground() {
        if (!dom.content) return;
        dom.content.classList.remove("has-board-background");
        dom.content.style.removeProperty("--board-background-image");
    }

    function syncBackgroundControls(message = "") {
        const projectSettings = readObjectStorage(PROJECT_SETTINGS_KEY)[projectName] || {};
        const hasBackground = Boolean(getBackgroundImage());
        if (dom.removeBackgroundButton) {
            dom.removeBackgroundButton.hidden = !hasBackground;
        }
        if (!dom.backgroundStatus) return;
        dom.backgroundStatus.textContent =
            message ||
            (hasBackground
                ? `Using ${projectSettings.backgroundImageName || "uploaded image"} on Kanban, Gantt, and the fallback cover. The whiteboard stays white.`
                : "Applies to Kanban, Gantt, and the fallback cover. The whiteboard always stays white.");
    }

    function setupBackground() {
        applyBackground();
        syncBackgroundControls();

        dom.backgroundInput?.addEventListener("change", async () => {
            const file = dom.backgroundInput.files?.[0];
            if (!file) return;

            dom.backgroundInput.disabled = true;
            syncBackgroundControls("Preparing image…");
            try {
                const backgroundImage = await optimizeBackgroundImage(file);
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
                dom.backgroundInput.disabled = false;
                dom.backgroundInput.value = "";
            }
        });

        dom.removeBackgroundButton?.addEventListener("click", () => {
            const settings = readObjectStorage(PROJECT_SETTINGS_KEY);
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

    async function optimizeBackgroundImage(file) {
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
        if (!context) throw new Error("This browser cannot prepare that image.");
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

    function setupDeletion() {
        if (
            !dom.deleteButton ||
            !dom.deleteDialog ||
            !dom.deleteForm ||
            !dom.deleteName ||
            !dom.deleteConfirmation ||
            !dom.confirmDeletion
        ) {
            return;
        }

        dom.deleteButton.addEventListener("click", () => {
            closeSettings();
            dom.deleteName.textContent = projectName;
            dom.deleteConfirmation.value = "";
            dom.confirmDeletion.disabled = true;
            dom.deleteDialog.showModal();
            window.requestAnimationFrame(() => dom.deleteConfirmation.focus());
        });
        dom.deleteConfirmation.addEventListener("input", () => {
            dom.confirmDeletion.disabled =
                dom.deleteConfirmation.value !== projectName;
        });
        dom.cancelDeletion?.addEventListener("click", () => {
            dom.deleteDialog.close();
        });
        dom.deleteForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (dom.deleteConfirmation.value !== projectName) return;
            dom.confirmDeletion.disabled = true;
            await deleteCurrentProject();
        });
        dom.deleteDialog.addEventListener("click", (event) => {
            if (event.target === dom.deleteDialog) dom.deleteDialog.close();
        });
        dom.deleteDialog.addEventListener("close", () => {
            dom.deleteConfirmation.value = "";
            dom.confirmDeletion.disabled = true;
        });
    }

    async function deleteCurrentProject() {
        const name = projectName;
        window.clearTimeout(autosaveTimer);
        autosaveTimer = 0;

        try {
            window.localStorage.setItem(HOME_INITIALIZED_KEY, "true");
            window.localStorage.removeItem(name);
            if (name === DEFAULT_PROJECT_NAME) {
                window.localStorage.removeItem(LEGACY_BOARD_KEY);
            }
            saveProjectNames(
                readProjectNames().filter((savedName) => savedName !== name)
            );
            removeProjectRecord(PROJECT_METADATA_KEY, name);
            removeProjectRecord(PROJECT_SETTINGS_KEY, name);
            if (window.localStorage.getItem(ACTIVE_PROJECT_KEY) === name) {
                window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
            }
            if (window.sessionStorage.getItem(NEW_PROJECT_FOCUS_KEY) === name) {
                window.sessionStorage.removeItem(NEW_PROJECT_FOCUS_KEY);
            }
            await deleteWhiteboardSnapshot(name);
        } catch (error) {
            console.warn("Unable to delete project", error);
            dom.confirmDeletion.disabled = false;
            return;
        }

        allowNavigation = true;
        window.location.href = "index.html";
    }

    function nextId(prefix) {
        const id = `${prefix}-${state.nextId}`;
        state.nextId += 1;
        return id;
    }

    function midpoint(first, second) {
        return {
            x: (first.x + second.x) * 0.5,
            y: (first.y + second.y) * 0.5,
            pressure:
                ((first.pressure ?? 0.6) + (second.pressure ?? 0.6)) * 0.5
        };
    }

    function sampleQuadratic(start, control, end, progress) {
        const inverse = 1 - progress;
        return {
            x:
                inverse * inverse * start.x +
                2 * inverse * progress * control.x +
                progress * progress * end.x,
            y:
                inverse * inverse * start.y +
                2 * inverse * progress * control.y +
                progress * progress * end.y
        };
    }

    function pointToSegmentDistance(x, y, start, end) {
        const deltaX = end.x - start.x;
        const deltaY = end.y - start.y;
        if (!deltaX && !deltaY) return Math.hypot(x - start.x, y - start.y);

        const projection = clamp(
            ((x - start.x) * deltaX + (y - start.y) * deltaY) /
                (deltaX * deltaX + deltaY * deltaY),
            0,
            1
        );
        return Math.hypot(
            x - (start.x + projection * deltaX),
            y - (start.y + projection * deltaY)
        );
    }

    function lerp(start, end, progress) {
        return start + (end - start) * progress;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function finiteNumber(value, fallback) {
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
    }

    function isCssColour(value) {
        return (
            typeof value === "string" &&
            value.length <= 64 &&
            window.CSS?.supports?.("color", value)
        );
    }

    function isTypingTarget(target) {
        return (
            target instanceof HTMLElement &&
            target.closest("input, textarea, [contenteditable='true']") !== null
        );
    }

    function setStatus(message) {
        if (!dom.statusMessage) return;
        dom.statusMessage.textContent = message;
        window.clearTimeout(state.statusTimer);
        state.statusTimer = window.setTimeout(() => {
            dom.statusMessage.textContent =
                "Space pans • Ctrl+wheel zooms • Right-drag erases";
        }, 3000);
    }

    function setSaveState(label, status) {
        if (!dom.saveState) return;
        dom.saveState.textContent = label;
        dom.saveState.dataset.state = status;
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;");
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replaceAll("'", "&#39;");
    }
})();
