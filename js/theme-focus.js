(function setupLocktAppearance() {
    "use strict";

    const THEME_STORAGE_KEY = "lockt:theme";
    const FOCUS_STORAGE_KEY = "lockt:focus-mode";
    const DARK_THEME = "dark";
    const LIGHT_THEME = "light";

    function getStoredTheme() {
        try {
            const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
            if (storedTheme === DARK_THEME || storedTheme === LIGHT_THEME) {
                return storedTheme;
            }
        } catch (error) {
            console.warn("Unable to read the saved theme", error);
        }

        return window.matchMedia?.("(prefers-color-scheme: dark)").matches
            ? DARK_THEME
            : LIGHT_THEME;
    }

    function setTheme(theme, shouldSave = true) {
        const nextTheme = theme === DARK_THEME ? DARK_THEME : LIGHT_THEME;
        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;

        if (shouldSave) {
            try {
                window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
            } catch (error) {
                console.warn("Unable to save the theme", error);
            }
        }

        updateThemeControls(nextTheme);
        window.dispatchEvent(
            new CustomEvent("lockt:themechange", {
                detail: { theme: nextTheme }
            })
        );
    }

    function updateThemeControls(theme) {
        const isDark = theme === DARK_THEME;

        document.querySelectorAll(".theme-toggle").forEach((button) => {
            const icon = button.querySelector(".theme-toggle-icon");
            const label = button.querySelector(".theme-toggle-label");
            const nextLabel = isDark ? "Light mode" : "Dark mode";

            if (icon) icon.textContent = isDark ? "☀" : "☾";
            if (label) label.textContent = nextLabel;
            button.setAttribute("aria-label", `Use ${nextLabel.toLowerCase()}`);
            button.setAttribute("aria-pressed", String(isDark));
            button.title = `Use ${nextLabel.toLowerCase()}`;
        });
    }

    function syncKanbanListColours(root = document) {
        if (!document.body?.classList.contains("kanban-body")) return;

        const fallbackColours = {
            todo: "#b8a4cc",
            doing: "#8fa99d",
            done: "#a7b99a"
        };
        const lists = [
            ...(root instanceof Element && root.matches(".list") ? [root] : []),
            ...root.querySelectorAll(".list")
        ];

        lists.forEach((list) => {
            const inlineColour = list.style.backgroundColor;
            const fallbackEntry = Object.entries(fallbackColours).find(
                ([name]) => list.classList.contains(name)
            );
            const baseColour =
                inlineColour || fallbackEntry?.[1] || "#b8a4cc";
            list.style.setProperty("--lockt-list-colour", baseColour);
        });
    }

    function readFocusMode() {
        try {
            return window.sessionStorage.getItem(FOCUS_STORAGE_KEY) === "true";
        } catch (error) {
            console.warn("Unable to read focus mode", error);
            return false;
        }
    }

    function saveFocusMode(isActive) {
        try {
            if (isActive) {
                window.sessionStorage.setItem(FOCUS_STORAGE_KEY, "true");
            } else {
                window.sessionStorage.removeItem(FOCUS_STORAGE_KEY);
            }
        } catch (error) {
            console.warn("Unable to save focus mode", error);
        }
    }

    function setFocusMode(isActive, { shouldSave = true } = {}) {
        const hasFocusControls = Boolean(
            document.querySelector(".focus-mode-button, .focus-mode-exit")
        );

        if (!hasFocusControls) return;

        document.body.classList.toggle("is-focus-mode", isActive);
        document.querySelectorAll(".focus-mode-button").forEach((button) => {
            button.textContent = isActive ? "Exit focus mode" : "Enter focus mode";
            button.setAttribute("aria-pressed", String(isActive));
        });

        document.querySelectorAll(".focus-mode-exit").forEach((button) => {
            button.hidden = !isActive;
        });

        if (isActive) {
            const settingsPanel = document.querySelector(".kanban-settings-panel");
            const settingsButton = document.querySelector(".kanban-settings-button");
            if (settingsPanel) settingsPanel.hidden = true;
            settingsButton?.setAttribute("aria-expanded", "false");
        }

        if (shouldSave) saveFocusMode(isActive);
    }

    function initialiseControls() {
        const currentTheme =
            document.documentElement.dataset.theme || getStoredTheme();
        updateThemeControls(currentTheme);
        syncKanbanListColours();

        if (document.body.classList.contains("kanban-body")) {
            const listObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        if (node.matches(".list")) {
                            syncKanbanListColours(node);
                        } else if (node.querySelector(".list")) {
                            syncKanbanListColours(node);
                        }
                    });
                });
            });
            listObserver.observe(document.querySelector(".lists-row") || document.body, {
                childList: true,
                subtree: true
            });
        }

        document.querySelectorAll(".theme-toggle").forEach((button) => {
            button.addEventListener("click", () => {
                const nextTheme =
                    document.documentElement.dataset.theme === DARK_THEME
                        ? LIGHT_THEME
                        : DARK_THEME;
                setTheme(nextTheme);
                syncKanbanListColours();
            });
        });

        const initialFocusMode = readFocusMode();
        setFocusMode(initialFocusMode, { shouldSave: false });

        document.querySelectorAll(".focus-mode-button").forEach((button) => {
            button.addEventListener("click", () => {
                setFocusMode(!document.body.classList.contains("is-focus-mode"));
            });
        });

        document.querySelectorAll(".focus-mode-exit").forEach((button) => {
            button.addEventListener("click", () => {
                setFocusMode(false);
                document.querySelector(".kanban-settings-button")?.focus();
            });
        });

        document.addEventListener("keydown", (event) => {
            if (
                event.key === "Escape" &&
                document.body.classList.contains("is-focus-mode") &&
                !document.querySelector("dialog[open]")
            ) {
                setFocusMode(false);
                document.querySelector(".kanban-settings-button")?.focus();
            }
        });
    }

    const initialTheme = getStoredTheme();
    document.documentElement.dataset.theme = initialTheme;
    document.documentElement.style.colorScheme = initialTheme;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialiseControls, {
            once: true
        });
    } else {
        initialiseControls();
    }
})();
