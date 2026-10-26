# Plan 001: Fix Break Prompt Flow, Break Mode Overlay, and Breaks Taken Statistics

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check if git is initialized (`git status`). If git is tracked, run:
> `git diff --stat HEAD -- src-tauri/src/state_machine.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/main.ts index.html src/style.css`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `uncommitted`, 2026-10-14
- **Issue**: none

## Why this matters

FocusGaze's primary value proposition is guiding users into scheduled rest breaks. Currently, clicking "Start Break Mode" in the break prompt modal immediately invokes `complete_break({ taken: true })`, instantly resetting the work interval back to `TrackingActive` without ever running the break timer or showing break guidance. Additionally, completed breaks are not propagated in `StateSnapshot`, preventing the dashboard from reflecting breaks taken. Fixing this restores the fundamental break loop: Prompt -> Break Mode with countdown & stretch guidance -> Finish/Resume.

## Current state

Relevant files:
- `src-tauri/src/state_machine.rs` — Core state machine, timers, and snapshot generation.
- `src-tauri/src/commands.rs` — Tauri IPC commands exposed to the frontend webview.
- `src-tauri/src/lib.rs` — Tauri application setup and command handler registration.
- `src/main.ts` — Frontend state renderer, event listener registrations, and timer display.
- `index.html` — HTML shell including `#break-modal` and stats elements.
- `src/style.css` — Stylesheet for dashboard cards, modal, and break overlay.

Current code excerpts:

1. `src/main.ts:315-318`:
```typescript
  // Modal Actions
  btnFinishBreak.addEventListener('click', async () => {
    const snapshot = await invoke<StateSnapshot>('complete_break', { taken: true });
    renderState(snapshot);
  });
```

2. `src-tauri/src/state_machine.rs:260-265` and `315-338`:
```rust
    pub fn take_break_now(&mut self) {
        if self.state != AppTrackingState::BreakMode {
            self.initiate_break_prompt();
            self.transition_to(AppTrackingState::BreakMode);
        }
    }
```
```rust
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
        self.snoozes_used = 0;
        self.transition_to(AppTrackingState::TrackingActive);
    }
```

3. `src-tauri/src/state_machine.rs:23-42`:
`StateSnapshot` contains `skips_today: i64`, but lacks `breaks_taken_today: i64`.

Repo conventions:
- Rust commands in `src-tauri/src/commands.rs` accept `state: State<'_, AppSharedState>` and return `StateSnapshot` or `Result<T, String>`.
- Frontend invokes Tauri commands via `invoke<StateSnapshot>('command_name', { ...args })`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Frontend build / typecheck | `npx tsc --noEmit` | exit 0, no errors |
| Rust check | `cargo check` (in `src-tauri`) | exit 0, no errors |
| Rust test | `cargo test` (in `src-tauri`) | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src/main.ts`
- `index.html`
- `src/style.css`

**Out of scope**:
- Database schema changes (`daily_stats` already has `breaks_taken` column).
- Camera/MediaPipe detection algorithms.
- Tray icon generation.

## Steps

### Step 1: Add `start_break` method and `breaks_taken_today` to `StateMachine`

In `src-tauri/src/state_machine.rs`:
1. Add `pub breaks_taken_today: i64` to `StateSnapshot` struct.
2. In `StateMachine::snapshot(&self)`:
   Set `breaks_taken_today: stats.breaks_taken`.
3. Add `pub fn start_break(&mut self)` to `StateMachine`:
   ```rust
   pub fn start_break(&mut self) {
       if self.current_break_id.is_none() {
           self.initiate_break_prompt();
       }
       self.break_seconds_elapsed = 0;
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
   ```
4. Update `take_break_now(&mut self)` to call `self.start_break()`.

**Verify**: `cargo test` (in `src-tauri`) → all tests pass.

---

### Step 2: Expose `start_break` command in Tauri backend

In `src-tauri/src/commands.rs`:
Add:
```rust
#[tauri::command]
pub fn start_break(state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.start_break();
    sm.snapshot()
}
```

In `src-tauri/src/lib.rs`:
Add `commands::start_break` to the `tauri::generate_handler![...]` macro list at line 94.

**Verify**: `cargo check` (in `src-tauri`) → exit 0, compiles cleanly.

---

### Step 3: Add Break Mode overlay UI in `index.html` and `src/style.css`

In `index.html`:
1. Add a dedicated Break Mode full-screen / overlay card (`#break-mode-overlay`) inside `#app` or as a top-level overlay:
```html
<div id="break-mode-overlay" class="break-mode-overlay hidden">
  <div class="break-mode-card">
    <div class="break-mode-header">
      <span class="break-badge">BREAK IN PROGRESS</span>
      <h2 id="break-mode-timer">00:00</h2>
      <p class="break-subtext">Rest your eyes: Look at an object 20 feet away, stretch your neck and shoulders.</p>
    </div>
    <div class="break-progress-wrap">
      <div id="break-mode-progress-bar" class="break-mode-progress-bar" style="width: 0%"></div>
    </div>
    <div class="break-actions">
      <button id="btn-end-break-early" class="btn btn-secondary">End Break Early</button>
    </div>
  </div>
</div>
```
2. In `src/style.css`, add styling for `.break-mode-overlay`:
Centered modal or backdrop, `background: rgba(10, 13, 20, 0.9)`, glassmorphic card with clear timer typography, smooth progress bar, and primary/secondary button styling matching existing design tokens.

**Verify**: `npx tsc --noEmit` → exit 0.

---

### Step 4: Update `src/main.ts` to manage Break Mode overlay and stats

In `src/main.ts`:
1. Update `StateSnapshot` interface:
   Add `breaks_taken_today: number;`
2. Get references to `#break-mode-overlay`, `#break-mode-timer`, `#break-mode-progress-bar`, `#btn-end-break-early`.
3. In `renderState(snapshot)`:
   - When `snapshot.state === 'BreakMode'`:
     - Show `breakModeOverlayEl.classList.remove('hidden')`.
     - Hide `breakModalEl.classList.add('hidden')`.
     - Calculate remaining break seconds: `Math.max(0, snapshot.break_interval_seconds - snapshot.break_seconds_elapsed)`.
     - Format as `MM:SS` in `breakModeTimerEl`.
     - Update progress bar: `(snapshot.break_seconds_elapsed / snapshot.break_interval_seconds) * 100`.
   - When `snapshot.state !== 'BreakMode'`:
     - Hide `breakModeOverlayEl.classList.add('hidden')`.
   - Update `statBreaksCountEl`:
     `statBreaksCountEl.textContent = `${snapshot.breaks_taken_today} taken • ${snapshot.skips_today} skipped`;`
4. Update button listeners:
   - `btnFinishBreak.addEventListener('click', async () => { const snap = await invoke<StateSnapshot>('start_break'); renderState(snap); });`
   - `btnEndBreakEarly.addEventListener('click', async () => { const snap = await invoke<StateSnapshot>('complete_break', { taken: true }); renderState(snap); });`

**Verify**: `npx tsc --noEmit` → exit 0.

## Test plan

1. In `src-tauri/src/state_machine.rs` `mod tests`:
   Add `test_start_break_and_completion()`:
   - Create state machine with in-memory DB.
   - Call `sm.start_break()`.
   - Assert `sm.state == AppTrackingState::BreakMode`.
   - Assert `sm.snapshot().breaks_taken_today == 0`.
   - Tick until `sm.break_seconds_elapsed >= sm.break_interval_seconds`.
   - Assert `sm.state == AppTrackingState::TrackingActive`.
   - Assert `sm.snapshot().breaks_taken_today == 1`.
2. Run `cargo test` in `src-tauri`. All 7 tests must pass.

## Done criteria

- [ ] `cargo check` in `src-tauri` exits 0 with no warnings or errors.
- [ ] `cargo test` in `src-tauri` exits 0 with all unit tests passing.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] Clicking "Start Break Mode" in UI triggers `start_break` and opens the Break Mode overlay.
- [ ] Dashboard stat label displays `<N> taken • <N> skipped`.
- [ ] No files outside in-scope list are modified.
- [ ] Status row updated in `plans/README.md`.

## STOP conditions

- If `db.update_daily_break_count` does not increment `breaks_taken`, STOP and verify `db/mod.rs` query logic before editing.
- If Tauri IPC serialization fails on `breaks_taken_today`, verify field name matches exactly in Rust struct and TypeScript interface.
