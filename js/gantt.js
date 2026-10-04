const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const GROUP_COLOURS = ["#b8a4cc", "#93aaa2", "#a7b99a", "#c9a3a3"];
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const WEEK_IN_MILLISECONDS = 7 * DAY_IN_MILLISECONDS;
const MINIMUM_WEEK_COUNT = 4;
const weekDateFormatter = new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short"
});
const fullDateFormatter = new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    year: "numeric"
});
const ganttTimelineScrollPositions = new Map();

function normalizeProjectName(projectName) {
    return typeof projectName === "string" ? projectName.trim() : "";
}

function getSelectedProjectName() {
    const projectFromUrl = normalizeProjectName(
        new URLSearchParams(window.location.search).get("project")
    );
    const activeProject = normalizeProjectName(
        window.localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY)
    );

    return projectFromUrl || activeProject || DEFAULT_BOARD_STORAGE_KEY;
}

function readBoardState(projectName) {
    try {
        const savedState =
            window.localStorage.getItem(projectName) ||
            (projectName === DEFAULT_BOARD_STORAGE_KEY
                ? window.localStorage.getItem(LEGACY_BOARD_STORAGE_KEY)
                : null);

        if (!savedState) return null;

        const boardState = JSON.parse(savedState);

        return boardState && Array.isArray(boardState.lists) ? boardState : null;
    } catch (error) {
        console.warn("Unable to read the board for the Gantt view", error);
        return null;
    }
}

function parseCardDate(dateValue) {
    if (typeof dateValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return null;
    }

    const [year, month, day] = dateValue.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfWeek(date) {
    const weekStart = new Date(date);
    const daysSinceMonday = (weekStart.getDay() + 6) % 7;

    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - daysSinceMonday);

    return weekStart;
}

function addDays(date, dayCount) {
    const nextDate = new Date(date);

    nextDate.setDate(nextDate.getDate() + dayCount);
    return nextDate;
}

function createTaskData(card, listIndex, cardIndex) {
    const dueDate = parseCardDate(card?.dateValue);
    const savedStartDate = parseCardDate(card?.startDateValue);
    const title =
        typeof card?.title === "string" && card.title.trim()
            ? card.title.trim()
            : "Untitled task";

    return {
        title,
        dueDate,
        savedStartDate,
        listIndex,
        cardIndex,
        urgent: Boolean(card?.urgent)
    };
}

function getGanttGroups(boardState) {
    const savedLists = Array.isArray(boardState?.lists) ? boardState.lists : [];
    const lists = savedLists.length
        ? savedLists
        : [
            { title: "To Do", cards: [] },
            { title: "Doing", cards: [] },
            { title: "Done", cards: [] }
        ];

    return lists.map((list, groupIndex) => {
        const cards = Array.isArray(list.cards) ? list.cards : [];

        return {
            title:
                typeof list.title === "string" && list.title.trim()
                    ? list.title.trim()
                    : "Untitled list",
            colour:
                typeof list.backgroundColor === "string"
                    ? list.backgroundColor
                    : null,
            collapsed: groupIndex === 1 && cards.length === 0,
            tasks: cards.map((card, cardIndex) =>
                createTaskData(card, groupIndex, cardIndex)
            )
        };
    });
}

function getTimelineRange(groups) {
    const timeframeDates = groups.flatMap((group) =>
        group.tasks.flatMap((task) => {
            if (!task.dueDate) return [];

            const effectiveStartDate =
                task.savedStartDate && task.savedStartDate <= task.dueDate
                    ? task.savedStartDate
                    : addDays(task.dueDate, -6);

            return [effectiveStartDate, task.dueDate];
        })
    );
    const hasScheduledTasks = timeframeDates.length > 0;
    const firstDate = hasScheduledTasks
        ? new Date(Math.min(...timeframeDates.map((date) => date.getTime())))
        : new Date();
    const lastDate = hasScheduledTasks
        ? new Date(Math.max(...timeframeDates.map((date) => date.getTime())))
        : firstDate;
    const startDate = startOfWeek(
        hasScheduledTasks ? addDays(firstDate, -7) : firstDate
    );
    const paddedLastDate = hasScheduledTasks ? addDays(lastDate, 7) : lastDate;
    const weeksToLastDate = Math.ceil(
        (paddedLastDate.getTime() -
            startDate.getTime() +
            DAY_IN_MILLISECONDS) /
        WEEK_IN_MILLISECONDS
    );

    return {
        startDate,
        weekCount: Math.max(MINIMUM_WEEK_COUNT, weeksToLastDate)
    };
}

function scheduleTasks(groups, timelineRange) {
    return groups.map((group) => ({
        ...group,
        tasks: group.tasks.map((task) => {
            if (!task.dueDate) return task;

            const effectiveStartDate =
                task.savedStartDate && task.savedStartDate <= task.dueDate
                    ? task.savedStartDate
                    : addDays(task.dueDate, -6);
            const startPosition =
                (effectiveStartDate.getTime() -
                    timelineRange.startDate.getTime()) /
                WEEK_IN_MILLISECONDS;
            const endPosition =
                (task.dueDate.getTime() - timelineRange.startDate.getTime() +
                    DAY_IN_MILLISECONDS) /
                WEEK_IN_MILLISECONDS;
            const barStart = Math.max(0, startPosition);
            const barEnd = Math.max(barStart + 1 / 7, endPosition);
            const barSpan = barEnd - barStart;

            return {
                ...task,
                effectiveStartDate,
                startRatio: barStart / timelineRange.weekCount,
                endRatio: barEnd / timelineRange.weekCount,
                startPercent: `${(barStart / timelineRange.weekCount) * 100
                    }%`,
                spanPercent: `${(barSpan / timelineRange.weekCount) * 100
                    }%`
            };
        })
    }));
}

function formatWeekRange(weekStart) {
    const weekEnd = addDays(weekStart, 6);

    return `${weekDateFormatter.format(weekStart)}–${weekDateFormatter.format(
        weekEnd
    )}`;
}

function createWeekLabels(timelineRange) {
    const weekLabels = document.createElement("div");

    const labels = Array.from({ length: timelineRange.weekCount }, (_, index) => {
        const label = document.createElement("span");
        const weekName = document.createElement("strong");
        const dateRange = document.createElement("small");
        const weekStart = addDays(timelineRange.startDate, index * 7);

        label.className = "week-label";
        weekName.textContent = `Week ${index + 1}`;
        dateRange.textContent = formatWeekRange(weekStart);
        label.append(weekName, dateRange);

        return label;
    });

    weekLabels.className = "week-labels list-week-labels";
    weekLabels.setAttribute("aria-hidden", "true");
    weekLabels.append(...labels);

    return weekLabels;
}

function setupTimelineScrollers() {
    const listScrollers = [
        ...document.querySelectorAll(".group-timeline-scroll")
    ];

    function enableWheelScrolling(scroller) {
        if (!scroller) return;

        scroller.addEventListener(
            "wheel",
            (event) => {
                const scrollDelta =
                    Math.abs(event.deltaY) >= Math.abs(event.deltaX)
                        ? -event.deltaY
                        : event.deltaX;

                if (!scrollDelta || scroller.scrollWidth <= scroller.clientWidth) {
                    return;
                }

                event.preventDefault();
                const deltaMultiplier =
                    event.deltaMode === WheelEvent.DOM_DELTA_LINE
                        ? 18
                        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                            ? scroller.clientWidth
                            : 1;

                scroller.scrollLeft += scrollDelta * deltaMultiplier;
            },
            { passive: false }
        );
    }

    listScrollers.forEach((scroller) => {
        const scrollKey = scroller.dataset.timelineScrollKey;
        scroller.scrollLeft = ganttTimelineScrollPositions.get(scrollKey) || 0;
        enableWheelScrolling(scroller);
        scroller.addEventListener("scroll", () => {
            ganttTimelineScrollPositions.set(scrollKey, scroller.scrollLeft);
        });
    });
}

function formatDateValue(date) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
    ].join("-");
}

function clampDateToTimeline(date, timelineRange) {
    const firstDate = timelineRange.startDate;
    const lastDate = addDays(
        firstDate,
        timelineRange.weekCount * 7 - 1
    );

    if (date < firstDate) return new Date(firstDate);
    if (date > lastDate) return lastDate;

    return date;
}

function getDateAtPointer(pointerX, timeline, timelineRange) {
    const bounds = timeline.getBoundingClientRect();
    const pointerRatio = Math.max(
        0,
        Math.min(1, (pointerX - bounds.left) / bounds.width)
    );
    const dayOffset = Math.round(
        pointerRatio * (timelineRange.weekCount * 7 - 1)
    );

    return addDays(timelineRange.startDate, dayOffset);
}

function updateBarTimeframe(bar, task, startDate, endDate, timelineRange) {
    const totalDays = timelineRange.weekCount * 7;
    const startDay =
        (startDate.getTime() - timelineRange.startDate.getTime()) /
        DAY_IN_MILLISECONDS;
    const endDay =
        (endDate.getTime() - timelineRange.startDate.getTime()) /
        DAY_IN_MILLISECONDS +
        1;
    const startRatio = startDay / totalDays;
    const endRatio = endDay / totalDays;

    task.effectiveStartDate = startDate;
    task.savedStartDate = startDate;
    task.dueDate = endDate;
    task.startRatio = startRatio;
    task.endRatio = endRatio;
    task.startPercent = `${startRatio * 100}%`;
    task.spanPercent = `${(endRatio - startRatio) * 100}%`;

    bar.style.setProperty("--start-percent", task.startPercent);
    bar.style.setProperty("--span-percent", task.spanPercent);
    bar.title = `${task.title} — ${fullDateFormatter.format(
        startDate
    )} to ${fullDateFormatter.format(endDate)}`;
}

function showTaskDateTooltip(bar, mode, task) {
    const tooltip = bar.querySelector(".task-date-tooltip");

    if (!tooltip) return;

    tooltip.className = `task-date-tooltip is-visible is-${mode}`;
    tooltip.textContent =
        mode === "start"
            ? `Starts ${fullDateFormatter.format(task.effectiveStartDate)}`
            : mode === "end"
                ? `Ends ${fullDateFormatter.format(task.dueDate)}`
                : `${fullDateFormatter.format(
                    task.effectiveStartDate
                )} – ${fullDateFormatter.format(task.dueDate)}`;
}

function hideTaskDateTooltip(bar) {
    const tooltip = bar.querySelector(".task-date-tooltip");

    if (!tooltip) return;

    tooltip.className = "task-date-tooltip";
}

function persistTaskTimeframe(projectName, task) {
    try {
        const boardState = readBoardState(projectName);
        const card = boardState?.lists?.[task.listIndex]?.cards?.[task.cardIndex];

        if (!card) return false;

        card.startDateValue = formatDateValue(task.effectiveStartDate);
        card.dateValue = formatDateValue(task.dueDate);
        card.isEmptyDate = false;

        window.localStorage.setItem(projectName, JSON.stringify(boardState));
        return true;
    } catch (error) {
        console.warn("Unable to save the resized task timeframe", error);
        return false;
    }
}

function setupResizeHandle(
    handle,
    edge,
    bar,
    task,
    projectName,
    timelineRange
) {
    function resizeToDate(selectedDate) {
        const startDate = new Date(task.effectiveStartDate);
        const endDate = new Date(task.dueDate);

        if (edge === "start") {
            updateBarTimeframe(
                bar,
                task,
                selectedDate > endDate ? endDate : selectedDate,
                endDate,
                timelineRange
            );
        } else {
            updateBarTimeframe(
                bar,
                task,
                startDate,
                selectedDate < startDate ? startDate : selectedDate,
                timelineRange
            );
        }
    }

    handle.addEventListener("pointerdown", (event) => {
        const timeline = bar.closest(".group-timeline");

        if (!timeline) return;

        if (event.button !== 0 && event.pointerType === "mouse") return;

        event.preventDefault();
        event.stopPropagation();
        bar.classList.add("is-resizing");
        document.body.classList.add("gantt-resizing");
        showTaskDateTooltip(bar, edge, task);

        const handlePointerMove = (moveEvent) => {
            const selectedDate = clampDateToTimeline(
                getDateAtPointer(moveEvent.clientX, timeline, timelineRange),
                timelineRange
            );

            resizeToDate(selectedDate);
            showTaskDateTooltip(bar, edge, task);
        };

        const finishResize = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishResize);
            window.removeEventListener("pointercancel", cancelResize);
            bar.classList.remove("is-resizing");
            document.body.classList.remove("gantt-resizing");
            hideTaskDateTooltip(bar);
            persistTaskTimeframe(projectName, task);
            initializeGanttView();
        };

        const cancelResize = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishResize);
            window.removeEventListener("pointercancel", cancelResize);
            bar.classList.remove("is-resizing");
            document.body.classList.remove("gantt-resizing");
            hideTaskDateTooltip(bar);
            initializeGanttView();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finishResize);
        window.addEventListener("pointercancel", cancelResize);
    });

    handle.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

        event.preventDefault();
        const currentDate = edge === "start" ? task.effectiveStartDate : task.dueDate;
        const dayDelta = event.key === "ArrowLeft" ? -1 : 1;
        const selectedDate = clampDateToTimeline(
            addDays(currentDate, dayDelta),
            timelineRange
        );

        resizeToDate(selectedDate);
        persistTaskTimeframe(projectName, task);
        initializeGanttView();
    });
}

function setupTaskDrag(bar, task, projectName, timelineRange) {
    function moveTaskByDays(dayDelta) {
        const startDate = addDays(task.effectiveStartDate, dayDelta);
        const endDate = addDays(task.dueDate, dayDelta);

        updateBarTimeframe(
            bar,
            task,
            startDate,
            endDate,
            timelineRange
        );
    }

    bar.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".task-resize-handle")) return;
        if (event.button !== 0 && event.pointerType === "mouse") return;

        const timeline = bar.closest(".group-timeline");

        if (!timeline) return;

        event.preventDefault();
        const initialPointerX = event.clientX;
        const initialStartDate = new Date(task.effectiveStartDate);
        const initialEndDate = new Date(task.dueDate);
        const timelineEndDate = addDays(
            timelineRange.startDate,
            timelineRange.weekCount * 7 - 1
        );
        const earliestDayDelta = Math.ceil(
            (timelineRange.startDate.getTime() - initialStartDate.getTime()) /
            DAY_IN_MILLISECONDS
        );
        const latestDayDelta = Math.floor(
            (timelineEndDate.getTime() - initialEndDate.getTime()) /
            DAY_IN_MILLISECONDS
        );

        bar.classList.add("is-dragging");
        document.body.classList.add("gantt-dragging");
        showTaskDateTooltip(bar, "centre", task);

        const handlePointerMove = (moveEvent) => {
            const bounds = timeline.getBoundingClientRect();
            const rawDayDelta = Math.round(
                ((moveEvent.clientX - initialPointerX) / bounds.width) *
                timelineRange.weekCount *
                7
            );
            const dayDelta = Math.max(
                earliestDayDelta,
                Math.min(latestDayDelta, rawDayDelta)
            );

            updateBarTimeframe(
                bar,
                task,
                addDays(initialStartDate, dayDelta),
                addDays(initialEndDate, dayDelta),
                timelineRange
            );
            showTaskDateTooltip(bar, "centre", task);
        };

        const finishDrag = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishDrag);
            window.removeEventListener("pointercancel", cancelDrag);
            bar.classList.remove("is-dragging");
            document.body.classList.remove("gantt-dragging");
            hideTaskDateTooltip(bar);
            persistTaskTimeframe(projectName, task);
            initializeGanttView();
        };

        const cancelDrag = () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishDrag);
            window.removeEventListener("pointercancel", cancelDrag);
            bar.classList.remove("is-dragging");
            document.body.classList.remove("gantt-dragging");
            hideTaskDateTooltip(bar);
            initializeGanttView();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", cancelDrag);
    });

    bar.addEventListener("keydown", (event) => {
        if (
            event.target !== bar ||
            (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
        ) {
            return;
        }

        event.preventDefault();
        const dayDelta = event.key === "ArrowLeft" ? -1 : 1;
        const nextStartDate = clampDateToTimeline(
            addDays(task.effectiveStartDate, dayDelta),
            timelineRange
        );
        const appliedDayDelta = Math.round(
            (nextStartDate.getTime() - task.effectiveStartDate.getTime()) /
            DAY_IN_MILLISECONDS
        );
        const nextEndDate = addDays(task.dueDate, appliedDayDelta);
        const timelineEndDate = addDays(
            timelineRange.startDate,
            timelineRange.weekCount * 7 - 1
        );

        if (nextEndDate > timelineEndDate) return;

        moveTaskByDays(appliedDayDelta);
        persistTaskTimeframe(projectName, task);
        initializeGanttView();
    });
}

function createTaskLabel(task) {
    const label = document.createElement("div");
    const dueDateDescription = task.dueDate
        ? `Due ${fullDateFormatter.format(task.dueDate)}`
        : "No due date";

    label.className = `task-label${task.dueDate ? "" : " is-unscheduled"}`;
    label.textContent = task.title;
    label.title = `${task.title} — ${dueDateDescription}`;

    return label;
}

function createGanttBar(
    task,
    taskIndex,
    isComplete,
    projectName,
    timelineRange
) {
    if (!task.dueDate) return null;

    const bar = document.createElement("div");
    const dragSurface = document.createElement("div");
    const dateTooltip = document.createElement("div");
    const startHandle = document.createElement("button");
    const endHandle = document.createElement("button");
    const stateClasses = [
        isComplete ? "is-complete" : "",
        task.urgent ? "is-urgent" : ""
    ].filter(Boolean);

    bar.className = ["gantt-bar", ...stateClasses].join(" ");
    bar.style.setProperty("--row", taskIndex);
    bar.style.setProperty("--start-percent", task.startPercent);
    bar.style.setProperty("--span-percent", task.spanPercent);
    bar.title = `${task.title} — ${fullDateFormatter.format(
        task.effectiveStartDate
    )} to ${fullDateFormatter.format(task.dueDate)}`;
    bar.setAttribute("role", "group");
    bar.setAttribute(
        "aria-label",
        `${task.title}, ${fullDateFormatter.format(
            task.effectiveStartDate
        )} to ${fullDateFormatter.format(task.dueDate)}`
    );
    bar.tabIndex = 0;

    dragSurface.className = "task-drag-surface";
    dragSurface.setAttribute("aria-hidden", "true");
    dateTooltip.className = "task-date-tooltip";
    dateTooltip.setAttribute("aria-hidden", "true");

    startHandle.className = "task-resize-handle is-start";
    startHandle.type = "button";
    startHandle.setAttribute("aria-label", `Change ${task.title} start date`);
    endHandle.className = "task-resize-handle is-end";
    endHandle.type = "button";
    endHandle.setAttribute("aria-label", `Change ${task.title} end date`);

    setupResizeHandle(
        startHandle,
        "start",
        bar,
        task,
        projectName,
        timelineRange
    );
    setupResizeHandle(
        endHandle,
        "end",
        bar,
        task,
        projectName,
        timelineRange
    );
    bar.append(dragSurface, dateTooltip, startHandle, endHandle);
    setupTaskDrag(bar, task, projectName, timelineRange);

    return bar;
}

function getTaskBarColour(task, isComplete) {
    if (isComplete) return "#eee8dd";
    if (task.urgent) return "#d5a09a";

    return "#93aaa2";
}

function createTaskConnector(
    sourceTask,
    sourceRow,
    targetTask,
    targetRow,
    isComplete
) {
    const connector = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const goesUp = sourceRow > targetRow;

    connector.classList.add("task-connector");
    if (goesUp) connector.classList.add("is-up");
    connector.style.setProperty("--top-row", Math.min(sourceRow, targetRow));
    connector.style.setProperty(
        "--connector-colour",
        getTaskBarColour(sourceTask, isComplete)
    );
    connector.style.setProperty(
        "--from-percent",
        `${sourceTask.endRatio * 100}%`
    );
    connector.style.setProperty(
        "--to-percent",
        `${targetTask.startRatio * 100}%`
    );
    connector.setAttribute("viewBox", "0 0 100 100");
    connector.setAttribute("preserveAspectRatio", "none");
    connector.setAttribute("aria-hidden", "true");
    path.setAttribute(
        "d",
        goesUp
            ? "M 0 100 H 18 Q 28 100 28 78 V 22 Q 28 0 50 0 H 100"
            : "M 0 0 H 18 Q 28 0 28 22 V 78 Q 28 100 50 100 H 100"
    );
    connector.append(path);

    return connector;
}

function createTaskConnectors(tasks, isComplete) {
    const connectors = [];

    for (let row = 0; row < tasks.length - 1; row += 1) {
        const upperTask = tasks[row];
        const lowerTask = tasks[row + 1];

        if (!upperTask.dueDate || !lowerTask.dueDate) continue;

        if (upperTask.endRatio < lowerTask.startRatio) {
            connectors.push(
                createTaskConnector(
                    upperTask,
                    row,
                    lowerTask,
                    row + 1,
                    isComplete
                )
            );
        } else if (lowerTask.endRatio < upperTask.startRatio) {
            connectors.push(
                createTaskConnector(
                    lowerTask,
                    row + 1,
                    upperTask,
                    row,
                    isComplete
                )
            );
        }
    }

    return connectors;
}

function createGanttGroup(
    group,
    groupIndex,
    projectName,
    timelineRange
) {
    const section = document.createElement("section");
    const sidebar = document.createElement("div");
    const toggle = document.createElement("button");
    const title = document.createElement("span");
    const chevron = document.createElement("span");
    const taskLabels = document.createElement("div");
    const addTask = document.createElement("button");
    const timelineScroll = document.createElement("div");
    const timeline = document.createElement("div");
    const colour = group.colour || GROUP_COLOURS[groupIndex % GROUP_COLOURS.length];
    const isComplete = group.title.trim().toLowerCase() === "done";

    section.className = `gantt-group${group.collapsed ? " is-collapsed" : ""}`;
    section.style.setProperty("--group-colour", colour);
    section.style.setProperty("--task-count", group.tasks.length);

    sidebar.className = "group-sidebar";
    toggle.className = "group-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!group.collapsed));
    title.textContent = group.title;
    chevron.className = "group-chevron";
    chevron.setAttribute("aria-hidden", "true");
    toggle.append(title, chevron);

    taskLabels.className = "task-labels";
    taskLabels.append(...group.tasks.map(createTaskLabel));

    addTask.className = "add-task";
    addTask.type = "button";
    addTask.textContent = "+ Add Task";
    addTask.title = "Open this project in the Kanban view to add a task";
    addTask.addEventListener("click", () => {
        window.location.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
    });

    timelineScroll.className = "timeline-scroll group-timeline-scroll";
    timelineScroll.dataset.timelineScrollKey = String(groupIndex);
    timeline.className = "group-timeline";
    timeline.append(
        createWeekLabels(timelineRange),
        ...group.tasks
            .map((task, taskIndex) =>
                createGanttBar(
                    task,
                    taskIndex,
                    isComplete,
                    projectName,
                    timelineRange
                )
            )
            .filter(Boolean)
    );
    timeline.append(...createTaskConnectors(group.tasks, isComplete));

    toggle.addEventListener("click", () => {
        const isCollapsed = section.classList.toggle("is-collapsed");
        toggle.setAttribute("aria-expanded", String(!isCollapsed));
    });

    sidebar.append(toggle, taskLabels, addTask);
    timelineScroll.append(timeline);
    section.append(sidebar, timelineScroll);

    return section;
}

function initializeGanttView() {
    const projectName = getSelectedProjectName();
    const projectTitle = document.querySelector(".gantt-project-title");
    const backLink = document.querySelector(".gantt-back");
    const groupsContainer = document.querySelector(".gantt-groups");
    const chart = document.querySelector(".gantt-chart");
    const boardState = readBoardState(projectName);
    const boardGroups = getGanttGroups(boardState);
    const timelineRange = getTimelineRange(boardGroups);
    const groups = scheduleTasks(boardGroups, timelineRange);

    document.title = `${projectName} Gantt Chart`;

    if (projectTitle) projectTitle.textContent = projectName;
    if (backLink) {
        backLink.href = `kanban.html?project=${encodeURIComponent(projectName)}`;
    }
    if (chart) {
        chart.style.setProperty("--week-count", timelineRange.weekCount);
    }

    if (groupsContainer) {
        groupsContainer.replaceChildren(
            ...groups.map((group, index) =>
                createGanttGroup(
                    group,
                    index,
                    projectName,
                    timelineRange
                )
            )
        );
    }

    setupTimelineScrollers();
}

initializeGanttView();
