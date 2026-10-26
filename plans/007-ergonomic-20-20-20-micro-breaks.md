# Plan 007: Implement Ergonomic 20-20-20 Eye-Rest Micro-Breaks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/state_machine.rs`. If signatures or structures
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

The core product mission in `PRODUCT.md` is preventing digital eye strain and asthenopia. The American Academy of Ophthalmology recommends the 20-20-20 rule: every 20 minutes, look at an object at least 20 feet away for 20 seconds. FocusGaze currently only triggers macro-breaks (every 50 minutes for 10 minutes), missing the primary clinical window to relax ciliary eye muscles. Adding a lightweight, non-intrusive micro-break prompt every 20 minutes directly fulfills this health requirement.

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs` — manages state and increments work time in `tick_second()`.
  - `src-tauri/src/commands.rs` — provides IPC bridge to frontend.
  - `index.html` — mentions 20-20-20 in `#break-mode-overlay` but has no toast/overlay for micro-breaks.
  - `src/main.ts` — receives state updates and renders UI.
  - `src/style.css` — dark mode theme styling.
- Current excerpt (`src-tauri/src/state_machine.rs:200-209`):
```rust
self.current_work_seconds += 1;

if let Ok(db) = self.db.lock() {
    let _ = db.increment_daily_seconds(&today, 1, 1);
}

if self.current_work_seconds >= self.work_interval_seconds {
    self.initiate_break_prompt();
}
```
- Repo conventions:
  - Non-blocking state: micro-breaks should not interrupt keyboard/mouse flow with a blocking full-screen modal; they appear as an ambient 20-second countdown pill or banner.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cargo test` (in `src-tauri`) | all pass |
| Rust check | `cargo check` (in `src-tauri`) | exit 0 |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs` (add `micro_break_work_seconds`, `is_micro_break_active`, and `micro_break_seconds_left` to `StateMachine` and `StateSnapshot`)
- `src-tauri/src/commands.rs` (add `dismiss_micro_break` command)
- `src-tauri/src/lib.rs` (register `dismiss_micro_break`)
- `index.html` (add `#micro-break-toast` element)
- `src/style.css` (style micro-break toast with ambient countdown and calm pulse)
- `src/main.ts` (render micro-break toast when active)

**Out of scope**:
- Replacing or modifying macro-break 50/10 timer logic.
- Native OS system audio playback if sound setting is disabled.

## Steps

### Step 1: Add micro-break tracking to `StateMachine`

1. In `src-tauri/src/state_machine.rs`:
   - Add fields to `StateMachine`:
     ```rust
     pub micro_break_work_seconds: i64,
     pub micro_break_countdown: i64, // 20 seconds when active
     pub micro_break_enabled: bool,
     ```
   - Add fields to `StateSnapshot`:
     ```rust
     pub is_micro_break_active: bool,
     pub micro_break_seconds_left: i64,
     ```
2. In `StateMachine::tick_second()`:
   - When in `TrackingActive`:
     ```rust
     if self.micro_break_enabled {
         if self.micro_break_countdown > 0 {
             self.micro_break_countdown -= 1;
         } else {
             self.micro_break_work_seconds += 1;
             if self.micro_break_work_seconds >= 1200 { // 20 minutes
                 self.micro_break_work_seconds = 0;
                 self.micro_break_countdown = 20; // 20-second rest
             }
         }
     }
     ```
3. Add `pub fn dismiss_micro_break(&mut self)` resetting `self.micro_break_countdown = 0`.
4. Include `is_micro_break_active: self.micro_break_countdown > 0` and `micro_break_seconds_left: self.micro_break_countdown` in `snapshot()`.

**Verify**: `cargo test` in `src-tauri` passes.

### Step 2: Expose IPC command in `commands.rs` and `lib.rs`

1. In `src-tauri/src/commands.rs`:
   ```rust
   #[tauri::command]
   pub fn dismiss_micro_break(state: State<'_, AppSharedState>) -> StateSnapshot {
       let mut sm = state.sm.lock().unwrap();
       sm.dismiss_micro_break();
       sm.snapshot()
   }
   ```
2. Register `commands::dismiss_micro_break` in `src-tauri/src/lib.rs`.

**Verify**: `cargo check` in `src-tauri` exits 0.

### Step 3: Implement the ambient UI toast in `index.html`, `style.css`, and `main.ts`

1. In `index.html`, add `#micro-break-toast` inside `#app`:
   ```html
   <div id="micro-break-toast" class="micro-break-toast hidden" role="alert" aria-live="polite">
     <div class="micro-toast-icon">👁️</div>
     <div class="micro-toast-body">
       <strong>20-20-20 Eye Rest</strong>
       <p>Look at an object 20 feet away (<span id="micro-timer">20s</span>)</p>
     </div>
     <button id="btn-dismiss-micro" class="btn-micro-dismiss" title="Dismiss">✕</button>
   </div>
   ```
2. In `src/style.css`, style `.micro-break-toast`:
   - Fixed position bottom-center, high contrast border, emerald accent glow (`rgba(16, 185, 129, 0.2)`), smooth entry animation (`transform: translateY(0)`).
3. In `src/main.ts`:
   - In `updateUIFromSnapshot`: if `snapshot.is_micro_break_active`, remove `.hidden`, update `#micro-timer` text to `${snapshot.micro_break_seconds_left}s`. Else add `.hidden`.
   - Add click listener on `#btn-dismiss-micro` calling `invoke("dismiss_micro_break")`.

**Verify**: `npm run build` exits 0.

## Test plan

- Unit tests in `src-tauri/src/state_machine.rs`:
  - `test_micro_break_trigger_and_dismiss`: tick 1200 seconds in `TrackingActive`, verify `is_micro_break_active` becomes `true` with `micro_break_seconds_left == 20`, then call `dismiss_micro_break()` and verify `is_micro_break_active` returns to `false`.
- Verification command: `cargo test -- state_machine::tests::test_micro_break` → passes.

## Done criteria

- [ ] `cargo test` exits 0 with new micro-break test passing.
- [ ] `npm run build` exits 0.
- [ ] Micro-break toast appears when triggered and auto-dismisses after 20 seconds.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If micro-break triggers while user is in `PausedAway` or `BreakMode` (ensure it only increments during `TrackingActive`).
