const cardContainers = document.querySelectorAll(".list-cards");
const cards = document.querySelectorAll(".card");
const addListButton = document.querySelector(".add-list");
const lists = document.querySelectorAll(".list");
const template = document.querySelector("#list-template");
const listsRow = document.querySelector(".lists-row");


let draggedCard = null;

function setupCard(card) {
    card.draggable = true;

    card.addEventListener("dragstart", () => {
        draggedCard = card;
        card.classList.add("dragging");
    });

    card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        draggedCard = null;

        document.querySelectorAll(".list-cards").forEach((container) => {
            container.classList.remove("drag-over");
        });
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

document.querySelectorAll(".card").forEach(setupCard);
document.querySelectorAll(".list-cards").forEach(setupContainer);

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


function createList(name) {
    const clone = template.content.cloneNode(true);
    const list = clone.querySelector(".list");
    const container = clone.querySelector(".list-cards");

    list.style.backgroundColor = "#c9a3a3";
    list.classList.add(name.toLowerCase());
    list.querySelector("h2").textContent = name;

    clone.querySelectorAll(".card").forEach(setupCard);
    setupContainer(container);

    listsRow.insertBefore(clone, addListButton);
}

addListButton.addEventListener("click", () => {
    createList("Ideas");
});