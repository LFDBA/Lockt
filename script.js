const addListButton = document.querySelector(".add-list");
const template = document.querySelector("#list-template");
const listsRow = document.querySelector(".lists-row");
const trash = document.querySelector("#trash");
const alertBox = document.querySelector("#alert");

let draggedCard = null;
let draggedFromList = null;
let actionHistory = [];
let activeCardDrag = null;
let activeListDrag = null;
let pendingListDrag = null;

const colours = ["#b8a4cc", "#a3c9c9", "#8fa99d", "#a7b99a", "#c9a3a3"];
let lastListColour = null;
const DROP_ANIMATION_MS = 180;
const LIST_DRAG_THRESHOLD = 6;
const EMPTY_CARD_DATE_LABEL = "No due date";
const cardDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
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
        ...listsRow.querySelectorAll(".list:not(.list-placeholder)")
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

    stopCardPointerTracking();
    resetCardDragState();

    if (deleteCard) {
        recordAction({
            type: "card-delete",
            card,
            parent: placeholder.parentElement || sourceList,
            nextSibling: placeholder.nextElementSibling
        });

        placeholder.remove();
        preview.remove();
        showDeleteAlert();
        return;
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
        showDeleteAlert();
        return;
    }

    preview.remove();
    placeholder.replaceWith(list);
    stopListPointerTracking();
    resetListDragState();
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
    const card = document.createElement("div");
    const options = document.createElement("div");
    const description = document.createElement("p");
    const date = document.createElement("div");
    const formattedDate = formatCardDate(dateValue);

    card.className = "card";
    options.className = "card-options";
    options.textContent = "•••";
    description.textContent = title.trim();
    date.className = "date";
    date.textContent = formattedDate;

    if (formattedDate === EMPTY_CARD_DATE_LABEL) {
        date.classList.add("is-empty");
    }

    card.append(options, description, date);

    setupCard(card);
    setupCardOptions(options);

    return card;
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

    if (container) {
        setupContainer(container);
    }

    if (addCardButton) {
        setupAddCardButton(addCardButton);
    }

    setupListDrag(list);
}

document.addEventListener("keydown", (event) => {
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
            return;
        }

        if (lastAction.type === "list-delete") {
            insertNodeAt(
                lastAction.parent,
                lastAction.list,
                lastAction.nextSibling
            );
            return;
        }

        if (lastAction.type === "list-add" && lastAction.list.isConnected) {
            lastAction.list.remove();
        }
    }
});

function setupCard(card) {
    card.draggable = false;

    card.addEventListener("dragstart", (event) => {
        event.preventDefault();
    });

    card.addEventListener("pointerdown", (event) => {
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
    options.addEventListener("click", (event) => {
        event.stopPropagation();
        console.log("Card options clicked");
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

        container.classList.remove("drag-over");
        alertBox.classList.add("show");

        setTimeout(() => {
            alertBox.classList.remove("show");
        }, 5000);
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

    requestAnimationFrame(() => {
        titleInput.focus();
    });
}

document.querySelectorAll(".card").forEach(setupCard);
document.querySelectorAll(".card-options").forEach(setupCardOptions);
document.querySelectorAll(".list").forEach(setupList);
setupTrash(trash);

addListButton.addEventListener("click", () => {
    createList();
});
