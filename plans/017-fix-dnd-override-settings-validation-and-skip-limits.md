# Plan 017: Fix Manual DND Override Clobbering, Enforce Settings Bounds & State Reset on Data Deletion, and Enforce Daily Skip Limits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts below
> against `src-tauri/src/state_machine.rs`, `src-tauri/src/commands.rs`,
> `src-tauri/src/db/mod.rs`, `src/main.ts`, and `index.html`. On a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [016](016-enforce-tracking-mode-and-pause-sync.md)
- **Category**: bug
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

Three logic bugs currently undermine user control in FocusGaze:
1. **Manual DND Override Clobbering**: `src/main.ts` defines `let manualDndOverride = false` and polls `checkPresentationState()` every 10 seconds, which disables DND whenever `!isOsPres && isDndActive && !manualDndOverride`. Because `manualDndOverride` is never set to `true` when the user clicks `#btn-toggle-dnd` or presses `Cmd/Ctrl+Shift+D`, manually enabling DND is silently reverted within 10 seconds.
2. **Unvalidated Settings & Dirty State on Data Deletion**: `commands::update_setting` accepts `0` or negative numbers for `work_interval_minutes` and `break_interval_minutes` (causing an infinite `BreakPrompt` loop every second), preset buttons mutate backend settings before the user clicks "Save Preferences", and `delete_all_data` wipes SQLite tables without resetting the in-memory `StateMachine` or restoring default settings.
3. **Unenforced Daily Skip Limit & Blind Snooze Button**: `skip_limit` is stored in SQLite and `StateSnapshot` (`prd.md:207`, `FEATURES.md:49`), but `skip_break()` never checks it, `#settings-modal` has no input for `skip_limit`, and `#btn-snooze-break` does not display remaining snoozes or disable itself when `snoozes_used >= snooze_limit`.

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs` — `StateMachine::reset()`, `skip_break()`, `snooze_break()`.
  - `src-tauri/src/commands.rs` — `update_setting`, `delete_all_data`.
  - `src-tauri/src/db/mod.rs` — `delete_all_user_data`.
  - `src/main.ts` — `manualDndOverride`, `checkPresentationState`, `renderState`, `openSettings`, `saveSettings`, `.btn-preset` click handler.
  - `index.html` — `#settings-modal` inputs.

- Current code excerpts:

`src/main.ts:724-739`:
```ts
// Plan 012: Automated OS Presentation / Meeting Detection
let manualDndOverride = false;

async function checkPresentationState() {
  try {
    const isOsPres = await invoke<boolean>('check_os_presentation_mode');
    if (isOsPres && !isDndActive && !manualDndOverride) {
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: true });
      renderState(snapshot);
    } else if (!isOsPres && isDndActive && !manualDndOverride) {
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: false });
      renderState(snapshot);
    }
  } catch {
    // Graceful fallback if platform does not support presentation query
  }
}
```

`src-tauri/src/commands.rs:40-71`:
```rust
#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, AppSharedState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_setting(&key, &value).map_err(|e| e.to_string())?;

    if let Ok(mut sm) = state.sm.lock() {
        if key == "work_interval_minutes" {
            if let Ok(mins) = value.parse::<i64>() {
                sm.work_interval_seconds = mins * 60;
            }
        } else if key == "break_interval_minutes" {
            if let Ok(mins) = value.parse::<i64>() {
                sm.break_interval_seconds = mins * 60;
            }
...
```

`src-tauri/src/commands.rs:119-122`:
```rust
#[tauri::command]
pub fn delete_all_data(state: State<'_, AppSharedState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_all_user_data().map_err(|e| e.to_string())
}
```

`src-tauri/src/db/mod.rs:460-472`:
```rust
    pub fn delete_all_user_data(&self) -> Result<()> {
        self.conn.execute_batch(
            "
            DELETE FROM sessions;
            DELETE FROM breaks;
            DELETE FROM daily_stats;
            DELETE FROM events;
            DELETE FROM telemetry_queue;
            VACUUM;
            ",
        )?;
        Ok(())
    }
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend typecheck & build | `npm run build` | exit 0, bundle generated in `dist/` |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/db/mod.rs`
- `src/main.ts`
- `index.html`

**Out of scope**:
- `src/style.css` (existing `.setting-item` and `.modal-buttons` styles already support these controls).
- `src-tauri/src/idle.rs` and `src-tauri/src/tray.rs`.

## Steps

### Step 1: Fix `manualDndOverride` Tracking in `src/main.ts`

In `src/main.ts`:
1. In the `#btn-toggle-dnd` click listener (`lines 910-915`):
   ```ts
   if (btnToggleDnd) {
     btnToggleDnd.addEventListener('click', async () => {
       const nextDnd = !isDndActive;
       manualDndOverride = nextDnd;
       const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: nextDnd });
       renderState(snapshot);
     });
   }
   ```
2. In the `Cmd/Ctrl+Shift+D` shortcut handler (`lines 1060-1064`):
   ```ts
   } else if (e.key.toLowerCase() === 'd') {
     e.preventDefault();
     const nextDnd = !isDndActive;
     manualDndOverride = nextDnd;
     const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: nextDnd });
     renderState(snapshot);
   }
   ```

**Verify**:
`npm run build` → exits 0.

### Step 2: Validate Settings Bounds, Reset Settings & `StateMachine` on `delete_all_data`

1. In `src-tauri/src/db/mod.rs`:
   - In `delete_all_user_data(&self)` (`lines 460-472`), also `DELETE FROM settings;` and call `self.seed_default_settings()?;` before returning `Ok(())`, so deleting all user data restores default preferences as required by `prd.md:255`.
2. In `src-tauri/src/state_machine.rs`:
   - Add `pub fn reset(&mut self)`:
     ```rust
     pub fn reset(&mut self) {
         self.current_work_seconds = 0;
         self.grace_seconds_elapsed = 0;
         self.break_prompt_seconds_elapsed = 0;
         self.break_seconds_elapsed = 0;
         self.snoozes_used = 0;
         self.current_break_id = None;
         self.micro_break_work_seconds = 0;
         self.micro_break_countdown = 0;
         self.is_dnd_active = false;
         self.is_wrap_up_active = false;
         self.wrap_up_seconds_left = 0;
         self.is_paused = false;
         self.work_interval_seconds = 50 * 60;
         self.break_interval_seconds = 10 * 60;
         self.grace_period_seconds = 60;
         self.snooze_limit = 2;
         self.skip_limit = 2;
         self.set_tracking_mode("Auto".to_string());
         self.transition_to(AppTrackingState::Initializing);
     }
     ```
3. In `src-tauri/src/commands.rs`:
   - In `update_setting(key, value, state)` (`lines 40-71`), validate and clamp numeric values before saving to `db` and updating `sm`:
     - `"work_interval_minutes"`: parse `i64`, reject with `Err("Work interval must be between 1 and 180 minutes".into())` if `< 1 || > 180`.
     - `"break_interval_minutes"`: parse `i64`, reject if `< 1 || > 60`.
     - `"grace_period_seconds"`: parse `i64`, reject if `< 10 || > 300`.
     - `"snooze_limit"`: parse `i32`, reject if `< 0 || > 10`.
     - `"skip_limit"`: parse `i32`, reject if `< 0 || > 10`.
   - In `delete_all_data(state)` (`lines 119-122`), after `db.delete_all_user_data()?`, drop the `db` lock (or lock `state.sm` after releasing `db`) and call `sm.reset()`.
4. In `src/main.ts`:
   - In the `.btn-preset` click handler (`lines 965-977`), only update `settingWorkInterval.value = work` and `settingBreakInterval.value = breakM` in the modal form so changes are committed when the user clicks "Save Preferences" (`saveSettings()`).

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Surface Remaining Snoozes/Skips and Enforce `skip_limit`

1. In `index.html`:
   - Inside `#settings-modal` right after `#setting-snooze-limit`'s `.setting-item` (`around line 233`), add a `.setting-item` for `#setting-skip-limit`:
     ```html
     <div class="setting-item">
       <label for="setting-skip-limit">Daily Skip Limit</label>
       <input type="number" id="setting-skip-limit" min="0" max="10" value="2" />
     </div>
     ```
2. In `src/main.ts`:
   - Bind `const settingSkipLimit = document.getElementById('setting-skip-limit') as HTMLInputElement;`.
   - Load `settings.skip_limit` in `openSettings()` and save `skip_limit` in `saveSettings()`.
   - In `renderState(snapshot)` when `snapshot.state === 'BreakPrompt'` (`lines 258-271`):
     - Compute `const snoozesLeft = Math.max(0, snapshot.snooze_limit - snapshot.snoozes_used);`.
     - Set `btnSnoozeBreak.textContent = snoozesLeft > 0 ? \`Snooze (5m • \${snoozesLeft} left)\` : 'Snooze Limit Reached';`.
     - Set `btnSnoozeBreak.disabled = snoozesLeft === 0;`.
     - Compute `const skipsLeft = Math.max(0, snapshot.skip_limit - snapshot.skips_today);`.
     - Set `btnSkipBreak.textContent = skipsLeft > 0 ? \`Skip Break (\${skipsLeft} left)\` : 'Skip Break (Over Limit)';`.
   - In `btnSkipBreak` click handler (`lines 994-997`):
     - If `btnSkipBreak.textContent?.includes('Over Limit')`, prompt with `confirm('You have reached your daily skip limit. Skipping another break may increase eye strain. Skip anyway?')` before invoking `skip_break`.

**Verify**:
`npm run build` → exits 0.
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 4: Add Unit Tests for Settings Validation and `StateMachine::reset`

In `src-tauri/src/state_machine.rs` (`mod tests`):
1. Add `test_state_machine_reset_clears_counters`:
   - Advance `sm.current_work_seconds = 500`, `sm.snoozes_used = 2`, `sm.is_dnd_active = true`, call `sm.reset()`, and assert all counters are `0`, `is_dnd_active == false`, and `sm.state == AppTrackingState::Initializing`.
2. Add `test_snooze_limit_exhaustion`:
   - Set `sm.snooze_limit = 2`, call `sm.initiate_break_prompt()`, assert first two `sm.snooze_break()` calls return `true`, and assert the 3rd `sm.snooze_break()` call returns `false` with `sm.snoozes_used == 2`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

## Test plan

- File: `src-tauri/src/state_machine.rs` (`#[cfg(test)] mod tests`) and `src-tauri/src/db/mod.rs` (`#[cfg(test)] mod tests`).
- Cases covered:
  - `StateMachine::reset()` restores all session counters, flags, and intervals to clean defaults.
  - `StateMachine::snooze_break()` returns `false` once `snoozes_used >= snooze_limit`.
  - `Database::delete_all_user_data()` clears user logs and re-seeds default settings.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_state_machine_reset_clears_counters` and `test_snooze_limit_exhaustion` pass
- [x] `npm run build` exits 0
- [x] `manualDndOverride` is updated whenever `#btn-toggle-dnd` or `Cmd/Ctrl+Shift+D` is triggered
- [x] `#setting-skip-limit` exists in `index.html` and is wired in `src/main.ts`
- [x] `plans/README.md` status row for Plan 017 updated to `DONE`

## STOP conditions

- Lock ordering deadlock between `state.db` and `state.sm` in `commands::delete_all_data` — always release `state.db` lock before locking `state.sm` (or lock `state.sm` whose `reset()` method does not lock `self.db` while `state.db` is held).
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Lock ordering convention in `src-tauri/src/commands.rs`: `StateMachine` methods (`transition_to`, `log_event`, `snapshot`) internally lock `self.db`. Therefore, in `commands.rs`, **never hold a `state.db.lock()` guard across a `state.sm.lock()` call** — always scope the `db` guard in its own block `{ let db = state.db.lock()...; }` before acquiring `state.sm.lock()`.
