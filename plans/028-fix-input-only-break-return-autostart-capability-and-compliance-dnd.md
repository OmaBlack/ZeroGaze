# Plan 028: Fix Input-Only Break Recovery, Autostart IPC Capability, DND Compliance Penalty, and Pause Session Persistence

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze has four critical correctness and permission issues affecting basic tracking integrity:
1. When tracking in `"Input only"` mode, completing or skipping a break unconditionally transitions to `TrackingActive` (which expects camera frames). Because the webcam is intentionally off in input-only mode, the system never receives presence updates and the CV watchdog ignores input-only mode, causing active work time to increment continuously 100% of the time, even when the user is away from the computer for hours.
2. In `src-tauri/capabilities/default.json`, `"autostart:default"` is missing from the Tauri v2 permission capability set, causing `@tauri-apps/plugin-autostart` IPC calls (`isEnabled()`, `enable()`, `disable()`) to fail silently with permission denied errors at runtime.
3. In `src-tauri/src/db/mod.rs`, `compliance_pct` counts `breaks_deferred` in the denominator (`breaks_taken / (breaks_taken + breaks_skipped + breaks_deferred)`). When users defer breaks during client presentations, video calls, or DND mode (as designed in PRD §4.6 and §4.10), their compliance percentage is penalized as if they skipped a break.
4. In `src-tauri/src/state_machine.rs`, `toggle_pause` does not call `flush_current_session()`. Pausing tracking leaves uncommitted work time in-memory; if the app restarts or exits while paused, that session's data is lost, and when resumed, the session start timestamp is stale.

Fixing these ensures accurate tracking across all modes, functional autostart controls, fair DND compliance statistics, and resilient session persistence.

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs` — State transitions for break completion, pause toggle, and session flushing.
  - `src-tauri/src/db/mod.rs` — SQLite database daily compliance calculation.
  - `src-tauri/capabilities/default.json` — Tauri v2 desktop capability configuration.

Current code excerpts:

1. `src-tauri/src/state_machine.rs:558-563`:
```rust
        self.current_work_seconds = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        self.transition_to(AppTrackingState::TrackingActive);
    }
```

2. `src-tauri/src/state_machine.rs:584-589`:
```rust
        self.current_work_seconds = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        self.transition_to(AppTrackingState::TrackingActive);
    }
```

3. `src-tauri/src/state_machine.rs:591-599`:
```rust
    pub fn toggle_pause(&mut self) -> bool {
        self.is_paused = !self.is_paused;
        if self.is_paused {
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("tracking_paused_manually", None);
            }
        }
        self.is_paused
    }
```

4. `src-tauri/src/db/mod.rs:327-336`:
```rust
        // Recalculate compliance %: taken / (taken + skipped + deferred)
        self.conn.execute(
            "UPDATE daily_stats SET
                compliance_pct = CASE
                    WHEN (breaks_taken + breaks_skipped + breaks_deferred) > 0
                    THEN (CAST(breaks_taken AS REAL) / (breaks_taken + breaks_skipped + breaks_deferred)) * 100.0
                    ELSE 0.0
                END
             WHERE date = ?1",
            params![date_str],
        )?;
```

5. `src-tauri/capabilities/default.json:8-12`:
```json
  "permissions": [
    "core:default",
    "notification:default"
  ]
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| TypeScript check | `npm run build` | exit 0, no errors |
| Frontend tests | `npm test` | exit 0, all 11 tests pass |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src-tauri/src/db/mod.rs`
- `src-tauri/capabilities/default.json`

**Out of scope**:
- Do not modify UI layout in `index.html` or `style.css`.
- Do not alter `src/ergonomics.ts` calculations.

## Steps

### Step 1: Fix break recovery state transition in `Input only` mode
In `src-tauri/src/state_machine.rs`:
1. In `skip_break(&mut self)` (lines 558-563):
   Replace:
   ```rust
   self.transition_to(AppTrackingState::TrackingActive);
   ```
   with:
   ```rust
   if self.tracking_mode == "Input only" {
       self.transition_to(AppTrackingState::FallbackInputTracking);
   } else {
       self.transition_to(AppTrackingState::TrackingActive);
   }
   ```
2. In `finish_break(&mut self, taken: bool)` (lines 584-589):
   Replace:
   ```rust
   self.transition_to(AppTrackingState::TrackingActive);
   ```
   with:
   ```rust
   if self.tracking_mode == "Input only" {
       self.transition_to(AppTrackingState::FallbackInputTracking);
   } else {
       self.transition_to(AppTrackingState::TrackingActive);
   }
   ```
3. Add a unit test `test_input_only_mode_returns_to_fallback_after_break` in `state_machine.rs` verifying that taking and skipping breaks in `"Input only"` mode transitions back to `FallbackInputTracking`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- test_input_only` → exit 0

### Step 2: Flush active session on manual pause
In `src-tauri/src/state_machine.rs`:
In `pub fn toggle_pause(&mut self) -> bool`:
When `self.is_paused` transitions from `false` to `true`:
```rust
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
```
Add an assertion in `test_pause_reflected_in_snapshot` verifying that pausing flushes non-zero active session seconds.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- test_pause` → exit 0

### Step 3: Remove DND deferral penalty from daily compliance formula
In `src-tauri/src/db/mod.rs`:
In `update_daily_break_count(&self, date_str: &str, status: &str) -> Result<()>`:
Update the compliance query so `breaks_deferred` does NOT reduce the user's compliance score:
```rust
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
```
In `test_daily_stats_and_compliance` in `src-tauri/src/db/mod.rs`, add a test case where a break is deferred, and verify `compliance_pct` remains 100.0% when 1 break is taken and 1 break is deferred.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- test_daily_stats_and_compliance` → exit 0

### Step 4: Add `autostart:default` to Tauri capabilities
In `src-tauri/capabilities/default.json`:
Add `"autostart:default"` to the permissions list:
```json
  "permissions": [
    "core:default",
    "notification:default",
    "autostart:default"
  ]
```

**Verify**: `npm run build` → exit 0

## Test plan

- In `src-tauri/src/state_machine.rs`:
  - `test_input_only_mode_returns_to_fallback_after_break`: Configure mode `"Input only"`, start break, finish break, assert state is `FallbackInputTracking`. Repeat for `skip_break`.
  - `test_pause_flushes_current_session`: Simulate active seconds, call `toggle_pause()`, assert session active seconds reset to 0 and session record exists in db.
- In `src-tauri/src/db/mod.rs`:
  - `test_deferred_break_does_not_lower_compliance`: Record 1 taken, 2 deferred breaks, assert compliance is 100.0%.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 (30+ tests pass, 0 failures).
- [ ] `npm run build` exits 0.
- [ ] `npm test` exits 0.
- [ ] `src-tauri/capabilities/default.json` includes `"autostart:default"`.
- [ ] `plans/README.md` status row updated to DONE.

## STOP conditions

- If `tauri-plugin-autostart` fails to compile with `"autostart:default"`, STOP and verify `src-tauri/Cargo.toml` version matches capability schema.
- If existing tests fail due to compliance formula changes without matching the new contract, STOP and report.

## Maintenance notes

- Deferrals logged in `daily_stats.breaks_deferred` continue to be tracked for analytics and weekly summaries, but are intentionally excluded from the compliance penalty calculation.
