# Releasing & updates (macOS)

Releases are built by `.github/workflows/release.yml` when a `v*` tag is pushed. The app
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

```
npm run release -- patch          # or minor | major | 0.2.0
git push origin <branch> v0.2.0   # or add --push: npm run release -- patch --push
```

The script bumps `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and
`src-tauri/Cargo.lock`, commits "Release vX.Y.Z" and tags it (the working tree must be clean).
Pushing the `v*` tag makes the workflow publish a release with `.dmg` installers
(Apple Silicon + Intel), the update bundles and `latest.json`.

Local `tauri build` now needs `TAURI_SIGNING_PRIVATE_KEY` set (updater artifacts are signed).

## First install for colleagues

The app is only ad-hoc signed (no Apple Developer account), so Gatekeeper blocks the first launch:

1. Download the `.dmg` matching the Mac (`aarch64` = Apple Silicon, `x64` = Intel), drag *Attention* to Applications.
2. Run once: `xattr -dr com.apple.quarantine /Applications/Attention.app`
   (or right-click → Open, then *System Settings → Privacy & Security → Open Anyway*).

Later updates install in-app and don't need this step. Keep `identifier` (`at.ring-dev.attention`)
unchanged forever so keychain entries and autostart keep working.
