(() => {
    "use strict";

    const cloud = window.LocktCloud;
    if (!cloud) return;

    const container = document.createElement("div");
    container.className = "lockt-account-control";
    container.innerHTML = `
        <button class="lockt-account-button" type="button" aria-haspopup="dialog">
            <span class="lockt-account-avatar" aria-hidden="true">♙</span>
            <span class="lockt-account-label">Account</span>
            <span class="lockt-cloud-dot" aria-hidden="true"></span>
        </button>
        <dialog class="lockt-account-dialog" aria-labelledby="lockt-account-title">
            <div class="lockt-account-dialog-header">
                <div>
                    <span class="lockt-account-kicker">Lockt cloud</span>
                    <h2 id="lockt-account-title">Your account</h2>
                </div>
                <button class="lockt-account-close" type="button" aria-label="Close">×</button>
            </div>

            <div class="lockt-auth-guest">
                <div class="lockt-auth-tabs" role="tablist" aria-label="Account action">
                    <button type="button" role="tab" data-auth-view="signin" aria-selected="true">Sign in</button>
                    <button type="button" role="tab" data-auth-view="signup" aria-selected="false">Create account</button>
                </div>

                <form class="lockt-auth-form" data-auth-form="signin">
                    <label>Email<input type="email" name="email" autocomplete="email" required></label>
                    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
                    <button class="lockt-auth-primary" type="submit">Sign in</button>
                    <button class="lockt-auth-link" type="button" data-auth-view="reset">Forgot password?</button>
                </form>

                <form class="lockt-auth-form" data-auth-form="signup" hidden>
                    <label>Email<input type="email" name="email" autocomplete="email" required></label>
                    <label>Password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
                    <label>Confirm password<input type="password" name="confirmation" autocomplete="new-password" minlength="8" required></label>
                    <button class="lockt-auth-primary" type="submit">Create account</button>
                </form>

                <form class="lockt-auth-form" data-auth-form="reset" hidden>
                    <p>Enter your email and we’ll send you a secure reset link.</p>
                    <label>Email<input type="email" name="email" autocomplete="email" required></label>
                    <button class="lockt-auth-primary" type="submit">Send reset link</button>
                    <button class="lockt-auth-link" type="button" data-auth-view="signin">Back to sign in</button>
                </form>
            </div>

            <div class="lockt-password-recovery" hidden>
                <p>Choose a new password for your Lockt account.</p>
                <form class="lockt-auth-form" data-auth-form="password">
                    <label>New password<input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
                    <label>Confirm password<input type="password" name="confirmation" autocomplete="new-password" minlength="8" required></label>
                    <button class="lockt-auth-primary" type="submit">Update password</button>
                </form>
            </div>

            <div class="lockt-auth-account" hidden>
                <div class="lockt-account-identity">
                    <span class="lockt-account-avatar large" aria-hidden="true">♙</span>
                    <div><span>Signed in as</span><strong class="lockt-account-email"></strong></div>
                </div>
                <div class="lockt-account-sync-row">
                    <span class="lockt-cloud-status">Checking cloud…</span>
                    <button class="lockt-sync-now" type="button">Sync now</button>
                </div>
                <button class="lockt-sign-out" type="button">Sign out</button>
                <details class="lockt-account-danger">
                    <summary>Delete account</summary>
                    <p>This permanently deletes every cloud project and uploaded image.</p>
                    <label>Type your email to confirm<input class="lockt-account-delete-confirmation" type="email" autocomplete="off"></label>
                    <button class="lockt-delete-account" type="button" disabled>Delete my account</button>
                </details>
            </div>

            <p class="lockt-auth-message" role="status" aria-live="polite"></p>
        </dialog>
    `;
    const dialog = container.querySelector(".lockt-account-dialog");
    const homeSlot = document.querySelector(".lockt-home-account-slot");
    const settingsSlot = document.querySelector(".lockt-account-settings-slot");
    if (settingsSlot) {
        container.classList.add("is-settings-entry");
        settingsSlot.append(container);
    } else if (homeSlot) {
        container.classList.add("is-home-entry");
        homeSlot.append(container);
    } else {
        document.body.append(container);
    }
    document.body.append(dialog);

    const accountButton = container.querySelector(".lockt-account-button");
    const accountLabel = container.querySelector(".lockt-account-label");
    const cloudDot = container.querySelector(".lockt-cloud-dot");
    const closeButton = dialog.querySelector(".lockt-account-close");
    const guestPanel = dialog.querySelector(".lockt-auth-guest");
    const accountPanel = dialog.querySelector(".lockt-auth-account");
    const recoveryPanel = dialog.querySelector(".lockt-password-recovery");
    const emailOutput = dialog.querySelector(".lockt-account-email");
    const statusOutput = dialog.querySelector(".lockt-cloud-status");
    const message = dialog.querySelector(".lockt-auth-message");
    const deleteConfirmation = dialog.querySelector(
        ".lockt-account-delete-confirmation"
    );
    const deleteButton = dialog.querySelector(".lockt-delete-account");

    accountButton.addEventListener("click", () => dialog.showModal());
    closeButton.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
        if (event.target === dialog) dialog.close();
    });

    dialog.querySelectorAll("[data-auth-view]").forEach((button) => {
        button.addEventListener("click", () => showAuthView(button.dataset.authView));
    });

    dialog.querySelector('[data-auth-form="signin"]')
        .addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await runAuthAction(
                event.currentTarget,
                () => cloud.signIn(data.get("email"), data.get("password")),
                "Signing in…"
            );
        });

    dialog.querySelector('[data-auth-form="signup"]')
        .addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (data.get("password") !== data.get("confirmation")) {
                setMessage("Those passwords do not match.", true);
                return;
            }
            await runAuthAction(
                event.currentTarget,
                async () => {
                    const result = await cloud.signUp(
                        data.get("email"),
                        data.get("password")
                    );
                    if (!result.session) {
                        setMessage("Check your email to confirm your account.");
                    }
                },
                "Creating your account…"
            );
        });

    dialog.querySelector('[data-auth-form="reset"]')
        .addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            await runAuthAction(
                event.currentTarget,
                async () => {
                    await cloud.sendPasswordReset(data.get("email"));
                    setMessage("Reset link sent. Check your email.");
                },
                "Sending reset link…"
            );
        });

    dialog.querySelector('[data-auth-form="password"]')
        .addEventListener("submit", async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            if (data.get("password") !== data.get("confirmation")) {
                setMessage("Those passwords do not match.", true);
                return;
            }
            await runAuthAction(
                event.currentTarget,
                async () => {
                    await cloud.updatePassword(data.get("password"));
                    recoveryPanel.hidden = true;
                    accountPanel.hidden = false;
                    setMessage("Password updated.");
                },
                "Updating password…"
            );
        });

    dialog.querySelector(".lockt-sync-now").addEventListener("click", async () => {
        setMessage("Syncing…");
        try {
            await cloud.flush();
            setMessage("Everything is synced.");
        } catch (error) {
            setMessage(readableError(error), true);
        }
    });

    dialog.querySelector(".lockt-sign-out").addEventListener("click", async () => {
        setMessage("Signing out…");
        try {
            await cloud.signOut();
        } catch (error) {
            setMessage(readableError(error), true);
        }
    });

    deleteConfirmation.addEventListener("input", () => {
        const email = cloud.getSession()?.user?.email || "";
        deleteButton.disabled = deleteConfirmation.value.trim() !== email;
    });
    deleteButton.addEventListener("click", async () => {
        const email = cloud.getSession()?.user?.email || "";
        if (deleteConfirmation.value.trim() !== email) return;
        deleteButton.disabled = true;
        setMessage("Deleting your account…");
        try {
            await cloud.deleteAccount();
        } catch (error) {
            deleteButton.disabled = false;
            setMessage(readableError(error), true);
        }
    });

    cloud.events.addEventListener("authchange", syncAccountUi);
    cloud.events.addEventListener("statuschange", (event) => {
        syncCloudStatus(event.detail);
    });

    void cloud.ready.then(() => {
        syncAccountUi();
        syncCloudStatus(cloud.getStatus());
        const query = new URLSearchParams(window.location.search);
        if (query.get("reset-password") === "1") {
            showRecoveryView();
            dialog.showModal();
        } else if (query.get("account") === "signin") {
            showAuthView("signin");
            dialog.showModal();
        }
    });

    function syncAccountUi() {
        const currentSession = cloud.getSession();
        const signedIn = Boolean(currentSession?.user);
        guestPanel.hidden = signedIn;
        accountPanel.hidden = !signedIn;
        if (!signedIn) {
            recoveryPanel.hidden = true;
            accountLabel.textContent = "Sign in";
            accountButton.setAttribute("aria-label", "Sign in to Lockt");
            return;
        }
        const email = currentSession.user.email || "Account";
        emailOutput.textContent = email;
        accountLabel.textContent = email.split("@")[0] || "Account";
        accountButton.setAttribute("aria-label", `Lockt account: ${email}`);
    }

    function syncCloudStatus(status) {
        cloudDot.dataset.state = status.state;
        statusOutput.textContent = status.message;
        accountButton.title = status.message;
    }

    function showAuthView(view) {
        recoveryPanel.hidden = true;
        guestPanel.hidden = false;
        accountPanel.hidden = true;
        dialog.querySelectorAll("[data-auth-form]").forEach((form) => {
            form.hidden = form.dataset.authForm !== view;
        });
        dialog.querySelectorAll('[role="tab"]').forEach((tab) => {
            tab.setAttribute("aria-selected", String(tab.dataset.authView === view));
        });
        setMessage("");
    }

    function showRecoveryView() {
        guestPanel.hidden = true;
        accountPanel.hidden = true;
        recoveryPanel.hidden = false;
        setMessage("");
    }

    async function runAuthAction(form, action, progressMessage) {
        const controls = [...form.querySelectorAll("input, button")];
        controls.forEach((control) => { control.disabled = true; });
        setMessage(progressMessage);
        try {
            await action();
        } catch (error) {
            setMessage(readableError(error), true);
        } finally {
            controls.forEach((control) => { control.disabled = false; });
        }
    }

    function setMessage(text, isError = false) {
        message.textContent = text;
        message.classList.toggle("is-error", isError);
    }

    function readableError(error) {
        const value = error instanceof Error
            ? error.message
            : String(error?.message || error || "Something went wrong.");
        if (/invalid login credentials/i.test(value)) {
            return "That email or password is incorrect.";
        }
        if (/user already registered/i.test(value)) {
            return "An account already exists for that email.";
        }
        return value;
    }
})();
