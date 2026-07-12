const addListButton = document.querySelector(".add-list");
const template = document.querySelector("#list-template");
const listsRow = document.querySelector(".lists-row");
const trash = document.querySelector("#trash");
const alertBox = document.querySelector("#alert");
const cardEditorBackdrop = document.querySelector("#card-editor-backdrop");

let draggedCard = null;
let draggedFromList = null;
let actionHistory = [];
let activeCardDrag = null;
let activeListDrag = null;
let pendingListDrag = null;
let activeCardNewListGhost = null;
let activeCardEditor = null;

const colours = ["#b8a4cc", "#a3c9c9", "#8fa99d", "#a7b99a", "#c9a3a3"];
let lastListColour = null;
const DROP_ANIMATION_MS = 180;
const CARD_EDITOR_TRANSITION_MS = 240;
const LIST_DRAG_THRESHOLD = 6;
const EMPTY_CARD_DATE_LABEL = "No due date";
const DEFAULT_BOARD_STORAGE_KEY = "My Project";
const LEGACY_BOARD_STORAGE_KEY = "lockt.board.v1";
const ACTIVE_BOARD_STORAGE_KEY = "lockt:active-kanban-project";
const PROJECTS_STORAGE_KEY = "lockt:kanban-projects";
const BOARD_STORAGE_KEY = getSelectedBoardStorageKey();
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

function rememberProjectName(projectName) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (!normalizedProjectName) return;

    const projectNames = readProjectNames();

    if (!projectNames.includes(normalizedProjectName)) {
        saveProjectNames([...projectNames, normalizedProjectName]);
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

    const title = document.querySelector(".top-bar h1");

    if (title) {
        title.textContent = BOARD_STORAGE_KEY;
    }
}

document.querySelector(".back")?.addEventListener("click", () => {
    window.location.href = "index.html";
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

function getListAfterPointer(pointerX) {
    const otherLists = [
        ...listsRow.querySelectorAll(
            '.list:not(.list-placeholder):not([data-ghost-list="true"])'
        )
    ];

    return otherLists.reduce(
        (closest, list) => {
            const bounds = list.getBoundingClientRect();
            const offset = pointerX - bounds.left - bounds.width / 2;

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

    return {
        title: titleInput?.value || "",
        backgroundColor: window.getComputedStyle(list).backgroundColor,
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

function stopListPointerTracking() {
    window.removeEventListener("pointermove", handleListPointerMove);
    window.removeEventListener("pointerup", handleListPointerUp);
    window.removeEventListener("pointercancel", handleListPointerCancel);

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

function renderCardDisplayContent(card, cardData = {}) {
    const title = typeof cardData.title === "string" ? cardData.title.trim() : "";
    const fallbackDateLabel =
        typeof cardData.dateLabel === "string" && cardData.dateLabel.trim()
            ? cardData.dateLabel.trim()
            : EMPTY_CARD_DATE_LABEL;
    const dateValue =
        normalizeDateValue(cardData.dateValue) ||
        deriveDateValueFromLabel(fallbackDateLabel);
    const options = document.createElement("div");
    const description = document.createElement("p");
    const date = document.createElement("div");

    if (typeof cardData.urgent === "boolean") {
        card.classList.toggle("urgent", cardData.urgent);
    }

    options.className = "card-options";
    options.textContent = "•••";
    options.setAttribute("role", "button");
    options.setAttribute("aria-label", "Edit card");
    options.tabIndex = 0;

    description.textContent = title;
    date.className = "date";
    date.textContent = dateValue ? formatCardDate(dateValue) : fallbackDateLabel;

    if (dateValue) {
        date.dataset.dateValue = dateValue;
    } else if (fallbackDateLabel === EMPTY_CARD_DATE_LABEL) {
        date.classList.add("is-empty");
    }

    card.replaceChildren(options, description, date);
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

function movePlaceholderToPointer(container, placeholder, pointerY) {
    const nextCard = getCardAfterPointer(container, pointerY);

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
    if (!activeCardDrag) return;

    updateCardPreviewPosition(event.clientX, event.clientY);
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

function moveListPlaceholderToPointer(pointerX) {
    if (!activeListDrag) return;

    const nextList = getListAfterPointer(pointerX);

    if (nextList) {
        listsRow.insertBefore(activeListDrag.placeholder, nextList);
        return;
    }

    listsRow.insertBefore(activeListDrag.placeholder, addListButton);
}

function handleListPointerMove(event) {
    if (!activeListDrag) return;

    updateListPreviewPosition(event.clientX, event.clientY);
    clearDragHighlights();

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);

    if (overTrash) {
        trash.classList.add("drag-over");
        return;
    }

    moveListPlaceholderToPointer(event.clientX);
}

function beginListDrag(listDrag, clientX, clientY) {
    const { list, pointerOffsetX, pointerOffsetY } = listDrag;
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
        pointerOffsetX,
        pointerOffsetY
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
    if (!activeCardDrag) return;

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);
    finishCardDrop({ deleteCard: overTrash });
}

function handleListPointerUp(event) {
    if (!activeListDrag) return;

    const { overTrash } = getPointerDropTarget(event.clientX, event.clientY);

    finishListDrop({ deleteList: overTrash });
}

function handleCardPointerCancel() {
    if (!activeCardDrag) return;

    finishCardDrop();
}

function handleListPointerCancel() {
    if (!activeListDrag) return;

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

    actionHistory = [];
}

function initializeBoard() {
    rememberProjectName(BOARD_STORAGE_KEY);
    window.localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, BOARD_STORAGE_KEY);
    syncBoardTitle();

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

    card.addEventListener("pointerdown", (event) => {
        if (card === activeCardEditor?.card) {
            return;
        }

        if (event.button !== 0 || event.target.closest(".card-options")) {
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
            pointerOffsetX,
            pointerOffsetY
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
        if (
            event.button !== 0 ||
            event.target.closest(".card, .card-composer, button, textarea") ||
            event.target.closest("input:not(.list-title)")
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

        const nextCard = getCardAfterPointer(container, event.clientY);

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

function getCardAfterPointer(container, pointerY) {
    const otherCards = [
        ...container.querySelectorAll(".card:not(.card-placeholder)")
    ];

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
