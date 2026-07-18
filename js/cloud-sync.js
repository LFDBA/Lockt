(() => {
    "use strict";

    const PROJECTS_KEY = "lockt:kanban-projects";
    const METADATA_KEY = "lockt:kanban-project-metadata";
    const SETTINGS_KEY = "lockt:kanban-project-settings";
    const ACTIVE_PROJECT_KEY = "lockt:active-kanban-project";
    const LEGACY_BOARD_KEY = "lockt.board.v1";
    const DEFAULT_PROJECT_NAME = "My Project";
    const HOME_INITIALIZED_KEY = "lockt:home-initialized";
    const CLOUD_OWNER_KEY = "lockt:cloud-cache-owner";
    const CLOUD_IDS_KEY = "lockt:cloud-project-ids";
    const CLOUD_PENDING_KEY = "lockt:cloud-pending";
    const CLOUD_MIGRATED_PREFIX = "lockt:cloud-migrated:";
    const WHITEBOARD_DATABASE = "lockt-whiteboards";
    const WHITEBOARD_STORE = "whiteboards";
    const WHITEBOARD_FALLBACK_PREFIX = "lockt:whiteboard:";
    const ASSET_BUCKET = "project-assets";
    const SYNC_DELAY_MS = 900;
    const cloudEvents = new EventTarget();

    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;

    let client = null;
    let session = null;
    let applyingCloudState = false;
    let schemaReady = false;
    let syncTimer = 0;
    let syncPromise = Promise.resolve();
    let cloudRows = [];
    let lastStatus = { state: "local", message: "Saved on this device" };

    const config = window.LocktSupabaseConfig || {};
    const ready = initialize();

    window.LocktCloud = Object.freeze({
        ready,
        bootstrapScripts,
        flush: () => queueSync({ immediate: true }),
        getSession: () => session,
        getStatus: () => ({ ...lastStatus }),
        events: cloudEvents,
        signIn,
        signUp,
        sendPasswordReset,
        updatePassword,
        signOut,
        deleteAccount,
        saveWhiteboard,
        renameProject,
        deleteProject
    });

    installStorageObserver();

    async function initialize() {
        if (
            !config.url ||
            !config.publishableKey ||
            !window.supabase?.createClient
        ) {
            setCloudStatus("error", "Cloud connection is unavailable");
            return;
        }

        client = window.supabase.createClient(
            config.url,
            config.publishableKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true
                }
            }
        );

        const { data, error } = await client.auth.getSession();
        if (error) {
            console.warn("Unable to restore the Lockt account session", error);
            setCloudStatus("error", "Unable to restore account session");
        }
        session = data?.session || null;

        client.auth.onAuthStateChange((event, nextSession) => {
            session = nextSession || null;
            dispatchAuthChange(event);
        });

        if (!session?.user) {
            setCloudStatus("local", "Saved on this device");
            dispatchAuthChange("INITIAL_SESSION");
            return;
        }

        await prepareSignedInStorage();
        dispatchAuthChange("INITIAL_SESSION");

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") {
                void queueSync({ immediate: true });
            }
        });
        window.addEventListener("pagehide", () => {
            void queueSync({ immediate: true });
        });
    }

    async function bootstrapScripts(sources) {
        await ready;
        for (const source of sources) {
            await loadScript(source);
        }
    }

    function loadScript(source) {
        return new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = source;
            script.onload = resolve;
            script.onerror = () => reject(
                new Error(`Unable to load ${source}`)
            );
            document.body.append(script);
        });
    }

    function dispatchAuthChange(event) {
        cloudEvents.dispatchEvent(new CustomEvent("authchange", {
            detail: { event, session }
        }));
    }

    function setCloudStatus(state, message) {
        lastStatus = { state, message };
        cloudEvents.dispatchEvent(new CustomEvent("statuschange", {
            detail: { ...lastStatus }
        }));
    }

    function rawGet(key) {
        return window.localStorage.getItem(key);
    }

    function rawSet(key, value) {
        originalSetItem.call(window.localStorage, key, value);
    }

    function rawRemove(key) {
        originalRemoveItem.call(window.localStorage, key);
    }

    function readJson(key, fallback) {
        try {
            const parsed = JSON.parse(rawGet(key) || "null");
            return parsed ?? fallback;
        } catch (error) {
            return fallback;
        }
    }

    function installStorageObserver() {
        Storage.prototype.setItem = function setItem(key, value) {
            originalSetItem.call(this, key, value);
            if (
                this === window.localStorage &&
                !applyingCloudState &&
                shouldSyncStorageMutation(key, value, false)
            ) {
                markPendingAndSchedule();
            }
        };

        Storage.prototype.removeItem = function removeItem(key) {
            const shouldSync =
                this === window.localStorage &&
                !applyingCloudState &&
                shouldSyncStorageMutation(key, null, true);
            originalRemoveItem.call(this, key);
            if (shouldSync) markPendingAndSchedule();
        };

        Storage.prototype.clear = function clear() {
            const isLocalStorage = this === window.localStorage;
            originalClear.call(this);
            if (isLocalStorage && !applyingCloudState) {
                markPendingAndSchedule();
            }
        };
    }

    function shouldSyncStorageMutation(key, value, removing) {
        if (!session?.user || !schemaReady) return false;
        if (
            key === CLOUD_OWNER_KEY ||
            key === CLOUD_IDS_KEY ||
            key === CLOUD_PENDING_KEY ||
            key.startsWith(CLOUD_MIGRATED_PREFIX) ||
            key.startsWith("sb-") ||
            key === "lockt:theme" ||
            key === "lockt:focus-mode" ||
            key.startsWith(WHITEBOARD_FALLBACK_PREFIX)
        ) {
            return false;
        }
        if ([PROJECTS_KEY, METADATA_KEY, SETTINGS_KEY].includes(key)) {
            return true;
        }
        const idMap = readJson(CLOUD_IDS_KEY, {});
        if (idMap[key]) return true;
        if (removing) return getLocalProjectNames().includes(key);
        return looksLikeBoard(value);
    }

    function looksLikeBoard(value) {
        try {
            const parsed = JSON.parse(value || "null");
            return Boolean(parsed && Array.isArray(parsed.lists));
        } catch (error) {
            return false;
        }
    }

    function markPendingAndSchedule() {
        rawSet(CLOUD_PENDING_KEY, "true");
        setCloudStatus("saving", "Saving to your account…");
        window.clearTimeout(syncTimer);
        syncTimer = window.setTimeout(() => {
            void queueSync({ immediate: true });
        }, SYNC_DELAY_MS);
    }

    function queueSync({ immediate = false } = {}) {
        if (!session?.user || !schemaReady || applyingCloudState) {
            return Promise.resolve();
        }
        if (!immediate) {
            markPendingAndSchedule();
            return Promise.resolve();
        }
        window.clearTimeout(syncTimer);
        syncTimer = 0;
        syncPromise = syncPromise
            .catch(() => undefined)
            .then(syncAllLocalProjects);
        return syncPromise;
    }

    async function prepareSignedInStorage() {
        const userId = session.user.id;
        const previousOwner = rawGet(CLOUD_OWNER_KEY);
        const isReturningOwner = previousOwner === userId;

        if (previousOwner && previousOwner !== userId) {
            await clearLocalProjectCache();
        }

        setCloudStatus("loading", "Loading your projects…");
        rawSet(CLOUD_OWNER_KEY, userId);

        const initialRows = await fetchCloudProjects();
        if (!initialRows) return;
        schemaReady = true;
        cloudRows = initialRows;

        if (isReturningOwner && rawGet(CLOUD_PENDING_KEY) === "true") {
            await syncAllLocalProjects();
            const refreshedRows = await fetchCloudProjects();
            if (refreshedRows) cloudRows = refreshedRows;
        } else {
            await migrateLocalProjects(cloudRows);
            const refreshedRows = await fetchCloudProjects();
            if (refreshedRows) cloudRows = refreshedRows;
        }

        await applyCloudProjects(cloudRows);
        rawSet(`${CLOUD_MIGRATED_PREFIX}${userId}`, "true");
        rawRemove(CLOUD_PENDING_KEY);
        setCloudStatus("saved", "Saved in your account");
    }

    async function fetchCloudProjects() {
        const { data, error } = await client
            .from("projects")
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .order("opened_at", { ascending: false });

        if (error) {
            console.warn("Unable to load Lockt cloud projects", error);
            const missingSchema =
                error.code === "42P01" ||
                /projects|schema cache|relation/i.test(error.message || "");
            setCloudStatus(
                "error",
                missingSchema
                    ? "Cloud database setup is required"
                    : "Cloud is unavailable; using this device"
            );
            return null;
        }
        return Array.isArray(data) ? data : [];
    }

    async function migrateLocalProjects(remoteRows) {
        const remoteNames = new Set(
            remoteRows.map((row) => normalizeName(row.name).toLocaleLowerCase())
        );
        const localNames = getLocalProjectNames();

        for (const name of localNames) {
            if (remoteNames.has(name.toLocaleLowerCase())) continue;
            try {
                const inserted = await insertCloudProjectFromLocal(name);
                if (inserted) {
                    remoteRows.push(inserted);
                    remoteNames.add(name.toLocaleLowerCase());
                }
            } catch (error) {
                console.warn(`Unable to migrate ${name} to the account`, error);
                setCloudStatus("error", `Could not migrate ${name}`);
            }
        }
    }

    async function insertCloudProjectFromLocal(name) {
        const metadata = readJson(METADATA_KEY, {})[name] || {};
        const board = readLocalBoard(name);
        const createdAt = normalizeDate(metadata.createdAt) || new Date().toISOString();
        const openedAt = normalizeDate(metadata.lastOpenedAt) || createdAt;
        const { data, error } = await client
            .from("projects")
            .insert({
                user_id: session.user.id,
                name,
                board,
                settings: {},
                created_at: createdAt,
                opened_at: openedAt
            })
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();

        if (error) throw error;

        const localSettings = readJson(SETTINGS_KEY, {})[name] || {};
        const localWhiteboard = await readLocalWhiteboard(name);
        const settings = await prepareSettingsForCloud(
            data.id,
            localSettings
        );
        const whiteboard = localWhiteboard
            ? await prepareWhiteboardForCloud(data.id, localWhiteboard)
            : null;
        const { data: completed, error: updateError } = await client
            .from("projects")
            .update({ settings, whiteboard })
            .eq("id", data.id)
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();
        if (updateError) throw updateError;
        return completed;
    }

    async function applyCloudProjects(rows) {
        applyingCloudState = true;
        try {
            const previousNames = getLocalProjectNames();
            const hydratedRows = await Promise.all(
                rows.map(async (row) => ({
                    ...row,
                    localSettings: await hydrateSettingsFromCloud(row.settings),
                    localWhiteboard: row.whiteboard
                        ? await hydrateWhiteboardFromCloud(row.whiteboard)
                        : null
                }))
            );
            const names = hydratedRows.map((row) => normalizeName(row.name))
                .filter(Boolean);
            const nameSet = new Set(names);
            const metadata = {};
            const settings = {};
            const idMap = {};

            for (const previousName of previousNames) {
                if (nameSet.has(previousName)) continue;
                rawRemove(previousName);
                rawRemove(`${WHITEBOARD_FALLBACK_PREFIX}${previousName}`);
                await deleteLocalWhiteboard(previousName);
            }

            for (const row of hydratedRows) {
                const name = normalizeName(row.name);
                if (!name) continue;
                rawSet(name, JSON.stringify(sanitizeBoard(row.board)));
                metadata[name] = {
                    createdAt: row.created_at,
                    lastOpenedAt: row.opened_at
                };
                settings[name] = row.localSettings || {};
                idMap[name] = row.id;
                if (row.localWhiteboard) {
                    await writeLocalWhiteboard(name, row.localWhiteboard);
                } else {
                    await deleteLocalWhiteboard(name);
                }
            }

            rawSet(PROJECTS_KEY, JSON.stringify(names));
            rawSet(METADATA_KEY, JSON.stringify(metadata));
            rawSet(SETTINGS_KEY, JSON.stringify(settings));
            rawSet(CLOUD_IDS_KEY, JSON.stringify(idMap));
            rawSet(HOME_INITIALIZED_KEY, "true");
            rawSet(CLOUD_OWNER_KEY, session.user.id);
            const activeName = normalizeName(rawGet(ACTIVE_PROJECT_KEY));
            if (activeName && !nameSet.has(activeName)) {
                rawRemove(ACTIVE_PROJECT_KEY);
            }
        } finally {
            applyingCloudState = false;
        }
    }

    async function syncAllLocalProjects() {
        if (!session?.user || !schemaReady || applyingCloudState) return;
        setCloudStatus("saving", "Saving to your account…");

        try {
            const localNames = getLocalProjectNames();
            const localNameSet = new Set(localNames);
            const idMap = readJson(CLOUD_IDS_KEY, {});
            const rowById = new Map(cloudRows.map((row) => [row.id, row]));
            const removedRows = cloudRows.filter(
                (row) => !localNameSet.has(row.name)
            );
            const newNames = localNames.filter((name) => !idMap[name]);

            if (removedRows.length === 1 && newNames.length === 1) {
                const renamedRow = removedRows[0];
                const nextName = newNames[0];
                const { error } = await client
                    .from("projects")
                    .update({ name: nextName })
                    .eq("id", renamedRow.id);
                if (error) throw error;
                delete idMap[renamedRow.name];
                idMap[nextName] = renamedRow.id;
                renamedRow.name = nextName;
            }

            for (const name of localNames) {
                let projectId = idMap[name];
                let row = projectId ? rowById.get(projectId) : null;
                if (!row) {
                    row = await insertCloudProjectFromLocal(name);
                    projectId = row.id;
                    idMap[name] = projectId;
                    cloudRows.push(row);
                    rowById.set(projectId, row);
                    continue;
                }
                await updateCloudProjectFromLocal(row, name);
            }

            const currentIds = new Set(Object.values(idMap));
            for (const row of [...cloudRows]) {
                if (localNameSet.has(row.name) || currentIds.has(row.id)) continue;
                await removeCloudProjectRow(row);
                cloudRows = cloudRows.filter((entry) => entry.id !== row.id);
                delete idMap[row.name];
            }

            applyingCloudState = true;
            rawSet(CLOUD_IDS_KEY, JSON.stringify(idMap));
            rawRemove(CLOUD_PENDING_KEY);
            applyingCloudState = false;
            setCloudStatus("saved", "Saved in your account");
        } catch (error) {
            applyingCloudState = false;
            rawSet(CLOUD_PENDING_KEY, "true");
            console.warn("Unable to sync Lockt projects", error);
            setCloudStatus("error", "Offline changes are waiting to sync");
            throw error;
        }
    }

    async function updateCloudProjectFromLocal(row, name) {
        const metadata = readJson(METADATA_KEY, {})[name] || {};
        const localSettings = readJson(SETTINGS_KEY, {})[name] || {};
        const settings = await prepareSettingsForCloud(row.id, localSettings);
        const payload = {
            name,
            board: readLocalBoard(name),
            settings,
            opened_at: normalizeDate(metadata.lastOpenedAt) || row.opened_at
        };
        const { data, error } = await client
            .from("projects")
            .update(payload)
            .eq("id", row.id)
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();
        if (error) throw error;
        Object.assign(row, data);
    }

