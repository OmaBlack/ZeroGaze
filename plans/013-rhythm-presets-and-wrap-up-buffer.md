# Plan 013: Implement Focus Rhythm Presets and "Wrap-Up" Grace Buffer

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/state_machine.rs` and `src/main.ts`. If
> break prompt handling or settings storage has changed, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md), [004](004-settings-modal-and-privacy-management.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-15

## Why this matters

Knowledge workers operate in different cognitive cadences: sprint debugging benefits from classic Pomodoro (25/5), while deep architecture sessions require Ultradian rhythms (90/20). Requiring manual interval calculation in settings creates friction. Furthermore, when a focus interval ends abruptly mid-thought, forced break prompts cause irritation; providing a dedicated "Wrap Up (2 min)" soft grace buffer preserves flow state without breaking the user's break discipline.

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs:242-248`: Break prompt timer auto-starts break mode after 120 seconds.
  - `src-tauri/src/commands.rs:40-71`: `update_setting` saves `work_interval_minutes` and `break_interval_minutes`.
  - `index.html:198-206`: Settings modal has raw number inputs for work and break intervals.
  - `index.html:150-165`: `#break-modal` has "Take Break Now", "Snooze (5m)", and "Skip Break".
  - `src/main.ts:564-585`: `openSettings()` loads settings from SQLite.

Excerpts:
`src-tauri/src/state_machine.rs:242-248`:
```rust
AppTrackingState::BreakPrompt => {
    self.break_prompt_seconds_elapsed += 1;
    if self.break_prompt_seconds_elapsed >= 120 {
        self.start_break();
    }
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend build & check | `npm run build` | exit 0, bundle generated in `dist/` |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`: Add `wrap_up_buffer_seconds` (default 0). When `wrap_up_break()` is called, add 120s to the break prompt grace window and record event in DB. Expose in `StateSnapshot`.
- `src-tauri/src/commands.rs`: Add `wrap_up_break` command returning `StateSnapshot`.
- `src-tauri/src/lib.rs`: Register `wrap_up_break` in `generate_handler!`.
- `index.html`:
  - Add preset rhythm buttons in `#settings-modal`: `FocusGaze 50/10`, `Pomodoro 25/5`, `Ultradian 90/20`.
  - Add "Wrap Up (2m)" button in `#break-modal`.
- `src/main.ts`:
  - Bind preset rhythm buttons to populate `settingWorkInterval` and `settingBreakInterval`.
  - Bind "Wrap Up (2m)" button to `invoke('wrap_up_break')`.
- `src/style.css`: Add styles for rhythm preset button pill group.

**Out of scope**:
- Changing existing SQLite database schema or tables.
- Modifying core presence detection logic.

## Steps

### Step 1: Add `wrap_up_break` to State Machine & Tauri Commands

In `src-tauri/src/state_machine.rs`:
1. Add field `pub is_wrap_up_active: bool` and `pub wrap_up_seconds_left: i64` to `StateMachine` and `StateSnapshot`.
2. Add method `pub fn wrap_up_break(&mut self) -> bool`:
   - If in `AppTrackingState::BreakPrompt`, set `is_wrap_up_active = true` and `wrap_up_seconds_left = 120`.
   - Log event `"break_wrap_up_requested"` in SQLite.
3. In `tick_second()`, if `is_wrap_up_active` is true and `wrap_up_seconds_left > 0`, decrement it. If it reaches 0, transition to `start_break()`.
4. In `src-tauri/src/commands.rs`, add:
   ```rust
   #[tauri::command]
   pub fn wrap_up_break(state: State<'_, AppSharedState>) -> StateSnapshot {
       let mut sm = state.sm.lock().unwrap();
       sm.wrap_up_break();
       sm.snapshot()
   }
   ```
5. Register in `src-tauri/src/lib.rs`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add Rhythm Preset Buttons to Settings Modal

In `index.html` inside `#settings-modal`:
1. Add `<div class="setting-item rhythm-presets-container">` with three preset buttons:
   - `<button type="button" class="btn-preset" data-work="50" data-break="10">Standard (50/10)</button>`
   - `<button type="button" class="btn-preset" data-work="25" data-break="5">Pomodoro (25/5)</button>`
   - `<button type="button" class="btn-preset" data-work="90" data-break="20">Deep Flow (90/20)</button>`
2. In `src/main.ts`, add event listeners to `.btn-preset` buttons:
   - On click, update `settingWorkInterval.value` and `settingBreakInterval.value`.
   - Add `.active-preset` class to selected button.

**Verify**:
`npm run build` → exits 0.

### Step 3: Wire "Wrap Up (2m)" Action in Break Prompt Modal

In `index.html`:
1. Add `<button id="btn-wrap-up-break" class="btn btn-secondary">Wrap Up (2 min)</button>` inside `#break-modal .modal-actions`.
2. In `src/main.ts`:
   - Bind click event to `invoke<StateSnapshot>('wrap_up_break')`.
   - When snapshot indicates `is_wrap_up_active`, update `#break-prompt-timer` to show `"Wrapping up: Xs remaining"`.

**Verify**:
`npm run build` → exits 0.

## Test plan

- **Unit test**: In `src-tauri/src/state_machine.rs`, write `test_wrap_up_break_countdown`:
  - Trigger `initiate_break_prompt()`.
  - Call `wrap_up_break()`. Verify `is_wrap_up_active` is true and `wrap_up_seconds_left == 120`.
  - Tick 120 seconds and assert transition to `AppTrackingState::BreakMode`.
- **Frontend test**: Verify `npm run build` completes with 0 errors.

## Done criteria

- [x] `npm run build` exits 0.
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] Preset buttons select 50/10, 25/5, and 90/20 in Settings.
- [x] `plans/README.md` row updated to DONE.


## STOP conditions

- If adding preset rhythm values overrides user-customized intervals without confirmation, preserve custom input fields as editable overrides.
