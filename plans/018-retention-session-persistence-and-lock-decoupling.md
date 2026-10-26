# Plan 018: Wire Data Retention Cleanup & Session Persistence, Remove Unused Telemetry Schema, and Decouple Idle Polling from StateMachine Lock

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts below
> against `src-tauri/src/db/mod.rs`, `src-tauri/src/state_machine.rs`, and
> `src-tauri/src/lib.rs`. On any mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [016](016-enforce-tracking-mode-and-pause-sync.md), [017](017-fix-dnd-override-settings-validation-and-skip-limits.md)
- **Category**: tech-debt
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

Three architectural gaps exist in the Rust backend:
1. **Unrecorded Focus Sessions**: `Database::record_session` (`src-tauri/src/db/mod.rs:221-236`) and the `sessions` table are included in JSON exports (`ExportBundle.sessions`), and `StateMachine` initializes `session_id` and `session_start_ts`, but `record_session` is never called—so exported JSON backups always have `"sessions": []`.
2. **Dead Retention Policy & Unused Telemetry Table**: `Database::cleanup_retention(days)` (`src-tauri/src/db/mod.rs:452-458`) is never called on startup, and `init_schema()` creates a `telemetry_queue` table despite `PRODUCT.md` Principle 1 ("Zero cloud servers, zero external telemetry") and `FEATURES.md:94` ("Absolute Zero-Telemetry Guarantee").
3. **Mutex Lock Contention on OS Idle Subprocesses**: `StateMachine::tick_second()` calls `get_idle_seconds()` while holding `timer_sm.lock()`. On Linux (`src-tauri/src/idle.rs:44-81`), `get_idle_seconds()` spawns `xprintidle` and `dbus-send` subprocesses synchronously, blocking all Tauri IPC commands (`update_presence`, `get_state`) while waiting on child processes.

## Current state

- Relevant files:
  - `src-tauri/src/db/mod.rs` — `init_schema`, `record_session`, `cleanup_retention`, `delete_all_user_data`.
  - `src-tauri/src/state_machine.rs` — `StateMachine` session tracking fields, `tick_second`, `transition_to`, `finish_break`, `skip_break`.
  - `src-tauri/src/lib.rs` — app startup and 1-second background tick thread.

- Current code excerpts:

`src-tauri/src/db/mod.rs:121-126`:
```rust
            CREATE TABLE IF NOT EXISTS telemetry_queue (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                sent_at TEXT
            );
```

`src-tauri/src/db/mod.rs:452-458`:
```rust
    pub fn cleanup_retention(&self, days: i64) -> Result<usize> {
        let cutoff = (Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        let sessions_deleted = self.conn.execute("DELETE FROM sessions WHERE end_ts < ?1", params![cutoff])?;
        self.conn.execute("DELETE FROM breaks WHERE prompted_ts < ?1", params![cutoff])?;
        self.conn.execute("DELETE FROM events WHERE ts < ?1", params![cutoff])?;
        Ok(sessions_deleted)
    }
```

`src-tauri/src/lib.rs:63-73`:
```rust
                loop {
                    std::thread::sleep(Duration::from_secs(1));

                    let (current_state, snapshot) = {
                        if let Ok(mut sm) = timer_sm.lock() {
                            sm.tick_second();
                            (sm.state, sm.snapshot())
                        } else {
                            continue;
                        }
                    };
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/state_machine.rs`
- `src-tauri/src/lib.rs`

**Out of scope**:
- `src-tauri/src/idle.rs` (the platform functions remain unchanged; only the call site is moved outside the mutex lock where appropriate).
- Frontend files (`src/main.ts`, `index.html`, `src/style.css`).

## Steps

### Step 1: Drop `telemetry_queue` and Run `cleanup_retention` on Database Init

In `src-tauri/src/db/mod.rs`:
1. In `init_schema(&self)`:
   - Replace `CREATE TABLE IF NOT EXISTS telemetry_queue (...)` with `DROP TABLE IF EXISTS telemetry_queue;` so existing and new databases contain zero telemetry tables.
   - Remove `"telemetry"` from `seed_default_settings(&self)` and remove `DELETE FROM telemetry_queue;` from `delete_all_user_data(&self)`.
2. In `Database::new(path)`:
   - After `db.seed_default_settings()?;`, read `data_retention_days`:
     ```rust
     let retention_days: i64 = db
         .get_setting("data_retention_days")
         .unwrap_or(None)
         .and_then(|v| v.parse().ok())
         .unwrap_or(365);
     if retention_days > 0 {
         let _ = db.cleanup_retention(retention_days);
     }
     ```
3. In `cleanup_retention(&self, days: i64)`:
   - Also delete stale `daily_stats` rows older than the date cutoff:
     ```rust
     let date_cutoff = (Utc::now() - chrono::Duration::days(days)).format("%Y-%m-%d").to_string();
     self.conn.execute("DELETE FROM daily_stats WHERE date < ?1", params![date_cutoff])?;
     ```

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Flush `SessionRecord` on Completed Work Sessions

In `src-tauri/src/state_machine.rs`:
1. Add `pub session_active_seconds: i64` and `pub session_present_seconds: i64` to `StateMachine` (initialized to `0` in `new()` and `reset()`).
2. In `tick_second()`:
   - When incrementing work seconds in `AppTrackingState::TrackingActive` or `AppTrackingState::FallbackInputTracking`, also increment `self.session_active_seconds += 1` and `self.session_present_seconds += 1`.
3. Add a helper `pub fn flush_current_session(&mut self)` on `StateMachine`:
   ```rust
   pub fn flush_current_session(&mut self) {
       if self.session_active_seconds > 0 {
           let now = Utc::now().to_rfc3339();
           let mode_str = if self.state == AppTrackingState::FallbackInputTracking || self.tracking_mode == "Input only" {
               "fallback_input".to_string()
           } else {
               "cv".to_string()
           };
           let record = crate::db::SessionRecord {
               id: self.session_id.clone(),
               start_ts: self.session_start_ts.clone(),
               end_ts: now.clone(),
               active_seconds: self.session_active_seconds,
               present_seconds: self.session_present_seconds,
               mode: mode_str,
               device_id: "local".to_string(),
           };
           if let Ok(db) = self.db.lock() {
               let _ = db.record_session(&record);
           }
           self.session_id = Uuid::new_v4().to_string();
           self.session_start_ts = now;
           self.session_active_seconds = 0;
           self.session_present_seconds = 0;
       }
   }
   ```
4. Call `self.flush_current_session()` in:
   - `start_break(&mut self)`
   - `skip_break(&mut self)`
   - `transition_to(&mut self, new_state)` when transitioning to `AppTrackingState::PausedAway`.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Sample OS Idle Time Outside the `StateMachine` Lock

1. In `src-tauri/src/state_machine.rs`:
   - Add `pub last_idle_seconds: f64` to `StateMachine` (initialized to `0.0`).
   - In `tick_second(&mut self)` inside `AppTrackingState::FallbackInputTracking`, read `self.last_idle_seconds` instead of calling `get_idle_seconds()` directly while holding the mutex, or provide `pub fn tick_second_with_idle(&mut self, idle_secs: f64)` where `pub fn tick_second(&mut self)` delegates to `self.tick_second_with_idle(get_idle_seconds())`.
2. In `src-tauri/src/lib.rs`:
   - In the 1-second background thread (`lines 63-73`), check if the previous state was `FallbackInputTracking`, query `crate::idle::get_idle_seconds()` *before* locking `timer_sm.lock()`, and call `sm.tick_second_with_idle(idle_secs)`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 4: Add Unit Tests for Session Flushing and Retention Cleanup

1. In `src-tauri/src/db/mod.rs` (`mod tests`):
   - Add `test_cleanup_retention_removes_old_records`: insert a session and daily_stats entry dated 400 days ago and one dated today, run `db.cleanup_retention(365)`, and assert only today's records remain.
2. In `src-tauri/src/state_machine.rs` (`mod tests`):
   - Add `test_session_flushed_on_start_break`: run 3 active seconds in `TrackingActive`, call `sm.start_break()`, and assert `db.lock().unwrap().get_all_sessions().unwrap().len() == 1` with `active_seconds == 3`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

## Test plan

- Files: `src-tauri/src/db/mod.rs` and `src-tauri/src/state_machine.rs`.
- Cases covered:
  - `cleanup_retention(365)` deletes expired `sessions`, `breaks`, `events`, and `daily_stats` while preserving recent rows.
  - `flush_current_session()` persists a `SessionRecord` with accurate `active_seconds` and resets session counters when a break starts or user transitions to `PausedAway`.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_cleanup_retention_removes_old_records` and `test_session_flushed_on_start_break` pass
- [x] `grep -rn "telemetry_queue" src-tauri/src/` only matches the `DROP TABLE IF EXISTS telemetry_queue` migration line
- [x] `plans/README.md` status row for Plan 018 updated to `DONE`

## STOP conditions

- Any existing test in `db::tests` or `state_machine::tests` breaks and cannot be resolved within 2 attempts.
- The code in `src-tauri/src/db/mod.rs` or `src-tauri/src/state_machine.rs` has drifted from the excerpts above.

## Maintenance notes

- Keep `tick_second(&mut self)` as a convenience wrapper around `tick_second_with_idle(&mut self, get_idle_seconds())` so existing unit tests in `state_machine::tests` continue to compile without signature changes.
