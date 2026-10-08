# attention — CLAUDE.md

## Keeping CLAUDE.md Up to Date

**After making any changes to a project — new dependencies, renamed files, changed tech stack, added scripts, updated test commands, or any other structural modifications — you MUST update the relevant CLAUDE.md file(s) to reflect the current state.** This applies to both this root CLAUDE.md and the per-project CLAUDE.md files. Outdated documentation is worse than no documentation; treat CLAUDE.md updates as a required part of every task, not optional cleanup.

## features.json
When adding an entry to `features.json`, give it only `id`, `title`, `description` — **never a `version`**. `npm run release` stamps it (see `RELEASING.md`). Append at the end; never reorder or delete entries.

## No assumptions
**Dont assume anything, but always ask me before decisions need to be taken. Collaborate with me instead of acting autonomously!**

## Overview

A personal desktop app that aggregates items requiring the user's attention into a single unified inbox. Instead of
context-switching between apps, everything surfaces in one place.

### Problem

Attention-worthy items are scattered across different contexts — GitHub PR reviews, feedback you're waiting on, manually
noted TODOs. The cognitive overhead of remembering _where_ to look is the problem this app solves.

### Non-Goals

- Not a task manager — items come _from_ sources, not replaced by them.
- Not a team tool — personal use only.
- Not a replacement for source apps — just a read/triage surface.

## Features

- **Sync providers** (all implement `SyncProvider`): GitHub open PRs, Gerrit open reviews (incoming as reviewer + my own outgoing changes), Datadog alerting monitors,
  GitLab MRs (label filter + me as reviewer), Jenkins failed builds, Jira assigned issues, SonarQube favorited-project issues (quality
  gates/issues/hotspots). Plus manual items.
- **Item metadata**: each provider populates a generic `properties` map surfaced as inline badges (Gerrit label scores,
  Datadog status, GitLab/GitHub PR metadata, Jenkins build duration, Jira issue type/status/priority, SonarQube
  severity/type/vulnerability probability/failing conditions).
- **Snooze**: per-item snooze and due-date display. Glob-pattern group snooze snoozes every open item whose title
  matches, with optional persisted rules that auto-snooze future matching items (e.g. the next Renovate MR).
- **Attention priority hooks**: providers can flag items as needing more or less attention (Datadog items float to top
  with a red stripe; Gerrit items with a negative label sink to the bottom, muted).
- **Per-source actions**: extensible `ActionProvider` framework for write-back operations. Currently: Gerrit "AI Review"
  (shells out to local `copilot` CLI).
- **Notifications & badges**: OS notifications on new items, window-title badge count, macOS Dock badge, tray tooltip.
  All reflect the open-item count excluding muted sources.
- **System tray**: left-click toggles window, right-click menu = Show/Quit. Closing the window hides to tray so
  auto-sync keeps running; quit only via tray.
- **Autostart**: opt-in launch-on-login.
- **OS keychain**: all credential tokens stored in the OS-native secret store (bundled as one entry to keep the keyring
  unlock prompt count at one on Linux).
- **Tenant Group Monitoring**: separate tab, independent of the Item/sync model —
  see [Tenant Group Monitoring](#tenant-group-monitoring). Column visibility is user-configurable per grid type and
  persisted across app restarts.
- **Docker orchestration**: separate tab for starting/stopping/restarting/pulling+starting services from a
  docker-compose.yaml configured in Settings, with the pull & start step optionally replaced by a custom shell command
  edited in Settings. Services can be starred as favorites, which float them to the top of the list; the list is
  otherwise sorted by state then alphabetically. A per-service "Logs" button live-tails that service's
  `docker compose logs`, reusing the same bottom console drawer as actions. Fires an OS desktop notification whenever
  any service's state or health changes between polls (e.g. a crash or a recovery) — see
  [Docker Orchestration](#docker-orchestration).

## Stack

| Layer         | Technology                                       |
|---------------|--------------------------------------------------|
| Desktop shell | Tauri v2 (Rust)                                  |
| Frontend      | Angular 19 + Angular Material (azure-blue theme) |
| Storage       | JSON file — `{app_data_dir}/items.json`          |
| Styling       | SCSS                                             |

## Project Structure

```
attention/
├── frontend/               # Angular 19 app
│   ├── src/
│   │   ├── app/
│   │   │   ├── app.component.*              # Root component (toolbar + inbox + sync/settings buttons)
│   │   │   ├── app.config.ts                # DI config: signals, routing, sync providers registration
│   │   │   ├── item.model.ts                # Item + ItemState types
│   │   │   ├── config.model.ts              # Config interface (shared between ShellService and ConfigService)
│   │   │   ├── snooze-rule.model.ts         # SnoozeRule type (patterns[] + until date)
│   │   │   ├── snooze-rules.service.ts      # Signal-based persisted snooze-rule state
│   │   │   ├── glob.util.ts                 # Glob↔regex matching + title-based glob guess
│   │   │   ├── tauri-commands.ts            # Typed CMD map — single source of truth for command name strings
│   │   │   ├── shell.service.ts             # Single Tauri boundary — all invoke() calls live here
│   │   │   ├── items.service.ts             # Signal-based item state
│   │   │   ├── config.service.ts            # Config persistence
│   │   │   ├── confirm-dialog.component.ts  # Generic confirm dialog
│   │   │   ├── syncs/                       # All sync providers, action providers, and shared contracts
│   │   │   │   ├── sync-provider.ts             # Abstract SyncProvider base class
│   │   │   │   ├── sync-providers.token.ts      # SYNC_PROVIDERS InjectionToken
│   │   │   │   ├── sync-coordinator.service.ts  # Runs all providers; knows no implementations
│   │   │   │   ├── item-action.ts               # ItemAction interface + abstract ActionProvider base class
│   │   │   │   ├── action-providers.token.ts    # ACTION_PROVIDERS InjectionToken
│   │   │   │   ├── item-actions.service.ts      # Resolves source-specific actions for an item
│   │   │   │   ├── github-sync.service.ts
│   │   │   │   ├── gerrit-sync.service.ts
│   │   │   │   ├── gerrit-actions.service.ts
│   │   │   │   ├── datadog-sync.service.ts
│   │   │   │   ├── gitlab-sync.service.ts
│   │   │   │   ├── jenkins-sync.service.ts
│   │   │   │   ├── jira-sync.service.ts
│   │   │   │   └── sonarqube-sync.service.ts
│   │   │   ├── inbox/
│   │   │   │   ├── inbox.component.*
│   │   │   │   └── snooze-group-dialog.component.ts
│   │   │   ├── settings/
│   │   │   │   └── settings-dialog.component.ts
│   │   │   ├── docker/                          # Docker orchestration tab
│   │   │   │   ├── docker.component.*
│   │   │   │   ├── docker-service-status.model.ts
│   │   │   │   └── docker-output-event.model.ts
│   │   │   └── monitoring/                      # Tenant Group Monitoring tab
│   │   │       ├── monitoring.component.*
│   │   │       ├── monitoring-stage.model.ts
│   │   │       ├── monitoring-stage-dialog.component.ts
│   │   │       ├── monitoring-stages.service.ts
│   │   │       ├── monitoring-auth.service.ts
│   │   │       ├── monitoring-column-prefs.service.ts  # Per-grid-type hidden-column preferences (persisted)
│   │   │       ├── monitoring-data.service.ts
│   │   │       ├── monitoring-grid-merge.util.ts
│   │   │       ├── grid-definitions.ts
│   │   │       ├── tenant-grid-result.model.ts
│   │   │       └── grid-progress-event.model.ts
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.scss
│   ├── angular.json
│   └── package.json
├── src-tauri/              # Tauri / Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs          # Tauri builder, command registration, system tray, close-to-tray, autostart
│   │   └── commands.rs     # CRUD commands + config + http proxy + monitoring
│   ├── capabilities/
│   │   └── default.json
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json            # Root — wraps `tauri dev` / `tauri build`
└── CLAUDE.md
```

## Data Model

`Item` (defined in `src-tauri/src/commands.rs` and mirrored as a TypeScript interface in `items.service.ts`):

| Field        | Type                                                               | Notes                                                                       |
|--------------|--------------------------------------------------------------------|-----------------------------------------------------------------------------|
| `id`         | `String` / `string`                                                | UUID v4 (generated in Angular)                                              |
| `title`      | `String` / `string`                                                | Required                                                                    |
| `notes`      | `Option<String>` / `string \| null`                                | Optional long-form text                                                     |
| `source`     | `String` / `string`                                                | `"manual"`, `"github"`, `"gerrit"`, etc.                                    |
| `state`      | `ItemState`                                                        | `open` \| `done` \| `snoozed`                                               |
| `created_at` | `String` / `string`                                                | ISO 8601 timestamp                                                          |
| `updated_at` | `String` / `string`                                                | ISO 8601 timestamp                                                          |
| `due_date`   | `Option<String>` / `string \| null`                                | Optional ISO date                                                           |
| `properties` | `Option<HashMap<String,String>>` / `Record<string,string> \| null` | Integration-specific metadata; displayed as inline badges                   |
| `url`        | `Option<String>` / `string \| null`                                | Optional deep-link; clicking the item title opens it in the default browser |

## Tauri Commands

All commands live in `src-tauri/src/commands.rs` and are registered in `lib.rs`. Every new command must also be listed
in the app manifest in `src-tauri/build.rs` and allowed (`allow-<name-with-dashes>`) in
`src-tauri/capabilities/default.json`; otherwise Tauri rejects the `invoke()` before the Rust code runs.

| Command                 | Args                                                                     | Returns                                                                                                                                                                                                                     |
|-------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `get_items`             | —                                                                        | `Vec<Item>`                                                                                                                                                                                                                 |
| `create_item`           | `item: Item`                                                             | `Vec<Item>` — errors on id collision (never upserts)                                                                                                                                                                        |
| `update_item`           | `item: Item`                                                             | `Vec<Item>`                                                                                                                                                                                                                 |
| `delete_item`           | `id: String`                                                             | `Vec<Item>`                                                                                                                                                                                                                 |
| `get_config`            | —                                                                        | `Config`                                                                                                                                                                                                                    |
| `set_config`            | `config: Config`                                                         | `Result<(), String>`                                                                                                                                                                                                        |
| `get_last_seen_feature` | —                                                                        | `Result<Option<String>, String>` — id of the last acknowledged "What's new" feature; `None` if no marker file                                                                                                               |
| `set_last_seen_feature` | `id: String`                                                             | `Result<(), String>`                                                                                                                                                                                                        |
| `http_request`          | `url, method, headers, body`                                             | `Result<String, String>` — thin CORS-bypass proxy                                                                                                                                                                           |
| `notify`                | `title, body`                                                            | `Result<(), String>`                                                                                                                                                                                                        |
| `open_url`              | `url: String`                                                            | `Result<(), String>`                                                                                                                                                                                                        |
| `set_badge_count`       | `count: usize`                                                           | —                                                                                                                                                                                                                           |
| `open_stage_login`      | `stage_name, sso_login_url`                                              | `Result<(), String>`                                                                                                                                                                                                        |
| `confirm_stage_login`   | `stage_name: String`                                                     | `Result<(), String>`                                                                                                                                                                                                        |
| `fetch_grid_data`       | `stage_name, tenant_host_template, grid_path, tenant_groups, request_id` | `Result<Vec<TenantGridResult>, String>`                                                                                                                                                                                     |
| `report_grid_result`    | `request_id: String, result: TenantGridResult`                           | `Result<(), String>` — invoked only from the hidden webview's injected script                                                                                                                                               |
| `cancel_grid_fetch`     | `request_id: String`                                                     | `Result<(), String>`                                                                                                                                                                                                        |
| `docker_list_services`  | `compose_path: String`                                                   | `Result<Vec<String>, String>` — shells out to `docker compose config --services`                                                                                                                                            |
| `docker_service_status` | `compose_path: String`                                                   | `Result<Vec<DockerServiceStatus>, String>` — shells out to `docker compose ps -a --format json`                                                                                                                             |
| `docker_service_action` | `compose_path, service, action, operation_id` (`action` ∈ `stop`\|`restart`) | `Result<(), String>` — shells out to the matching `docker compose` subcommand, streaming its stdout/stderr as `docker://output` events tagged with `operation_id`                                                        |
| `docker_pull_start`     | `compose_path, service, command_template, operation_id`                  | `Result<(), String>` — default: `docker compose pull` then `docker compose up -d` for `service`; if `command_template` is non-empty, substitutes `{service}`/`{compose_path}` into it and runs that through a shell instead; either way streamed as `docker://output` events tagged with `operation_id` |
| `docker_service_logs_start` | `compose_path, service, operation_id`                                 | `Result<(), String>` — spawns `docker compose logs --tail 200 -f <service>` detached, streaming it as `docker://output` events tagged with `operation_id`; returns as soon as the process is spawned rather than waiting for it to exit |
| `docker_service_logs_stop`  | `operation_id: String`                                                | `Result<(), String>` — kills the tracked log-follow child for `operation_id`, if still running; a no-op if it already exited or the id is unknown |

`set_badge_count` updates the window title (`Attention (N)` or plain `Attention`), the OS dock/taskbar badge via
`WebviewWindow::set_badge_count`, and the tray tooltip. The count itself is computed in Angular (`ItemsService`) since
muted-source filtering is a frontend concern.

All write commands return the full updated list so the frontend stays in sync without a separate load call.

`http_request` executes with `reqwest` and returns the raw response body. All API-specific logic (auth headers, parsing,
item mapping) lives in the sync providers.

## Config Model

Stored in `{app_data_dir}/config.json`. Credential fields (marked **keychain**) live in the OS secret store, not
`config.json` — see [OS keychain](#os-keychain-for-secrets).

| Field                       | Notes                                                                                                                                                                                                                                                                                                                 |
|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `github_token`              | GitHub PAT with `repo` scope. **Keychain.**                                                                                                                                                                                                                                                                           |
| `github_repos`              | Newline-separated `owner/repo` list                                                                                                                                                                                                                                                                                   |
| `gerrit_url`                | Base URL                                                                                                                                                                                                                                                                                                              |
| `gerrit_username`           |                                                                                                                                                                                                                                                                                                                       |
| `gerrit_http_password`      | Gerrit HTTP password. **Keychain.**                                                                                                                                                                                                                                                                                   |
| `gerrit_keywords`           | Newline-separated keywords; open changes whose commit message contains any keyword are surfaced with a `Keyword` badge, deduplicated with reviewer results                                                                                                                                                            |
| `datadog_token`             | Datadog PAT (`Authorization: Bearer`). **Keychain.**                                                                                                                                                                                                                                                                  |
| `datadog_site`              | e.g. `https://api.datadoghq.com`                                                                                                                                                                                                                                                                                      |
| `datadog_filter_query`      | Optional monitor search query (combined with `status:(Alert OR Warn)`)                                                                                                                                                                                                                                                |
| `gitlab_url`                | GitLab base URL                                                                                                                                                                                                                                                                                                       |
| `gitlab_token`              | GitLab PAT with `read_api`. **Keychain.**                                                                                                                                                                                                                                                                             |
| `gitlab_mr_labels`          | Comma-separated labels; optional — MRs where I am a reviewer are always synced                                                                                                                                                                                                                                                 |
| `jenkins_url`               | Jenkins base URL                                                                                                                                                                                                                                                                                                      |
| `jenkins_username`          |                                                                                                                                                                                                                                                                                                                       |
| `jenkins_api_token`         | Jenkins API token. **Keychain.**                                                                                                                                                                                                                                                                                      |
| `jenkins_jobs`              | Newline-separated job paths                                                                                                                                                                                                                                                                                           |
| `jenkins_folders`           | Newline-separated folder paths; all jobs inside are synced recursively                                                                                                                                                                                                                                                |
| `jenkins_excluded_paths`    | Newline-separated substrings; matching folders/jobs skipped during expansion                                                                                                                                                                                                                                          |
| `jenkins_long_running_minutes` | Optional minutes threshold; a currently-running build past this age is synced as an open, high-attention item (id-prefixed `jenkins-running-`) instead of being skipped                                                                                                                                          |
| `jira_url`                  | Jira Server/DC base URL                                                                                                                                                                                                                                                                                               |
| `jira_token`                | Jira PAT. **Keychain.**                                                                                                                                                                                                                                                                                               |
| `jira_jql_filter`           | Optional JQL appended with AND to `assignee = currentUser() AND statusCategory != Done`                                                                                                                                                                                                                               |
| `sonarqube_url`             | Base URL of a self-hosted SonarQube instance                                                                                                                                                                                                                                                                          |
| `sonarqube_token`           | SonarQube user token. **Keychain.**                                                                                                                                                                                                                                                                                   |
| `sonarqube_assigned_only`   | `"true"`/`"false"`/unset; unset or `"true"` = only issues assigned to me (default), `"false"` = all issues in favorited projects regardless of assignee. Only affects the assigned-issues sync, not quality gates or hotspots                                                                                         |
| `snooze_rules`              | Persisted group-snooze rules (`SnoozeRule[]`)                                                                                                                                                                                                                                                                         |
| `monitoring_stages`         | Tenant Group Monitoring stages (`MonitoringStage[]`)                                                                                                                                                                                                                                                                  |
| `monitoring_hidden_columns` | Per grid-type hidden-column names (`Record<gridKey, string[]>`). Applies across every stage — hiding a column is a grid-schema-level preference, not a stage-level one. `tenantGroup` is never hidden.                                                                                                                |
| `docker_compose_path`       | Path to a docker-compose.yaml on disk, edited in Settings. Read by the Docker tab; not a keychain secret.                                                                                                                                                                                                             |
| `pull_start_command`        | Optional custom shell command template for the Docker tab's "Pull & Start" button, edited in Settings. `{service}` and `{compose_path}` are substituted before running through a shell. Empty/unset falls back to the default `docker compose pull` + `docker compose up -d` for that service. Not a keychain secret. |
| `docker_favorite_services`  | Service names starred as favorites in the Docker tab (`string[]`). Toggled inline from the tab itself, not the Settings dialog.                                                                                                                                                                                       |

## Tenant Group Monitoring

A **Monitoring** tab (toggled from the toolbar via `AppComponent`'s `activeView` signal, sibling to the inbox) shows one
merged, sortable, filterable table per (stage, grid-type) combination across every tenant group configured for that
stage, streaming rows in live as each tenant group's data arrives. Entirely independent of the `Item`/`SyncProvider`
/snooze/badge model.

### Config

`monitoring_stages: MonitoringStage[]` in `Config`, edited via the "Add/Edit stage" dialog in the Monitoring tab (not
Settings). Each stage has a `name`, three base URLs (`token_base_url`, `tenant_list_base_url`,
`tenant_base_url_template` with a `{tenantGroup}` placeholder), an `sso_login_url`, and HTTP Basic credentials
(`basic_auth_username` + keychain-backed `basic_auth_password`, namespaced per stage as
`monitoring_basic_auth::{stage_name}`). The 5 grid types are fixed constants in `grid-definitions.ts`.

### Auth model

Three hosts, two mechanisms:

1. **Token host**: `GET {token_base_url}/cas/oidc/oidcAccessToken` with HTTP Basic → bearer token, cached in memory per
   stage; refetched once on failure.
2. **Tenant-list host**: `GET {tenant_list_base_url}/.../tenants` with the bearer token → tenant-group match codes,
   cached per stage.
3. **Tenant-group-scoped host** (`{tenantGroup}.<stage-domain>`): requires an **SSO session** in a hidden persistent
   `WebviewWindow` per stage (label `monitoring-login-{stage_name}`). The tenant-select URL sets an **httpOnly** cookie
   scoped to that subdomain — unreadable/unforwardable via `http_request`, which is why the hidden webview exists at
   all.

### Sequential navigation-driven fetch

`fetch_grid_data` in `commands.rs` drives the hidden webview through each tenant group one at a time (real top-level
navigations sidestep the CORS block that a same-page `fetch()` approach hits):

1. `window.navigate()` to the tenant-select URL, then to the grid URL — each awaited via a oneshot channel
   (`MonitoringState.page_load_waiters`, keyed by window label) fulfilled by an `on_page_load` callback filtering for
   `PageLoadEvent::Finished`. Each navigation has a 20s timeout; a timeout fails only that tenant group.
2. A small injected script compares `window.location.href` against the expected grid URL — mismatch means the session
   got redirected (session expired), reported as `url_mismatch: true`. Otherwise it `JSON.parse`s
   `document.body.textContent` and calls back `invoke('report_grid_result', { requestId, result })`, resolved via a
   second oneshot (`MonitoringState.grid_result_waiters`, keyed by `request_id` and additionally checked against the
   expected `tenant_group`).
3. Rust emits `monitoring://grid-progress` (`{request_id, done, total, result}`) after every tenant group, and aborts on
   `url_mismatch: true` or `cancel_grid_fetch` for that `request_id`. When done, emits `monitoring://grid-done`
   (`{request_id, session_expired, cancelled}`) and resolves the original call with every accumulated
   `TenantGridResult`.

### Angular side

`MonitoringDataService.fetchGrid()` returns `MergedGrid & {sessionExpired}` (derived from
`results.some(r => r.url_mismatch)`). `MonitoringComponent` subscribes to `monitoring://grid-progress` via
`ShellService.listen()` for the matching `request_id` and buffers incoming results on a
leading-edge-then-300ms-throttled cadence (first event merges immediately, subsequent within the window batched into one
trailing merge). The `progress` signal updates synchronously on every event regardless of throttling; any pending merge
is cancelled once the fetch's final result arrives. A `requestSeq` staleness guard protects against superseded fetches'
late events and against listener-teardown/registration races between successive `refresh()` calls.

The UI shows a live "Fetching tenant group N of total…" counter and a Cancel button (`ShellService.cancelGridFetch`)
while a fetch is running.

### Grid UI

**Tenant group column is a link**: first column (`tenantGroup`) renders each cell as an anchor whose `href` is the same
tenant-select URL the fetch mechanism uses (`{host}/crossng-datahub/open/tenantgrp/{encoded_group}`). Clicking opens the
tenant-scoped page in the user's default browser via `ShellService.openUrl`; `$event.preventDefault()` keeps the anchor
from navigating the webview. URL construction in `MonitoringComponent.tenantGroupUrl` mirrors Rust's
`tenant_group_host` — keep in sync with `commands.rs`.

**Long cell text**: fixed 48px row height (uniform-height requirement of the virtual scroller). Cells clip with
ellipsis; every body and header cell has a `matTooltip` bound to its own text with a 500ms hover delay. Header ellipsis
is applied to `.mat-sort-header-content` (inside `mat-sort-header`'s flex container) so the sort arrow stays visible.

**Per-tenant-group row-count chips**: a `mat-chip-listbox` row above the table renders `Group name (count)` per tenant
group, derived from `tenantGroupCounts()` (computed, grouping text-filtered rows). Clicking a chip toggles
`tenantGroupFilter`. `filteredRows()` narrows by text first (into `textFilteredRows`), then optionally by tenant group.
Chip counts reflect the text filter but NOT the tenant-group chip filter, so selecting one doesn't collapse the rest to
zero. `clearGridState()` resets the chip filter alongside the rest.

**Column visibility picker**: a `mat-menu` opened from a `view_column` toolbar icon lists every column (except
`tenantGroup`, which is filtered out of `hideableColumns()` — hiding the pivot column makes the table meaningless) with
a checkbox for each. Toggling persists via `MonitoringColumnPrefsService` under `config.monitoring_hidden_columns` (a
`Record<gridKey, string[]>` — the grid key alone, not per-stage: column visibility is a grid-schema-level preference).
`visibleColumns()` is a `computed()` that filters `columns()` by the current grid's hidden set; header/body tables and
`matHeaderRowDef`/`matRowDef` all bind to it. Store-hidden design (rather than store-visible) means a new column added
to a grid — e.g. a new schema field a tenant group brings in on next sync — defaults to visible without migration.
`tenantGroup` is always kept even if a stale/malformed persisted entry lists it, as a belt-and-braces guard. Menu items
call `$event.stopPropagation()` so the menu stays open across toggles; each checkbox is display-only
(`[disabled]="true"` plus click preventDefault) so it can't double-fire the toggle alongside the menu-item click.

### Performance at scale (~100k rows)

- `mergeGridResults` precomputes a lowercased `__searchText` field per row at merge time (excluded from `columns()`) so
  `filteredRows()` does one `includes()` per row instead of re-stringifying every cell.
- Filter input is bound to an immediate `filterText` signal; `filteredRows()` reads a debounced (~250ms)
  `debouncedFilterText` signal.
- `sortRows()` uses `compareGridValues` (`monitoring-sort.util.ts`) — numeric fast path, falls back to `localeCompare`
  only for non-numeric values.
- Rendering is virtualized via a hand-rolled `FixedSizeTableVirtualScrollStrategy`
  (`fixed-size-table-virtual-scroll-strategy.ts`) provided as `VIRTUAL_SCROLL_STRATEGY`. Reason: `mat-table`/`CdkTable`
  has no built-in integration with `cdk-virtual-scroll-viewport`; the built-in `FixedSizeVirtualScrollStrategy` only
  attaches to `*cdkVirtualFor`, which `mat-table`'s row templates don't use. The strategy drives the viewport's public
  `setTotalContentSize`/`setRenderedRange`/`setRenderedContentOffset` APIs and slices `filteredRows()` down to
  `windowedRows()` before handing it to the table's `dataSource`.
- Header is a separate non-scrolling `<table>` above the viewport (a `sticky` row would get dragged by the virtual
  scroll transform). Both tables use `table-layout: fixed` sharing the same `columns()` list; the header gets a
  `ResizeObserver`-driven `padding-right` equal to the body's scrollbar width so columns stay aligned on platforms with
  reserved-space scrollbars.
- The viewport enters the DOM only after rows arrive, so wiring uses a `@ViewChild` **setter**
  (`private set viewport(...)`) that calls `wireViewport()` on every query-result change, rather than a plain field read
  in `ngAfterViewInit`.

## Docker Orchestration

A **Docker** tab (sibling to Inbox/Monitoring via `AppComponent`'s `activeView` signal) lists the services defined in a
docker-compose.yaml and lets you start/stop/restart/pull-and-start each one. Entirely independent of the `Item`/
`SyncProvider` model, and much simpler than Tenant Group Monitoring — no live-fetch coordination, no virtualization, no
per-column config.

### Config

`config.docker_compose_path`, a single filesystem path edited in the Settings dialog's "Docker" section (a plain text
field, hardcoded there rather than routed through the per-provider `SettingsSection` mechanism, since it isn't tied to a
`SyncProvider`). Not a keychain secret.

`config.pull_start_command`, also in the Settings "Docker" section: an optional custom shell command template for the
"Pull & Start" button (see below), likewise hardcoded rather than a `SettingsField`.

### Backend: shelling out to the `docker` CLI

Rust does no compose-file parsing or Docker Engine API calls itself — it shells out to `docker compose`, matching the
rest of this backend's "thin proxy" style:

- `docker_list_services` runs `docker compose -f <path> config --services`, which asks compose's own parser for the
  resolved service list (correctly handling anchors/extends/includes/env interpolation) rather than this app parsing the
  YAML itself — so no YAML-parsing dependency was needed.
- `docker_service_status` runs `docker compose -f <path> ps -a --format json` and groups containers by `Service`,
  reducing each service's container states to `"running"` (all running), `"partial"` (some running), `"not created"` (no
  containers at all — e.g. never started), or the shared container state when every container agrees on one non-running
  state. Handles both NDJSON (one JSON object per line, current Docker CLI) and a single JSON array (older/other
  versions) output shapes.
- `docker_service_action` runs the matching subcommand for `stop` (`stop <service>`), or `restart`
  (`restart <service>`).
- `docker_pull_start` backs the "Pull & Start" button. With no `pull_start_command` configured it's the default two-step
  call — `pull <service>` then `up -d <service>` — same as the other actions. When a command template is configured,
  it's textually substituted (`{service}` → the service name, `{compose_path}` → the configured compose path) and run
  through a shell (`sh -c` on Unix, `cmd /C` on Windows) instead — needed because a user-supplied command is an
  arbitrary string (e.g. two `docker compose` calls joined with `&&`), not a fixed argv this app builds itself. This is
  the one place Rust runs a string the user wrote rather than args it assembles itself; it intentionally has no
  allowlist or validation, matching the same personal-use trust model as `gerrit_repos_root`/`run_in_terminal`.
- All four are `async fn` using `tokio::process::Command` (the `tokio` dependency needed the `process` feature added)
  rather than `std::process`, since `pull`/`up` can take a while and must not block a worker thread for that long.

**Streaming command output**: `docker_service_action` and `docker_pull_start` (the two actions with log-worthy output)
take a frontend-generated `operation_id` and spawn their `docker`/shell command with piped stdout/stderr instead of
buffering it. A shared `stream_command` helper reads both streams concurrently line-by-line (`tokio::select!` over two
`AsyncBufReadExt::lines()` cursors — the `tokio` dependency needed the `io-util` and `macros` features added) and
`app.emit`s each line as a `docker://output` event (`{operation_id, stream: "stdout"|"stderr", line}`) as it's
produced, mirroring the `request_id`/`monitoring://grid-progress` pattern `fetch_grid_data` already uses. On failure,
the command's error is the last stderr line seen (falling back to the bare exit status), same shape as before. The
default "Pull & Start" runs its two steps (`pull` then `up -d`) under the same `operation_id` so the frontend sees one
continuous log. `docker_list_services`/`docker_service_status` are unaffected — their stdout is parsed data, not a log,
so they still buffer the full output and return it as a string (`run_compose`, now built on a shared `compose_command`
helper that also backs the streaming path's default-command construction).

**Live logs**: `docker_service_logs_start` spawns `docker compose logs --tail 200 -f <service>` and emits the same
`docker://output` event shape as `stream_command`, so the frontend's existing console drawer/listener needs no
separate code path for it. It can't reuse `stream_command` itself, though: a follow (`-f`) process doesn't exit on its
own from the frontend's point of view, but `stream_command` only returns once its child exits. Instead,
`docker_service_logs_start` spawns the child, stores it in `DockerLogsState` (a
`tokio::sync::Mutex<HashMap<operation_id, Child>>`, `app.manage`d in `lib.rs`) keyed by `operation_id`, and returns
immediately — the read-and-emit loop runs in a detached `tauri::async_runtime::spawn` task instead of being awaited by
the command. `docker_service_logs_stop(operation_id)` looks up and kills the tracked child (a no-op if it already
exited or the id is unknown); the detached task also removes its own entry once the child exits on its own (e.g. the
container stops), so a later stop has nothing stale to kill. Known limitation: quitting the app entirely (tray Quit)
while a log stream is active doesn't kill that child process — no shutdown hook was added for this narrow case,
mirroring how other "accepted, rare, bounded" edge cases are handled elsewhere in this backend (e.g.
`MonitoringState.cancelled`'s documented race).

### Angular side

`DockerComponent` calls `dockerListServices` once on load to discover services, then polls `dockerServiceStatus` on a
fixed interval (5s, via `setInterval`, regardless of tab visibility — same always-on-in-background convention as
`ItemsService`'s auto-sync) to keep each row's state current. Each row has Start/Stop/Restart/Pull & Start buttons;
`runningActions` (a `Set<string>` of `service:action` keys) tracks in-flight actions per service so all four buttons for
that service disable while one is running. The Pull & Start button (`action: 'pull_start'`) is the only one that reads
`config.pull_start_command` (via `ConfigService.get()`) before calling `ShellService.dockerPullStart` — every other
action just forwards straight to `dockerServiceAction`. Feedback is a `MatSnackBar` message on success or failure.

**Live output console**: each action call generates a fresh `operation_id` (`crypto.randomUUID()`) passed to the Tauri
command, and a single bottom console drawer (shared across all services/actions, rather than one per row — this app has
no per-service parallelism worth showing side by side) shows that operation's output as it streams in. `ngOnInit` sets
up one `docker://output` listener for the component's lifetime (`ShellService.listen`, mirroring the
`monitoring://grid-progress` pattern), filtering events by `event.payload.operation_id` against the currently-tracked
`consoleOperationId` signal — so starting a new action while another is still running switches the drawer over to it;
the older one keeps running to completion in the background and still reports its own snackbar. `runAction` opens the
drawer (`consoleExpanded.set(true)`) and clears `consoleLines` at the start of every action. Auto-scroll
(`consoleAutoScroll`, checked via `AfterViewChecked` + `consoleScrollPending`) sticks the log to its latest line unless
the user has scrolled up more than 24px from the bottom (`onConsoleScroll`), and `consoleLines` is capped at
`MAX_CONSOLE_LINES` (2000) to bound memory/DOM cost for a very chatty operation like a large image pull. stderr lines
are styled distinctly (`.console-stderr`) from stdout.

**Live logs viewer**: each row has a "Logs" button (`viewLogs(service)`) that repurposes the same console drawer to
live-tail that service instead of showing an action's output — `consoleMode` (`'action' | 'logs' | null`) distinguishes
the two so the header can render a pulsing "live" dot instead of a spinner, and add a "Stop following" button, only in
logs mode. It's deliberately not persistent: closing/switching the drawer, switching away from the Docker tab
(`ngOnDestroy`), or clicking "Stop following" all call `ShellService.dockerServiceLogsStop` for the current
`operation_id`, killing the backend follow process — reopening logs later starts a fresh `docker compose logs --tail
200 -f` rather than resuming any buffered history. Clicking Logs on the service already being followed toggles it off.
Starting a new action (`runAction`) while logs are being followed stops the log stream first, since the two modes
share the same drawer and `operation_id`.

**Favorites & sorting**: each row has a star toggle (`toggleFavorite`) that persists into
`config.docker_favorite_services` (via `ConfigService`, mirroring `SourcesService.toggleMute`'s read-modify-write
pattern). The displayed list (`sortedServices`, a `computed()`) always places every favorited service ahead of all
non-favorited ones as one block, then within each block sorts by state — `running` > `partial` > `exited` >
`restarting` > `paused` > `not created` > `unknown`, any other docker-reported state alphabetically after that — and
alphabetically by service name as the final tiebreaker.

**Desktop notifications on state change**: after the first status fetch establishes a baseline per service
(`previousStatus`, a `Map<service, {state, health}>`, populated silently — `refreshStatus(false)` is called from
`loadServices`/reload so nothing fires on initial load or manual reload), every subsequent poll compares each service's
freshly-fetched `state`/`health` against that baseline. Any difference — in either direction, e.g. a crash or a
recovery — fires `ShellService.notify('Docker', ...)` with a body like `service — state: running → exited` (both state
and health changes are listed if both changed in the same poll). Applies to every service, not just favorites; there's
no settings toggle to disable it.

## Dev Commands

From `attention/` (root):

```bash
npm run dev        # Start Tauri dev (launches Angular dev server + desktop window)
npm run build      # Production build
npm run frontend   # Angular dev server only (browser, no Tauri shell)
```

From `attention/frontend/`:

```bash
npm run start      # Angular dev server on :4200
npm run build      # Angular production build → dist/attention-app/browser/
```

## System Requirements (Linux)

Tauri on Linux needs GTK3 and webkit2gtk dev headers, and the `keyring` crate's Linux backend (`sync-secret-service`)
needs libdbus dev headers:

```bash
sudo apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev libdbus-1-dev
```

At runtime, the keychain-backed credential fields require a Secret Service provider (GNOME Keyring or KWallet). Without
one, secret reads/writes fail closed rather than falling back to plaintext.

The Docker tab requires the `docker` CLI (with the `compose` subcommand) on `PATH` at runtime — it shells out to
`docker compose`, it isn't bundled or vendored.

## Angular Architecture Notes

### Signals & services

- `ItemsService` holds items in a `signal<Item[]>()` exposed as `readonly items` via `.asReadonly()`. Components read
  via `computed()`. Mutations only through named service methods.
- `AppComponent.ngOnInit()` calls `items.load()` once to hydrate from disk.
- Auto-sync: `interval(1_000)` in `ItemsService` constructor counts down `nextSyncIn` and drives `autoSync()` — no Rust
  background task. Keeps running while the window is hidden in the tray.

### Tauri boundary

- `ShellService` is the single point of contact with Tauri — the only file that imports from `@tauri-apps`. All
  `invoke()` calls live there.
- All command name strings live in `tauri-commands.ts` as the `CMD` constant, imported only by `ShellService`. No raw
  string literals in `invoke()` calls.
- Backend is a thin proxy: `http_request` (CORS bypass), file I/O, `notify`, tray, close-to-tray, autostart. All sync
  logic lives in Angular.

### Sync architecture

- Each sync provider extends `SyncProvider` and is registered against the `SYNC_PROVIDERS` token in `app.config.ts`.
- A provider's `sync(currentItems)` returns a `SyncDiff` (`{ toCreate, toUpdate, toDelete }`) — pure data transformer,
  no side effects.
- `SyncCoordinatorService` chains providers, applying each diff locally so the next provider sees accurate state, and
  returns the aggregate `SyncDiff`.
- `ItemsService.sync()` is the sole caller of `create_item`/`update_item`/`delete_item` — validation and hooks added
  there apply to sync-created items too.
- Adding a provider: implement `SyncProvider`, register with the token. No other wiring.
- `updated_at` must reflect the source system's own last-activity timestamp, never wall-clock sync time —
  `ItemsService.sync()` overwrites an existing item's `updated_at` with the freshly-synced value on every sync. Current
  mapping: GitHub (`pr.updated_at`), GitLab (`mr.updated_at`), Jira (`issue.fields.updated`), Gerrit (`change.updated`),
  Datadog (`overall_state_modified`, last alert state change), Jenkins (build `timestamp + duration`, i.e. when the
  build finished), SonarQube (`issue.updateDate` / `hotspot.updateDate`, or the analysis date for failed-quality-gate
  items). `created_at` uses each source's real creation field where available (Gerrit's `change.created`, SonarQube's
  `issue.creationDate` / `hotspot.creationDate`); Datadog's search response has no per-monitor creation timestamp, so
  `created_at` falls back to `overall_state_modified` there. SonarQube's failed-quality-gate items have no separate
  creation field, so `created_at` falls back to the analysis date too.

### Per-provider settings & display

- `SyncProvider` exposes optional `getSettingsFields(): SettingsSection` and `getPropertyOrder(): string[]`.
- `SettingsDialogComponent` injects all `SYNC_PROVIDERS` and renders fields dynamically — no per-provider hardcoding.
- The inbox renders property badges in provider-defined order, appending unknown keys in insertion order.

### Attention priority hooks

- `SyncProvider` exposes optional `needsMoreAttention(item)` and `needsLessAttention(item)`. `InboxComponent` resolves
  via `SYNC_PROVIDERS`, falls back to `false`.
- `sortItems()` uses these as sort keys: "more" floats to top, "less" sinks to bottom, user's chosen sort
  (newest/oldest/source) is tiebreak. "More" wins if both fire.
- Template binds `[class.high-attention]` (red stripe + light tint) and `[class.low-attention]` (muted gray stripe) on
  `.item-row`.
- Currently: `DatadogSyncService` flags every item as "more" (sync already filters to `status:(Alert OR Warn)`).
  `SonarqubeSyncService` flags an item as "more" when it's a failed-quality-gate item (id prefix `sonarqube-qg-`) —
  assigned-issue and hotspot items sort normally. `GerritSyncService` flags an item as "less" when its `Verified` or
  `Code-Review` property starts with `-` (negative vote → ball is in author's court). Outgoing Gerrit changes (`owner:self`, tagged `Role: Outgoing`) are the inverse: "less" by default, normal attention only when any label is negative or both `Verified` and `Code-Review` are positive. `JenkinsSyncService` flags an
  item as "more" when it's a still-running build synced past the configured `jenkins_long_running_minutes` threshold
  (id prefix `jenkins-running-`).

### Per-source actions

- `ItemAction` = `{ id, label, icon, destructive?, run(item) }`.
- `ActionProvider` declares the `source` it serves and returns `getActions(item)` — item-aware, so a provider can offer
  conditional actions based on `item.properties`.
- Registered against `ACTION_PROVIDERS` (`syncs/action-providers.token.ts`) in `app.config.ts`. `ItemActionsService`
  resolves actions by matching `item.source`.
- Each item row's meta area (`.item-actions`) has two stacked rows: `.default-actions` (source chip, snooze/un-snooze,
  done, delete — always present) and, only when `actionsFor(item)` is non-empty, `.specific-actions` rendering one icon
  button per action directly (tooltip = label), no dropdown.
- `runAction()` confirms first when `action.destructive` (`ConfirmDialogComponent`), disables that action's own button
  while in flight (`runningAction` signal, keyed per item+action), and reports via `MatSnackBar`. Local item is left
  as-is post-action — reconciles on next auto-sync.
- Currently: **Gerrit "AI Review"** (`GerritActionsService`) shells out to a local `copilot` CLI via
  `ShellService.runInTerminal` (needs `gerrit_repos_root` configured).

### Snooze

- `ItemsService.snooze(id, days)` takes a number of days and computes the due date. Components don't compute dates.
- `load()` calls `wakeExpiredSnoozes()` which un-snoozes items past their due date before setting the signal.

### Group snooze by title glob

- Entry point: per-item menu's "Snooze items like this…" (`SnoozeGroupDialogComponent`, opened from
  `InboxComponent.openSnoozeGroupDialog()`).
- Pre-fills a single glob chip guessed from the item's title (`guessGlobFromTitle` in `glob.util.ts` replaces
  version-like digit runs with `*`).
- Patterns are `mat-chip-grid` chips — a rule holds any number of globs, matched OR-wise (case-insensitive `*`/`?` →
  regex via `matchesAnyGlob` / `matchesGlob`).
- Live count/preview of matching open items updates as the user edits.
- Confirming calls `ItemsService.snoozeMatching(patterns, untilDate)`.
- Optional "keep applying to new matching items" persists a `SnoozeRule` (`{id, title, patterns, until, created_at}`)
  via `SnoozeRulesService` into `config.snooze_rules`. `ItemsService` applies active rules to newly-open items on every
  `load()` and `sync()` (`applySnoozeRules`, run after `wakeExpiredSnoozes`).

### Snooze rules UI

- `SnoozeRulesService.rules()` returns every rule (active + expired) for the inbox chip row; `activeRules()` filters to
  `until >= today` and is what `applySnoozeRules` consults. Expired rules stay visible but stop auto-snoozing.
- Rule chips render below the Open/Snoozed/Done/All row, each showing `title (currently-snoozed match count)` with a
  tooltip listing all patterns. Expired chips render dimmed with an "expired" tag.
- Clicking a chip sets `ruleFilter`; `visible()` intersects it with the current status filter (AND, not replacement).
- `matChipRemove` calls `ItemsService.unsnoozeMatching(patterns)` (sets every currently-snoozed item matching the rule
  back to `open`) followed by `SnoozeRulesService.removeRule(id)`. No "delete rule but leave items snoozed" path.
- Trailing icon on each chip reopens the dialog for edit — for active rules the "Snooze until" is pre-filled with the
  rule's current `until` (not reset to +7d); for expired rules it defaults to +7d. Icons/labels flip between
  `edit`/"Save" and `restore`/"Reactivate". Confirming calls `SnoozeRulesService.updateRule(id, {...})` (never a new
  rule) plus `snoozeMatching` for immediate effect.

### System tray & close-to-tray

- Built in `lib.rs` `.setup()` using Tauri v2's built-in tray (`tray-icon` + `image-png` Cargo features; no plugin).
  Tray id is `TRAY_ID` (`"main-tray"`, defined in `commands.rs`, reused in `lib.rs`).
- Left-click toggles main window visibility. Right-click menu: "Show Attention", "Quit" (`app.exit(0)`). Tooltip mirrors
  the window title.
- `on_window_event` intercepts `WindowEvent::CloseRequested` for the `main` window and calls
  `api.prevent_close() + window.hide()` — closing hides to tray, webview stays alive, auto-sync and notifications keep
  running. Quit only via tray.

### Autostart

- `tauri-plugin-autostart` v2 (Rust crate + `@tauri-apps/plugin-autostart` frontend dep), registered in `lib.rs` with
  `MacosLauncher::LaunchAgent`.
- OFF by default. Toggled from the Settings "Application" section.
- `ShellService.isAutostartEnabled()` / `setAutostart(enabled)` dynamic-import the JS plugin (mirroring the notification
  pattern). The OS plugin is the source of truth — autostart state is NOT in `config.json` and has no `CMD` entry.
- Requires `autostart:allow-enable` / `allow-disable` / `allow-is-enabled` in `capabilities/default.json`.

### Badge count excludes muted sources

- `ItemsService` injects `SourcesService` and defines a `computed()` of the open item count filtered by
  `!sources.isMuted(i.source)`, plus an `effect()` pushing it via `ShellService.setBadgeCount()` whenever the item list
  or muted set changes.
- Rust's `set_badge_count` just applies the given count — muted-source logic stays in Angular alongside
  `SourcesService`.

### OS keychain for secrets

- The seven credential fields (`github_token`, `gerrit_http_password`, `datadog_token`, `gitlab_token`,
  `jenkins_api_token`, `jira_token`, `sonarqube_token`) are stripped out of the serialized `Config` before it's written
  to `config.json` (`write_config` removes each `SECRET_KEYS` entry from the JSON `Value`) — never persisted in
  plaintext. They live in the OS secret store (Windows Credential Manager / macOS Keychain / Linux Secret Service) via
  the `keyring` crate, service name `"attention"`.
- **Transparent to the frontend**: `get_config`/`set_config` round-trip the whole `Config` exactly as before.
- **Bundled**: all seven secrets are stored as one JSON object under a single keychain entry
  (`SECRET_BUNDLE_KEY = "secrets"`), not seven separate entries — each `keyring::Entry` is its own session, and on Linux
  a locked keyring prompts per session, so bundling keeps the startup prompt count at one. `load_config` hydrates from
  the bundle; `write_config` upserts (`Some` inserts, `None` removes) and re-saves the bundle before writing non-secret
  fields.
- **Fail-closed**: if the keychain backend is unreachable (e.g. Linux with no D-Bus session), `set_config` errors rather
  than falling back to plaintext. A bundle read failure is treated as "no secrets set" rather than failing the whole
  config load.
