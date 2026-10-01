mod commands;

use commands::{
    cancel_grid_fetch, confirm_stage_login, create_item, delete_item, docker_list_services,
    docker_pull_start, docker_service_action, docker_service_logs_start, docker_service_logs_stop,
    docker_service_status, fetch_grid_data, get_config, get_items, http_request, notify,
    open_stage_login, open_url, report_grid_result, run_in_terminal, set_badge_count, set_config,
    update_item, DockerLogsState, MonitoringState, TRAY_ID,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

/// Restore and focus the main window (used by the tray "Show" action and left-click).
fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            app.manage(MonitoringState::default());
            app.manage(DockerLogsState::default());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let show_i = MenuItem::with_id(app, "show", "Show Attention", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Attention")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                show_main(app);
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    // Hide to tray instead of quitting; the app keeps running so
                    // auto-sync and notifications continue. Quit only via the tray.
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_items,
            create_item,
            update_item,
            delete_item,
            get_config,
            set_config,
            set_badge_count,
            http_request,
            notify,
            open_url,
            run_in_terminal,
            open_stage_login,
            confirm_stage_login,
            fetch_grid_data,
            report_grid_result,
            cancel_grid_fetch,
            docker_list_services,
            docker_service_status,
            docker_service_action,
            docker_pull_start,
            docker_service_logs_start,
            docker_service_logs_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
