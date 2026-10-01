# Attention

Unified attention dashboard — a desktop app (Tauri + Angular) that lives in your menu bar,
collects items that need your attention in one inbox, and keeps running in the background
for syncs and notifications. Closing the window hides it to the tray; quit via the tray menu.

## Install (macOS)

1. Open the [latest release](https://github.com/Wallabeng/attention/releases/latest) and download the `.dmg`
   for your Mac:
   - `aarch64` — Apple Silicon (M1/M2/M3/…)
   - `x64` — Intel
   (Not sure? Apple menu → *About This Mac*.)
2. Open the `.dmg` and drag **Attention** into *Applications*.
3. The app is not signed with an Apple Developer certificate, so macOS blocks the first launch.
   Remove the quarantine flag once, in Terminal:
   ```
   xattr -dr com.apple.quarantine /Applications/Attention.app
   ```
   Alternatively: right-click the app → *Open*, or *System Settings → Privacy & Security → Open Anyway*.
4. Start Attention. Credentials you enter are stored in the macOS Keychain.

## Updates

Attention checks for new versions on startup and asks before installing; the update is
signature-verified and the app restarts afterwards. You can also check manually via the tray
icon → *Check for Updates…*. No re-download or Gatekeeper step is needed for updates.

## Development

Prerequisites: [Rust](https://rustup.rs) and Node.js.

```
npm ci
(cd frontend && npm ci)
npm run dev
```

Releasing (maintainers): see [RELEASING.md](RELEASING.md).
