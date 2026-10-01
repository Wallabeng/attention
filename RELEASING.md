# Releasing & updates (macOS)

Releases are built by `.github/workflows/release.yml` when a GitHub Release is created (the workflow attaches the build artifacts to that release). The app
checks `releases/latest/download/latest.json` on startup (and via tray → *Check for Updates…*),
verifies the update signature, installs it and restarts.

## One-time setup

1. Generate the updater signing key (keep the private key safe — losing it means existing
   installs can never auto-update again):
   ```
   npx tauri signer generate -w ~/.tauri/attention.key
   ```
2. Put the **public** key (`~/.tauri/attention.key.pub` contents) into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` (replace `REPLACE_WITH_PUBLIC_KEY`).
3. In GitHub → Settings → Secrets and variables → Actions, add:
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose
4. The repository must be public (the updater downloads release assets anonymously).

## Cutting a release

1. Bump `version` in `src-tauri/Cargo.toml` (single source of truth; also bump `package.json` for tidiness).
2. Commit and push to `main`.
3. On GitHub, create a new Release with tag `v0.2.0` (matching `Cargo.toml`), targeting `main`.
   Publish it directly — draft releases don't trigger the workflow, and pre-releases are not
   served as "latest" to the updater.
4. The workflow attaches `.dmg` installers (Apple Silicon + Intel), the update bundles and
   `latest.json` to that release.

Local `tauri build` now needs `TAURI_SIGNING_PRIVATE_KEY` set (updater artifacts are signed).

## First install for colleagues

The app is only ad-hoc signed (no Apple Developer account), so Gatekeeper blocks the first launch:

1. Download the `.dmg` matching the Mac (`aarch64` = Apple Silicon, `x64` = Intel), drag *Attention* to Applications.
2. Run once: `xattr -dr com.apple.quarantine /Applications/Attention.app`
   (or right-click → Open, then *System Settings → Privacy & Security → Open Anyway*).

Later updates install in-app and don't need this step. Keep `identifier` (`com.ring-dev.attention`)
unchanged forever so keychain entries and autostart keep working.
