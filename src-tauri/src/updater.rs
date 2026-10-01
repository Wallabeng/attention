use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

/// Ask the user a yes/no question via a native dialog.
async fn confirm(app: &AppHandle, title: &str, message: String, ok: &str, cancel: &str) -> bool {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(title)
        .buttons(MessageDialogButtons::OkCancelCustom(ok.into(), cancel.into()))
        .show(move |answer| {
            let _ = tx.send(answer);
        });
    rx.await.unwrap_or(false)
}

/// Check GitHub Releases for a newer version and, if the user agrees, download,
/// verify (signature), install and restart. `interactive` additionally reports
/// "up to date" / errors; the silent startup check only speaks up when an update exists.
pub async fn check_for_updates(app: AppHandle, interactive: bool) {
    let info = |msg: String| {
        let app = app.clone();
        async move {
            let (tx, rx) = tokio::sync::oneshot::channel();
            app.dialog()
                .message(msg)
                .title("Attention")
                .show(move |_| {
                    let _ = tx.send(());
                });
            let _ = rx.await;
        }
    };

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            log::warn!("updater unavailable: {e}");
            if interactive {
                info(format!("Update check failed: {e}")).await;
            }
            return;
        }
    };

    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => {
            if interactive {
                info("You're running the latest version.".into()).await;
            }
            return;
        }
        Err(e) => {
            log::warn!("update check failed: {e}");
            if interactive {
                info(format!("Update check failed: {e}")).await;
            }
            return;
        }
    };

    let msg = format!(
        "Version {} is available (you have {}). Install it now? The app will restart.",
        update.version, update.current_version
    );
    if !confirm(&app, "Update available", msg, "Update", "Later").await {
        return;
    }

    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => app.restart(),
        Err(e) => {
            log::error!("update install failed: {e}");
            info(format!("Update failed: {e}")).await;
        }
    }
}
