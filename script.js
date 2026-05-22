const cardContainers = document.querySelectorAll(".list-cards");
const cards = document.querySelectorAll(".card");

let draggedCard = null;

cards.forEach((card) => {
  card.draggable = true;

  card.addEventListener("dragstart", () => {
    draggedCard = card;
    card.classList.add("dragging");
  });

  card.addEventListener("dragend", () => {
    card.classList.remove("dragging");
    draggedCard = null;

    cardContainers.forEach((container) => {
      container.classList.remove("drag-over");
    });
  });
});

cardContainers.forEach((container) => {
  container.addEventListener("dragover", (event) => {
    event.preventDefault();

    if (!draggedCard) {
      return;
    }

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
});

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
