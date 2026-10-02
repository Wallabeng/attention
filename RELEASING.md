# Releasing & updates (macOS)

Releases are built by `.github/workflows/release.yml`, which is run manually from GitHub
(pushing a `v*` tag does not trigger it). The app
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

### From GitHub

1. Open **Actions → Release → Run workflow**.
2. Select the branch to release and choose a version bump: `patch`, `minor`, or `major`.
3. Click **Run workflow**.

The workflow runs the release script, pushes the version commit and tag to the selected
branch, then builds and publishes that tag in the same run. No extra token is needed:
tags pushed with `GITHUB_TOKEN` do not trigger another workflow run.
Release runs are serialized to prevent overlapping releases.
GitHub keeps only one pending run in the concurrency group; a newer request replaces
an older pending request, so wait for the current release to finish before requesting another.

The selected branch must allow pushes from `github-actions[bot]`; branch protection
requiring pull requests may prevent the version commit from being pushed.
The branch and tag are pushed atomically, so a rejected branch push does not leave a release tag behind.
The workflow must be present on the default branch for the **Run workflow** button to appear.

Releases run on a branch (not a tag) on purpose: GitHub Actions caches are scoped to the ref
that saved them, and tag refs cannot restore each other's caches. Running on `main` lets the
Rust and npm caches be reused by every release after the first.

### Locally

```
npm run release -- patch          # or minor | major | 0.2.0
```

The script bumps `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and
`src-tauri/Cargo.lock`, commits "Release vX.Y.Z" and tags it (the working tree must be clean).
The workflow runs this same script with `--push`, then builds and publishes a release with
`.dmg` installers (Apple Silicon + Intel), the update bundles and `latest.json`.

Local `tauri build` now needs `TAURI_SIGNING_PRIVATE_KEY` set (updater artifacts are signed).

## What's new popup

User-visible features are listed in `features.json`, an
**append-only** log. Add an entry (`id`, `title`, `description`) at the **end** in the PR
that ships the feature; never reorder or delete entries, because order defines what a user
has already seen (the app stores the id of the last entry shown, and shows everything after
it, so skipped releases and fresh installs are covered). Ids must be unique and stable.
`npm run release` stamps entries without a `version` with the new version, and the popup groups by it.

## First install for colleagues

The app is only ad-hoc signed (no Apple Developer account), so Gatekeeper blocks the first launch:

1. Download the `.dmg` matching the Mac (`aarch64` = Apple Silicon, `x64` = Intel), drag *Attention* to Applications.
2. Run once: `xattr -dr com.apple.quarantine /Applications/Attention.app`
   (or right-click → Open, then *System Settings → Privacy & Security → Open Anyway*).

Later updates install in-app and don't need this step. Keep `identifier` (`at.ring-dev.attention`)
unchanged forever so keychain entries and autostart keep working.
