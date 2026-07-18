# Lockt cloud setup

The frontend is already configured for the Supabase project and GitHub Pages URL. The publishable key in `js/supabase-config.js` is intentionally safe to use in browser code; never add a Supabase `service_role` key to this repository.

## 1. Create the database and private image bucket

1. Open the [Supabase SQL editor](https://supabase.com/dashboard/project/sicgnsiaaqxhsenktwxz/sql/new).
2. Copy all of `supabase/migrations/20260718000000_account_storage.sql` into the editor.
3. Select **Run**.

The migration can be run again safely. It creates per-user projects, row-level security rules, private image storage, and the guarded account-deletion function.

## 2. Confirm the authentication URLs

In Supabase, open **Authentication → URL Configuration** and set:

- Site URL: `https://lfdba.github.io/Lockt/`
- Redirect URL: `https://lfdba.github.io/Lockt/index.html`

Keep email/password authentication enabled. With email confirmation enabled, new users receive a confirmation link before their first sign-in.

## 3. Publish and verify

After the current changes are committed and pushed to `main`, wait for GitHub Pages to deploy. Then:

1. Open [Lockt](https://lfdba.github.io/Lockt/).
2. Select **Sign in → Create account**.
3. Confirm the email if prompted and sign in.
4. Create or edit a project, select **Sync now**, then sign in on another browser or device.

Existing projects on the first device are migrated into the account the first time that account signs in. Signed-out use remains local to the device.

