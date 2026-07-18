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
    const CLOUD_VERSIONS_KEY = "lockt:cloud-project-versions";
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
    let startupSyncPromise = Promise.resolve();
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
            if (rawGet(CLOUD_OWNER_KEY)) {
                await clearLocalProjectCache();
                rawRemove(CLOUD_OWNER_KEY);
                rawRemove(CLOUD_PENDING_KEY);
            }
            setCloudStatus("local", "Saved on this device");
            dispatchAuthChange("INITIAL_SESSION");
            return;
        }

        const isWarmStart =
            rawGet(CLOUD_OWNER_KEY) === session.user.id &&
            rawGet(PROJECTS_KEY) !== null;

        if (isWarmStart) {
            setCloudStatus("saved", "Saved in your account");
            startupSyncPromise = prepareSignedInStorage({ warmStart: true })
                .catch((startupError) => {
                    console.warn("Unable to refresh Lockt in the background", startupError);
                });
        } else {
            startupSyncPromise = prepareSignedInStorage();
            await startupSyncPromise;
        }
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
            const previousValue = this.getItem(key);
            originalSetItem.call(this, key, value);
            if (
                this === window.localStorage &&
                !applyingCloudState &&
                previousValue !== String(value) &&
                shouldSyncStorageMutation(key, value, false)
            ) {
                markPendingAndSchedule();
            }
        };

        Storage.prototype.removeItem = function removeItem(key) {
            const hadValue = this.getItem(key) !== null;
            const shouldSync =
                this === window.localStorage &&
                !applyingCloudState &&
                hadValue &&
                shouldSyncStorageMutation(key, null, true);
            originalRemoveItem.call(this, key);
            if (shouldSync) markPendingAndSchedule();
        };

        Storage.prototype.clear = function clear() {
            const isLocalStorage =
                this === window.localStorage && this.length > 0;
            originalClear.call(this);
            if (isLocalStorage && !applyingCloudState) {
                markPendingAndSchedule();
            }
        };
    }

    function shouldSyncStorageMutation(key, value, removing) {
        if (!session?.user) return false;
        if (
            key === CLOUD_OWNER_KEY ||
            key === CLOUD_IDS_KEY ||
            key === CLOUD_VERSIONS_KEY ||
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
            if (!schemaReady) {
                rawSet(CLOUD_PENDING_KEY, "true");
                return false;
            }
            return true;
        }
        const idMap = readJson(CLOUD_IDS_KEY, {});
        const isProjectMutation =
            Boolean(idMap[key]) ||
            (removing && getLocalProjectNames().includes(key)) ||
            looksLikeBoard(value);
        if (isProjectMutation && !schemaReady) {
            rawSet(CLOUD_PENDING_KEY, "true");
            return false;
        }
        return isProjectMutation;
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
        if (!session?.user || applyingCloudState) {
            return Promise.resolve();
        }
        if (!schemaReady) {
            if (!immediate) {
                rawSet(CLOUD_PENDING_KEY, "true");
                return Promise.resolve();
            }
            return startupSyncPromise.then(() => (
                schemaReady && rawGet(CLOUD_PENDING_KEY) === "true"
                    ? queueSync({ immediate: true })
                    : undefined
            ));
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

    async function prepareSignedInStorage({ warmStart = false } = {}) {
        const userId = session.user.id;
        const previousOwner = rawGet(CLOUD_OWNER_KEY);
        const isReturningOwner = previousOwner === userId;
        const migrationKey = `${CLOUD_MIGRATED_PREFIX}${userId}`;
        const shouldMigrate =
            !isReturningOwner || rawGet(migrationKey) !== "true";

        if (previousOwner && previousOwner !== userId) {
            await clearLocalProjectCache();
        }

        if (!warmStart) {
            setCloudStatus("loading", "Loading your projects…");
        }
        rawSet(CLOUD_OWNER_KEY, userId);

        const initialRows = await fetchCloudProjects();
        if (!initialRows) return;
        schemaReady = true;
        cloudRows = initialRows;

        if (warmStart) {
            if (rawGet(CLOUD_PENDING_KEY) === "true") {
                await syncAllLocalProjects({ quiet: true });
                persistCloudVersions(cloudRows);
                return;
            }
            if (cloudRowsMatchLocalVersions(cloudRows)) {
                setCloudStatus("saved", "Saved in your account");
                return;
            }
            await applyCloudProjects(cloudRows);
            rawRemove(CLOUD_PENDING_KEY);
            setCloudStatus("saved", "Updated from your account");
            window.setTimeout(() => {
                if (
                    session?.user?.id === userId &&
                    document.visibilityState === "visible" &&
                    rawGet(CLOUD_PENDING_KEY) !== "true"
                ) {
                    window.location.reload();
                }
            }, 0);
            return;
        }

        if (isReturningOwner && rawGet(CLOUD_PENDING_KEY) === "true") {
            await syncAllLocalProjects();
            const refreshedRows = await fetchCloudProjects();
            if (refreshedRows) cloudRows = refreshedRows;
        } else if (shouldMigrate) {
            await migrateLocalProjects(cloudRows);
            const refreshedRows = await fetchCloudProjects();
            if (refreshedRows) cloudRows = refreshedRows;
        }

        await applyCloudProjects(cloudRows);
        rawSet(migrationKey, "true");
        rawRemove(CLOUD_PENDING_KEY);
        setCloudStatus("saved", "Saved in your account");
    }

    function cloudRowsMatchLocalVersions(rows) {
        const versions = readJson(CLOUD_VERSIONS_KEY, {});
        const idMap = readJson(CLOUD_IDS_KEY, {});
        const localNames = getLocalProjectNames();
        if (rows.length !== localNames.length) return false;
        return rows.every((row) => (
            idMap[row.name] === row.id &&
            Number(versions[row.id]) === Number(row.version)
        ));
    }

    function persistCloudVersions(rows) {
        const versions = {};
        rows.forEach((row) => {
            versions[row.id] = Number(row.version) || 1;
        });
        applyingCloudState = true;
        rawSet(CLOUD_VERSIONS_KEY, JSON.stringify(versions));
        applyingCloudState = false;
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
        const projectId = createUuid();
        const localSettings = readJson(SETTINGS_KEY, {})[name] || {};
        const localWhiteboard = await readLocalWhiteboard(name);
        const settings = await prepareSettingsForCloud(
            projectId,
            localSettings
        );
        const whiteboard = localWhiteboard
            ? await prepareWhiteboardForCloud(projectId, localWhiteboard)
            : null;
        const { data, error } = await client
            .from("projects")
            .insert({
                id: projectId,
                user_id: session.user.id,
                name,
                board,
                whiteboard,
                settings,
                created_at: createdAt,
                opened_at: openedAt
            })
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();

        if (error) {
            try {
                await removeProjectAssets(projectId);
            } catch (cleanupError) {
                console.warn("Unable to clean up an incomplete project upload", cleanupError);
            }
            throw error;
        }
        return data;
    }

    async function applyCloudProjects(rows) {
        applyingCloudState = true;
        try {
            const previousNames = getLocalProjectNames();
            const cachedSettings = readJson(SETTINGS_KEY, {});
            const currentProjectName = normalizeName(
                new URLSearchParams(window.location.search).get("project") ||
                rawGet(ACTIVE_PROJECT_KEY)
            );
            const isHomePage = document.body.classList.contains("home-body");
            const isWhiteboardPage = document.body.classList.contains(
                "whiteboard-body"
            );
            const hydratedRows = await Promise.all(
                rows.map(async (row) => {
                    const name = normalizeName(row.name);
                    const cachedWhiteboard = row.whiteboard
                        ? await readLocalWhiteboard(name)
                        : null;
                    return {
                        ...row,
                        localSettings: await hydrateSettingsFromCloud(
                            row.settings,
                            cachedSettings[name],
                            isHomePage || name === currentProjectName
                        ),
                        localWhiteboard: row.whiteboard
                            ? await hydrateWhiteboardFromCloud(
                                row.whiteboard,
                                cachedWhiteboard,
                                isWhiteboardPage && name === currentProjectName
                            )
                            : null
                    };
                })
            );
            const names = hydratedRows.map((row) => normalizeName(row.name))
                .filter(Boolean);
            const nameSet = new Set(names);
            const metadata = {};
            const settings = {};
            const idMap = {};
            const versions = {};

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
                versions[row.id] = Number(row.version) || 1;
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
            rawSet(CLOUD_VERSIONS_KEY, JSON.stringify(versions));
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

    async function syncAllLocalProjects({ quiet = false } = {}) {
        if (!session?.user || !schemaReady || applyingCloudState) return;
        if (!quiet) {
            setCloudStatus("saving", "Saving to your account…");
        }

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

            for (const row of [...cloudRows]) {
                if (localNameSet.has(row.name)) continue;
                await removeCloudProjectRow(row);
                cloudRows = cloudRows.filter((entry) => entry.id !== row.id);
                delete idMap[row.name];
            }

            applyingCloudState = true;
            rawSet(CLOUD_IDS_KEY, JSON.stringify(idMap));
            const versions = {};
            cloudRows.forEach((row) => {
                versions[row.id] = Number(row.version) || 1;
            });
            rawSet(CLOUD_VERSIONS_KEY, JSON.stringify(versions));
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
        const previousAssetPaths = projectAssetPaths(
            row.settings,
            row.whiteboard
        );
        const metadata = readJson(METADATA_KEY, {})[name] || {};
        const localSettings = readJson(SETTINGS_KEY, {})[name] || {};
        const settings = await prepareSettingsForCloud(
            row.id,
            localSettings,
            row.settings
        );
        const localWhiteboard = await readLocalWhiteboard(name);
        const whiteboard = localWhiteboard
            ? await prepareWhiteboardForCloud(
                row.id,
                localWhiteboard,
                row.whiteboard
            )
            : null;
        const payload = {
            name,
            board: readLocalBoard(name),
            settings,
            whiteboard,
            opened_at: normalizeDate(metadata.lastOpenedAt) || row.opened_at
        };
        const { data, error } = await client
            .from("projects")
            .update(payload)
            .eq("id", row.id)
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();
        if (error) throw error;
        await removeStaleAssets(
            previousAssetPaths,
            projectAssetPaths(data.settings, data.whiteboard)
        );
        Object.assign(row, data);
    }

    async function prepareSettingsForCloud(
        projectId,
        localSettings,
        previousSettings = null
    ) {
        const settings = { ...(localSettings || {}) };
        await prepareSettingImage(
            settings,
            projectId,
            "backgroundImage",
            "backgroundAssetPath",
            "backgroundAssetFingerprint",
            previousSettings
        );
        await prepareSettingImage(
            settings,
            projectId,
            "coverImage",
            "coverAssetPath",
            "coverAssetFingerprint",
            previousSettings
        );
        return settings;
    }

    async function prepareSettingImage(
        settings,
        projectId,
        dataKey,
        pathKey,
        fingerprintKey,
        previousSettings
    ) {
        const dataUrl = settings[dataKey];

        if (!isImageDataUrl(dataUrl)) {
            delete settings[dataKey];
            delete settings[pathKey];
            delete settings[fingerprintKey];
            return;
        }

        const fingerprint = fingerprintDataUrl(dataUrl);
        if (
            !settings[pathKey] &&
            previousSettings?.[fingerprintKey] === fingerprint &&
            previousSettings?.[pathKey]
        ) {
            settings[pathKey] = previousSettings[pathKey];
            settings[fingerprintKey] = fingerprint;
        }
        if (
            settings[fingerprintKey] !== fingerprint ||
            !settings[pathKey]
        ) {
            const path = await uploadDataUrlAsset(
                projectId,
                dataKey === "coverImage" ? "cover" : "background",
                dataUrl,
                fingerprint
            );
            settings[pathKey] = path;
            settings[fingerprintKey] = fingerprint;
        }
        delete settings[dataKey];
    }

    async function hydrateSettingsFromCloud(
        cloudSettings,
        cachedSettings = null,
        downloadMissing = true
    ) {
        const settings = { ...(cloudSettings || {}) };
        await hydrateSettingImage(
            settings,
            "backgroundImage",
            "backgroundAssetPath",
            "backgroundAssetFingerprint",
            cachedSettings,
            downloadMissing
        );
        await hydrateSettingImage(
            settings,
            "coverImage",
            "coverAssetPath",
            "coverAssetFingerprint",
            cachedSettings,
            downloadMissing
        );
        return settings;
    }

    async function hydrateSettingImage(
        settings,
        dataKey,
        pathKey,
        fingerprintKey,
        cachedSettings,
        downloadMissing
    ) {
        if (!settings[pathKey]) return;
        const cachedDataUrl = cachedSettings?.[dataKey];
        const cacheMatches = isImageDataUrl(cachedDataUrl) && (
            cachedSettings?.[pathKey] === settings[pathKey] ||
            (
                settings[fingerprintKey] &&
                fingerprintDataUrl(cachedDataUrl) === settings[fingerprintKey]
            )
        );
        if (cacheMatches) {
            settings[dataKey] = cachedDataUrl;
            return;
        }
        if (!downloadMissing) return;
        try {
            settings[dataKey] = await downloadAssetAsDataUrl(settings[pathKey]);
        } catch (error) {
            console.warn(`Unable to download ${dataKey}`, error);
        }
    }

    async function prepareWhiteboardForCloud(
        projectId,
        snapshot,
        previousSnapshot = null
    ) {
        const cloudSnapshot = cloneValue(snapshot);
        if (!Array.isArray(cloudSnapshot?.items)) return cloudSnapshot;
        const previousItems = new Map(
            Array.isArray(previousSnapshot?.items)
                ? previousSnapshot.items.map((item) => [item?.id, item])
                : []
        );

        for (const item of cloudSnapshot.items) {
            if (item?.type !== "image") continue;
            if (isImageDataUrl(item.src)) {
                const fingerprint = fingerprintDataUrl(item.src);
                const previousItem = previousItems.get(item.id);
                if (
                    !item.assetPath &&
                    previousItem?.assetFingerprint === fingerprint &&
                    previousItem?.assetPath
                ) {
                    item.assetPath = previousItem.assetPath;
                    item.assetFingerprint = fingerprint;
                }
                if (
                    item.assetFingerprint !== fingerprint ||
                    !item.assetPath
                ) {
                    item.assetPath = await uploadDataUrlAsset(
                        projectId,
                        `whiteboard-${item.id || "image"}`,
                        item.src,
                        fingerprint
                    );
                    item.assetFingerprint = fingerprint;
                }
                delete item.src;
            }
        }
        return cloudSnapshot;
    }

    function whiteboardAssetPaths(snapshot) {
        if (!Array.isArray(snapshot?.items)) return [];
        return snapshot.items
            .filter((item) => item?.type === "image" && item.assetPath)
            .map((item) => item.assetPath);
    }

    function projectAssetPaths(settings, whiteboard) {
        return [
            settings?.backgroundAssetPath,
            settings?.coverAssetPath,
            ...whiteboardAssetPaths(whiteboard)
        ].filter(Boolean);
    }

    async function removeStaleAssets(previousPaths, currentPaths) {
        const activePaths = new Set(currentPaths);
        await removeAssets(
            previousPaths.filter((path) => !activePaths.has(path))
        );
    }

    async function hydrateWhiteboardFromCloud(
        snapshot,
        cachedSnapshot = null,
        downloadMissing = true
    ) {
        const localSnapshot = cloneValue(snapshot);
        if (!Array.isArray(localSnapshot?.items)) return localSnapshot;
        const cachedItems = new Map(
            Array.isArray(cachedSnapshot?.items)
                ? cachedSnapshot.items.map((item) => [item?.id, item])
                : []
        );

        await Promise.all(localSnapshot.items.map(async (item) => {
            if (item?.type !== "image" || !item.assetPath) return;
            const cachedItem = cachedItems.get(item.id);
            const cachedSource = cachedItem?.src;
            const cacheMatches = isImageDataUrl(cachedSource) && (
                cachedItem.assetPath === item.assetPath ||
                (
                    item.assetFingerprint &&
                    fingerprintDataUrl(cachedSource) === item.assetFingerprint
                )
            );
            if (cacheMatches) {
                item.src = cachedSource;
                return;
            }
            if (!downloadMissing) return;
            try {
                item.src = await downloadAssetAsDataUrl(item.assetPath);
            } catch (error) {
                console.warn("Unable to restore a Whiteboard image", error);
            }
        }));
        return localSnapshot;
    }

    async function uploadDataUrlAsset(projectId, kind, dataUrl, fingerprint) {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const extension = mimeExtension(blob.type);
        const safeKind = String(kind).replace(/[^a-z0-9_-]/gi, "-");
        const path = `${session.user.id}/${projectId}/${safeKind}-${fingerprint}.${extension}`;
        const { error } = await client.storage
            .from(ASSET_BUCKET)
            .upload(path, blob, {
                upsert: true,
                contentType: blob.type || "image/webp",
                cacheControl: "3600"
            });
        if (error) throw error;
        return path;
    }

    async function downloadAssetAsDataUrl(path) {
        const { data, error } = await client.storage
            .from(ASSET_BUCKET)
            .download(path);
        if (error) throw error;
        return blobToDataUrl(data);
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(
                reader.error || new Error("Unable to read downloaded image")
            );
            reader.readAsDataURL(blob);
        });
    }

    async function removeAssets(paths, { strict = false } = {}) {
        const uniquePaths = [...new Set(paths.filter(Boolean))];
        if (!uniquePaths.length) return;
        for (let index = 0; index < uniquePaths.length; index += 100) {
            const { error } = await client.storage
                .from(ASSET_BUCKET)
                .remove(uniquePaths.slice(index, index + 100));
            if (!error) continue;
            if (strict) throw error;
            console.warn("Unable to remove superseded assets", error);
        }
    }

    async function removeCloudProjectRow(row) {
        await removeProjectAssets(row.id);
        const { error } = await client.from("projects").delete().eq("id", row.id);
        if (error) throw error;
    }

    async function removeProjectAssets(projectId) {
        const folder = `${session.user.id}/${projectId}`;
        const paths = [];
        let offset = 0;
        while (true) {
            const { data, error } = await client.storage
                .from(ASSET_BUCKET)
                .list(folder, { limit: 1000, offset });
            if (error) throw error;
            const entries = data || [];
            paths.push(...entries.map((entry) => `${folder}/${entry.name}`));
            if (entries.length < 1000) break;
            offset += entries.length;
        }
        await removeAssets(paths, { strict: true });
    }

    function isImageDataUrl(value) {
        return typeof value === "string" && /^data:image\//i.test(value);
    }

    function fingerprintDataUrl(value) {
        let hash = 2166136261;
        const stride = Math.max(1, Math.floor(value.length / 8192));
        for (let index = 0; index < value.length; index += stride) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${(hash >>> 0).toString(16)}-${value.length}`;
    }

    function mimeExtension(type) {
        if (type === "image/png") return "png";
        if (type === "image/jpeg") return "jpg";
        if (type === "image/gif") return "gif";
        return "webp";
    }

    function cloneValue(value) {
        if (typeof structuredClone === "function") {
            return structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value));
    }

    function createUuid() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => (
            Number(char) ^ window.crypto.getRandomValues(new Uint8Array(1))[0]
            & 15 >> Number(char) / 4
        ).toString(16));
    }

    function normalizeName(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    function normalizeDate(value) {
        if (typeof value !== "string" || !value) return "";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    }

    function sanitizeBoard(value) {
        return value && typeof value === "object" && Array.isArray(value.lists)
            ? value
            : { lists: [] };
    }

    function readLocalBoard(name) {
        try {
            const rawValue =
                rawGet(name) ||
                (name === DEFAULT_PROJECT_NAME ? rawGet(LEGACY_BOARD_KEY) : null);
            return sanitizeBoard(rawValue ? JSON.parse(rawValue) : null);
        } catch (error) {
            return { lists: [] };
        }
    }

    function getLocalProjectNames() {
        const names = new Set();
        const savedNames = readJson(PROJECTS_KEY, []);
        if (Array.isArray(savedNames)) {
            savedNames.map(normalizeName).filter(Boolean).forEach((name) => {
                names.add(name);
            });
        }
        for (let index = 0; index < window.localStorage.length; index += 1) {
            const key = window.localStorage.key(index);
            if (!key || isReservedStorageKey(key)) continue;
            if (looksLikeBoard(rawGet(key))) names.add(key);
        }
        return [...names];
    }

    function isReservedStorageKey(key) {
        return (
            key.startsWith("lockt:") ||
            key.startsWith("sb-") ||
            key === LEGACY_BOARD_KEY
        );
    }

    async function clearLocalProjectCache() {
        applyingCloudState = true;
        try {
            getLocalProjectNames().forEach((name) => {
                rawRemove(name);
                rawRemove(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
            });
            [
                PROJECTS_KEY,
                METADATA_KEY,
                SETTINGS_KEY,
                ACTIVE_PROJECT_KEY,
                LEGACY_BOARD_KEY,
                HOME_INITIALIZED_KEY,
                CLOUD_IDS_KEY,
                CLOUD_VERSIONS_KEY,
                CLOUD_PENDING_KEY
            ].forEach(rawRemove);
            await clearLocalWhiteboards();
        } finally {
            applyingCloudState = false;
        }
    }

    function openWhiteboardDatabase() {
        return new Promise((resolve, reject) => {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is unavailable"));
                return;
            }
            const request = window.indexedDB.open(WHITEBOARD_DATABASE, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(WHITEBOARD_STORE)) {
                    request.result.createObjectStore(WHITEBOARD_STORE, {
                        keyPath: "projectName"
                    });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function whiteboardRequest(mode, operation) {
        const database = await openWhiteboardDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(WHITEBOARD_STORE, mode);
            const request = operation(transaction.objectStore(WHITEBOARD_STORE));
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || transaction.error);
            transaction.oncomplete = () => database.close();
            transaction.onabort = () => {
                database.close();
                reject(transaction.error);
            };
        });
    }

    async function readLocalWhiteboard(name) {
        try {
            const record = await whiteboardRequest(
                "readonly",
                (store) => store.get(name)
            );
            if (record?.snapshot) return record.snapshot;
        } catch (error) {
            console.warn("Unable to read local Whiteboard during sync", error);
        }
        try {
            const fallback = rawGet(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
            return fallback ? JSON.parse(fallback) : null;
        } catch (error) {
            return null;
        }
    }

    async function writeLocalWhiteboard(name, snapshot) {
        try {
            await whiteboardRequest("readwrite", (store) => store.put({
                projectName: name,
                updatedAt: snapshot.updatedAt || new Date().toISOString(),
                snapshot
            }));
            rawRemove(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
        } catch (error) {
            rawSet(
                `${WHITEBOARD_FALLBACK_PREFIX}${name}`,
                JSON.stringify(snapshot)
            );
        }
    }

    async function deleteLocalWhiteboard(name) {
        try {
            await whiteboardRequest("readwrite", (store) => store.delete(name));
        } catch (error) {
            // The fallback is still removed below.
        }
        rawRemove(`${WHITEBOARD_FALLBACK_PREFIX}${name}`);
    }

    async function clearLocalWhiteboards() {
        try {
            await whiteboardRequest("readwrite", (store) => store.clear());
        } catch (error) {
            console.warn("Unable to clear the local Whiteboard cache", error);
        }
    }

    async function saveWhiteboard(name, snapshot) {
        await ready;
        if (session?.user && !schemaReady) {
            rawSet(CLOUD_PENDING_KEY, "true");
            await startupSyncPromise;
        }
        if (!session?.user || !schemaReady || !name || !snapshot) return;
        await queueSync({ immediate: true });
        const idMap = readJson(CLOUD_IDS_KEY, {});
        const projectId = idMap[name];
        if (!projectId) return;

        setCloudStatus("saving", "Saving Whiteboard to your account…");
        try {
            const row = cloudRows.find((entry) => entry.id === projectId);
            const previousAssetPaths = whiteboardAssetPaths(row?.whiteboard);
            const whiteboard = await prepareWhiteboardForCloud(
                projectId,
                snapshot,
                row?.whiteboard
            );
            const { data, error } = await client
                .from("projects")
                .update({ whiteboard })
                .eq("id", projectId)
                .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
                .single();
            if (error) throw error;
            await removeStaleAssets(
                previousAssetPaths,
                whiteboardAssetPaths(data.whiteboard)
            );
            if (row) Object.assign(row, data);
            persistCloudVersions(cloudRows);
            setCloudStatus("saved", "Saved in your account");
        } catch (error) {
            console.warn("Unable to sync the Whiteboard", error);
            rawSet(CLOUD_PENDING_KEY, "true");
            setCloudStatus("error", "Whiteboard changes are waiting to sync");
        }
    }

    async function renameProject(previousName, nextName) {
        await ready;
        if (session?.user && !schemaReady) await startupSyncPromise;
        if (!session?.user || !schemaReady) return;
        const idMap = readJson(CLOUD_IDS_KEY, {});
        const projectId = idMap[previousName];
        if (!projectId) {
            await queueSync({ immediate: true });
            return;
        }
        const { data, error } = await client
            .from("projects")
            .update({ name: nextName })
            .eq("id", projectId)
            .select("id,user_id,name,board,whiteboard,settings,created_at,opened_at,updated_at,version")
            .single();
        if (error) {
            console.warn("Unable to rename the cloud project", error);
            rawSet(CLOUD_PENDING_KEY, "true");
            return;
        }
        applyingCloudState = true;
        delete idMap[previousName];
        idMap[nextName] = projectId;
        rawSet(CLOUD_IDS_KEY, JSON.stringify(idMap));
        applyingCloudState = false;
        const row = cloudRows.find((entry) => entry.id === projectId);
        if (row) Object.assign(row, data);
        persistCloudVersions(cloudRows);
    }

    async function deleteProject(name) {
        await ready;
        if (session?.user && !schemaReady) await startupSyncPromise;
        if (!session?.user || !schemaReady) return;
        const idMap = readJson(CLOUD_IDS_KEY, {});
        const projectId = idMap[name];
        if (!projectId) return;
        const row = cloudRows.find((entry) => entry.id === projectId) || {
            id: projectId,
            name
        };
        try {
            await removeCloudProjectRow(row);
            cloudRows = cloudRows.filter((entry) => entry.id !== projectId);
            applyingCloudState = true;
            delete idMap[name];
            rawSet(CLOUD_IDS_KEY, JSON.stringify(idMap));
            applyingCloudState = false;
            persistCloudVersions(cloudRows);
            setCloudStatus("saved", "Project deleted from your account");
        } catch (error) {
            console.warn("Unable to delete cloud project", error);
            rawSet(CLOUD_PENDING_KEY, "true");
            setCloudStatus("error", "Project deletion is waiting to sync");
        }
    }

    function configuredAuthRedirectUrl(parameters = "") {
        const base = config.siteUrl || new URL("index.html", window.location.href).href;
        const url = new URL("index.html", base);
        if (parameters) url.search = parameters.replace(/^\?/, "");
        return url.href;
    }

    function localHomeUrl(parameters = "") {
        const url = new URL("index.html", window.location.href);
        if (parameters) url.search = parameters.replace(/^\?/, "");
        else url.search = "";
        url.hash = "";
        return url.href;
    }

    async function signIn(email, password) {
        await ready;
        const { data, error } = await client.auth.signInWithPassword({
            email: String(email || "").trim(),
            password: String(password || "")
        });
        if (error) throw error;
        session = data.session;
        window.location.href = localHomeUrl();
    }

    async function signUp(email, password) {
        await ready;
        const { data, error } = await client.auth.signUp({
            email: String(email || "").trim(),
            password: String(password || ""),
            options: { emailRedirectTo: configuredAuthRedirectUrl() }
        });
        if (error) throw error;
        if (data.session) {
            session = data.session;
            window.location.href = localHomeUrl();
        }
        return data;
    }

    async function sendPasswordReset(email) {
        await ready;
        const { error } = await client.auth.resetPasswordForEmail(
            String(email || "").trim(),
            { redirectTo: configuredAuthRedirectUrl("reset-password=1") }
        );
        if (error) throw error;
    }

    async function updatePassword(password) {
        await ready;
        const { error } = await client.auth.updateUser({
            password: String(password || "")
        });
        if (error) throw error;
        window.history.replaceState({}, "", localHomeUrl());
    }

    async function signOut() {
        await ready;
        try {
            await queueSync({ immediate: true });
        } catch (error) {
            // The local cache will still be cleared for account privacy.
        }
        const { error } = await client.auth.signOut();
        if (error) throw error;
        session = null;
        await clearLocalProjectCache();
        rawRemove(CLOUD_OWNER_KEY);
        window.location.href = localHomeUrl();
    }

    async function deleteAccount() {
        await ready;
        if (!session?.user) return;
        for (const row of cloudRows) {
            await removeProjectAssets(row.id);
        }
        const { error } = await client.rpc("delete_current_user");
        if (error) throw error;
        session = null;
        await clearLocalProjectCache();
        rawRemove(CLOUD_OWNER_KEY);
        await client.auth.signOut({ scope: "local" });
        window.location.href = localHomeUrl();
    }
})();
