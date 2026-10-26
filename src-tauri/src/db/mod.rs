use chrono::Utc;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

pub const CURRENT_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStats {
    pub date: String,
    pub active_seconds: i64,
    pub present_seconds: i64,
    pub breaks_taken: i64,
    pub breaks_skipped: i64,
    pub breaks_deferred: i64,
    pub compliance_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakRecord {
    pub id: String,
    pub prompted_ts: String,
    pub start_ts: Option<String>,
    pub end_ts: Option<String>,
    pub status: String, // "taken", "skipped", "deferred", "snoozed"
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub start_ts: String,
    pub end_ts: String,
    pub active_seconds: i64,
    pub present_seconds: i64,
    pub mode: String, // "cv", "fallback_input"
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportBundle {
    pub exported_at: String,
    pub daily_stats: Vec<DailyStats>,
    pub sessions: Vec<SessionRecord>,
    pub breaks: Vec<BreakRecord>,
}

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path)?;
        let db = Self { conn };
        db.init_schema()?;
        db.seed_default_settings()?;
        let retention_days: i64 = db
            .get_setting("data_retention_days")
            .unwrap_or(None)
            .and_then(|v| v.parse().ok())
            .unwrap_or(365);
        let _ = db.cleanup_retention(retention_days);
        Ok(db)
    }

    pub fn new_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self { conn };
        db.init_schema()?;
        db.seed_default_settings()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                start_ts TEXT NOT NULL,
                end_ts TEXT NOT NULL,
                active_seconds INTEGER NOT NULL,
                present_seconds INTEGER NOT NULL,
                mode TEXT NOT NULL,
                device_id TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS breaks (
                id TEXT PRIMARY KEY,
                prompted_ts TEXT NOT NULL,
                start_ts TEXT,
                end_ts TEXT,
                status TEXT NOT NULL,
                reason TEXT
            );

            CREATE TABLE IF NOT EXISTS daily_stats (
                date TEXT PRIMARY KEY,
                active_seconds INTEGER NOT NULL DEFAULT 0,
                present_seconds INTEGER NOT NULL DEFAULT 0,
                breaks_taken INTEGER NOT NULL DEFAULT 0,
                breaks_skipped INTEGER NOT NULL DEFAULT 0,
                breaks_deferred INTEGER NOT NULL DEFAULT 0,
                compliance_pct REAL NOT NULL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                type TEXT NOT NULL,
                details_json TEXT
            );

            DROP TABLE IF EXISTS telemetry_queue;

            CREATE INDEX IF NOT EXISTS idx_sessions_start_ts ON sessions(start_ts);
            CREATE INDEX IF NOT EXISTS idx_breaks_prompted_ts ON breaks(prompted_ts);
            CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
            ",
        )?;

        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM schema_version WHERE version = ?1", params![CURRENT_SCHEMA_VERSION], |row| row.get(0))?;

        if count == 0 {
            let now = Utc::now().to_rfc3339();
            self.conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                params![CURRENT_SCHEMA_VERSION, now],
            )?;
        }

        Ok(())
    }

    fn seed_default_settings(&self) -> Result<()> {
        let defaults = [
            ("work_interval_minutes", "50"),
            ("break_interval_minutes", "10"),
            ("grace_period_seconds", "60"),
            ("cv_fps", "2"),
            ("camera_selection", "Default"),
            ("tracking_mode", "Auto"),
            ("auto_start", "off"),
            ("break_overlay", "full-screen"),
            ("sound", "on"),
            ("snooze_limit", "2"),
            ("skip_limit", "2"),
            ("battery_mode", "on"),
            ("data_retention_days", "365"),
            ("reduced_motion", "off"),
            ("high_contrast", "off"),
            ("onboarding_completed", "false"),
            ("lock_on_unrecognized_user", "off"),
            ("primary_user_signature", ""),
            ("posture_alert_sound", "on"),
            ("notifications_enabled", "on"),
            ("tray_alerts_enabled", "on"),
            ("micro_break_notifications", "on"),
            ("ergo_tray_alerts", "on"),
            ("comfort_distance_cm", "65"),
            ("screen_size_preset", "desktop_monitor"),
        ];

        let now = Utc::now().to_rfc3339();
        for (key, val) in defaults.iter() {
            self.conn.execute(
                "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                params![key, val, now],
            )?;
        }

        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn get_all_settings(&self) -> Result<HashMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        let mut map = HashMap::new();
        for item in rows {
            let (k, v) = item?;
            map.insert(k, v);
        }
        Ok(map)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn log_event(&self, event_type: &str, details_json: Option<&str>) -> Result<()> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO events (id, ts, type, details_json) VALUES (?1, ?2, ?3, ?4)",
            params![id, now, event_type, details_json],
        )?;
        Ok(())
    }

    pub fn record_session(&self, session: &SessionRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO sessions (id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                session.id,
                session.start_ts,
                session.end_ts,
                session.active_seconds,
                session.present_seconds,
                session.mode,
                session.device_id
            ],
        )?;
        Ok(())
    }

    pub fn record_break(&self, record: &BreakRecord) -> Result<()> {
        self.conn.execute(
            "INSERT INTO breaks (id, prompted_ts, start_ts, end_ts, status, reason)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                start_ts = COALESCE(?3, start_ts),
                end_ts = COALESCE(?4, end_ts),
                status = ?5,
                reason = COALESCE(?6, reason)",
            params![
                record.id,
                record.prompted_ts,
                record.start_ts,
                record.end_ts,
                record.status,
                record.reason
            ],
        )?;
        Ok(())
    }

    pub fn get_today_stats(&self, date_str: &str) -> Result<DailyStats> {
        let mut stmt = self.conn.prepare(
            "SELECT date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct
             FROM daily_stats WHERE date = ?1",
        )?;
        let mut rows = stmt.query(params![date_str])?;
        if let Some(row) = rows.next()? {
            Ok(DailyStats {
                date: row.get(0)?,
                active_seconds: row.get(1)?,
                present_seconds: row.get(2)?,
                breaks_taken: row.get(3)?,
                breaks_skipped: row.get(4)?,
                breaks_deferred: row.get(5)?,
                compliance_pct: row.get(6)?,
            })
        } else {
            Ok(DailyStats {
                date: date_str.to_string(),
                active_seconds: 0,
                present_seconds: 0,
                breaks_taken: 0,
                breaks_skipped: 0,
                breaks_deferred: 0,
                compliance_pct: 0.0,
            })
        }
    }

    pub fn increment_daily_seconds(&self, date_str: &str, active_delta: i64, present_delta: i64) -> Result<()> {
        self.conn.execute(
            "INSERT INTO daily_stats (date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct)
             VALUES (?1, ?2, ?3, 0, 0, 0, 0.0)
             ON CONFLICT(date) DO UPDATE SET
                active_seconds = active_seconds + ?2,
                present_seconds = present_seconds + ?3",
            params![date_str, active_delta, present_delta],
        )?;
        Ok(())
    }

    pub fn update_daily_break_count(&self, date_str: &str, status: &str) -> Result<()> {
        let (col_taken, col_skipped, col_deferred) = match status {
            "taken" => (1, 0, 0),
            "skipped" => (0, 1, 0),
            "deferred" => (0, 0, 1),
            _ => (0, 0, 0),
        };

        self.conn.execute(
            "INSERT INTO daily_stats (date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct)
             VALUES (?1, 0, 0, ?2, ?3, ?4, 0.0)
             ON CONFLICT(date) DO UPDATE SET
                breaks_taken = breaks_taken + ?2,
                breaks_skipped = breaks_skipped + ?3,
                breaks_deferred = breaks_deferred + ?4",
            params![date_str, col_taken, col_skipped, col_deferred],
        )?;

        // Recalculate compliance %: taken / (taken + skipped). Deferred breaks do not penalize compliance.
        self.conn.execute(
            "UPDATE daily_stats SET
                compliance_pct = CASE
                    WHEN (breaks_taken + breaks_skipped) > 0
                    THEN (CAST(breaks_taken AS REAL) / (breaks_taken + breaks_skipped)) * 100.0
                    ELSE 100.0
                END
             WHERE date = ?1",
            params![date_str],
        )?;

        Ok(())
    }

    pub fn get_all_daily_stats(&self) -> Result<Vec<DailyStats>> {
        let mut stmt = self.conn.prepare(
            "SELECT date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct
             FROM daily_stats
             ORDER BY date ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(DailyStats {
                date: row.get(0)?,
                active_seconds: row.get(1)?,
                present_seconds: row.get(2)?,
                breaks_taken: row.get(3)?,
                breaks_skipped: row.get(4)?,
                breaks_deferred: row.get(5)?,
                compliance_pct: row.get(6)?,
            })
        })?;
        let mut stats = Vec::new();
        for s in rows {
            stats.push(s?);
        }
        Ok(stats)
    }

    pub fn get_all_sessions(&self) -> Result<Vec<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id
             FROM sessions
             ORDER BY start_ts ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                start_ts: row.get(1)?,
                end_ts: row.get(2)?,
                active_seconds: row.get(3)?,
                present_seconds: row.get(4)?,
                mode: row.get(5)?,
                device_id: row.get(6)?,
            })
        })?;
        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn get_recent_sessions(&self, limit: i64) -> Result<Vec<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id
             FROM sessions
             ORDER BY end_ts DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                start_ts: row.get(1)?,
                end_ts: row.get(2)?,
                active_seconds: row.get(3)?,
                present_seconds: row.get(4)?,
                mode: row.get(5)?,
                device_id: row.get(6)?,
            })
        })?;
        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn get_all_breaks(&self) -> Result<Vec<BreakRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, prompted_ts, start_ts, end_ts, status, reason
             FROM breaks
             ORDER BY prompted_ts ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(BreakRecord {
                id: row.get(0)?,
                prompted_ts: row.get(1)?,
                start_ts: row.get(2)?,
                end_ts: row.get(3)?,
                status: row.get(4)?,
                reason: row.get(5)?,
            })
        })?;
        let mut breaks = Vec::new();
        for b in rows {
            breaks.push(b?);
        }
        Ok(breaks)
    }

    pub fn export_json(&self) -> Result<String> {
        let bundle = ExportBundle {
            exported_at: Utc::now().to_rfc3339(),
            daily_stats: self.get_all_daily_stats()?,
            sessions: self.get_all_sessions()?,
            breaks: self.get_all_breaks()?,
        };
        serde_json::to_string_pretty(&bundle).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    }

    pub fn import_json(&mut self, json_str: &str) -> Result<usize> {
        let bundle: ExportBundle = serde_json::from_str(json_str)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        let tx = self.conn.transaction()?;
        let mut imported_count = 0usize;

        for s in &bundle.daily_stats {
            tx.execute(
                "INSERT OR REPLACE INTO daily_stats (date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    s.date,
                    s.active_seconds,
                    s.present_seconds,
                    s.breaks_taken,
                    s.breaks_skipped,
                    s.breaks_deferred,
                    s.compliance_pct
                ],
            )?;
            imported_count += 1;
        }

        for sess in &bundle.sessions {
            tx.execute(
                "INSERT OR REPLACE INTO sessions (id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    sess.id,
                    sess.start_ts,
                    sess.end_ts,
                    sess.active_seconds,
                    sess.present_seconds,
                    sess.mode,
                    sess.device_id
                ],
            )?;
            imported_count += 1;
        }

        for brk in &bundle.breaks {
            tx.execute(
                "INSERT OR REPLACE INTO breaks (id, prompted_ts, start_ts, end_ts, status, reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    brk.id,
                    brk.prompted_ts,
                    brk.start_ts,
                    brk.end_ts,
                    brk.status,
                    brk.reason
                ],
            )?;
            imported_count += 1;
        }

        tx.commit()?;
        Ok(imported_count)
    }

    pub fn export_csv_daily(&self) -> Result<String> {
        let stats = self.get_all_daily_stats()?;
        let mut csv = String::from("date,active_seconds,present_seconds,breaks_taken,breaks_skipped,breaks_deferred,compliance_pct\n");
        for s in stats {
            csv.push_str(&format!(
                "{},{},{},{},{},{},{:.2}\n",
                s.date, s.active_seconds, s.present_seconds, s.breaks_taken, s.breaks_skipped, s.breaks_deferred, s.compliance_pct
            ));
        }
        Ok(csv)
    }

    pub fn get_recent_daily_stats(&self, limit_days: i64) -> Result<Vec<DailyStats>> {
        let mut stmt = self.conn.prepare(
            "SELECT date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct
             FROM daily_stats
             ORDER BY date DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit_days], |row| {
            Ok(DailyStats {
                date: row.get(0)?,
                active_seconds: row.get(1)?,
                present_seconds: row.get(2)?,
                breaks_taken: row.get(3)?,
                breaks_skipped: row.get(4)?,
                breaks_deferred: row.get(5)?,
                compliance_pct: row.get(6)?,
            })
        })?;
        let mut stats = Vec::new();
        for s in rows {
            stats.push(s?);
        }
        stats.reverse();
        Ok(stats)
    }

    pub fn cleanup_retention(&self, days: i64) -> Result<usize> {
        let cutoff = (Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let sessions_deleted = self.conn.execute("DELETE FROM sessions WHERE end_ts < ?1", params![cutoff])?;
        self.conn.execute("DELETE FROM breaks WHERE prompted_ts < ?1", params![cutoff])?;
        self.conn.execute("DELETE FROM events WHERE ts < ?1", params![cutoff])?;
        let date_cutoff = (Utc::now() - chrono::Duration::days(days)).format("%Y-%m-%d").to_string();
        self.conn.execute("DELETE FROM daily_stats WHERE date < ?1", params![date_cutoff])?;
        Ok(sessions_deleted)
    }

    pub fn delete_all_user_data(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            DELETE FROM sessions;
            DELETE FROM breaks;
            DELETE FROM daily_stats;
            DELETE FROM events;
            DELETE FROM settings;
            VACUUM;
            ",
        )?;
        self.seed_default_settings()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_db_init_and_defaults() {
        let db = Database::new_in_memory().expect("db in memory");
        let work_interval = db.get_setting("work_interval_minutes").unwrap();
        assert_eq!(work_interval, Some("50".to_string()));

        let grace_period = db.get_setting("grace_period_seconds").unwrap();
        assert_eq!(grace_period, Some("60".to_string()));

        let onboarding = db.get_setting("onboarding_completed").unwrap();
        assert_eq!(onboarding, Some("false".to_string()));

        let lock_unrecognized = db.get_setting("lock_on_unrecognized_user").unwrap();
        assert_eq!(lock_unrecognized, Some("off".to_string()));

        let primary_sig = db.get_setting("primary_user_signature").unwrap();
        assert_eq!(primary_sig, Some("".to_string()));

        assert_eq!(db.get_setting("notifications_enabled").unwrap(), Some("on".to_string()));
        assert_eq!(db.get_setting("tray_alerts_enabled").unwrap(), Some("on".to_string()));
        assert_eq!(db.get_setting("micro_break_notifications").unwrap(), Some("on".to_string()));
        assert_eq!(db.get_setting("ergo_tray_alerts").unwrap(), Some("on".to_string()));
    }

    #[test]
    fn test_settings_update() {
        let db = Database::new_in_memory().expect("db in memory");
        db.set_setting("work_interval_minutes", "25").unwrap();
        let val = db.get_setting("work_interval_minutes").unwrap();
        assert_eq!(val, Some("25".to_string()));
    }

    #[test]
    fn test_daily_stats_and_compliance() {
        let db = Database::new_in_memory().expect("db in memory");
        let today = "2026-10-14";
        db.increment_daily_seconds(today, 300, 300).unwrap();
        db.update_daily_break_count(today, "taken").unwrap();
        db.update_daily_break_count(today, "skipped").unwrap();

        let stats = db.get_today_stats(today).unwrap();
        assert_eq!(stats.active_seconds, 300);
        assert_eq!(stats.breaks_taken, 1);
        assert_eq!(stats.breaks_skipped, 1);
        assert_eq!(stats.compliance_pct, 50.0);

        // Deferring a break (e.g. presentation / meeting mode) must not penalize compliance
        db.update_daily_break_count(today, "deferred").unwrap();
        let stats_deferred = db.get_today_stats(today).unwrap();
        assert_eq!(stats_deferred.breaks_deferred, 1);
        assert_eq!(stats_deferred.compliance_pct, 50.0);
    }

    #[test]
    fn test_export_json_and_csv() {
        let db = Database::new_in_memory().expect("db in memory");
        let today = "2026-10-14";
        db.increment_daily_seconds(today, 120, 120).unwrap();
        db.update_daily_break_count(today, "taken").unwrap();

        let json = db.export_json().unwrap();
        assert!(json.contains("daily_stats"));
        assert!(json.contains("2026-10-14"));

        let csv = db.export_csv_daily().unwrap();
        assert!(csv.contains("date,active_seconds"));
        assert!(csv.contains("2026-10-14,120,120,1,0,0,100.00"));
    }

    #[test]
    fn test_get_recent_daily_stats() {
        let db = Database::new_in_memory().expect("db in memory");
        db.increment_daily_seconds("2026-10-12", 100, 100).unwrap();
        db.increment_daily_seconds("2026-10-13", 200, 200).unwrap();
        db.increment_daily_seconds("2026-10-14", 300, 300).unwrap();

        let recent = db.get_recent_daily_stats(2).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].date, "2026-10-13");
        assert_eq!(recent[1].date, "2026-10-14");
    }

    #[test]
    fn test_cleanup_retention_removes_old_records() {
        let db = Database::new_in_memory().expect("db in memory");
        let old_ts = (Utc::now() - chrono::Duration::days(400)).to_rfc3339();
        let recent_ts = Utc::now().to_rfc3339();

        db.record_session(&SessionRecord {
            id: "old-session".to_string(),
            start_ts: old_ts.clone(),
            end_ts: old_ts.clone(),
            active_seconds: 100,
            present_seconds: 100,
            mode: "cv".to_string(),
            device_id: "local".to_string(),
        })
        .unwrap();

        db.record_session(&SessionRecord {
            id: "recent-session".to_string(),
            start_ts: recent_ts.clone(),
            end_ts: recent_ts.clone(),
            active_seconds: 200,
            present_seconds: 200,
            mode: "cv".to_string(),
            device_id: "local".to_string(),
        })
        .unwrap();

        let old_date = (Utc::now() - chrono::Duration::days(400)).format("%Y-%m-%d").to_string();
        let recent_date = Utc::now().format("%Y-%m-%d").to_string();
        db.increment_daily_seconds(&old_date, 50, 50).unwrap();
        db.increment_daily_seconds(&recent_date, 60, 60).unwrap();

        let deleted = db.cleanup_retention(365).unwrap();
        assert_eq!(deleted, 1);

        let sessions = db.get_all_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "recent-session");

        let stats = db.get_all_daily_stats().unwrap();
        assert_eq!(stats.len(), 1);
        assert_eq!(stats[0].date, recent_date);
    }

    #[test]
    fn test_export_and_import_json_roundtrip() {
        let db1 = Database::new_in_memory().expect("db1");
        db1.increment_daily_seconds("2026-10-15", 600, 600).unwrap();
        db1.update_daily_break_count("2026-10-15", "taken").unwrap();
        db1.record_session(&SessionRecord {
            id: "sess-1".to_string(),
            start_ts: "2026-10-15T10:00:00Z".to_string(),
            end_ts: "2026-10-15T10:10:00Z".to_string(),
            active_seconds: 600,
            present_seconds: 600,
            mode: "cv".to_string(),
            device_id: "local".to_string(),
        })
        .unwrap();
        db1.record_break(&BreakRecord {
            id: "brk-1".to_string(),
            prompted_ts: "2026-10-15T10:10:00Z".to_string(),
            start_ts: Some("2026-10-15T10:10:05Z".to_string()),
            end_ts: Some("2026-10-15T10:20:05Z".to_string()),
            status: "taken".to_string(),
            reason: None,
        })
        .unwrap();

        let exported = db1.export_json().unwrap();

        let mut db2 = Database::new_in_memory().expect("db2");
        let count = db2.import_json(&exported).unwrap();
        assert_eq!(count, 3);

        let stats = db2.get_today_stats("2026-10-15").unwrap();
        assert_eq!(stats.active_seconds, 600);
        assert_eq!(stats.breaks_taken, 1);
        assert_eq!(db2.get_all_sessions().unwrap().len(), 1);
        assert_eq!(db2.get_all_breaks().unwrap().len(), 1);
    }

    #[test]
    fn test_get_recent_sessions() {
        let db = Database::new_in_memory().expect("db");
        db.record_session(&SessionRecord {
            id: "s1".to_string(),
            start_ts: "2026-10-15T09:00:00Z".to_string(),
            end_ts: "2026-10-15T09:30:00Z".to_string(),
            active_seconds: 1800,
            present_seconds: 1800,
            mode: "cv".to_string(),
            device_id: "local".to_string(),
        })
        .unwrap();
        db.record_session(&SessionRecord {
            id: "s2".to_string(),
            start_ts: "2026-10-15T10:00:00Z".to_string(),
            end_ts: "2026-10-15T10:45:00Z".to_string(),
            active_seconds: 2700,
            present_seconds: 2700,
            mode: "fallback_input".to_string(),
            device_id: "local".to_string(),
        })
        .unwrap();

        let recent = db.get_recent_sessions(1).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, "s2");
    }
}

