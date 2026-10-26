use chrono::{Local, Utc};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::db::{BreakRecord, Database, SessionRecord};
use crate::idle::get_idle_seconds;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AppTrackingState {
    Initializing,
    TrackingActive,
    TrackingGrace,
    PausedAway,
    BreakPrompt,
    BreakMode,
    BreakSnoozed,
    BreakSkipped,
    FallbackInputTracking,
    CameraErrorFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub state: AppTrackingState,
    pub active_seconds_today: i64,
    pub present_seconds_today: i64,
    pub current_work_seconds: i64,
    pub work_interval_seconds: i64,
    pub break_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub grace_seconds_left: i64,
    pub break_seconds_elapsed: i64,
    pub break_away_seconds: i64,
    pub snoozes_used: i32,
    pub snooze_limit: i32,
    pub skips_today: i64,
    pub skip_limit: i32,
    pub compliance_pct: f64,
    pub is_cv_present: bool,
    pub cv_confidence: f32,
    pub tracking_mode: String, // "Auto", "Webcam only", "Input only"
    pub breaks_taken_today: i64,
    pub is_micro_break_active: bool,
    pub micro_break_seconds_left: i64,
    pub is_dnd_active: bool,
    pub is_wrap_up_active: bool,
    pub wrap_up_seconds_left: i64,
    pub is_paused: bool,
    pub is_too_close: bool,
    pub is_slouching: bool,
}

pub struct StateMachine {
    pub state: AppTrackingState,
    pub db: Arc<Mutex<Database>>,
    pub is_cv_present: bool,
    pub cv_confidence: f32,
    pub last_presence_ts: i64,
    pub last_cv_heartbeat_ts: i64,
    pub grace_seconds_elapsed: i64,
    pub current_work_seconds: i64,
    pub work_interval_seconds: i64,
    pub break_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub break_prompt_seconds_elapsed: i64,
    pub break_seconds_elapsed: i64,
    pub break_away_seconds: i64,
    pub snoozes_used: i32,
    pub snooze_limit: i32,
    pub skip_limit: i32,
    pub current_break_id: Option<String>,
    pub tracking_mode: String,
    pub is_paused: bool,
    pub session_id: String,
    pub session_start_ts: String,
    pub session_active_seconds: i64,
    pub session_present_seconds: i64,
    pub micro_break_work_seconds: i64,
    pub micro_break_countdown: i64,
    pub is_dnd_active: bool,
    pub is_wrap_up_active: bool,
    pub wrap_up_seconds_left: i64,
    pub is_too_close: bool,
    pub is_slouching: bool,
}

impl StateMachine {
    pub fn new(db: Arc<Mutex<Database>>) -> Self {
        let (work_mins, break_mins, grace_secs, sl, skl, mode) = {
            let conn = db.lock().unwrap();
            let wm: i64 = conn
                .get_setting("work_interval_minutes")
                .unwrap_or(None)
                .and_then(|v| v.parse().ok())
                .unwrap_or(50);
            let bm: i64 = conn
                .get_setting("break_interval_minutes")
                .unwrap_or(None)
                .and_then(|v| v.parse().ok())
                .unwrap_or(10);
            let gs: i64 = conn
                .get_setting("grace_period_seconds")
                .unwrap_or(None)
                .and_then(|v| v.parse().ok())
                .unwrap_or(60);
            let snooze_l: i32 = conn
                .get_setting("snooze_limit")
                .unwrap_or(None)
                .and_then(|v| v.parse().ok())
                .unwrap_or(2);
            let skip_l: i32 = conn
                .get_setting("skip_limit")
                .unwrap_or(None)
                .and_then(|v| v.parse().ok())
                .unwrap_or(2);
            let tm = conn
                .get_setting("tracking_mode")
                .unwrap_or(None)
                .unwrap_or_else(|| "Auto".to_string());
            (wm, bm, gs, snooze_l, skip_l, tm)
        };

        let initial_state = if mode == "Input only" {
            AppTrackingState::FallbackInputTracking
        } else {
            AppTrackingState::Initializing
        };

        let now = Utc::now().to_rfc3339();
        Self {
            state: initial_state,
            db,
            is_cv_present: false,
            cv_confidence: 0.0,
            last_presence_ts: Utc::now().timestamp(),
            last_cv_heartbeat_ts: Utc::now().timestamp(),
            grace_seconds_elapsed: 0,
            current_work_seconds: 0,
            work_interval_seconds: work_mins * 60,
            break_interval_seconds: break_mins * 60,
            grace_period_seconds: grace_secs,
            break_prompt_seconds_elapsed: 0,
            break_seconds_elapsed: 0,
            break_away_seconds: 0,
            snoozes_used: 0,
            snooze_limit: sl,
            skip_limit: skl,
            current_break_id: None,
            tracking_mode: mode,
            is_paused: false,
            session_id: Uuid::new_v4().to_string(),
            session_start_ts: now,
            session_active_seconds: 0,
            session_present_seconds: 0,
            micro_break_work_seconds: 0,
            micro_break_countdown: 0,
            is_dnd_active: false,
            is_wrap_up_active: false,
            wrap_up_seconds_left: 0,
            is_too_close: false,
            is_slouching: false,
        }
    }

    pub fn reset(&mut self) {
        let (work_mins, break_mins, grace_secs, sl, skl, mode) = {
            if let Ok(conn) = self.db.lock() {
                let wm: i64 = conn
                    .get_setting("work_interval_minutes")
                    .unwrap_or(None)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(50);
                let bm: i64 = conn
                    .get_setting("break_interval_minutes")
                    .unwrap_or(None)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(10);
                let gs: i64 = conn
                    .get_setting("grace_period_seconds")
                    .unwrap_or(None)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(60);
                let snooze_l: i32 = conn
                    .get_setting("snooze_limit")
                    .unwrap_or(None)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2);
                let skip_l: i32 = conn
                    .get_setting("skip_limit")
                    .unwrap_or(None)
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(2);
                let tm = conn
                    .get_setting("tracking_mode")
                    .unwrap_or(None)
                    .unwrap_or_else(|| "Auto".to_string());
                (wm, bm, gs, snooze_l, skip_l, tm)
            } else {
                (50, 10, 60, 2, 2, "Auto".to_string())
            }
        };

        self.current_work_seconds = 0;
        self.grace_seconds_elapsed = 0;
        self.break_prompt_seconds_elapsed = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        self.current_break_id = None;
        self.micro_break_work_seconds = 0;
        self.micro_break_countdown = 0;
        self.is_dnd_active = false;
        self.is_wrap_up_active = false;
        self.wrap_up_seconds_left = 0;
        self.is_paused = false;
        self.is_too_close = false;
        self.is_slouching = false;
        self.work_interval_seconds = work_mins * 60;
        self.break_interval_seconds = break_mins * 60;
        self.grace_period_seconds = grace_secs;
        self.snooze_limit = sl;
        self.skip_limit = skl;
        self.tracking_mode = mode.clone();
        self.session_id = Uuid::new_v4().to_string();
        self.session_start_ts = Utc::now().to_rfc3339();
        self.session_active_seconds = 0;
        self.session_present_seconds = 0;
        let initial_state = if mode == "Input only" {
            AppTrackingState::FallbackInputTracking
        } else {
            AppTrackingState::Initializing
        };
        self.transition_to(initial_state);
    }

    pub fn flush_current_session(&mut self) {
        if self.session_active_seconds > 0 {
            let mode = if self.state == AppTrackingState::FallbackInputTracking || self.tracking_mode == "Input only" {
                "fallback_input".to_string()
            } else {
                "cv".to_string()
            };
            let record = SessionRecord {
                id: self.session_id.clone(),
                start_ts: self.session_start_ts.clone(),
                end_ts: Utc::now().to_rfc3339(),
                active_seconds: self.session_active_seconds,
                present_seconds: self.session_present_seconds,
                mode,
                device_id: "local".to_string(),
            };
            if let Ok(db) = self.db.lock() {
                let _ = db.record_session(&record);
            }
        }
        self.session_id = Uuid::new_v4().to_string();
        self.session_start_ts = Utc::now().to_rfc3339();
        self.session_active_seconds = 0;
        self.session_present_seconds = 0;
    }

    pub fn set_tracking_mode(&mut self, mode: String) {
        self.tracking_mode = mode;
        if self.tracking_mode == "Input only" {
            self.is_cv_present = false;
            self.cv_confidence = 0.0;
            if !matches!(
                self.state,
                AppTrackingState::BreakPrompt | AppTrackingState::BreakMode | AppTrackingState::BreakSnoozed
            ) {
                self.transition_to(AppTrackingState::FallbackInputTracking);
            }
        } else if self.tracking_mode == "Webcam only" && self.state == AppTrackingState::FallbackInputTracking {
            self.flush_current_session();
            self.transition_to(AppTrackingState::PausedAway);
        }
    }

    pub fn handle_presence_update(&mut self, present: bool, confidence: f32, multi_face: bool) {
        self.handle_presence_update_with_ergo(present, confidence, multi_face, false, false);
    }

    pub fn handle_presence_update_with_ergo(
        &mut self,
        present: bool,
        confidence: f32,
        multi_face: bool,
        is_too_close: bool,
        is_slouching: bool,
    ) {
        if self.tracking_mode == "Input only" {
            return;
        }

        self.last_cv_heartbeat_ts = Utc::now().timestamp();
        self.is_cv_present = present;
        self.cv_confidence = confidence;
        self.is_too_close = if present { is_too_close } else { false };
        self.is_slouching = if present { is_slouching } else { false };

        if multi_face {
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("multi_face_detected", Some("{\"faces\": \">1\"}"));
            }
        }

        if self.is_paused {
            return;
        }

        if present {
            self.last_presence_ts = Utc::now().timestamp();
            self.grace_seconds_elapsed = 0;

            match self.state {
                AppTrackingState::Initializing
                | AppTrackingState::TrackingGrace
                | AppTrackingState::PausedAway
                | AppTrackingState::FallbackInputTracking
                | AppTrackingState::CameraErrorFallback => {
                    self.transition_to(AppTrackingState::TrackingActive);
                }
                _ => {}
            }
        } else {
            // Face lost
            match self.state {
                AppTrackingState::TrackingActive => {
                    self.grace_seconds_elapsed = 0;
                    self.transition_to(AppTrackingState::TrackingGrace);
                }
                _ => {}
            }
        }
    }

    pub fn handle_camera_error(&mut self, _err: &str) {
        let target_state = if self.tracking_mode == "Webcam only" {
            AppTrackingState::CameraErrorFallback
        } else {
            AppTrackingState::FallbackInputTracking
        };
        if self.state != target_state {
            self.transition_to(target_state);
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("camera_error_fallback", Some("{\"source\": \"webcam_failure\"}"));
            }
        }
    }

    pub fn tick_second(&mut self) {
        self.tick_second_with_idle(get_idle_seconds());
    }

    pub fn tick_second_with_idle(&mut self, idle_secs: f64) {
        if self.is_paused {
            return;
        }

        if self.state == AppTrackingState::Initializing && self.tracking_mode == "Input only" {
            self.transition_to(AppTrackingState::FallbackInputTracking);
        }

        let now_ts = Utc::now().timestamp();
        if (self.state == AppTrackingState::TrackingActive || self.state == AppTrackingState::TrackingGrace)
            && self.tracking_mode != "Input only"
            && (now_ts - self.last_cv_heartbeat_ts) > 5
        {
            if self.tracking_mode == "Webcam only" {
                self.flush_current_session();
                self.transition_to(AppTrackingState::PausedAway);
            } else {
                self.transition_to(AppTrackingState::FallbackInputTracking);
            }
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("cv_heartbeat_timeout", Some("{\"reason\": \"no_updates_5s\"}"));
            }
        }

        let today = Local::now().format("%Y-%m-%d").to_string();

        match self.state {
            AppTrackingState::TrackingActive => {
                if self.micro_break_countdown > 0 {
                    self.micro_break_countdown -= 1;
                } else {
                    self.micro_break_work_seconds += 1;
                    if self.micro_break_work_seconds >= 1200 {
                        self.micro_break_work_seconds = 0;
                        self.micro_break_countdown = 20;
                    }
                }

                self.current_work_seconds += 1;
                self.session_active_seconds += 1;
                self.session_present_seconds += 1;

                if let Ok(db) = self.db.lock() {
                    let _ = db.increment_daily_seconds(&today, 1, 1);
                }

                if self.current_work_seconds >= self.work_interval_seconds {
                    if self.is_dnd_active {
                        self.defer_break("dnd_presentation");
                    } else {
                        self.initiate_break_prompt();
                    }
                }
            }
            AppTrackingState::TrackingGrace => {
                self.grace_seconds_elapsed += 1;
                if self.grace_seconds_elapsed >= self.grace_period_seconds {
                    if self.tracking_mode == "Auto" && idle_secs < 10.0 {
                        self.transition_to(AppTrackingState::FallbackInputTracking);
                        if let Ok(db) = self.db.lock() {
                            let _ = db.log_event(
                                "low_light_input_fallback",
                                Some("{\"reason\": \"cv_absent_but_input_active\"}"),
                            );
                        }
                    } else {
                        self.flush_current_session();
                        self.transition_to(AppTrackingState::PausedAway);
                    }
                }
            }
            AppTrackingState::PausedAway => {
                // User away, no active seconds incremented unless user returns in Auto mode with active input
                if self.tracking_mode == "Auto" && idle_secs < 5.0 {
                    self.transition_to(AppTrackingState::FallbackInputTracking);
                }
            }
            AppTrackingState::BreakPrompt => {
                if self.is_wrap_up_active {
                    if self.wrap_up_seconds_left > 0 {
                        self.wrap_up_seconds_left -= 1;
                    }
                    if self.wrap_up_seconds_left == 0 {
                        self.is_wrap_up_active = false;
                        self.start_break();
                    }
                } else {
                    self.break_prompt_seconds_elapsed += 1;
                    // PRD 4.5: If user ignores initial alert, after 2 minutes transition to Break Mode
                    if self.break_prompt_seconds_elapsed >= 120 {
                        self.start_break();
                    }
                }
            }
            AppTrackingState::BreakMode => {
                self.break_seconds_elapsed += 1;
                if !self.is_cv_present || idle_secs >= 15.0 {
                    self.break_away_seconds += 1;
                }
                if self.break_seconds_elapsed >= self.break_interval_seconds {
                    self.finish_break(true);
                }
            }
            AppTrackingState::BreakSnoozed => {
                self.break_prompt_seconds_elapsed += 1;
                // Snooze is 5 minutes (300 seconds)
                if self.break_prompt_seconds_elapsed >= 300 {
                    self.initiate_break_prompt();
                }
            }
            AppTrackingState::FallbackInputTracking => {
                if self.tracking_mode != "Webcam only" {
                    if idle_secs < self.grace_period_seconds as f64 {
                        // Active via mouse/keyboard input
                        if self.micro_break_countdown > 0 {
                            self.micro_break_countdown -= 1;
                        } else {
                            self.micro_break_work_seconds += 1;
                            if self.micro_break_work_seconds >= 1200 {
                                self.micro_break_work_seconds = 0;
                                self.micro_break_countdown = 20;
                            }
                        }

                        self.current_work_seconds += 1;
                        self.session_active_seconds += 1;
                        self.session_present_seconds += 1;
                        if let Ok(db) = self.db.lock() {
                            let _ = db.increment_daily_seconds(&today, 1, 1);
                        }
                        if self.current_work_seconds >= self.work_interval_seconds {
                            if self.is_dnd_active {
                                self.defer_break("dnd_presentation");
                            } else {
                                self.initiate_break_prompt();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    fn initiate_break_prompt(&mut self) {
        let break_id = Uuid::new_v4().to_string();
        self.current_break_id = Some(break_id.clone());
        self.break_prompt_seconds_elapsed = 0;
        self.transition_to(AppTrackingState::BreakPrompt);

        if let Ok(db) = self.db.lock() {
            let record = BreakRecord {
                id: break_id,
                prompted_ts: Utc::now().to_rfc3339(),
                start_ts: None,
                end_ts: None,
                status: "prompted".to_string(),
                reason: None,
            };
            let _ = db.record_break(&record);
            let _ = db.log_event("break_prompted", None);
        }
    }

    pub fn start_break(&mut self) {
        self.flush_current_session();
        if self.current_break_id.is_none() {
            self.initiate_break_prompt();
        }
        self.is_wrap_up_active = false;
        self.wrap_up_seconds_left = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.transition_to(AppTrackingState::BreakMode);

        if let Some(ref bid) = self.current_break_id {
            if let Ok(db) = self.db.lock() {
                let record = BreakRecord {
                    id: bid.clone(),
                    prompted_ts: Utc::now().to_rfc3339(),
                    start_ts: Some(Utc::now().to_rfc3339()),
                    end_ts: None,
                    status: "started".to_string(),
                    reason: None,
                };
                let _ = db.record_break(&record);
            }
        }
    }

    pub fn take_break_now(&mut self) {
        if self.state != AppTrackingState::BreakMode {
            self.start_break();
        }
    }

    pub fn snooze_break(&mut self) -> bool {
        self.is_wrap_up_active = false;
        self.wrap_up_seconds_left = 0;
        if self.snoozes_used < self.snooze_limit {
            self.snoozes_used += 1;
            self.break_prompt_seconds_elapsed = 0;
            self.transition_to(AppTrackingState::BreakSnoozed);

            if let Some(ref bid) = self.current_break_id {
                if let Ok(db) = self.db.lock() {
                    let record = BreakRecord {
                        id: bid.clone(),
                        prompted_ts: Utc::now().to_rfc3339(),
                        start_ts: None,
                        end_ts: None,
                        status: "snoozed".to_string(),
                        reason: Some(format!("Snooze #{}", self.snoozes_used)),
                    };
                    let _ = db.record_break(&record);
                }
            }
            true
        } else {
            false
        }
    }

    pub fn skip_break(&mut self) {
        self.flush_current_session();
        self.is_wrap_up_active = false;
        self.wrap_up_seconds_left = 0;
        let today = Local::now().format("%Y-%m-%d").to_string();
        if let Some(ref bid) = self.current_break_id {
            if let Ok(db) = self.db.lock() {
                let record = BreakRecord {
                    id: bid.clone(),
                    prompted_ts: Utc::now().to_rfc3339(),
                    start_ts: None,
                    end_ts: Some(Utc::now().to_rfc3339()),
                    status: "skipped".to_string(),
                    reason: Some("User dismissed break prompt".to_string()),
                };
                let _ = db.record_break(&record);
                let _ = db.update_daily_break_count(&today, "skipped");
            }
        }

        self.current_work_seconds = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        if self.tracking_mode == "Input only" {
            self.transition_to(AppTrackingState::FallbackInputTracking);
        } else {
            self.transition_to(AppTrackingState::TrackingActive);
        }
    }

    pub fn finish_break(&mut self, taken: bool) {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let status = if taken { "taken" } else { "dismissed" };

        if let Some(ref bid) = self.current_break_id {
            if let Ok(db) = self.db.lock() {
                let record = BreakRecord {
                    id: bid.clone(),
                    prompted_ts: Utc::now().to_rfc3339(),
                    start_ts: Some(Utc::now().to_rfc3339()),
                    end_ts: Some(Utc::now().to_rfc3339()),
                    status: status.to_string(),
                    reason: None,
                };
                let _ = db.record_break(&record);
                let _ = db.update_daily_break_count(&today, status);
            }
        }

        self.current_work_seconds = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        if self.tracking_mode == "Input only" {
            self.transition_to(AppTrackingState::FallbackInputTracking);
        } else {
            self.transition_to(AppTrackingState::TrackingActive);
        }
    }

    pub fn toggle_pause(&mut self) -> bool {
        self.is_paused = !self.is_paused;
        if self.is_paused {
            self.flush_current_session();
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("tracking_paused_manually", None);
            }
        }
        self.is_paused
    }

    pub fn wrap_up_break(&mut self) -> bool {
        if self.state == AppTrackingState::BreakPrompt {
            self.is_wrap_up_active = true;
            self.wrap_up_seconds_left = 120;
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("break_wrap_up_requested", None);
            }
            true
        } else {
            false
        }
    }

    pub fn dismiss_micro_break(&mut self) {
        self.micro_break_countdown = 0;
    }

    pub fn set_dnd_active(&mut self, active: bool) {
        self.is_dnd_active = active;
        if let Ok(db) = self.db.lock() {
            let details = format!("{{\"dnd_active\": {}}}", active);
            let _ = db.log_event("dnd_mode_toggled", Some(&details));
        }
    }

    pub fn defer_break(&mut self, reason: &str) {
        let today = Local::now().format("%Y-%m-%d").to_string();
        if let Ok(db) = self.db.lock() {
            let _ = db.update_daily_break_count(&today, "deferred");
            let record = BreakRecord {
                id: Uuid::new_v4().to_string(),
                prompted_ts: Utc::now().to_rfc3339(),
                start_ts: None,
                end_ts: None,
                status: "deferred".to_string(),
                reason: Some(reason.to_string()),
            };
            let _ = db.record_break(&record);
            let _ = db.log_event("break_deferred", Some(&format!("{{\"reason\": \"{}\"}}", reason)));
        }
        self.current_work_seconds = self.work_interval_seconds.saturating_sub(300);
    }

    fn transition_to(&mut self, new_state: AppTrackingState) {
        let old_state = self.state;
        self.state = new_state;

        if let Ok(db) = self.db.lock() {
            let details = format!("{{\"from\": \"{:?}\", \"to\": \"{:?}\"}}", old_state, new_state);
            let _ = db.log_event("state_transition", Some(&details));
        }
    }

    pub fn snapshot(&self) -> StateSnapshot {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let stats = if let Ok(db) = self.db.lock() {
            db.get_today_stats(&today).unwrap_or(crate::db::DailyStats {
                date: today,
                active_seconds: 0,
                present_seconds: 0,
                breaks_taken: 0,
                breaks_skipped: 0,
                breaks_deferred: 0,
                compliance_pct: 0.0,
            })
        } else {
            crate::db::DailyStats {
                date: today,
                active_seconds: 0,
                present_seconds: 0,
                breaks_taken: 0,
                breaks_skipped: 0,
                breaks_deferred: 0,
                compliance_pct: 0.0,
            }
        };

        let grace_left = if self.state == AppTrackingState::TrackingGrace {
            (self.grace_period_seconds - self.grace_seconds_elapsed).max(0)
        } else {
            self.grace_period_seconds
        };

        StateSnapshot {
            state: self.state,
            active_seconds_today: stats.active_seconds,
            present_seconds_today: stats.present_seconds,
            current_work_seconds: self.current_work_seconds,
            work_interval_seconds: self.work_interval_seconds,
            break_interval_seconds: self.break_interval_seconds,
            grace_period_seconds: self.grace_period_seconds,
            grace_seconds_left: grace_left,
            break_seconds_elapsed: self.break_seconds_elapsed,
            break_away_seconds: self.break_away_seconds,
            snoozes_used: self.snoozes_used,
            snooze_limit: self.snooze_limit,
            skips_today: stats.breaks_skipped,
            skip_limit: self.skip_limit,
            compliance_pct: stats.compliance_pct,
            is_cv_present: self.is_cv_present,
            cv_confidence: self.cv_confidence,
            tracking_mode: self.tracking_mode.clone(),
            breaks_taken_today: stats.breaks_taken,
            is_micro_break_active: self.micro_break_countdown > 0,
            micro_break_seconds_left: self.micro_break_countdown,
            is_dnd_active: self.is_dnd_active,
            is_wrap_up_active: self.is_wrap_up_active,
            wrap_up_seconds_left: self.wrap_up_seconds_left,
            is_paused: self.is_paused,
            is_too_close: self.is_too_close,
            is_slouching: self.is_slouching,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_presence_transitions() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);

        assert_eq!(sm.state, AppTrackingState::Initializing);

        // Face detected
        sm.handle_presence_update(true, 0.95, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);

        // Face lost
        sm.handle_presence_update(false, 0.0, false);
        assert_eq!(sm.state, AppTrackingState::TrackingGrace);

        // Tick grace until away
        for _ in 0..61 {
            sm.tick_second_with_idle(120.0);
        }
        assert_eq!(sm.state, AppTrackingState::PausedAway);

        // Face returns
        sm.handle_presence_update(true, 0.90, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);
    }

    #[test]
    fn test_break_prompt_and_snooze() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.work_interval_seconds = 2; // test 2s work interval
        sm.handle_presence_update(true, 0.9, false);

        sm.tick_second();
        sm.tick_second();

        assert_eq!(sm.state, AppTrackingState::BreakPrompt);

        // Test snooze
        let snoozed = sm.snooze_break();
        assert!(snoozed);
        assert_eq!(sm.state, AppTrackingState::BreakSnoozed);
        assert_eq!(sm.snoozes_used, 1);
    }

    #[test]
    fn test_start_break_and_completion() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.break_interval_seconds = 2;

        sm.start_break();
        assert_eq!(sm.state, AppTrackingState::BreakMode);
        assert_eq!(sm.snapshot().breaks_taken_today, 0);

        sm.tick_second();
        sm.tick_second();

        assert_eq!(sm.state, AppTrackingState::TrackingActive);
        assert_eq!(sm.snapshot().breaks_taken_today, 1);
    }

    #[test]
    fn test_cv_heartbeat_watchdog_timeout() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);

        sm.handle_presence_update(true, 0.95, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);

        // Simulate 6s without CV update
        sm.last_cv_heartbeat_ts = Utc::now().timestamp() - 6;
        sm.tick_second();

        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Heartbeat resumes
        sm.handle_presence_update(true, 0.95, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);
    }

    #[test]
    fn test_micro_break_trigger_and_dismiss() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.handle_presence_update(true, 0.95, false);

        // Advance micro break work seconds to 1199
        sm.micro_break_work_seconds = 1199;
        sm.tick_second();

        assert!(sm.snapshot().is_micro_break_active);
        assert_eq!(sm.snapshot().micro_break_seconds_left, 20);

        // Dismiss
        sm.dismiss_micro_break();
        assert!(!sm.snapshot().is_micro_break_active);
        assert_eq!(sm.snapshot().micro_break_seconds_left, 0);
    }

    #[test]
    fn test_dnd_break_deferral() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.work_interval_seconds = 10;
        sm.handle_presence_update(true, 0.95, false);

        sm.set_dnd_active(true);
        sm.current_work_seconds = 9;

        sm.tick_second(); // reaches 10 with DND active

        // Should not transition to BreakPrompt; should remain in TrackingActive and defer
        assert_eq!(sm.state, AppTrackingState::TrackingActive);
        assert!(sm.current_work_seconds < sm.work_interval_seconds);
    }

    #[test]
    fn test_wrap_up_break_countdown() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.initiate_break_prompt();
        assert_eq!(sm.state, AppTrackingState::BreakPrompt);

        assert!(sm.wrap_up_break());
        assert!(sm.is_wrap_up_active);
        assert_eq!(sm.wrap_up_seconds_left, 120);

        for _ in 0..119 {
            sm.tick_second();
            assert_eq!(sm.state, AppTrackingState::BreakPrompt);
        }
        assert_eq!(sm.wrap_up_seconds_left, 1);

        sm.tick_second(); // 120th tick
        assert_eq!(sm.state, AppTrackingState::BreakMode);
        assert!(!sm.is_wrap_up_active);
    }

    #[test]
    fn test_input_only_mode_ignores_cv_and_tracks_input() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.set_tracking_mode("Input only".to_string());
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Stray CV presence update should be ignored in Input only mode
        sm.handle_presence_update(true, 0.99, false);
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);
        assert!(!sm.is_cv_present);
    }

    #[test]
    fn test_webcam_only_mode_does_not_fallback_to_input() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.set_tracking_mode("Webcam only".to_string());
        sm.handle_presence_update(true, 0.95, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);

        // Simulate CV heartbeat timeout > 5s in Webcam only mode
        sm.last_cv_heartbeat_ts = Utc::now().timestamp() - 6;
        sm.tick_second();
        assert_eq!(sm.state, AppTrackingState::PausedAway);

        // Camera error in Webcam only mode should transition to CameraErrorFallback
        sm.handle_camera_error("webcam unplugged");
        assert_eq!(sm.state, AppTrackingState::CameraErrorFallback);
    }

    #[test]
    fn test_pause_reflected_in_snapshot() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(Arc::clone(&db));
        assert!(!sm.snapshot().is_paused);

        sm.session_active_seconds = 120;
        sm.session_present_seconds = 120;

        let paused = sm.toggle_pause();
        assert!(paused);
        assert!(sm.snapshot().is_paused);
        assert_eq!(sm.session_active_seconds, 0);

        let sessions = db.lock().unwrap().get_all_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].active_seconds, 120);

        let paused = sm.toggle_pause();
        assert!(!paused);
        assert!(!sm.snapshot().is_paused);
    }

    #[test]
    fn test_state_machine_reset_clears_counters() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.handle_presence_update(true, 0.95, false);
        sm.current_work_seconds = 1234;
        sm.snoozes_used = 2;
        sm.is_dnd_active = true;
        sm.is_paused = true;
        sm.work_interval_seconds = 90 * 60;

        sm.reset();

        assert_eq!(sm.state, AppTrackingState::Initializing);
        assert_eq!(sm.current_work_seconds, 0);
        assert_eq!(sm.snoozes_used, 0);
        assert!(!sm.is_dnd_active);
        assert!(!sm.is_paused);
        assert_eq!(sm.work_interval_seconds, 50 * 60);
    }

    #[test]
    fn test_snooze_limit_exhaustion() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.snooze_limit = 2;
        sm.initiate_break_prompt();

        assert!(sm.snooze_break());
        assert_eq!(sm.snoozes_used, 1);

        sm.initiate_break_prompt();
        assert!(sm.snooze_break());
        assert_eq!(sm.snoozes_used, 2);

        sm.initiate_break_prompt();
        assert!(!sm.snooze_break());
        assert_eq!(sm.snoozes_used, 2);
    }

    #[test]
    fn test_session_flushed_on_start_break() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(Arc::clone(&db));
        sm.handle_presence_update(true, 0.95, false);

        sm.tick_second_with_idle(0.0);
        sm.tick_second_with_idle(0.0);
        sm.tick_second_with_idle(0.0);
        assert_eq!(sm.session_active_seconds, 3);

        sm.start_break();
        assert_eq!(sm.session_active_seconds, 0);

        let sessions = db.lock().unwrap().get_all_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].active_seconds, 3);
        assert_eq!(sessions[0].mode, "cv");
    }

    #[test]
    fn test_break_prompt_auto_escalates_after_120s() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.initiate_break_prompt();
        assert_eq!(sm.state, AppTrackingState::BreakPrompt);

        for _ in 0..119 {
            sm.tick_second_with_idle(0.0);
            assert_eq!(sm.state, AppTrackingState::BreakPrompt);
        }

        sm.tick_second_with_idle(0.0); // 120th second
        assert_eq!(sm.state, AppTrackingState::BreakMode);
    }

    #[test]
    fn test_break_snoozed_reprompts_after_300s() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.initiate_break_prompt();
        assert!(sm.snooze_break());
        assert_eq!(sm.state, AppTrackingState::BreakSnoozed);

        for _ in 0..299 {
            sm.tick_second_with_idle(0.0);
            assert_eq!(sm.state, AppTrackingState::BreakSnoozed);
        }

        sm.tick_second_with_idle(0.0); // 300th second
        assert_eq!(sm.state, AppTrackingState::BreakPrompt);
    }

    #[test]
    fn test_skip_break_updates_daily_compliance() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);

        // Take 1 break
        sm.start_break();
        sm.finish_break(true);
        assert_eq!(sm.snapshot().breaks_taken_today, 1);
        assert_eq!(sm.snapshot().skips_today, 0);
        assert_eq!(sm.snapshot().compliance_pct, 100.0);

        // Skip 1 break
        sm.initiate_break_prompt();
        sm.skip_break();
        assert_eq!(sm.snapshot().breaks_taken_today, 1);
        assert_eq!(sm.snapshot().skips_today, 1);
        assert_eq!(sm.snapshot().compliance_pct, 50.0);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);
    }

    #[test]
    fn test_fallback_input_tracking_idle_threshold() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.set_tracking_mode("Input only".to_string());
        sm.grace_period_seconds = 60;
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Active input (idle < 60s) increments work seconds
        sm.tick_second_with_idle(5.0);
        assert_eq!(sm.current_work_seconds, 1);

        // Idle >= 60s does not increment work seconds
        sm.tick_second_with_idle(60.0);
        assert_eq!(sm.current_work_seconds, 1);
        sm.tick_second_with_idle(120.0);
        assert_eq!(sm.current_work_seconds, 1);
    }

    #[test]
    fn test_low_light_active_input_transitions_to_fallback() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        assert_eq!(sm.tracking_mode, "Auto");

        sm.handle_presence_update(true, 0.95, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);

        // Face lost in dark room
        sm.handle_presence_update(false, 0.0, false);
        assert_eq!(sm.state, AppTrackingState::TrackingGrace);

        // User continues typing (idle_secs = 2.0 < 10.0) while camera still reports 0 faces
        for _ in 0..60 {
            sm.last_cv_heartbeat_ts = Utc::now().timestamp();
            sm.tick_second_with_idle(2.0);
        }
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // When room is lit and CV detects face again, recovers to TrackingActive
        sm.tick_second_with_idle(120.0);
        sm.handle_presence_update(true, 0.92, false);
        assert_eq!(sm.state, AppTrackingState::TrackingActive);
    }

    #[test]
    fn test_break_away_seconds_tracked_during_break_mode() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.break_interval_seconds = 10;

        sm.handle_presence_update(true, 0.95, false);
        sm.start_break();
        assert_eq!(sm.state, AppTrackingState::BreakMode);
        assert_eq!(sm.snapshot().break_away_seconds, 0);

        // User still seated and typing (is_cv_present = true, idle = 0.0) -> away_seconds stays 0
        sm.tick_second_with_idle(0.0);
        assert_eq!(sm.snapshot().break_seconds_elapsed, 1);
        assert_eq!(sm.snapshot().break_away_seconds, 0);

        // User steps away from desk (is_cv_present = false) -> away_seconds increments
        sm.handle_presence_update(false, 0.0, false);
        sm.tick_second_with_idle(0.0);
        sm.tick_second_with_idle(0.0);
        assert_eq!(sm.snapshot().break_seconds_elapsed, 3);
        assert_eq!(sm.snapshot().break_away_seconds, 2);

        // Finish break resets break_away_seconds
        sm.finish_break(true);
        assert_eq!(sm.snapshot().break_away_seconds, 0);
    }

    #[test]
    fn test_input_only_mode_returns_to_fallback_after_break() {
        let db = Arc::new(Mutex::new(Database::new_in_memory().unwrap()));
        let mut sm = StateMachine::new(db);
        sm.set_tracking_mode("Input only".to_string());
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Start break from input-only mode
        sm.start_break();
        assert_eq!(sm.state, AppTrackingState::BreakMode);

        // Completing break must return to FallbackInputTracking, NOT TrackingActive
        sm.finish_break(true);
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);

        // Snooze and skip break must also return to FallbackInputTracking
        sm.start_break();
        assert_eq!(sm.state, AppTrackingState::BreakMode);
        sm.skip_break();
        assert_eq!(sm.state, AppTrackingState::FallbackInputTracking);
    }
}


