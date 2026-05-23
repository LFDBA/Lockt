const addListButton = document.querySelector(".add-list");
const template = document.querySelector("#list-template");
const listsRow = document.querySelector(".lists-row");
const trash = document.querySelector("#trash");
const alertBox = document.querySelector("#alert");

let draggedCard = null;
let draggedFromList = null;
let deletedCards = [];

const colours = ["#b8a4cc", "#a3c9c9", "#8fa99d", "#a7b99a", "#c9a3a3"];
let lastListColour = null;

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

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        const lastDeleted = deletedCards.pop();

        if (!lastDeleted) return;

        lastDeleted.list.appendChild(lastDeleted.card);
    }
});

function setupCard(card) {
    card.draggable = true;

    card.addEventListener("dragstart", (event) => {
        draggedCard = card;
        draggedFromList = card.parentElement;
        card.classList.add("dragging");

        const dragImage = card.cloneNode(true);
        dragImage.classList.add("drag-preview");

        document.body.appendChild(dragImage);
        event.dataTransfer.setDragImage(dragImage, 100, 40);

        setTimeout(() => {
            dragImage.remove();
        }, 0);
    });

    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        draggedCard = null;
        draggedFromList = null;

        document.querySelectorAll(".list-cards").forEach((container) => {
            container.classList.remove("drag-over");
        });

        trash.classList.remove("drag-over");
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

        deletedCards.push({
            card: draggedCard,
            list: draggedFromList
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
    const otherCards = [...container.querySelectorAll(".card:not(.dragging)")];

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
    const container = clone.querySelector(".list-cards");
    const titleInput = clone.querySelector(".list-title");

    list.style.backgroundColor = getRandomListColour();

    titleInput.value = "";
    titleInput.placeholder = "New List";

    clone.querySelectorAll(".card").forEach(setupCard);
    clone.querySelectorAll(".card-options").forEach(setupCardOptions);
    setupContainer(container);

    listsRow.insertBefore(clone, addListButton);

    requestAnimationFrame(() => {
        titleInput.focus();
    });
}

document.querySelectorAll(".card").forEach(setupCard);
document.querySelectorAll(".card-options").forEach(setupCardOptions);
document.querySelectorAll(".list-cards").forEach(setupContainer);
setupTrash(trash);

addListButton.addEventListener("click", () => {
    createList();
});