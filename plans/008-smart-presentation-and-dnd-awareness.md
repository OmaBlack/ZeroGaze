# Plan 008: Implement Smart Meeting and Presentation Awareness (DND & Break Deferral)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/state_machine.rs` and `src-tauri/src/db/mod.rs`.
> If signatures or structures mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: [001](001-fix-break-flow-and-stats.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

Unexpected break modals or screen takeovers during live slide presentations, client demos, or Zoom/Meet video conferences disrupt users and are a top cause of break-reminder uninstalls. `DailyStats` in SQLite already has a `breaks_deferred: i64` column, but breaks are currently prompted unconditionally. Detecting Do-Not-Disturb (DND) or presentation mode suppresses intrusive break takeovers, deferring the break cleanly until the user finishes presenting.

## Current state

- Relevant files:
  - `src-tauri/src/db/mod.rs:11-19` — defines `DailyStats` with `breaks_deferred: i64`.
  - `src-tauri/src/state_machine.rs:256-274` — `initiate_break_prompt` creates a `BreakRecord` and enters `BreakPrompt` unconditionally.
  - `src-tauri/src/commands.rs` — exposed Tauri commands.
  - `src/main.ts` — frontend state loop.
- Current excerpt (`src-tauri/src/state_machine.rs:256-261`):
```rust
fn initiate_break_prompt(&mut self) {
    let break_id = Uuid::new_v4().to_string();
    self.current_break_id = Some(break_id.clone());
    self.break_prompt_seconds_elapsed = 0;
    self.transition_to(AppTrackingState::BreakPrompt);
```
- Repo conventions:
  - Deferrals must be recorded with status `"deferred"` and reason `"dnd_presentation"` in `breaks` table, and increment `breaks_deferred` in `daily_stats`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust check | `cargo check` (in `src-tauri`) | exit 0 |
| Rust tests | `cargo test` (in `src-tauri`) | all pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs` (add `increment_break_deferred` method)
- `src-tauri/src/state_machine.rs` (add `is_dnd_active: bool`, `defer_break(&mut self, reason: &str)`, and check DND before `initiate_break_prompt`)
- `src-tauri/src/commands.rs` (add `set_dnd_mode(enabled: bool)`)
- `src-tauri/src/lib.rs` (register `set_dnd_mode`)
- `index.html` (add DND status indicator and manual presentation toggle in header)
- `src/main.ts` (handle DND toggle and automatic presentation detection via fullscreen change events)

**Out of scope**:
- Native kernel extensions or private macOS frameworks.
- Silencing non-FocusGaze third party notifications.

## Steps

### Step 1: Add break deferral in `src-tauri/src/db/mod.rs`

1. In `src-tauri/src/db/mod.rs`, implement `increment_break_deferred`:
   ```rust
   pub fn increment_break_deferred(&self, date_str: &str) -> Result<()> {
       self.conn.execute(
           "INSERT INTO daily_stats (date, breaks_deferred)
            VALUES (?1, 1)
            ON CONFLICT(date) DO UPDATE SET breaks_deferred = breaks_deferred + 1",
           params![date_str],
       )?;
       Ok(())
   }
   ```

**Verify**: `cargo test` in `src-tauri` passes.

### Step 2: Implement DND / Presentation awareness in `src-tauri/src/state_machine.rs`

1. In `StateMachine`:
   - Add field `pub is_dnd_active: bool`.
   - Add field `pub dnd_deferred_seconds: i64`.
2. Add method:
   ```rust
   pub fn set_dnd_active(&mut self, active: bool) {
       self.is_dnd_active = active;
   }
   
   pub fn defer_break(&mut self, reason: &str) {
       let today = Utc::now().format("%Y-%m-%d").to_string();
       if let Ok(db) = self.db.lock() {
           let _ = db.increment_break_deferred(&today);
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
       // Reset work counter slightly so it re-checks in 5 minutes (300 seconds) rather than every second
       self.current_work_seconds = self.work_interval_seconds.saturating_sub(300);
   }
   ```
3. In `tick_second()`:
   - When `self.current_work_seconds >= self.work_interval_seconds`:
     ```rust
     if self.is_dnd_active {
         self.defer_break("dnd_presentation");
     } else {
         self.initiate_break_prompt();
     }
     ```
4. In `StateSnapshot`: add `pub is_dnd_active: bool`.

**Verify**: `cargo test` in `src-tauri` passes.

### Step 3: Expose IPC command and connect frontend presentation events

1. In `src-tauri/src/commands.rs`:
   ```rust
   #[tauri::command]
   pub fn set_dnd_mode(enabled: bool, state: State<'_, AppSharedState>) -> StateSnapshot {
       let mut sm = state.sm.lock().unwrap();
       sm.set_dnd_active(enabled);
       sm.snapshot()
   }
   ```
2. Register `commands::set_dnd_mode` in `src-tauri/src/lib.rs`.
3. In `index.html`, add presentation mode toggle button in `#app` header next to settings button:
   ```html
   <button id="btn-toggle-dnd" class="btn-icon" title="Presentation / DND Mode (Defers breaks)">
     <span class="dnd-icon">🔕</span>
   </button>
   ```
4. In `src/main.ts`:
   - Bind click on `#btn-toggle-dnd` to call `invoke("set_dnd_mode", { enabled: !isDndActive })`.
   - Listen to `window.addEventListener("fullscreenchange", ...)` to auto-activate DND when the browser or secondary display enters full-screen presentation mode.

**Verify**: `npm run build` exits 0.

## Test plan

- Unit test in `src-tauri/src/state_machine.rs`:
  - `test_dnd_break_deferral`: set `sm.set_dnd_active(true)`, tick until `current_work_seconds >= work_interval_seconds`, verify `state` remains `TrackingActive` (NOT `BreakPrompt`), `breaks_deferred` increments, and `current_work_seconds` is deferred.
- Verification command: `cargo test -- state_machine::tests::test_dnd` → passes.

## Done criteria

- [ ] `cargo test` passes with new deferral test.
- [ ] `npm run build` exits 0.
- [ ] Enabling presentation mode prevents break overlay popups and logs `deferred`.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If deferring breaks resets total daily active seconds (ensure `active_seconds` continues to increment while working in presentation mode).
