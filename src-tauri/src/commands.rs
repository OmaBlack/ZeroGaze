use std::collections::HashMap;
use tauri::State;

use crate::db::{DailyStats, SessionRecord};
use crate::state_machine::StateSnapshot;
use crate::AppSharedState;

#[tauri::command]
pub fn update_presence(
    present: bool,
    confidence: f32,
    multi_face: bool,
    is_too_close: Option<bool>,
    is_slouching: Option<bool>,
    state: State<'_, AppSharedState>,
) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.handle_presence_update_with_ergo(
        present,
        confidence,
        multi_face,
        is_too_close.unwrap_or(false),
        is_slouching.unwrap_or(false),
    );
    sm.snapshot()
}

#[tauri::command]
pub fn report_camera_error(error: String, state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.handle_camera_error(&error);
    sm.snapshot()
}

#[tauri::command]
pub fn get_state(state: State<'_, AppSharedState>) -> StateSnapshot {
    let sm = state.sm.lock().unwrap();
    sm.snapshot()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppSharedState>) -> Result<HashMap<String, String>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_all_settings().map_err(|e| e.to_string())
}

pub fn validate_setting(key: &str, value: &str) -> Result<(), String> {
    match key {
        "work_interval_minutes" => {
            let mins = value.parse::<i64>().map_err(|_| "Invalid work_interval_minutes".to_string())?;
            if !(1..=180).contains(&mins) {
                return Err("work_interval_minutes must be between 1 and 180".to_string());
            }
        }
        "break_interval_minutes" => {
            let mins = value.parse::<i64>().map_err(|_| "Invalid break_interval_minutes".to_string())?;
            if !(1..=60).contains(&mins) {
                return Err("break_interval_minutes must be between 1 and 60".to_string());
            }
        }
        "grace_period_seconds" => {
            let secs = value.parse::<i64>().map_err(|_| "Invalid grace_period_seconds".to_string())?;
            if !(10..=300).contains(&secs) {
                return Err("grace_period_seconds must be between 10 and 300".to_string());
            }
        }
        "snooze_limit" => {
            let lim = value.parse::<i32>().map_err(|_| "Invalid snooze_limit".to_string())?;
            if !(0..=10).contains(&lim) {
                return Err("snooze_limit must be between 0 and 10".to_string());
            }
        }
        "skip_limit" => {
            let lim = value.parse::<i32>().map_err(|_| "Invalid skip_limit".to_string())?;
            if !(0..=10).contains(&lim) {
                return Err("skip_limit must be between 0 and 10".to_string());
            }
        }
        "cv_fps" => {
            let fps = value.parse::<i32>().map_err(|_| "Invalid cv_fps".to_string())?;
            if !(1..=5).contains(&fps) {
                return Err("cv_fps must be between 1 and 5".to_string());
            }
        }
        "data_retention_days" => {
            let days = value.parse::<i64>().map_err(|_| "Invalid data_retention_days".to_string())?;
            if !(7..=3650).contains(&days) {
                return Err("data_retention_days must be between 7 and 3650".to_string());
            }
        }
        "notifications_enabled"
        | "tray_alerts_enabled"
        | "micro_break_notifications"
        | "ergo_tray_alerts"
        | "sound"
        | "posture_alert_sound"
        | "reduced_motion"
        | "high_contrast"
        | "lock_on_unrecognized_user" => {
            if value != "on" && value != "off" {
                return Err(format!("{} must be 'on' or 'off'", key));
            }
        }
        "tracking_mode" => {
            if value != "Auto" && value != "Input only" && value != "Webcam only" {
                return Err("tracking_mode must be 'Auto', 'Input only', or 'Webcam only'".to_string());
            }
        }
        "break_overlay" => {
            if value != "full-screen" && value != "toast-only" && value != "centered" {
                return Err("break_overlay must be 'full-screen', 'toast-only', or 'centered'".to_string());
            }
        }
        "onboarding_completed" => {
            if value != "true" && value != "false" {
                return Err("onboarding_completed must be 'true' or 'false'".to_string());
            }
        }
        "min_face_height_ratio" => {
            let r = value.parse::<f64>().map_err(|_| "Invalid min_face_height_ratio".to_string())?;
            if !(0.05..=0.5).contains(&r) {
                return Err("min_face_height_ratio must be between 0.05 and 0.5".to_string());
            }
        }
        "comfort_distance_cm" => {
            let cm = value.parse::<i32>().map_err(|_| "Invalid comfort_distance_cm".to_string())?;
            if !(35..=120).contains(&cm) {
                return Err("comfort_distance_cm must be between 35 and 120 cm".to_string());
            }
        }
        "screen_size_preset" => {
            if value != "compact_laptop"
                && value != "standard_laptop"
                && value != "desktop_monitor"
                && value != "large_ultrawide"
                && value != "custom"
            {
                return Err("Invalid screen_size_preset".to_string());
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, AppSharedState>) -> Result<(), String> {
    validate_setting(&key, &value)?;

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.set_setting(&key, &value).map_err(|e| e.to_string())?;
        if key == "data_retention_days" {
            if let Ok(days) = value.parse::<i64>() {
                let _ = db.cleanup_retention(days);
            }
        }
    }

    if let Ok(mut sm) = state.sm.lock() {
        if key == "work_interval_minutes" {
            if let Ok(mins) = value.parse::<i64>() {
                sm.work_interval_seconds = mins * 60;
            }
        } else if key == "break_interval_minutes" {
            if let Ok(mins) = value.parse::<i64>() {
                sm.break_interval_seconds = mins * 60;
            }
        } else if key == "grace_period_seconds" {
            if let Ok(secs) = value.parse::<i64>() {
                sm.grace_period_seconds = secs;
            }
        } else if key == "snooze_limit" {
            if let Ok(lim) = value.parse::<i32>() {
                sm.snooze_limit = lim;
            }
        } else if key == "skip_limit" {
            if let Ok(lim) = value.parse::<i32>() {
                sm.skip_limit = lim;
            }
        } else if key == "tracking_mode" {
            sm.set_tracking_mode(value);
        }
    }

    Ok(())
}

#[tauri::command]
pub fn take_break_now(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.take_break_now();
    sm.snapshot()
}

#[tauri::command]
pub fn snooze_break(state: State<'_, AppSharedState>) -> Result<StateSnapshot, String> {
    let mut sm = state.sm.lock().unwrap();
    if sm.snooze_break() {
        Ok(sm.snapshot())
    } else {
        Err("Snooze limit reached".to_string())
    }
}

#[tauri::command]
pub fn skip_break(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.skip_break();
    sm.snapshot()
}

#[tauri::command]
pub fn complete_break(taken: bool, state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.finish_break(taken);
    sm.snapshot()
}

#[tauri::command]
pub fn toggle_tracking(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.toggle_pause();
    sm.snapshot()
}

#[tauri::command]
pub fn start_break(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.start_break();
    sm.snapshot()
}

#[tauri::command]
pub fn delete_all_data(state: State<'_, AppSharedState>) -> Result<(), String> {
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.delete_all_user_data().map_err(|e| e.to_string())?;
    }
    if let Ok(mut sm) = state.sm.lock() {
        sm.reset();
    }
    Ok(())
}

#[tauri::command]
pub fn get_today_stats(date_str: String, state: State<'_, AppSharedState>) -> Result<DailyStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_today_stats(&date_str).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data_json(state: State<'_, AppSharedState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.export_json().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_data_csv(state: State<'_, AppSharedState>) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.export_csv_daily().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_micro_break(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.dismiss_micro_break();
    sm.snapshot()
}

#[tauri::command]
pub fn set_dnd_mode(enabled: bool, state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.set_dnd_active(enabled);
    sm.snapshot()
}

#[tauri::command]
pub fn get_recent_stats(days: i64, state: State<'_, AppSharedState>) -> Result<Vec<DailyStats>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_recent_daily_stats(days).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_os_presentation_mode() -> Result<bool, String> {
    Ok(crate::idle::is_presentation_mode_active())
}

#[tauri::command]
pub fn wrap_up_break(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.wrap_up_break();
    sm.snapshot()
}

#[tauri::command]
pub fn import_data_json(json_payload: String, state: State<'_, AppSharedState>) -> Result<usize, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.import_json(&json_payload).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_sessions(limit: i64, state: State<'_, AppSharedState>) -> Result<Vec<SessionRecord>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_recent_sessions(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lock_workstation(state: State<'_, AppSharedState>) -> Result<StateSnapshot, String> {
    if let Ok(db) = state.db.lock() {
        let _ = db.log_event("workstation_locked_unrecognized_user", None);
    }
    let snapshot = if let Ok(mut sm) = state.sm.lock() {
        sm.flush_current_session();
        if !sm.is_paused {
            sm.toggle_pause();
        }
        sm.snapshot()
    } else {
        return Err("Failed to lock state machine".to_string());
    };
    crate::idle::lock_os_session()?;
    Ok(snapshot)
}

#[tauri::command]
pub fn send_test_notification(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("ZeroGaze: Notifications Active")
        .body("Desktop alerts, screen rest timers, and tray badges are working properly.")
        .show()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use crate::db::Database;
    use crate::state_machine::{AppTrackingState, StateMachine};

    #[test]
    fn test_validate_work_interval_bounds() {
        assert!(validate_setting("work_interval_minutes", "1").is_ok());
        assert!(validate_setting("work_interval_minutes", "25").is_ok());
        assert!(validate_setting("work_interval_minutes", "180").is_ok());
        assert!(validate_setting("work_interval_minutes", "0").is_err());
        assert!(validate_setting("work_interval_minutes", "181").is_err());
        assert!(validate_setting("work_interval_minutes", "-5").is_err());
        assert!(validate_setting("work_interval_minutes", "abc").is_err());
    }

    #[test]
    fn test_validate_break_interval_bounds() {
        assert!(validate_setting("break_interval_minutes", "1").is_ok());
        assert!(validate_setting("break_interval_minutes", "5").is_ok());
        assert!(validate_setting("break_interval_minutes", "60").is_ok());
        assert!(validate_setting("break_interval_minutes", "0").is_err());
        assert!(validate_setting("break_interval_minutes", "61").is_err());
    }

    #[test]
    fn test_validate_grace_period_bounds() {
        assert!(validate_setting("grace_period_seconds", "10").is_ok());
        assert!(validate_setting("grace_period_seconds", "60").is_ok());
        assert!(validate_setting("grace_period_seconds", "300").is_ok());
        assert!(validate_setting("grace_period_seconds", "9").is_err());
        assert!(validate_setting("grace_period_seconds", "301").is_err());
    }

    #[test]
    fn test_validate_snooze_and_skip_limits() {
        assert!(validate_setting("snooze_limit", "0").is_ok());
        assert!(validate_setting("snooze_limit", "3").is_ok());
        assert!(validate_setting("snooze_limit", "10").is_ok());
        assert!(validate_setting("snooze_limit", "-1").is_err());
        assert!(validate_setting("snooze_limit", "11").is_err());

        assert!(validate_setting("skip_limit", "0").is_ok());
        assert!(validate_setting("skip_limit", "3").is_ok());
        assert!(validate_setting("skip_limit", "10").is_ok());
        assert!(validate_setting("skip_limit", "-1").is_err());
        assert!(validate_setting("skip_limit", "11").is_err());
    }

    #[test]
    fn test_validate_cv_fps_bounds() {
        assert!(validate_setting("cv_fps", "1").is_ok());
        assert!(validate_setting("cv_fps", "3").is_ok());
        assert!(validate_setting("cv_fps", "5").is_ok());
        assert!(validate_setting("cv_fps", "0").is_err());
        assert!(validate_setting("cv_fps", "6").is_err());
    }

    #[test]
    fn test_validate_data_retention_days_bounds() {
        assert!(validate_setting("data_retention_days", "7").is_ok());
        assert!(validate_setting("data_retention_days", "30").is_ok());
        assert!(validate_setting("data_retention_days", "3650").is_ok());
        assert!(validate_setting("data_retention_days", "6").is_err());
        assert!(validate_setting("data_retention_days", "3651").is_err());
    }

    #[test]
    fn test_validate_tracking_mode() {
        assert!(validate_setting("tracking_mode", "Auto").is_ok());
        assert!(validate_setting("tracking_mode", "Input only").is_ok());
        assert!(validate_setting("tracking_mode", "Webcam only").is_ok());
        assert!(validate_setting("tracking_mode", "Manual").is_err());
        assert!(validate_setting("tracking_mode", "").is_err());
    }

    #[test]
    fn test_validate_break_overlay() {
        assert!(validate_setting("break_overlay", "full-screen").is_ok());
        assert!(validate_setting("break_overlay", "toast-only").is_ok());
        assert!(validate_setting("break_overlay", "centered").is_ok());
        assert!(validate_setting("break_overlay", "hidden").is_err());
    }

    #[test]
    fn test_validate_onboarding_completed() {
        assert!(validate_setting("onboarding_completed", "true").is_ok());
        assert!(validate_setting("onboarding_completed", "false").is_ok());
        assert!(validate_setting("onboarding_completed", "1").is_err());
        assert!(validate_setting("onboarding_completed", "yes").is_err());
    }

    #[test]
    fn test_validate_min_face_ratio() {
        assert!(validate_setting("min_face_height_ratio", "0.05").is_ok());
        assert!(validate_setting("min_face_height_ratio", "0.22").is_ok());
        assert!(validate_setting("min_face_height_ratio", "0.5").is_ok());
        assert!(validate_setting("min_face_height_ratio", "0.01").is_err());
        assert!(validate_setting("min_face_height_ratio", "0.9").is_err());
        assert!(validate_setting("min_face_height_ratio", "not_a_float").is_err());
    }

    #[test]
    fn test_validate_boolean_toggles() {
        let bool_keys = [
            "notifications_enabled",
            "tray_alerts_enabled",
            "micro_break_notifications",
            "ergo_tray_alerts",
            "sound",
            "posture_alert_sound",
            "reduced_motion",
            "high_contrast",
            "lock_on_unrecognized_user",
        ];

        for key in bool_keys {
            assert!(validate_setting(key, "on").is_ok(), "Key {} should accept 'on'", key);
            assert!(validate_setting(key, "off").is_ok(), "Key {} should accept 'off'", key);
            assert!(validate_setting(key, "true").is_err(), "Key {} should reject 'true'", key);
            assert!(validate_setting(key, "false").is_err(), "Key {} should reject 'false'", key);
            assert!(validate_setting(key, "invalid").is_err(), "Key {} should reject 'invalid'", key);
        }
    }

    #[test]
    fn test_handle_camera_error_transitions() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.reset();

        // Under default mode ("Hybrid"), camera error should transition to FallbackInputTracking
        sm.handle_camera_error("webcam disconnected");
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Under "Webcam only", camera error should transition to CameraErrorFallback
        sm.set_tracking_mode("Webcam only".to_string());
        sm.handle_camera_error("webcam disconnected");
        assert_eq!(sm.state, AppTrackingState::CameraErrorFallback);
    }

    #[test]
    fn test_workstation_lock_state_invariants() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db.clone());
        sm.reset();

        sm.session_active_seconds = 120;
        sm.session_present_seconds = 100;

        // Simulate lock_workstation state-machine side effects:
        sm.flush_current_session();
        if !sm.is_paused {
            sm.toggle_pause();
        }

        // Active session counters should be flushed and state should be paused
        assert_eq!(sm.session_active_seconds, 0);
        assert_eq!(sm.session_present_seconds, 0);
        assert!(sm.is_paused);

        // Verify session was persisted to DB
        let db_lock = db.lock().unwrap();
        let sessions = db_lock.get_recent_sessions(10).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].active_seconds, 120);
    }
}
