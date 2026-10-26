use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::state_machine::{AppTrackingState, StateSnapshot};
use crate::AppSharedState;

pub const TRAY_ID: &str = "zerogaze-tray";

pub fn create_colored_icon(r: u8, g: u8, b: u8, a: u8) -> Image<'static> {
    let size: u32 = 18;
    let mut rgba = Vec::with_capacity((size * size * 4) as usize);
    let center = size as f32 / 2.0;
    let radius = center - 2.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5 - center;
            let dy = y as f32 + 0.5 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist <= radius {
                rgba.extend_from_slice(&[r, g, b, a]);
            } else if dist <= radius + 1.0 {
                let alpha = (a as f32 * (1.0 - (dist - radius))).max(0.0) as u8;
                rgba.extend_from_slice(&[r, g, b, alpha]);
            } else {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
            }
        }
    }

    Image::new_owned(rgba, size, size)
}

pub fn get_icon_for_state(state: AppTrackingState) -> Image<'static> {
    match state {
        AppTrackingState::TrackingActive => create_colored_icon(34, 197, 94, 255), // Green
        AppTrackingState::TrackingGrace | AppTrackingState::PausedAway => {
            create_colored_icon(234, 179, 8, 255) // Yellow
        }
        AppTrackingState::BreakPrompt => create_colored_icon(239, 68, 68, 255), // Red
        AppTrackingState::BreakMode => create_colored_icon(59, 130, 246, 255), // Blue
        _ => create_colored_icon(156, 163, 175, 255),                         // Grey
    }
}

pub fn get_tooltip_for_state(state: AppTrackingState) -> String {
    match state {
        AppTrackingState::TrackingActive => {
            "ZeroGaze: Tracking active (Camera is on locally. No images stored).".to_string()
        }
        AppTrackingState::TrackingGrace => "ZeroGaze: User absent (Grace period active)".to_string(),
        AppTrackingState::PausedAway => "ZeroGaze: Paused (User away)".to_string(),
        AppTrackingState::BreakPrompt => "ZeroGaze: Break interval reached! Time to rest.".to_string(),
        AppTrackingState::BreakMode => "ZeroGaze: Break mode in progress.".to_string(),
        AppTrackingState::FallbackInputTracking => {
            "ZeroGaze: Input fallback active (Idle tracking via keyboard/mouse).".to_string()
        }
        _ => "ZeroGaze: Initializing / Ready".to_string(),
    }
}

pub fn get_tooltip_for_snapshot(snapshot: &StateSnapshot) -> String {
    if snapshot.is_paused {
        return "ZeroGaze: Tracking paused manually".to_string();
    }
    if snapshot.is_micro_break_active {
        return format!(
            "ZeroGaze: 20-20-20 Eye Rest active ({}s left)",
            snapshot.micro_break_seconds_left
        );
    }
    if snapshot.state == AppTrackingState::BreakPrompt {
        return "ZeroGaze Alert: Break interval reached! Time to rest eyes and stretch.".to_string();
    }
    if snapshot.state == AppTrackingState::BreakMode {
        return "ZeroGaze: Break mode in progress.".to_string();
    }
    if snapshot.state == AppTrackingState::TrackingActive {
        if snapshot.is_too_close && snapshot.is_slouching {
            return "ZeroGaze Alert: Sitting too close (<45cm) and slouching detected.".to_string();
        } else if snapshot.is_too_close {
            return "ZeroGaze Alert: Sitting too close to screen (<45cm). Move back to 50–70cm.".to_string();
        } else if snapshot.is_slouching {
            return "ZeroGaze Alert: Poor desk posture. Lift chest and align neck.".to_string();
        }
        return "ZeroGaze: Tracking active (Camera is on locally. No images stored).".to_string();
    }
    get_tooltip_for_state(snapshot.state)
}

pub fn create_tray_menu<R: Runtime>(app: &AppHandle<R>, snapshot: &StateSnapshot) -> Result<Menu<R>, tauri::Error> {
    let status_text = if snapshot.is_paused {
        "ZeroGaze: Paused".to_string()
    } else if snapshot.state == AppTrackingState::BreakPrompt {
        "ZeroGaze: ⚠️ Break Due!".to_string()
    } else if snapshot.state == AppTrackingState::BreakMode {
        let break_rem = (snapshot.break_interval_seconds.saturating_sub(snapshot.break_seconds_elapsed) + 59) / 60;
        format!("ZeroGaze: ☕ Rest ({}m left)", break_rem)
    } else if snapshot.is_micro_break_active {
        format!("ZeroGaze: 👁️ 20-20-20 Rest ({}s)", snapshot.micro_break_seconds_left)
    } else if snapshot.state == AppTrackingState::TrackingActive {
        if snapshot.is_too_close && snapshot.is_slouching {
            "ZeroGaze: ⚠️ Too Close & Slouching".to_string()
        } else if snapshot.is_too_close {
            "ZeroGaze: ⚠️ Move Back (<45cm)".to_string()
        } else if snapshot.is_slouching {
            "ZeroGaze: ⚠️ Slouching Detected".to_string()
        } else {
            let mins_left = (snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds) + 59) / 60;
            format!("ZeroGaze: 🟢 Focus ({}m left)", mins_left)
        }
    } else {
        "ZeroGaze: Ready / Away".to_string()
    };

    let status_item = MenuItemBuilder::with_id("status", status_text)
        .enabled(false)
        .build(app)?;
    let dashboard_item = MenuItemBuilder::with_id("dashboard", "Open Dashboard").build(app)?;
    let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;

    let toggle_label = if snapshot.is_paused {
        "Resume Tracking"
    } else {
        "Pause Tracking"
    };
    let toggle_item = MenuItemBuilder::with_id("toggle", toggle_label).build(app)?;

    let privacy_item = MenuItemBuilder::with_id("privacy", "Privacy Explainer").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "Quit ZeroGaze").build(app)?;

    let separator1 = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let separator3 = PredefinedMenuItem::separator(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&status_item)
        .item(&separator1)
        .item(&dashboard_item)
        .item(&settings_item)
        .item(&separator2);

    if snapshot.state == AppTrackingState::BreakPrompt {
        let start_break_item = MenuItemBuilder::with_id("start_break", "Start Break Now").build(app)?;
        let snooze_item = MenuItemBuilder::with_id("snooze_break", "Snooze (5m)").build(app)?;
        let skip_item = MenuItemBuilder::with_id("skip_break", "Skip Break").build(app)?;
        builder = builder.item(&start_break_item).item(&snooze_item).item(&skip_item);
    } else if snapshot.state == AppTrackingState::BreakMode {
        let complete_break_item = MenuItemBuilder::with_id("complete_break", "Complete Break Early").build(app)?;
        builder = builder.item(&complete_break_item);
    } else if snapshot.is_micro_break_active {
        let dismiss_micro_item = MenuItemBuilder::with_id("dismiss_micro", "Dismiss 20s Rest").build(app)?;
        let break_now_item = MenuItemBuilder::with_id("break_now", "Take Full Break Now").build(app)?;
        builder = builder.item(&dismiss_micro_item).item(&break_now_item);
    } else {
        if snapshot.is_too_close || snapshot.is_slouching {
            let recalibrate_item = MenuItemBuilder::with_id("recalibrate_posture", "Recalibrate Baseline Posture").build(app)?;
            builder = builder.item(&recalibrate_item);
        }
        let break_now_item = MenuItemBuilder::with_id("break_now", "Take Break Now").build(app)?;
        builder = builder.item(&break_now_item);
    }

    builder = builder.item(&toggle_item).item(&separator3).item(&privacy_item).item(&quit_item);
    builder.build()
}

pub fn build_tray(app: &AppHandle) -> Result<TrayIcon, tauri::Error> {
    let icon = get_icon_for_state(AppTrackingState::Initializing);

    let state = app.state::<AppSharedState>();
    let initial_snapshot = if let Ok(sm) = state.sm.lock() {
        sm.snapshot()
    } else {
        // Fallback dummy snapshot
        StateSnapshot {
            state: AppTrackingState::Initializing,
            active_seconds_today: 0,
            present_seconds_today: 0,
            current_work_seconds: 0,
            work_interval_seconds: 3000,
            break_interval_seconds: 600,
            grace_period_seconds: 60,
            grace_seconds_left: 60,
            break_seconds_elapsed: 0,
            break_away_seconds: 0,
            snoozes_used: 0,
            snooze_limit: 2,
            skips_today: 0,
            skip_limit: 2,
            compliance_pct: 0.0,
            is_cv_present: false,
            cv_confidence: 0.0,
            tracking_mode: "Auto".to_string(),
            breaks_taken_today: 0,
            is_micro_break_active: false,
            micro_break_seconds_left: 0,
            is_dnd_active: false,
            is_wrap_up_active: false,
            wrap_up_seconds_left: 0,
            is_paused: false,
            is_too_close: false,
            is_slouching: false,
        }
    };

    let menu = create_tray_menu(app, &initial_snapshot)?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("ZeroGaze: Local presence tracker")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dashboard" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "settings");
                }
            }
            "recalibrate_posture" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("calibrate_posture", ());
                }
            }
            "toggle" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.toggle_pause();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);

                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if snapshot.is_paused {
                        let _ = tray.set_icon(Some(create_colored_icon(234, 179, 8, 255)));
                        let _ = tray.set_tooltip(Some("ZeroGaze: Tracking paused manually"));
                        let _ = tray.set_title(Some("Paused"));
                    } else {
                        let icon = get_icon_for_state(snapshot.state);
                        let tooltip = get_tooltip_for_snapshot(&snapshot);
                        let _ = tray.set_icon(Some(icon));
                        let _ = tray.set_tooltip(Some(tooltip));
                        let _ = tray.set_title(None::<String>);
                    }
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }
            }
            "start_break" | "break_now" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.start_break();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);

                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "snooze_break" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    let _ = sm.snooze_break();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }
            }
            "skip_break" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.skip_break();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }
            }
            "complete_break" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.finish_break(true);
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }
            }
            "dismiss_micro" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.dismiss_micro_break();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    if let Ok(new_menu) = create_tray_menu(app, &snapshot) {
                        let _ = tray.set_menu(Some(new_menu));
                    }
                }
            }
            "privacy" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "privacy");
                }
            }
            "quit" => {
                app.exit(0);
            }
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
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(tray)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::state_machine::{AppTrackingState, StateSnapshot};

    fn make_test_snapshot() -> StateSnapshot {
        StateSnapshot {
            state: AppTrackingState::TrackingActive,
            active_seconds_today: 0,
            present_seconds_today: 0,
            current_work_seconds: 600,
            work_interval_seconds: 1500,
            break_interval_seconds: 300,
            grace_period_seconds: 60,
            grace_seconds_left: 60,
            break_seconds_elapsed: 0,
            break_away_seconds: 0,
            snoozes_used: 0,
            snooze_limit: 3,
            skips_today: 0,
            skip_limit: 3,
            compliance_pct: 100.0,
            is_cv_present: true,
            cv_confidence: 0.9,
            tracking_mode: "Auto".to_string(),
            breaks_taken_today: 0,
            is_micro_break_active: false,
            micro_break_seconds_left: 0,
            is_dnd_active: false,
            is_wrap_up_active: false,
            wrap_up_seconds_left: 0,
            is_paused: false,
            is_too_close: false,
            is_slouching: false,
        }
    }

    #[test]
    fn test_tooltip_paused() {
        let mut snapshot = make_test_snapshot();
        snapshot.is_paused = true;
        assert_eq!(get_tooltip_for_snapshot(&snapshot), "ZeroGaze: Tracking paused manually");
    }

    #[test]
    fn test_tooltip_break_prompt() {
        let mut snapshot = make_test_snapshot();
        snapshot.state = AppTrackingState::BreakPrompt;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze Alert: Break interval reached! Time to rest eyes and stretch."
        );
    }

    #[test]
    fn test_tooltip_break_mode() {
        let mut snapshot = make_test_snapshot();
        snapshot.state = AppTrackingState::BreakMode;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze: Break mode in progress."
        );
    }

    #[test]
    fn test_tooltip_micro_break() {
        let mut snapshot = make_test_snapshot();
        snapshot.is_micro_break_active = true;
        snapshot.micro_break_seconds_left = 14;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze: 20-20-20 Eye Rest active (14s left)"
        );
    }

    #[test]
    fn test_tooltip_posture_alerts() {
        let mut snapshot = make_test_snapshot();
        snapshot.is_too_close = true;
        snapshot.is_slouching = true;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze Alert: Sitting too close (<45cm) and slouching detected."
        );

        snapshot.is_slouching = false;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze Alert: Sitting too close to screen (<45cm). Move back to 50–70cm."
        );

        snapshot.is_too_close = false;
        snapshot.is_slouching = true;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze Alert: Poor desk posture. Lift chest and align neck."
        );
    }

    #[test]
    fn test_tooltip_active_focus() {
        let snapshot = make_test_snapshot();
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze: Tracking active (Camera is on locally. No images stored)."
        );
    }

    #[test]
    fn test_tooltip_fallback_input_tracking() {
        let mut snapshot = make_test_snapshot();
        snapshot.state = AppTrackingState::FallbackInputTracking;
        assert_eq!(
            get_tooltip_for_snapshot(&snapshot),
            "ZeroGaze: Input fallback active (Idle tracking via keyboard/mouse)."
        );
    }
}
