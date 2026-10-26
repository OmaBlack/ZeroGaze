# Plan 004: Implement Settings and Privacy Management Modal with Data Controls

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check if git is initialized (`git status`). If git is tracked, run:
> `git diff --stat HEAD -- src-tauri/src/commands.rs src-tauri/src/lib.rs index.html src/style.css src/main.ts`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-break-flow-and-stats.md
- **Category**: architecture / dx
- **Planned at**: commit `uncommitted`, 2026-10-14
- **Issue**: none

## Why this matters

The system tray menu contains items for "Settings" and "Privacy Explainer" that emit Tauri window events (`"navigate", "settings"` and `"navigate", "privacy"`). However, the frontend has no listeners or UI views for these events, preventing users from configuring their work/break intervals, grace period, snooze limits, or sound preferences. Furthermore, while the Rust database already implements `delete_all_user_data()`, there is no way for privacy-conscious users to execute it. This plan connects tray navigation, builds a clean Settings & Privacy modal, and surfaces user data controls.

## Current state

Relevant files:
- `src-tauri/src/tray.rs` — Emits `"navigate", "settings"` and `"navigate", "privacy"`.
- `src-tauri/src/commands.rs` — Has `get_settings` and `update_setting`, but missing `delete_all_data`.
- `src-tauri/src/db/mod.rs` — Implements `delete_all_user_data()`.
- `src-tauri/src/lib.rs` — Command handler registration.
- `index.html` — Main UI, currently lacking a settings button and settings modal.
- `src/main.ts` — Lacks `listen('navigate')` and settings form bindings.

Current code excerpts:

1. `src-tauri/src/tray.rs:107-120`:
```rust
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "settings");
                }
            }
            "privacy" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "privacy");
                }
            }
```

2. `src-tauri/src/db/mod.rs:333-345`:
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
|---------|---------|---------------------|
| Frontend check | `npx tsc --noEmit` | exit 0, no errors |
| Rust check | `cargo check` (in `src-tauri`) | exit 0, no errors |
| Rust test | `cargo test` (in `src-tauri`) | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `index.html`
- `src/style.css`
- `src/main.ts`

**Out of scope**:
- Remote cloud backup or sync (FocusGaze is strictly local).
- Modifying default setting keys in `db/mod.rs`.

## Steps

### Step 1: Expose `delete_all_data` in Tauri backend

In `src-tauri/src/commands.rs`:
Add command:
```rust
#[tauri::command]
pub fn delete_all_data(state: State<'_, AppSharedState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_all_user_data().map_err(|e| e.to_string())
}
```

In `src-tauri/src/lib.rs`:
Add `commands::delete_all_data` to `tauri::generate_handler![...]`.

**Verify**: `cargo check` in `src-tauri` → exit 0.

---

### Step 2: Add Settings & Privacy Modal in `index.html` and `src/style.css`

In `index.html`:
1. In the header right-side area, add a Settings icon button (`#btn-open-settings`):
```html
<button id="btn-open-settings" class="btn-icon" title="Settings & Privacy">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="3"></circle>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
  </svg>
</button>
```

2. Add the Settings modal markup (`#settings-modal`):
```html
<div id="settings-modal" class="modal-backdrop hidden">
  <div class="settings-card">
    <div class="modal-header">
      <h3>Preferences & Privacy</h3>
      <button id="btn-close-settings" class="btn-icon">✕</button>
    </div>
    <div class="settings-body">
      <div class="setting-item">
        <label for="setting-work-interval">Focus Interval (minutes)</label>
        <input type="number" id="setting-work-interval" min="5" max="180" value="50" />
      </div>
      <div class="setting-item">
        <label for="setting-break-interval">Break Duration (minutes)</label>
        <input type="number" id="setting-break-interval" min="1" max="60" value="10" />
      </div>
      <div class="setting-item">
        <label for="setting-grace-period">Grace Period (seconds)</label>
        <input type="number" id="setting-grace-period" min="10" max="300" value="60" />
      </div>
      <div class="setting-item">
        <label for="setting-snooze-limit">Max Snoozes per Break</label>
        <input type="number" id="setting-snooze-limit" min="0" max="10" value="2" />
      </div>
      <div class="setting-item">
        <label for="setting-tracking-mode">Tracking Mode</label>
        <select id="setting-tracking-mode">
          <option value="Auto">Auto (Webcam with Input Fallback)</option>
          <option value="Webcam only">Webcam only</option>
          <option value="Input only">Input only (Mouse & Keyboard)</option>
        </select>
      </div>

      <div class="settings-danger-zone">
        <h4>Data Management</h4>
        <p class="text-sm text-muted">All logs and statistics are stored locally on your machine.</p>
        <button id="btn-delete-all-data" class="btn btn-danger">Delete All Local Data</button>
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-save-settings" class="btn btn-primary">Save Changes</button>
    </div>
  </div>
</div>
```

3. In `src/style.css`, add styling for `.modal-backdrop`, `.settings-card`, `.setting-item`, and `.settings-danger-zone`.

**Verify**: `npx tsc --noEmit` → exit 0.

---

### Step 3: Wire Settings in `src/main.ts`

In `src/main.ts`:
1. Listen to `"navigate"` event from Tauri:
   ```typescript
   listen<string>('navigate', (event) => {
     if (event.payload === 'settings' || event.payload === 'privacy') {
       openSettingsModal();
     }
   });
   ```
2. Implement `loadSettings()`:
   Fetch settings via `invoke<Record<string, string>>('get_settings')` and populate form inputs.
3. Implement `saveSettings()`:
   Iterate inputs and call `invoke('update_setting', { key, value })`.
   Re-fetch `get_state` and update UI.
4. Wire `#btn-delete-all-data`:
   Confirm via `confirm('Are you sure you want to delete all local history and statistics?')`.
   If confirmed, call `invoke('delete_all_data')` and re-render initial state.

**Verify**: `npx tsc --noEmit` → exit 0.

## Test plan

- Test manually or through unit testing:
  1. Open settings modal via gear button or tray `"navigate"` event.
  2. Change work interval from 50 to 45 minutes; save settings.
  3. Verify `get_settings` returns `"work_interval_minutes": "45"` and `work_interval_seconds` updates to 2700 in `StateSnapshot`.
  4. Click "Delete All Local Data"; verify `delete_all_data` executes cleanly and daily stats reset to zero.

## Done criteria

- [ ] `cargo check` and `cargo test` in `src-tauri` pass with 0 errors.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] Clicking Settings icon in UI or tray opens the Preferences modal.
- [ ] Changing intervals updates database and state machine immediately.
- [ ] "Delete All Local Data" triggers `delete_all_data` IPC command.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `update_setting` fails to update `work_interval_seconds` in `StateMachine`, verify the lock acquisition on `state.sm` in `commands.rs`.
