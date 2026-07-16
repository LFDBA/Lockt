(() => {
    "use strict";

    const DATABASE_NAME = "lockt-whiteboards";
    const DATABASE_VERSION = 1;
    const STORE_NAME = "whiteboards";
    const FALLBACK_PREFIX = "lockt:whiteboard:";
    let databasePromise = null;

    function openDatabase() {
        if (databasePromise) return databasePromise;

        databasePromise = new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is unavailable."));
                return;
            }

            const request = window.indexedDB.open(
                DATABASE_NAME,
                DATABASE_VERSION
            );
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                    request.result.createObjectStore(STORE_NAME, {
                        keyPath: "projectName"
                    });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(
                new Error("The whiteboard database is busy.")
            );
        });

        return databasePromise;
    }

    function requestFromStore(mode, operation) {
        return openDatabase().then((database) => new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, mode);
            const request = operation(transaction.objectStore(STORE_NAME));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || transaction.error);
            transaction.onabort = () => reject(
                transaction.error || new Error("Whiteboard storage was interrupted.")
            );
        }));
    }

    async function move(previousName, nextName) {
        if (!previousName || !nextName || previousName === nextName) return;

        try {
            const record = await requestFromStore(
                "readonly",
                (store) => store.get(previousName)
            );
            if (record) {
                await requestFromStore("readwrite", (store) =>
                    store.put({ ...record, projectName: nextName })
                );
                await requestFromStore("readwrite", (store) =>
                    store.delete(previousName)
                );
            }
        } catch (error) {
            databasePromise = null;
            console.warn("Unable to move whiteboard data after renaming", error);
        }

        try {
            const previousKey = `${FALLBACK_PREFIX}${previousName}`;
            const nextKey = `${FALLBACK_PREFIX}${nextName}`;
            const fallback = window.localStorage.getItem(previousKey);
            if (fallback !== null) {
                window.localStorage.setItem(nextKey, fallback);
                window.localStorage.removeItem(previousKey);
            }
        } catch (error) {
            console.warn("Unable to move fallback whiteboard data", error);
        }
    }

    async function remove(projectName) {
        if (!projectName) return;

        try {
            await requestFromStore("readwrite", (store) =>
                store.delete(projectName)
            );
        } catch (error) {
            databasePromise = null;
            console.warn("Unable to delete whiteboard data", error);
        }

        try {
            window.localStorage.removeItem(`${FALLBACK_PREFIX}${projectName}`);
        } catch (error) {
            console.warn("Unable to delete fallback whiteboard data", error);
        }
    }

    window.LocktWhiteboardStorage = Object.freeze({ move, remove });
})();
