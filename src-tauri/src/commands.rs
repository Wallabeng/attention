use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use percent_encoding::{AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncBufReadExt;

/// Tray icon id — shared between the tray builder in `lib.rs` and tooltip updates here.
pub const TRAY_ID: &str = "main-tray";

/// Window label for a stage's hidden SSO login webview.
fn login_window_label(stage_name: &str) -> String {
    format!("monitoring-login-{stage_name}")
}

/// Mirrors JS `encodeURIComponent`'s unreserved-character set (RFC 3986 `-_.~` stay
/// unescaped) so a tenant-group match code containing a dash (e.g. "acme-eu") isn't
/// corrupted when substituted into a hostname or path segment.
const URI_COMPONENT_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'~');

/// Per-navigation-step timeout: a tenant-select or grid-fetch navigation that doesn't
/// finish loading within this window fails only that tenant group; processing continues
/// to the next one. Also reused for the (much faster in practice) extraction-script step,
/// as a robustness backstop rather than a documented per-spec guarantee.
const NAVIGATION_TIMEOUT: Duration = Duration::from_secs(20);

fn tenant_group_host(tenant_host_template: &str, tenant_group: &str) -> String {
    let encoded = percent_encoding::utf8_percent_encode(tenant_group, URI_COMPONENT_ENCODE_SET).to_string();
    tenant_host_template.replace("{tenantGroup}", &encoded)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemState {
    Open,
    Done,
    Snoozed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub source: String,
    pub state: ItemState,
    pub created_at: String,
    pub updated_at: String,
    pub due_date: Option<String>,
    pub properties: Option<HashMap<String, String>>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnoozeRule {
    pub id: String,
    pub title: String,
    pub patterns: Vec<String>,
    pub until: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringStage {
    pub name: String,
    pub token_base_url: String,
    pub tenant_list_base_url: String,
    pub tenant_base_url_template: String,
    pub sso_login_url: String,
    pub basic_auth_username: String,
    #[serde(default)]
    pub basic_auth_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantGridResult {
    pub tenant_group: String,
    pub ok: bool,
    pub data: Option<Vec<serde_json::Value>>,
    pub error: Option<String>,
    /// True when the post-navigation URL check (see `EXTRACT_GRID_RESULT_SCRIPT_TEMPLATE`)
    /// found the webview redirected away from the grid URL it was told to load — the
    /// authoritative session-expiry signal for the sequential navigation fetch.
    #[serde(default)]
    pub url_mismatch: bool,
}

#[derive(Default)]
pub struct MonitoringState {
    /// Resolved by the `on_page_load` `Finished` callback for the hidden webview with this
    /// window label (see `open_stage_login`). Reset (a fresh oneshot inserted) before every
    /// `navigate()` call — only one navigation is ever in flight per stage's webview, since
    /// the whole fetch loop is sequential. Deliberately NOT gated on the loaded URL matching
    /// what was requested: a session-expiry redirect legitimately lands on a different URL
    /// than requested, and that's exactly the case `EXTRACT_GRID_RESULT_SCRIPT_TEMPLATE`'s
    /// `url_mismatch` check needs to see promptly rather than waiting out a full timeout.
    /// This leaves an accepted residual race: if a timed-out navigation's `Finished` event
    /// arrives late (the abandoned navigation was never actually cancelled, just given up
    /// on), it resolves whatever waiter is *currently* registered for this label — which by
    /// then almost certainly belongs to a later step, not the one that timed out. The only
    /// truly safe gap is the brief synchronous window between a timeout's cleanup and the
    /// next step's registration (no waiter present, so a late arrival harmlessly no-ops);
    /// once the next step registers its own waiter, a stale arrival can misattribute a
    /// navigation as "loaded" before it actually has — caught in the common case by
    /// `extract_grid_result`'s own URL check, but not guaranteed to be. Accepted for now:
    /// requires an actual hung/very slow navigation to trigger, which is already an unusual
    /// condition for this feature's real-world usage.
    page_load_waiters: std::sync::Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>,
    /// Resolved by `report_grid_result`, keyed by `request_id`. Reset before each
    /// per-tenant-group extraction script is `eval()`'d — only one `fetch_grid_data` call is
    /// ever in flight per stage at a time. The stored tenant group is checked against the
    /// reported result's `tenant_group` before resolving. Unlike `page_load_waiters` above,
    /// this guard has no equivalent redirect problem: the extraction script always echoes
    /// back the exact `tenant_group` it was told to fetch, so there's no legitimate reason
    /// for a mismatch — a mismatch can only mean a stale, late-arriving report from a
    /// timed-out-but-still-running eval, which this guard safely ignores instead of
    /// misattributing to the current tenant group.
    grid_result_waiters: std::sync::Mutex<HashMap<String, (String, tokio::sync::oneshot::Sender<TenantGridResult>)>>,
    /// `request_id`s flagged by `cancel_grid_fetch`; checked by the in-flight loop between
    /// tenant groups. Cleared at the end of `fetch_grid_data` regardless of outcome. If
    /// `cancel_grid_fetch` races the very end of the loop (fetch already finished/cleared
    /// its own entry by the time the cancel flag is inserted), the flag is orphaned until
    /// app restart — accepted as a rare, bounded edge case rather than adding in-flight
    /// tracking machinery to close it.
    cancelled: std::sync::Mutex<HashSet<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub github_token: Option<String>,
    pub github_repos: Option<String>,
    pub gerrit_url: Option<String>,
    pub gerrit_username: Option<String>,
    pub gerrit_http_password: Option<String>,
    pub datadog_token: Option<String>,
    pub datadog_site: Option<String>,
    pub datadog_filter_query: Option<String>,
    pub gitlab_url: Option<String>,
    pub gitlab_token: Option<String>,
    pub gitlab_mr_labels: Option<String>,
    pub jenkins_url: Option<String>,
    pub jenkins_username: Option<String>,
    pub jenkins_api_token: Option<String>,
    pub jenkins_jobs: Option<String>,
    pub jenkins_folders: Option<String>,
    pub jenkins_excluded_paths: Option<String>,
    pub jenkins_long_running_minutes: Option<String>,
    pub jira_url: Option<String>,
    pub jira_token: Option<String>,
    pub jira_jql_filter: Option<String>,
    pub gerrit_repos_root: Option<String>,
    pub gerrit_keywords: Option<String>,
    pub sonarqube_url: Option<String>,
    pub sonarqube_token: Option<String>,
    pub sonarqube_assigned_only: Option<String>,
    #[serde(default)]
    pub muted_sources: Vec<String>,
    #[serde(default)]
    pub snooze_rules: Vec<SnoozeRule>,
    #[serde(default)]
    pub monitoring_stages: Vec<MonitoringStage>,
    /// Per grid-type hidden-column names. Applies across every stage — column
    /// visibility is a grid-schema-level preference, not a stage-level one, so
    /// hiding `errorCode` in one stage hides it everywhere the same grid type
    /// is shown. Missing entry = no columns hidden. `tenantGroup` is filtered
    /// out client-side and never stored here.
    #[serde(default)]
    pub monitoring_hidden_columns: HashMap<String, Vec<String>>,
    /// Path to a docker-compose.yaml on disk, read by the Docker tab to list and
    /// control services. Not a keychain secret — just a filesystem path.
    pub docker_compose_path: Option<String>,
    /// Optional custom shell command template for the "Pull & Start" action, in place
    /// of the default `docker compose pull` + `docker compose up -d`. `{service}` and
    /// `{compose_path}` are substituted before the command is run through a shell.
    /// Empty/unset falls back to the default two-step compose invocation. Not a
    /// keychain secret.
    pub pull_start_command: Option<String>,
    /// Service names starred as favorites in the Docker tab. Favorited services are
    /// listed ahead of all others, regardless of state.
    #[serde(default)]
    pub docker_favorite_services: Vec<String>,
}

/// Service name under which all credentials are namespaced in the OS keychain.
const KEYCHAIN_SERVICE: &str = "attention";

/// Single keychain entry all seven secrets are bundled into (as a JSON object), so
/// startup makes one keychain call instead of seven — each `keyring::Entry` is a
/// separate keychain/Secret-Service session, and on Linux a locked keyring prompts
/// per session, not per app. Bundling collapses seven startup prompts into one.
const SECRET_BUNDLE_KEY: &str = "secrets";

/// The seven `Config` fields backed by the OS keychain rather than config.json.
const SECRET_KEYS: &[&str] = &[
    "github_token",
    "gerrit_http_password",
    "datadog_token",
    "gitlab_token",
    "jenkins_api_token",
    "jira_token",
    "sonarqube_token",
];

fn load_secret_bundle() -> HashMap<String, String> {
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, SECRET_BUNDLE_KEY) {
        Ok(entry) => entry,
        Err(e) => {
            log::warn!("keychain unavailable for secret bundle: {e}");
            return HashMap::new();
        }
    };
    match entry.get_password() {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(keyring::Error::NoEntry) => HashMap::new(),
        Err(e) => {
            log::warn!("keychain read failed for secret bundle: {e}");
            HashMap::new()
        }
    }
}

/// Fail-closed: on any keychain error this returns `Err` rather than falling back
/// to plaintext storage, so a save either lands in the keychain or not at all.
fn save_secret_bundle(bundle: &HashMap<String, String>) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, SECRET_BUNDLE_KEY).map_err(|e| e.to_string())?;
    if bundle.is_empty() {
        return match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    let json = serde_json::to_string(bundle).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| e.to_string())
}

fn hydrate_secrets(config: &mut Config, bundle: &HashMap<String, String>) {
    config.github_token = bundle.get("github_token").cloned();
    config.gerrit_http_password = bundle.get("gerrit_http_password").cloned();
    config.datadog_token = bundle.get("datadog_token").cloned();
    config.gitlab_token = bundle.get("gitlab_token").cloned();
    config.jenkins_api_token = bundle.get("jenkins_api_token").cloned();
    config.jira_token = bundle.get("jira_token").cloned();
    config.sonarqube_token = bundle.get("sonarqube_token").cloned();
}

fn persist_secrets(config: &Config) -> Result<(), String> {
    // Load first (rather than starting from an empty map) so a save never clobbers
    // any other secret this call doesn't touch.
    let mut bundle = load_secret_bundle();
    let upsert = |bundle: &mut HashMap<String, String>, key: &str, value: &Option<String>| match value {
        Some(v) => {
            bundle.insert(key.to_string(), v.clone());
        }
        None => {
            bundle.remove(key);
        }
    };
    upsert(&mut bundle, "github_token", &config.github_token);
    upsert(&mut bundle, "gerrit_http_password", &config.gerrit_http_password);
    upsert(&mut bundle, "datadog_token", &config.datadog_token);
    upsert(&mut bundle, "gitlab_token", &config.gitlab_token);
    upsert(&mut bundle, "jenkins_api_token", &config.jenkins_api_token);
    upsert(&mut bundle, "jira_token", &config.jira_token);
    upsert(&mut bundle, "sonarqube_token", &config.sonarqube_token);
    save_secret_bundle(&bundle)
}

/// Keychain key for a stage's basic-auth password. Namespaced per stage name
/// (unlike the fixed SECRET_KEYS) since monitoring_stages is a repeatable
/// list, not a fixed set of struct fields. Renaming *or removing* a stage
/// orphans its old keychain entry (persist_monitoring_secrets below only
/// writes secrets for stages still present in the config, it never deletes
/// one for a stage that's gone) — acceptable for personal-use scope, same as
/// the rename case.
fn monitoring_secret_key(stage_name: &str) -> String {
    format!("monitoring_basic_auth::{stage_name}")
}

fn hydrate_monitoring_secrets(config: &mut Config, bundle: &HashMap<String, String>) {
    for stage in &mut config.monitoring_stages {
        stage.basic_auth_password = bundle.get(&monitoring_secret_key(&stage.name)).cloned().unwrap_or_default();
    }
}

fn persist_monitoring_secrets(config: &Config) -> Result<(), String> {
    let mut bundle = load_secret_bundle();
    for stage in &config.monitoring_stages {
        bundle.insert(monitoring_secret_key(&stage.name), stage.basic_auth_password.clone());
    }
    save_secret_bundle(&bundle)
}

/// Strips each stage's password from the JSON before it's written to
/// config.json, mirroring the SECRET_KEYS removal below but nested one level
/// into the monitoring_stages array.
fn strip_monitoring_secrets(value: &mut serde_json::Value) {
    if let Some(stages) = value.get_mut("monitoring_stages").and_then(|v| v.as_array_mut()) {
        for stage in stages.iter_mut() {
            if let Some(obj) = stage.as_object_mut() {
                obj.remove("basic_auth_password");
            }
        }
    }
}

fn items_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("items.json")
}

fn config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("config.json")
}

fn last_seen_feature_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("last_seen_feature.json")
}

fn load(app: &AppHandle) -> Vec<Item> {
    let path = items_path(app);
    if !path.exists() {
        return vec![];
    }
    let raw = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save(app: &AppHandle, items: &[Item]) {
    let path = items_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(items).expect("serialization failed");
    fs::write(&path, json).expect("write failed");
}

fn load_config(app: &AppHandle) -> Config {
    let path = config_path(app);
    let value: serde_json::Value = if path.exists() {
        let raw = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let bundle = load_secret_bundle();
    let mut config: Config = serde_json::from_value(value).unwrap_or_default();
    hydrate_secrets(&mut config, &bundle);
    hydrate_monitoring_secrets(&mut config, &bundle);
    config
}

fn write_config(app: &AppHandle, config: &Config) -> Result<(), String> {
    persist_secrets(config)?;
    persist_monitoring_secrets(config)?;
    let path = config_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let mut value = serde_json::to_value(config).expect("serialization failed");
    if let serde_json::Value::Object(map) = &mut value {
        // exclude secrets when writing config file as they are stored in the OS keychain
        for key in SECRET_KEYS {
            map.remove(*key);
        }
    }
    strip_monitoring_secrets(&mut value);
    let json = serde_json::to_string_pretty(&value).expect("serialization failed");
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn apply_badge(app: &AppHandle, open_count: usize) {
    let title = if open_count > 0 {
        format!("Attention ({})", open_count)
    } else {
        "Attention".to_string()
    };
    if let Some(window) = app.get_webview_window("main") {
        window.set_title(&title).ok();
        let badge_count = if open_count > 0 { Some(open_count as i64) } else { None };
        window.set_badge_count(badge_count).ok();
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(title.as_str())).ok();
    }
}

// The open-item count driving the badge excludes muted sources, which is Angular's
// business logic (SourcesService), so Angular computes the count and pushes it here
// rather than Rust re-deriving it from the raw item list.
#[tauri::command]
pub fn set_badge_count(app: AppHandle, count: usize) {
    apply_badge(&app, count);
}

#[tauri::command]
pub fn get_items(app: AppHandle) -> Vec<Item> {
    load(&app)
}

#[tauri::command]
pub fn create_item(app: AppHandle, item: Item) -> Result<Vec<Item>, String> {
    let mut items = load(&app);
    // Reject id collisions rather than upserting: a sync pass (or any caller) may
    // hand us an id that already exists on disk, and blindly overwriting the
    // existing row here could silently clobber user state (e.g. an open item's
    // state or due date) that create_item has no business touching. Surface the
    // collision as an error instead so the caller can decide what to do.
    if items.iter().any(|i| i.id == item.id) {
        return Err(format!("an item with id {} already exists", item.id));
    }
    items.push(item);
    save(&app, &items);
    Ok(items)
}

#[tauri::command]
pub fn update_item(app: AppHandle, item: Item) -> Vec<Item> {
    let mut items = load(&app);
    if let Some(pos) = items.iter().position(|i| i.id == item.id) {
        items[pos] = item;
    }
    save(&app, &items);
    items
}

#[tauri::command]
pub fn delete_item(app: AppHandle, id: String) -> Vec<Item> {
    let mut items = load(&app);
    items.retain(|i| i.id != id);
    save(&app, &items);
    items
}

/// Id of the last "What's new" feature the user has acknowledged, if any.
#[tauri::command]
pub fn get_last_seen_feature(app: AppHandle) -> Option<String> {
    let raw = fs::read_to_string(last_seen_feature_path(&app)).ok()?;
    serde_json::from_str(&raw).ok()
}

#[tauri::command]
pub fn set_last_seen_feature(app: AppHandle, id: String) -> Result<(), String> {
    let path = last_seen_feature_path(&app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string(&id).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_config(app: AppHandle) -> Config {
    load_config(&app)
}

#[tauri::command]
pub fn set_config(app: AppHandle, config: Config) -> Result<(), String> {
    write_config(&app, &config)
}

#[tauri::command]
pub async fn http_request(
    url: String,
    method: String,
    headers: Vec<(String, String)>,
    body: Option<String>,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("unsupported method: {}", method)),
    };
    for (key, value) in headers {
        req = req.header(key, value);
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{}: {}", status, text));
    }
    resp.text().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_in_terminal(command: String, working_dir: String) -> Result<(), String> {
    run_in_terminal_impl(command, working_dir)
}

#[cfg(target_os = "macos")]
fn run_in_terminal_impl(command: String, working_dir: String) -> Result<(), String> {
    let escaped_dir = working_dir.replace('\'', "'\\''");
    let escaped_cmd = command.replace('"', "\\\"");
    let script = format!(
        "tell application \"Terminal\" to do script \"cd '{escaped_dir}' && {escaped_cmd}\""
    );
    std::process::Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn run_in_terminal_impl(command: String, working_dir: String) -> Result<(), String> {
    let escaped_dir = working_dir.replace('\'', "'\\''");
    let inner = format!("cd '{}' && {}; exec bash", escaped_dir, command);

    if std::process::Command::new("gnome-terminal")
        .args(["--", "bash", "-c", &inner])
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    if std::process::Command::new("xterm")
        .args(["-e", &format!("bash -c '{}'", inner.replace('\'', "'\\''"))])
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    if std::process::Command::new("konsole")
        .args(["--noclose", "-e", "bash", "-c", &inner])
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    Err("no supported terminal emulator found (tried: gnome-terminal, xterm, konsole)".to_string())
}

#[cfg(target_os = "windows")]
fn run_in_terminal_impl(command: String, working_dir: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "cmd", "/k", &format!("cd /d \"{}\" && {}", working_dir, command)])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn run_in_terminal_impl(_command: String, _working_dir: String) -> Result<(), String> {
    Err("run_in_terminal is not supported on this platform".to_string())
}

#[tauri::command]
pub async fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_stage_login(app: AppHandle, stage_name: String, sso_login_url: String) -> Result<(), String> {
    let label = login_window_label(&stage_name);
    let url = url::Url::parse(&sso_login_url).map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window(&label) {
        window.navigate(url).map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else {
        // Registered once, for this window's whole lifetime — fires for every navigation on
        // it (SSO login, tenant-select, grid-fetch alike), so it just routes each Finished
        // event to whichever `page_load_waiters` entry is currently pending for this label;
        // if none is pending (e.g. during interactive SSO login) it's a harmless no-op.
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(url))
            .title(format!("Log in — {stage_name}"))
            .inner_size(900.0, 700.0)
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let label = window.label().to_string();
                    let state = window.state::<MonitoringState>();
                    let waiter = state.page_load_waiters.lock().unwrap().remove(&label);
                    if let Some(tx) = waiter {
                        let _ = tx.send(());
                    }
                }
            })
            .build()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn confirm_stage_login(app: AppHandle, stage_name: String) -> Result<(), String> {
    let label = login_window_label(&stage_name);
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Runs inside the hidden per-stage login webview via `eval()`, once per tenant group,
/// after the grid-URL navigation has finished loading. Compares the final URL against the
/// grid URL it was told to navigate to (a mismatch means the session got redirected
/// elsewhere — almost certainly bounced to SSO login — so it's reported as a session
/// expiry and the whole batch aborts); otherwise it JSON-parses the page body and reports
/// the parsed data (or a parse failure as a non-fatal per-tenant-group error). `expectedUrl`
/// is re-parsed via `new URL()` before comparing rather than compared as a raw string —
/// `window.location.href` always reports a lowercased host per the URL spec, so a tenant
/// group match code with uppercase letters (e.g. "AL") substituted verbatim into the
/// hostname would otherwise always look like a mismatch even on a perfectly healthy session.
/// Reports back via the same `report_grid_result` command as before, one call per tenant group.
const EXTRACT_GRID_RESULT_SCRIPT_TEMPLATE: &str = r#"(function() {
    var params = __PARAMS_JSON__;
    if (window.location.href !== new URL(params.expectedUrl).href) {
        window.__TAURI__.core.invoke('report_grid_result', {
            requestId: params.requestId,
            result: {
                tenant_group: params.tenantGroup,
                ok: false,
                error: 'redirected away from expected URL (session likely expired): actual=' + window.location.href + ' expected=' + params.expectedUrl,
                url_mismatch: true,
            },
        });
        return;
    }
    try {
        var data = JSON.parse(document.body.textContent);
        window.__TAURI__.core.invoke('report_grid_result', {
            requestId: params.requestId,
            result: {
                tenant_group: params.tenantGroup,
                ok: true,
                data: Array.isArray(data) ? data : [data],
                url_mismatch: false,
            },
        });
    } catch (e) {
        var bodyPreview = String(document.body.textContent || '').slice(0, 200);
        window.__TAURI__.core.invoke('report_grid_result', {
            requestId: params.requestId,
            result: {
                tenant_group: params.tenantGroup,
                ok: false,
                error: String(e && e.message || e) + ' — body: ' + bodyPreview,
                url_mismatch: false,
            },
        });
    }
})();"#;

fn build_extract_script(request_id: &str, tenant_group: &str, expected_url: &str) -> Result<String, String> {
    // Substituted via one combined JSON payload, not sequential per-field .replace() calls
    // (which would risk an externally-sourced tenant group name matching another
    // placeholder token and getting double-substituted) — same hazard-avoidance as the
    // previous script builder.
    let params = serde_json::json!({
        "requestId": request_id,
        "tenantGroup": tenant_group,
        "expectedUrl": expected_url,
    });
    let params_json = serde_json::to_string(&params).map_err(|e| e.to_string())?;
    Ok(EXTRACT_GRID_RESULT_SCRIPT_TEMPLATE.replace("__PARAMS_JSON__", &params_json))
}

async fn navigate_and_await_load(
    window: &tauri::WebviewWindow,
    monitoring: &MonitoringState,
    label: &str,
    url: url::Url,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    monitoring.page_load_waiters.lock().unwrap().insert(label.to_string(), tx);
    window.navigate(url).map_err(|e| e.to_string())?;
    match tokio::time::timeout(NAVIGATION_TIMEOUT, rx).await {
        Ok(_) => Ok(()),
        Err(_) => {
            monitoring.page_load_waiters.lock().unwrap().remove(label);
            Err("navigation timed out".to_string())
        }
    }
}

async fn extract_grid_result(
    window: &tauri::WebviewWindow,
    monitoring: &MonitoringState,
    request_id: &str,
    tenant_group: &str,
    expected_url: &str,
) -> Result<TenantGridResult, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    monitoring.grid_result_waiters.lock().unwrap().insert(request_id.to_string(), (tenant_group.to_string(), tx));
    let script = match build_extract_script(request_id, tenant_group, expected_url) {
        Ok(s) => s,
        Err(e) => {
            monitoring.grid_result_waiters.lock().unwrap().remove(request_id);
            return Err(e);
        }
    };
    if let Err(e) = window.eval(&script) {
        monitoring.grid_result_waiters.lock().unwrap().remove(request_id);
        return Err(e.to_string());
    }
    match tokio::time::timeout(NAVIGATION_TIMEOUT, rx).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(_)) => Err("response channel closed unexpectedly".to_string()),
        Err(_) => {
            monitoring.grid_result_waiters.lock().unwrap().remove(request_id);
            Err("timed out waiting for grid extraction result".to_string())
        }
    }
}

async fn fetch_one_tenant_group(
    window: &tauri::WebviewWindow,
    monitoring: &MonitoringState,
    label: &str,
    request_id: &str,
    tenant_group: &str,
    tenant_host_template: &str,
    grid_path: &str,
) -> TenantGridResult {
    let failure = |error: String| TenantGridResult {
        tenant_group: tenant_group.to_string(),
        ok: false,
        data: None,
        error: Some(error),
        url_mismatch: false,
    };

    let host = tenant_group_host(tenant_host_template, tenant_group);
    let encoded_group = percent_encoding::utf8_percent_encode(tenant_group, URI_COMPONENT_ENCODE_SET);
    let select_url_str = format!("{host}/crossng-datahub/open/tenantgrp/{encoded_group}");
    let grid_url_str = format!("{host}{grid_path}");

    let select_url = match url::Url::parse(&select_url_str) {
        Ok(u) => u,
        Err(e) => return failure(e.to_string()),
    };
    if let Err(e) = navigate_and_await_load(window, monitoring, label, select_url).await {
        return failure(format!("tenant-select {e}"));
    }

    let grid_url = match url::Url::parse(&grid_url_str) {
        Ok(u) => u,
        Err(e) => return failure(e.to_string()),
    };
    if let Err(e) = navigate_and_await_load(window, monitoring, label, grid_url).await {
        return failure(format!("grid-fetch {e}"));
    }

    match extract_grid_result(window, monitoring, request_id, tenant_group, &grid_url_str).await {
        Ok(result) => result,
        Err(e) => failure(e),
    }
}

#[derive(Debug, Clone, Serialize)]
struct GridProgressPayload {
    request_id: String,
    done: usize,
    total: usize,
    result: TenantGridResult,
}

#[derive(Debug, Clone, Serialize)]
struct GridDonePayload {
    request_id: String,
    session_expired: bool,
    cancelled: bool,
}

#[tauri::command]
pub async fn fetch_grid_data(
    app: AppHandle,
    state: tauri::State<'_, MonitoringState>,
    stage_name: String,
    tenant_host_template: String,
    grid_path: String,
    tenant_groups: Vec<String>,
    request_id: String,
) -> Result<Vec<TenantGridResult>, String> {
    let label = login_window_label(&stage_name);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("stage {stage_name} is not logged in"))?;

    let total = tenant_groups.len();
    let mut results: Vec<TenantGridResult> = Vec::with_capacity(total);
    let mut session_expired = false;
    let mut cancelled = false;

    for (index, tenant_group) in tenant_groups.iter().enumerate() {
        if state.cancelled.lock().unwrap().contains(&request_id) {
            cancelled = true;
            break;
        }

        let result = fetch_one_tenant_group(
            &window, &state, &label, &request_id, tenant_group, &tenant_host_template, &grid_path,
        ).await;

        let is_mismatch = result.url_mismatch;
        results.push(result.clone());
        let _ = app.emit("monitoring://grid-progress", GridProgressPayload {
            request_id: request_id.clone(),
            done: index + 1,
            total,
            result,
        });

        if is_mismatch {
            session_expired = true;
            break;
        }
    }

    state.cancelled.lock().unwrap().remove(&request_id);
    let _ = app.emit("monitoring://grid-done", GridDonePayload {
        request_id: request_id.clone(),
        session_expired,
        cancelled,
    });
    Ok(results)
}

#[tauri::command]
pub fn report_grid_result(
    state: tauri::State<'_, MonitoringState>,
    request_id: String,
    result: TenantGridResult,
) -> Result<(), String> {
    let mut waiters = state.grid_result_waiters.lock().unwrap();
    // Same late-arrival guard as the on_page_load callback above: only resolve if the
    // reported tenant_group matches what this request_id's waiter was registered for.
    let matches = waiters.get(&request_id).is_some_and(|(expected_tenant_group, _)| *expected_tenant_group == result.tenant_group);
    if matches {
        if let Some((_, tx)) = waiters.remove(&request_id) {
            let _ = tx.send(result);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_grid_fetch(state: tauri::State<'_, MonitoringState>, request_id: String) -> Result<(), String> {
    state.cancelled.lock().unwrap().insert(request_id);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct DockerServiceStatus {
    pub service: String,
    /// One of "running" (every container for this service is running), "partial" (some but
    /// not all are), "not created" (the service has no containers yet — e.g. never started),
    /// or a docker-reported container state ("exited", "restarting", "paused", ...) when every
    /// container agrees on a single non-running state.
    pub state: String,
    /// Aggregated Docker healthcheck status ("healthy", "unhealthy", "starting"), or `None` if no
    /// container for this service defines a healthcheck.
    pub health: Option<String>,
}

/// Builds `docker compose -f <compose_path> <args>` as a `Command`, without running it —
/// shared by `run_compose` (buffered output, for list/status) and the streaming docker actions
/// (`docker_service_action`/`docker_pull_start`'s default path) below, so the "no compose file
/// configured" check and argv construction aren't duplicated between the two output-handling
/// strategies.
fn compose_command(compose_path: &str, args: &[&str]) -> Result<tokio::process::Command, String> {
    if compose_path.trim().is_empty() {
        return Err("no docker-compose.yaml configured — set its path in Settings".to_string());
    }
    let (docker, path_env) = docker_runtime();
    let mut cmd = tokio::process::Command::new(docker);
    if let Some(path_env) = path_env {
        // Also needed by docker itself: it execs `docker-credential-*` helpers via `PATH`.
        cmd.env("PATH", path_env);
    }
    cmd.args(["compose", "-f", compose_path]).args(args);
    Ok(cmd)
}

/// Directories where Docker CLIs commonly live but which a GUI-launched (Dock/Finder/desktop
/// entry/AppImage) process doesn't have on its `PATH` — unlike a dev run from a terminal, which
/// inherits the shell's. Without these, spawning plain `docker` fails with ENOENT.
fn docker_extra_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from);
    if cfg!(windows) {
        for var in ["ProgramFiles", "ProgramW6432"] {
            if let Some(pf) = std::env::var_os(var) {
                dirs.push(PathBuf::from(pf).join("Docker").join("Docker").join("resources").join("bin"));
            }
        }
        dirs.push(PathBuf::from(r"C:\Program Files\Docker\Docker\resources\bin"));
        if let Some(home) = &home {
            dirs.push(home.join(".rd").join("bin")); // Rancher Desktop
        }
    } else {
        for d in [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/usr/bin",
            "/bin",
            "/snap/bin",
            "/Applications/Docker.app/Contents/Resources/bin",
            "/Applications/OrbStack.app/Contents/MacOS/xbin",
        ] {
            dirs.push(PathBuf::from(d));
        }
        if let Some(home) = &home {
            for d in [".docker/bin", ".rd/bin", ".orbstack/bin", ".local/bin"] {
                dirs.push(home.join(d));
            }
        }
    }
    dirs
}

/// Resolves the `docker` executable and an augmented `PATH` (inherited entries first, then the
/// well-known Docker locations from `docker_extra_dirs`). Computed once. Falls back to the bare
/// name `"docker"` if nothing is found, so the usual "failed to run docker" error still surfaces.
fn docker_runtime() -> (PathBuf, Option<std::ffi::OsString>) {
    static RUNTIME: std::sync::OnceLock<(PathBuf, Option<std::ffi::OsString>)> =
        std::sync::OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
                .map(|p| std::env::split_paths(&p).collect())
                .unwrap_or_default();
            for d in docker_extra_dirs() {
                if !dirs.contains(&d) {
                    dirs.push(d);
                }
            }
            let exe = if cfg!(windows) { "docker.exe" } else { "docker" };
            let found = dirs.iter().map(|d| d.join(exe)).find(|p| p.is_file());
            let path_env = std::env::join_paths(&dirs).ok();
            (found.unwrap_or_else(|| PathBuf::from("docker")), path_env)
        })
        .clone()
}

/// Runs `docker compose -f <compose_path> <args>` to completion and returns its full stdout,
/// shelling out to the `docker` CLI (mirroring the rest of this backend's "thin proxy" style —
/// no Docker Engine API client dependency). Async/`tokio::process` rather than `std::process`,
/// since `pull`/`up` can take a while and this must not block a worker thread for that long.
/// Used only by `docker_list_services`/`docker_service_status`, whose stdout is parsed data
/// rather than a log — the docker actions with log-worthy output use `stream_command` instead.
async fn run_compose(compose_path: &str, args: &[&str]) -> Result<String, String> {
    let output = compose_command(compose_path, args)?
        .output()
        .await
        .map_err(|e| format!("failed to run docker: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("docker compose exited with {}", output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[tauri::command]
pub async fn docker_list_services(compose_path: String) -> Result<Vec<String>, String> {
    // `config --services` asks compose's own parser for the resolved service list (handles
    // anchors/extends/includes/env interpolation correctly) rather than this app parsing the
    // YAML itself, so a new YAML dependency isn't needed.
    let out = run_compose(&compose_path, &["config", "--services"]).await?;
    Ok(out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

fn record_container_state(
    states: &mut HashMap<String, Vec<String>>,
    healths: &mut HashMap<String, Vec<String>>,
    item: &serde_json::Value,
) {
    let service = item.get("Service").and_then(|v| v.as_str()).unwrap_or_default();
    if service.is_empty() {
        return;
    }
    let state = item.get("State").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
    states.entry(service.to_string()).or_default().push(state);
    let health = item.get("Health").and_then(|v| v.as_str()).unwrap_or_default();
    if !health.is_empty() {
        healths.entry(service.to_string()).or_default().push(health.to_string());
    }
}

/// `None` if no container in the service defines a healthcheck; otherwise "unhealthy" wins over
/// "starting" which wins over "healthy", mirroring how a single bad container should dominate the
/// displayed status.
fn aggregate_health(container_healths: &[String]) -> Option<String> {
    if container_healths.is_empty() {
        return None;
    }
    if container_healths.iter().any(|h| h == "unhealthy") {
        return Some("unhealthy".to_string());
    }
    if container_healths.iter().any(|h| h == "starting") {
        return Some("starting".to_string());
    }
    Some("healthy".to_string())
}

fn aggregate_state(container_states: &[String]) -> String {
    if container_states.is_empty() {
        return "not created".to_string();
    }
    if container_states.iter().all(|s| s == "running") {
        return "running".to_string();
    }
    if container_states.iter().any(|s| s == "running") {
        return "partial".to_string();
    }
    container_states[0].clone()
}

#[tauri::command]
pub async fn docker_service_status(compose_path: String) -> Result<Vec<DockerServiceStatus>, String> {
    // `docker compose ps --format json` prints one JSON object per line (NDJSON) on current
    // Docker CLI versions, but older/other versions print a single JSON array — handle both.
    // A service with no containers at all (never started) simply has no line and is left out;
    // the frontend treats a missing service as "not created".
    let out = run_compose(&compose_path, &["ps", "-a", "--format", "json"]).await?;
    let mut states: HashMap<String, Vec<String>> = HashMap::new();
    let mut healths: HashMap<String, Vec<String>> = HashMap::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(line) {
            for item in &items {
                record_container_state(&mut states, &mut healths, item);
            }
        } else if let Ok(item) = serde_json::from_str::<serde_json::Value>(line) {
            record_container_state(&mut states, &mut healths, &item);
        }
    }
    Ok(states
        .into_iter()
        .map(|(service, container_states)| DockerServiceStatus {
            state: aggregate_state(&container_states),
            health: aggregate_health(healths.get(&service).map(Vec::as_slice).unwrap_or_default()),
            service,
        })
        .collect())
}

/// One line of a streaming docker action's stdout/stderr, emitted as a `docker://output` event
/// as the line is produced (see `stream_command`). `operation_id` is generated by the frontend
/// per action invocation, letting `DockerComponent` filter events for the run it's displaying —
/// mirrors the `request_id` pattern `fetch_grid_data`/`monitoring://grid-progress` already use.
#[derive(Debug, Clone, Serialize)]
struct DockerOutputPayload {
    operation_id: String,
    stream: &'static str,
    line: String,
}

/// Spawns `cmd` and emits each stdout/stderr line as a `docker://output` event as it's produced,
/// rather than buffering full output like `run_compose`/`run_shell` — used for the docker actions
/// whose output is worth watching live (stop/restart/pull+start), as opposed to
/// `docker_list_services`/`docker_service_status`, whose stdout is parsed data, not a log.
/// On failure, the error is the last stderr line seen (or the bare exit status if there was
/// none), matching `run_compose`/`run_shell`'s error shape.
async fn stream_command(app: &AppHandle, operation_id: &str, mut cmd: tokio::process::Command) -> Result<(), String> {
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("failed to run command: {e}"))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let mut stdout_lines = tokio::io::BufReader::new(stdout).lines();
    let mut stderr_lines = tokio::io::BufReader::new(stderr).lines();
    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut last_stderr_line: Option<String> = None;

    while !stdout_done || !stderr_done {
        tokio::select! {
            line = stdout_lines.next_line(), if !stdout_done => match line {
                Ok(Some(line)) => {
                    let _ = app.emit("docker://output", DockerOutputPayload {
                        operation_id: operation_id.to_string(),
                        stream: "stdout",
                        line,
                    });
                }
                _ => stdout_done = true,
            },
            line = stderr_lines.next_line(), if !stderr_done => match line {
                Ok(Some(line)) => {
                    let _ = app.emit("docker://output", DockerOutputPayload {
                        operation_id: operation_id.to_string(),
                        stream: "stderr",
                        line: line.clone(),
                    });
                    last_stderr_line = Some(line);
                }
                _ => stderr_done = true,
            },
        }
    }

    let status = child.wait().await.map_err(|e| format!("failed to wait for command: {e}"))?;
    if !status.success() {
        return Err(last_stderr_line.unwrap_or_else(|| format!("command exited with {status}")));
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_service_action(
    app: AppHandle,
    compose_path: String,
    service: String,
    action: String,
    operation_id: String,
) -> Result<(), String> {
    let args: Vec<&str> = match action.as_str() {
        "stop" => vec!["stop", service.as_str()],
        "restart" => vec!["restart", service.as_str()],
        other => return Err(format!("unknown docker action: {other}")),
    };
    let cmd = compose_command(&compose_path, &args)?;
    stream_command(&app, &operation_id, cmd).await
}

/// Builds a shell invocation of an arbitrary command string (as opposed to `compose_command`,
/// which builds a fixed `docker` argv) — needed because the "Pull & Start" custom command is
/// user-supplied text that may itself contain shell operators (e.g. `&&` chaining two
/// `docker compose` calls), not just arguments to a single known binary.
fn shell_command(command: &str) -> Result<tokio::process::Command, String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("empty command".to_string());
    }
    #[cfg(target_os = "windows")]
    let cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.args(["/C", command]);
        c
    };
    #[cfg(not(target_os = "windows"))]
    let cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-c", command]);
        c
    };
    Ok(cmd)
}

/// "Pull & Start" for a single service. With no custom command configured, this is the default
/// two-step `docker compose pull <service>` + `docker compose up -d <service>` (same "thin proxy"
/// shelling-out style as the other docker commands), each streamed under the same `operation_id`
/// so the frontend sees one continuous log. When `command_template` is set (edited in Settings),
/// it's substituted (`{service}`, `{compose_path}`) and run through a shell instead, replacing
/// the default compose invocation entirely — this is what makes the action a user-customizable
/// command rather than a hardcoded one.
#[tauri::command]
pub async fn docker_pull_start(
    app: AppHandle,
    compose_path: String,
    service: String,
    command_template: Option<String>,
    operation_id: String,
) -> Result<(), String> {
    match command_template.as_deref().map(str::trim) {
        Some(template) if !template.is_empty() => {
            let command = template.replace("{service}", &service).replace("{compose_path}", &compose_path);
            let cmd = shell_command(&command)?;
            stream_command(&app, &operation_id, cmd).await?;
        }
        _ => {
            let pull = compose_command(&compose_path, &["pull", service.as_str()])?;
            stream_command(&app, &operation_id, pull).await?;
            let up = compose_command(&compose_path, &["up", "-d", service.as_str()])?;
            stream_command(&app, &operation_id, up).await?;
        }
    }
    Ok(())
}

/// Tracks in-flight `docker compose logs -f` children keyed by the frontend's `operation_id`, so
/// `docker_service_logs_stop` can kill the right one. Unlike `stream_command`'s actions (stop/
/// restart/pull+start), a log-follow child never exits on its own initiative from the frontend's
/// point of view — it only stops when explicitly killed or when the container itself goes away —
/// so it can't reuse `stream_command`'s "spawn, stream until the child exits, return" shape; the
/// command must return as soon as the child is spawned, while the streaming loop keeps running in
/// a detached task.
#[derive(Default)]
pub struct DockerLogsState(tokio::sync::Mutex<HashMap<String, tokio::process::Child>>);

/// Starts `docker compose logs --tail 200 -f <service>`, streaming it as `docker://output` events
/// under `operation_id` exactly like `stream_command`'s output (so `DockerComponent` can reuse the
/// same console drawer/listener for both), but detached: the command returns immediately after
/// spawning rather than awaiting completion, since a follow stream is meant to keep running until
/// `docker_service_logs_stop` is called. The child is tracked in `DockerLogsState` for that stop
/// call to find; once the child exits on its own (e.g. the container stops), the background task
/// removes its own now-dead entry so a later stop() has nothing stale to kill.
#[tauri::command]
pub async fn docker_service_logs_start(
    app: AppHandle,
    state: tauri::State<'_, DockerLogsState>,
    compose_path: String,
    service: String,
    operation_id: String,
) -> Result<(), String> {
    let mut cmd = compose_command(&compose_path, &["logs", "--tail", "200", "-f", service.as_str()])?;
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("failed to run docker: {e}"))?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    state.0.lock().await.insert(operation_id.clone(), child);

    tauri::async_runtime::spawn(async move {
        let mut stdout_lines = tokio::io::BufReader::new(stdout).lines();
        let mut stderr_lines = tokio::io::BufReader::new(stderr).lines();
        let mut stdout_done = false;
        let mut stderr_done = false;

        while !stdout_done || !stderr_done {
            tokio::select! {
                line = stdout_lines.next_line(), if !stdout_done => match line {
                    Ok(Some(line)) => {
                        let _ = app.emit("docker://output", DockerOutputPayload {
                            operation_id: operation_id.clone(),
                            stream: "stdout",
                            line,
                        });
                    }
                    _ => stdout_done = true,
                },
                line = stderr_lines.next_line(), if !stderr_done => match line {
                    Ok(Some(line)) => {
                        let _ = app.emit("docker://output", DockerOutputPayload {
                            operation_id: operation_id.clone(),
                            stream: "stderr",
                            line,
                        });
                    }
                    _ => stderr_done = true,
                },
            }
        }

        app.state::<DockerLogsState>().0.lock().await.remove(&operation_id);
    });

    Ok(())
}

/// Kills the `docker compose logs -f` child tracked under `operation_id`, if still running.
/// A no-op (not an error) when the id is unknown — it may have already exited on its own, or
/// this may be a stale stop from a drawer that's since moved on.
#[tauri::command]
pub async fn docker_service_logs_stop(
    state: tauri::State<'_, DockerLogsState>,
    operation_id: String,
) -> Result<(), String> {
    let child = state.0.lock().await.remove(&operation_id);
    if let Some(mut child) = child {
        let _ = child.kill().await;
    }
    Ok(())
}
