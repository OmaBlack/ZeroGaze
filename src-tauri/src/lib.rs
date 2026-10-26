pub mod commands;
pub mod db;
pub mod idle;
pub mod state_machine;
pub mod tray;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::Database;
use crate::state_machine::{AppTrackingState, StateMachine};
use crate::tray::{get_icon_for_state, TRAY_ID};

pub struct AppSharedState {
    pub sm: Arc<Mutex<StateMachine>>,
    pub db: Arc<Mutex<Database>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            // Determine SQLite DB path in app data directory
            let app_data_dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            std::fs::create_dir_all(&app_data_dir).ok();
            let old_db_path = app_data_dir.join("focusgaze.db");
            let db_path = app_data_dir.join("zerogaze.db");
            if old_db_path.exists() && !db_path.exists() {
                let _ = std::fs::rename(&old_db_path, &db_path);
            }

            let database = Database::new(&db_path).expect("Failed to initialize SQLite database");
            let db_arc = Arc::new(Mutex::new(database));

            let sm = StateMachine::new(Arc::clone(&db_arc));
            let sm_arc = Arc::new(Mutex::new(sm));

            app.manage(AppSharedState {
                sm: Arc::clone(&sm_arc),
                db: Arc::clone(&db_arc),
            });

            // Initialize Tray
            let _tray = tray::build_tray(app.handle())?;

            // Background tick loop
            let handle = app.handle().clone();
            let timer_sm = Arc::clone(&sm_arc);
            let timer_db = Arc::clone(&db_arc);

            std::thread::spawn(move || {
                let mut prev_state = AppTrackingState::Initializing;
                let mut prev_paused = false;
                let mut prev_micro_active = false;
                let mut prev_ergo_alert = false;
                let mut tick_counter = 0u64;
                let mut cached_notifs_enabled = true;
                let mut cached_micro_notifs_enabled = true;
                let mut cached_tray_alerts_enabled = true;
                let mut cached_ergo_tray_alerts = true;

                loop {
                    std::thread::sleep(Duration::from_secs(1));

                    let idle_secs = if matches!(
                        prev_state,
                        AppTrackingState::FallbackInputTracking
                            | AppTrackingState::TrackingGrace
                            | AppTrackingState::PausedAway
                    ) {
                        crate::idle::get_idle_seconds()
                    } else {
                        0.0
                    };

                    let (current_state, snapshot) = {
                        if let Ok(mut sm) = timer_sm.lock() {
                            sm.tick_second_with_idle(idle_secs);
                            (sm.state, sm.snapshot())
                        } else {
                            continue;
                        }
                    };

                    // Broadcast snapshot to all open windows
                    let _ = handle.emit("state_change", &snapshot);

                    // Fetch user notification and tray settings with cache (queried once every 10 ticks instead of 1s)
                    if tick_counter % 10 == 0 {
                        if let Ok(db) = timer_db.lock() {
                            cached_notifs_enabled = db.get_setting("notifications_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_micro_notifs_enabled = db.get_setting("micro_break_notifications").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_tray_alerts_enabled = db.get_setting("tray_alerts_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_ergo_tray_alerts = db.get_setting("ergo_tray_alerts").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                        }
                    }
                    tick_counter = tick_counter.wrapping_add(1);

                    let notifs_enabled = cached_notifs_enabled;
                    let micro_notifs_enabled = cached_micro_notifs_enabled;
                    let tray_alerts_enabled = cached_tray_alerts_enabled;
                    let ergo_tray_alerts = cached_ergo_tray_alerts;

                    let current_ergo_alert = snapshot.is_too_close || snapshot.is_slouching;

                    if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                        if !tray_alerts_enabled {
                            let _ = tray.set_title(None::<String>);
                            let _ = tray.set_tooltip(Some(crate::tray::get_tooltip_for_snapshot(&snapshot)));
                        } else if snapshot.is_paused {
                            let _ = tray.set_title(Some("Paused".to_string()));
                            let _ = tray.set_icon(Some(crate::tray::create_colored_icon(234, 179, 8, 255)));
                            let _ = tray.set_tooltip(Some("ZeroGaze: Tracking paused manually"));
                        } else if snapshot.is_micro_break_active {
                            let _ = tray.set_title(Some(format!("👁️ {}s", snapshot.micro_break_seconds_left)));
                            let _ = tray.set_tooltip(Some(format!("ZeroGaze: 20-20-20 Eye Rest active ({}s left)", snapshot.micro_break_seconds_left)));
                        } else if current_state == AppTrackingState::BreakPrompt {
                            let _ = tray.set_title(Some("⚠️ Break!".to_string()));
                            let _ = tray.set_tooltip(Some("ZeroGaze Alert: Break interval reached! Time to rest."));
                        } else if current_state == AppTrackingState::BreakMode {
                            let break_rem = snapshot.break_interval_seconds.saturating_sub(snapshot.break_seconds_elapsed);
                            let break_mins = (break_rem + 59) / 60;
                            let _ = tray.set_title(Some(format!("Break {}m", break_mins)));
                            let _ = tray.set_tooltip(Some("ZeroGaze: Break mode in progress."));
                        } else if current_state == AppTrackingState::TrackingActive {
                            if ergo_tray_alerts && current_ergo_alert {
                                if snapshot.is_too_close && snapshot.is_slouching {
                                    let _ = tray.set_title(Some("⚠️ Posture!".to_string()));
                                    let _ = tray.set_tooltip(Some("ZeroGaze Alert: Sitting too close (<45cm) & slouching detected."));
                                } else if snapshot.is_too_close {
                                    let _ = tray.set_title(Some("⚠️ Move Back!".to_string()));
                                    let _ = tray.set_tooltip(Some("ZeroGaze Alert: Sitting too close to screen (<45cm). Move back to 50–70cm."));
                                } else {
                                    let _ = tray.set_title(Some("⚠️ Sit Up!".to_string()));
                                    let _ = tray.set_tooltip(Some("ZeroGaze Alert: Poor desk posture. Lift chest and align neck."));
                                }
                            } else {
                                let remaining = snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds);
                                let mins_left = (remaining + 59) / 60;
                                let _ = tray.set_title(Some(format!("{}m", mins_left)));
                                let _ = tray.set_tooltip(Some(crate::tray::get_tooltip_for_snapshot(&snapshot)));
                            }
                        } else {
                            let _ = tray.set_title(None::<String>);
                            let _ = tray.set_tooltip(Some(crate::tray::get_tooltip_for_snapshot(&snapshot)));
                        }
                    }

                    // Rebuild tray menu and update icon on state, pause, micro-break, or ergo alert change
                    if current_state != prev_state
                        || snapshot.is_paused != prev_paused
                        || snapshot.is_micro_break_active != prev_micro_active
                        || current_ergo_alert != prev_ergo_alert
                    {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            if !snapshot.is_paused {
                                let icon = get_icon_for_state(current_state);
                                let _ = tray.set_icon(Some(icon));
                            }
                            if let Ok(new_menu) = crate::tray::create_tray_menu(&handle, &snapshot) {
                                let _ = tray.set_menu(Some(new_menu));
                            }
                        }
                    }

                    // Dispatch notifications if enabled and not suppressed by DND
                    if notifs_enabled && !snapshot.is_dnd_active {
                        // Break prompt notification
                        if current_state == AppTrackingState::BreakPrompt && prev_state != AppTrackingState::BreakPrompt {
                            let _ = handle.notification()
                                .builder()
                                .title("ZeroGaze: Time for a Break!")
                                .body("You've completed your focus session. Step away, stretch, and rest your eyes.")
                                .show();
                        }

                        // 20-20-20 micro-break notification
                        if snapshot.is_micro_break_active && !prev_micro_active && micro_notifs_enabled {
                            let _ = handle.notification()
                                .builder()
                                .title("ZeroGaze: 20-20-20 Eye Rest")
                                .body("Look at an object at least 20 feet away for 20 seconds to relax your eyes.")
                                .show();
                        }

                        // Break completed notification
                        if prev_state == AppTrackingState::BreakMode
                            && current_state != AppTrackingState::BreakMode
                            && current_state != AppTrackingState::BreakPrompt
                        {
                            let _ = handle.notification()
                                .builder()
                                .title("ZeroGaze: Break Completed")
                                .body("Great job taking a break! Ready for your next focus session.")
                                .show();
                        }
                    }

                    prev_state = current_state;
                    prev_paused = snapshot.is_paused;
                    prev_micro_active = snapshot.is_micro_break_active;
                    prev_ergo_alert = current_ergo_alert;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::update_presence,
            commands::report_camera_error,
            commands::get_state,
            commands::get_settings,
            commands::update_setting,
            commands::take_break_now,
            commands::start_break,
            commands::snooze_break,
            commands::skip_break,
            commands::complete_break,
            commands::toggle_tracking,
            commands::delete_all_data,
            commands::get_today_stats,
            commands::export_data_json,
            commands::export_data_csv,
            commands::dismiss_micro_break,
            commands::set_dnd_mode,
            commands::get_recent_stats,
            commands::get_recent_sessions,
            commands::check_os_presentation_mode,
            commands::wrap_up_break,
            commands::import_data_json,
            commands::lock_workstation,
            commands::send_test_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
