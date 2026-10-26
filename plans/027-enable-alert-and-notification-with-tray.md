# Plan 027: Enable Alerts and Desktop Notifications with System Tray Integration (Including Screen Distance & Posture Slouch Alerts)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check modified files against live code:
> `git diff --stat HEAD -- src-tauri/src/lib.rs src-tauri/src/tray.rs src-tauri/src/commands.rs src-tauri/src/state_machine.rs src-tauri/src/db/mod.rs index.html src/main.ts src/ergonomics.ts src/ergonomics.test.mjs`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [002](002-fix-tray-lifecycle-and-window-close.md), [008](008-smart-presentation-and-dnd-awareness.md), [014](014-interactive-eye-exercises-and-posture-detection.md), [015](015-global-shortcuts-and-tray-countdown.md), [021](021-wire-seeded-settings-and-webaudio-chimes.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze is designed to run persistently in the background as a system tray / menu bar daemon while knowledge workers operate in full-screen IDEs and terminals. Currently, tray alerts and desktop notifications have four critical defects:
1. When a break is prompted (`BreakPrompt`), the tray title clears to `None`, erasing the countdown badge at the exact moment the user needs an urgent rest reminder.
2. When a 20-20-20 micro-break triggers (`is_micro_break_active`), the tray title and notifications ignore it entirely, leaving background users unaware of eye-strain rest intervals.
3. When ergonomic warnings (sitting too close `< 45cm` or poor desk slouching) trigger, they are only rendered on the in-window DOM banner. When the window is minimized to the tray or hidden behind work apps, users receive **zero tray feedback or menu bar alert badges** about their posture drift or excessive proximity to the screen.
4. The tray context menu is completely static: its status item is frozen on `"FocusGaze: Initializing"`, `"Pause Tracking"` never updates to `"Resume Tracking"` when paused, and there are no quick actions to start, snooze, skip breaks, or recalibrate posture from the tray.
5. Notifications ignore DND suppression, lack user configuration toggles in settings, and clicking a notification fails to focus the dashboard.

Fixing this completes the desktop integration promise: rich native OS notifications for macro- and micro-breaks, live glanceable alert badges in the system tray (`⚠️ Move Back!`, `⚠️ Sit Up!`, `⚠️ Posture!`, `⚠️ Break!`, `👁️ 20s`), a dynamic context menu with immediate break and posture calibration controls, and full user preference management.

## Current state

- Relevant files:
  - `src-tauri/src/lib.rs:89-128`: 1-second tick loop updates tray icon/title and emits break prompt notification.
  - `src-tauri/src/tray.rs:66-183`: Builds static tray icon and handles menu events.
  - `src-tauri/src/state_machine.rs:25-80`: `StateSnapshot` and `StateMachine` fields.
  - `src-tauri/src/commands.rs:9-18`: `update_presence` command.
  - `src-tauri/src/commands.rs:40-124`: `update_setting` validation and command dispatch.
  - `src-tauri/src/db/mod.rs:150-182`: `seed_default_settings` defaults.
  - `index.html:470-512`: Settings modal checkbox controls.
  - `src/main.ts:300-348`: `updateErgonomicAlerts` and `updatePostureUI` logic.
  - `src/main.ts:885-905`: CV detection loop invokes `update_presence`.

Current code excerpts:

1. `src-tauri/src/lib.rs:90-105`:
```rust
if snapshot.is_paused {
    let _ = tray.set_title(Some("Paused".to_string()));
    let _ = tray.set_icon(Some(crate::tray::create_colored_icon(234, 179, 8, 255)));
    let _ = tray.set_tooltip(Some("FocusGaze: Tracking paused manually"));
} else if current_state == AppTrackingState::TrackingActive {
    let remaining = snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds);
    let mins_left = (remaining + 59) / 60;
    let _ = tray.set_title(Some(format!("{}m", mins_left)));
} else if current_state == AppTrackingState::BreakMode {
    let break_rem = snapshot.break_interval_seconds.saturating_sub(snapshot.break_seconds_elapsed);
    let break_mins = (break_rem + 59) / 60;
    let _ = tray.set_title(Some(format!("Break {}m", break_mins)));
} else {
    let _ = tray.set_title(None::<String>);
}
```
*(Notice: When `current_state == AppTrackingState::BreakPrompt`, `tray.set_title(None::<String>)` is called! When `snapshot.is_micro_break_active` is true, the title displays normal work minutes left rather than the 20-second ocular rest countdown. When the user is slouching or too close to the screen, the tray title displays normal work minutes left without any alert badge).*

2. `src-tauri/src/state_machine.rs:40-50`:
```rust
pub struct StateSnapshot {
    ...
    pub is_micro_break_active: bool,
    pub micro_break_seconds_left: i64,
    pub is_dnd_active: bool,
    pub is_wrap_up_active: bool,
    pub wrap_up_seconds_left: i64,
    pub is_paused: bool,
}
```
*(Notice: Ergonomic alert states `is_too_close` and `is_slouching` are missing from `StateSnapshot` and `StateMachine`, preventing the tray from knowing if the user is slouching or too close).*

3. `src/main.ts:896-900`:
```rust
const snapshot = await invoke<StateSnapshot>('update_presence', {
  present,
  confidence,
  multiFace,
});
```
*(Notice: `update_presence` passes `present`, `confidence`, `multiFace`, but does not pass `isTooClose` or `isSlouching` derived from the face bounding box).*

4. `src-tauri/src/tray.rs:69-77`:
```rust
let status_item = MenuItemBuilder::with_id("status", "FocusGaze: Initializing")
    .enabled(false)
    .build(app)?;
let dashboard_item = MenuItemBuilder::with_id("dashboard", "Open Dashboard").build(app)?;
let settings_item = MenuItemBuilder::with_id("settings", "Settings").build(app)?;
let toggle_item = MenuItemBuilder::with_id("toggle", "Pause Tracking").build(app)?;
let break_now_item = MenuItemBuilder::with_id("break_now", "Take Break Now").build(app)?;
```
*(Notice: `status_item` is hardcoded to "FocusGaze: Initializing" and never updated. Menu items cannot reflect Break Prompt, Paused, or Posture Slouch states).*

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend build & check | `npm run build` | exit 0, bundle generated in `dist/` |
| Frontend test | `npm test` | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`: Add `is_too_close: bool` and `is_slouching: bool` to `StateMachine` and `StateSnapshot`. Update `handle_presence_update` and `snapshot()`.
- `src-tauri/src/commands.rs`:
  - Update `commands::update_presence` to accept optional `is_too_close: Option<bool>` and `is_slouching: Option<bool>`.
  - Add validation for `"notifications_enabled"`, `"tray_alerts_enabled"`, `"micro_break_notifications"`, `"ergo_tray_alerts"`.
  - Add `commands::send_test_notification`.
- `src-tauri/src/db/mod.rs`: Seed `"notifications_enabled"`, `"tray_alerts_enabled"`, `"micro_break_notifications"`, `"ergo_tray_alerts"`.
- `src-tauri/src/tray.rs`:
  - Add dynamic tray menu builder with context-sensitive status and break/posture actions (`start_break`, `snooze`, `skip`, `toggle`, `dismiss_micro`, `calibrate_posture`).
  - Update tray tooltips and icons for posture/too-close alerts.
- `src-tauri/src/lib.rs`:
  - Update background tick loop to format alert titles:
    - `"Paused"`
    - `"👁️ 20s"` (micro-break)
    - `"⚠️ Break!"` (break prompt)
    - `"⚠️ Move Back!"` (too close `< 45cm`)
    - `"⚠️ Sit Up!"` (slouching)
    - `"⚠️ Posture!"` (too close & slouching)
    - `"Break Xm"` (break mode)
    - `"Xm"` (active focus)
  - Respect DND and notification settings, fire micro-break and break-completion notifications, and handle notification action clicks.
- `index.html`: Add settings checkboxes for notifications, tray badges, micro-break notifications, and ergonomic posture/distance tray alerts, plus a "Send Test Notification" button and OS permission status note.
- `src/main.ts`:
  - Pass `isTooClose` and `isSlouch` to `update_presence`.
  - Wire settings, permission verification via `@tauri-apps/plugin-notification`, test notification dispatch, and notification click navigation.
- `src/ergonomics.ts` & `src/ergonomics.test.mjs`:
  - Add helper for formatting tray title (`formatTrayTitle`) including too-close and slouching alert states, with unit tests.

**Out of scope**:
- Modifying underlying OS event taps or hardware power suspension hooks.
- Modifying MediaPipe model weight files or local storage schemas.

## Steps

### Step 1: Add Ergonomic Alert State in `state_machine.rs` and `commands.rs`

1. In `src-tauri/src/state_machine.rs`:
   - In `StateSnapshot`:
     ```rust
     pub is_too_close: bool,
     pub is_slouching: bool,
     ```
   - In `StateMachine`:
     ```rust
     pub is_too_close: bool,
     pub is_slouching: bool,
     ```
   - In `StateMachine::new()`: initialize `is_too_close: false`, `is_slouching: false`.
   - In `StateMachine::handle_presence_update_with_ergo(&mut self, present: bool, confidence: f32, multi_face: bool, too_close: bool, slouching: bool)`:
     - Update `self.is_too_close = if present { too_close } else { false };`
     - Update `self.is_slouching = if present { slouching } else { false };`
   - In `StateMachine::snapshot()`:
     ```rust
     is_too_close: self.is_too_close,
     is_slouching: self.is_slouching,
     ```
2. In `src-tauri/src/commands.rs`:
   - Update `update_presence`:
     ```rust
     #[tauri::command]
     pub fn update_presence(
         present: bool,
         confidence: f32,
         multi_face: bool,
         is_too_close: Option<bool>,
         is_slouching: Option<bool>,
         state: State<'_, AppSharedState>,
     ) -> StateSnapshot {
         let mut sm = state.sm.lock().unwrap();
         sm.handle_presence_update_with_ergo(
             present,
             confidence,
             multi_face,
             is_too_close.unwrap_or(false),
             is_slouching.unwrap_or(false),
         );
         sm.snapshot()
     }
     ```
3. In `src-tauri/src/db/mod.rs`, add default settings to `seed_default_settings`:
   - `("notifications_enabled", "on")`
   - `("tray_alerts_enabled", "on")`
   - `("micro_break_notifications", "on")`
   - `("ergo_tray_alerts", "on")`
4. In `src-tauri/src/commands.rs` under `update_setting`:
   - Validate `"notifications_enabled"`, `"tray_alerts_enabled"`, `"micro_break_notifications"`, and `"ergo_tray_alerts"` to only accept `"on"` or `"off"`.
5. In `src-tauri/src/commands.rs`:
   - Add `#[tauri::command] pub fn send_test_notification(app: tauri::AppHandle) -> Result<(), String>`.
6. Register `commands::send_test_notification` in `src-tauri/src/lib.rs` `tauri::generate_handler!`.

**Verify**: `cargo check --manifest-path src-tauri/Cargo.toml` -> exit 0

---

### Step 2: Implement Dynamic Context Tray Menu & Tooltip in `tray.rs`

1. In `src-tauri/src/tray.rs`:
   - Define `pub fn create_tray_menu(app: &AppHandle, snapshot: &StateSnapshot) -> Result<tauri::menu::Menu, tauri::Error>`:
     - **Status text**:
       - Paused: `"FocusGaze: Paused"`
       - BreakPrompt: `"FocusGaze: ⚠️ Break Due!"`
       - BreakMode: format!(`"FocusGaze: ☕ Rest ({}m left)"`, (snapshot.break_interval_seconds.saturating_sub(snapshot.break_seconds_elapsed) + 59) / 60)
       - MicroBreak active: format!(`"FocusGaze: 👁️ 20-20-20 Rest ({}s)"`, snapshot.micro_break_seconds_left)
       - Ergonomic Warning (if tracking active & not micro-break):
         - `snapshot.is_too_close && snapshot.is_slouching`: `"FocusGaze: ⚠️ Too Close & Slouching"`
         - `snapshot.is_too_close`: `"FocusGaze: ⚠️ Move Back (<45cm)"`
         - `snapshot.is_slouching`: `"FocusGaze: ⚠️ Slouching Detected"`
       - TrackingActive: format!(`"FocusGaze: 🟢 Focus ({}m left)"`, (snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds) + 59) / 60)
       - Other: `"FocusGaze: Ready / Away"`
     - **Dynamic Context Items**:
       - If `snapshot.state == AppTrackingState::BreakPrompt`:
         - Add `"start_break"` item: `"Start Break Now"`
         - Add `"snooze_break"` item: `"Snooze (5m)"`
         - Add `"skip_break"` item: `"Skip Break"`
       - Else if `snapshot.state == AppTrackingState::BreakMode`:
         - Add `"complete_break"` item: `"Complete Break Early"`
       - Else if `snapshot.is_micro_break_active`:
         - Add `"dismiss_micro"` item: `"Dismiss 20s Rest"`
         - Add `"break_now"` item: `"Take Full Break Now"`
       - Else:
         - If `snapshot.is_too_close || snapshot.is_slouching`:
           - Add `"recalibrate_posture"` item: `"Recalibrate Baseline Posture"`
         - Add `"break_now"` item: `"Take Break Now"`
       - Toggle item:
         - If `snapshot.is_paused`: `"Resume Tracking"`
         - Else: `"Pause Tracking"`
       - Standard items: `"Open Dashboard"`, `"Settings"`, `"Privacy Explainer"`, `"Quit FocusGaze"`.
   - Update `on_menu_event` to handle:
     - `"start_break"`: `sm.start_break()`, emit state change, show & focus main window.
     - `"snooze_break"`: `sm.snooze_break()`, emit state change.
     - `"skip_break"`: `sm.skip_break()`, emit state change.
     - `"complete_break"`: `sm.finish_break(true)`, emit state change.
     - `"dismiss_micro"`: `sm.dismiss_micro_break()`, emit state change.
     - `"recalibrate_posture"`: show main window, focus it, and emit `"calibrate_posture"` event.
     - `"toggle"`: `sm.toggle_pause()`, emit state change, update tray icon/menu.
     - `"dashboard"`, `"settings"`, `"privacy"`, `"quit"`.

**Verify**: `cargo check --manifest-path src-tauri/Cargo.toml` -> exit 0

---

### Step 3: Upgrade Background Tick Loop Alert & Notification Logic in `lib.rs`

1. In `src-tauri/src/lib.rs` tick loop:
   - Track `prev_micro_active: bool = false;`, `prev_state: AppTrackingState`, and `prev_ergo_alert: bool = false;`.
   - Query DB settings: `notifications_enabled`, `micro_notifications_enabled`, `tray_alerts_enabled`, `ergo_tray_alerts`, and `sound`.
   - **Tray Title & Alert Badge**:
     - If `!tray_alerts_enabled`: `tray.set_title(None::<String>)`
     - Else if `snapshot.is_paused`: `tray.set_title(Some("Paused".to_string()))`
     - Else if `snapshot.is_micro_break_active`: `tray.set_title(Some(format!("👁️ {}s", snapshot.micro_break_seconds_left)))`
     - Else if `current_state == AppTrackingState::BreakPrompt`: `tray.set_title(Some("⚠️ Break!".to_string()))`
     - Else if `current_state == AppTrackingState::BreakMode`:
       - `let break_rem = snapshot.break_interval_seconds.saturating_sub(snapshot.break_seconds_elapsed);`
       - `tray.set_title(Some(format!("Break {}m", (break_rem + 59) / 60)))`
     - Else if `current_state == AppTrackingState::TrackingActive`:
       - If `ergo_tray_alerts`:
         - If `snapshot.is_too_close && snapshot.is_slouching`:
           `tray.set_title(Some("⚠️ Posture!".to_string()))`
         - Else if `snapshot.is_too_close`:
           `tray.set_title(Some("⚠️ Move Back!".to_string()))`
         - Else if `snapshot.is_slouching`:
           `tray.set_title(Some("⚠️ Sit Up!".to_string()))`
         - Else:
           `let remaining = snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds);`
           `tray.set_title(Some(format!("{}m", (remaining + 59) / 60)))`
       - Else:
         `let remaining = snapshot.work_interval_seconds.saturating_sub(snapshot.current_work_seconds);`
         `tray.set_title(Some(format!("{}m", (remaining + 59) / 60)))`
     - Else: `tray.set_title(None::<String>)`
   - **Tray Tooltip with Ergonomic Alert**:
     - If `snapshot.is_too_close && snapshot.is_slouching`:
       `tray.set_tooltip(Some("FocusGaze Alert: Sitting too close (<45cm) & slouching detected."))`
     - Else if `snapshot.is_too_close`:
       `tray.set_tooltip(Some("FocusGaze Alert: Sitting too close to screen (<45cm). Move back to 50–70cm."))`
     - Else if `snapshot.is_slouching`:
       `tray.set_tooltip(Some("FocusGaze Alert: Poor desk posture. Lift chest and align neck."))`
   - **Dynamic Menu Sync**:
     - When `current_state != prev_state` OR `snapshot.is_paused` changed OR `snapshot.is_micro_break_active != prev_micro_active` OR `(snapshot.is_too_close || snapshot.is_slouching) != prev_ergo_alert`:
       - Rebuild tray menu: `let new_menu = tray::create_tray_menu(&handle, &snapshot)?; tray.set_menu(Some(new_menu));`
   - **Notifications Dispatch**:
     - If `notifications_enabled && !snapshot.dnd_active`:
       - **Break Prompt**: If `current_state == AppTrackingState::BreakPrompt && prev_state != AppTrackingState::BreakPrompt`:
         - Fire notification: `"FocusGaze: Time for a Break!"` / `"You've completed your focus session. Step away, stretch, and rest your eyes."`
       - **Micro-Break**: If `snapshot.is_micro_break_active && !prev_micro_active && micro_notifications_enabled`:
         - Fire notification: `"FocusGaze: 20-20-20 Eye Rest"` / `"Look at an object at least 20 feet away for 20 seconds to relax your eyes."`
       - **Break Completed**: If `prev_state == AppTrackingState::BreakMode && current_state != AppTrackingState::BreakMode`:
         - Fire notification: `"FocusGaze: Break Completed"` / `"Great job taking a break! Ready for your next focus session."`

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` -> exit 0

---

### Step 4: Frontend Ergonomic Helper for Tray Formatting

1. In `src/ergonomics.ts`:
   - Export pure helper function:
     ```typescript
     export function formatTrayTitle(
       state: string,
       isPaused: boolean,
       isMicroBreakActive: boolean,
       microBreakSecondsLeft: number,
       currentWorkSeconds: number,
       workIntervalSeconds: number,
       breakSecondsElapsed: number,
       breakIntervalSeconds: number,
       isTooClose: boolean = false,
       isSlouching: boolean = false,
       trayAlertsEnabled: boolean = true,
       ergoTrayAlertsEnabled: boolean = true
     ): string | null {
       if (!trayAlertsEnabled) return null;
       if (isPaused) return "Paused";
       if (isMicroBreakActive) return `👁️ ${microBreakSecondsLeft}s`;
       if (state === "BreakPrompt") return "⚠️ Break!";
       if (state === "BreakMode") {
         const rem = Math.max(0, breakIntervalSeconds - breakSecondsElapsed);
         return `Break ${Math.ceil(rem / 60)}m`;
       }
       if (state === "TrackingActive") {
         if (ergoTrayAlertsEnabled) {
           if (isTooClose && isSlouching) return "⚠️ Posture!";
           if (isTooClose) return "⚠️ Move Back!";
           if (isSlouching) return "⚠️ Sit Up!";
         }
         const rem = Math.max(0, workIntervalSeconds - currentWorkSeconds);
         return `${Math.ceil(rem / 60)}m`;
       }
       return null;
     }
     ```
2. In `src/ergonomics.test.mjs`:
   - Add unit tests verifying `formatTrayTitle` for:
     - Paused state (`"Paused"`)
     - Micro-break active (`"👁️ 20s"`)
     - Break prompt (`"⚠️ Break!"`)
     - Too close warning (`"⚠️ Move Back!"`)
     - Slouching warning (`"⚠️ Sit Up!"`)
     - Too close & slouching combined (`"⚠️ Posture!"`)
     - Normal tracking active (`"50m"`)
     - Alerts disabled (`null`)

**Verify**: `npm test` -> exit 0

---

### Step 5: Update Settings UI in `index.html`

1. In `index.html`, in `#settings-modal` under the `"Experience, Accessibility & System"` section:
   - Add settings controls:
     ```html
     <div class="setting-item checkbox-item">
       <label for="setting-notifications">Desktop Notifications</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-notifications" checked />
         <label for="setting-notifications" class="checkbox-label">Show native OS notifications for break prompts and completions</label>
       </div>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-micro-notifications">20-20-20 Eye-Rest Alerts</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-micro-notifications" checked />
         <label for="setting-micro-notifications" class="checkbox-label">Notify when 20-minute eye-rest interval is reached</label>
       </div>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-tray-alerts">System Tray Badges &amp; Alerts</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-tray-alerts" checked />
         <label for="setting-tray-alerts" class="checkbox-label">Display live countdown, eye-rest timer, and alert badges in menu bar</label>
       </div>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-ergo-tray-alerts">Ergonomic Posture &amp; Distance Tray Alerts</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-ergo-tray-alerts" checked />
         <label for="setting-ergo-tray-alerts" class="checkbox-label">Display "⚠️ Move Back!" and "⚠️ Sit Up!" badges in menu bar during poor posture</label>
       </div>
     </div>
     <div class="setting-item setting-item-stacked">
       <div class="setting-row-top">
         <label>Notification Verification</label>
         <button type="button" id="btn-test-notification" class="btn btn-secondary btn-sm">Send Test Alert</button>
       </div>
       <span id="notification-permission-status" class="setting-status-note">Checking system notification permission...</span>
     </div>
     ```

**Verify**: `npm run build` -> exit 0

---

### Step 6: Wire Posture Detection Loop, Notification Permissions, and Action Handlers in `src/main.ts`

1. In `src/main.ts`:
   - In `runDetectionLoop`:
     ```typescript
     const isTooClose = currentDistEval?.isTooCloseWarning === true;
     const isSlouch = isCurrentSlouching === true;

     const snapshot = await invoke<StateSnapshot>('update_presence', {
       present,
       confidence,
       multiFace,
       isTooClose,
       isSlouching: isSlouch,
     });
     ```
   - Import `{ isPermissionGranted, requestPermission, onAction }` from `@tauri-apps/plugin-notification`.
   - Add DOM elements: `settingNotifications`, `settingMicroNotifications`, `settingTrayAlerts`, `settingErgoTrayAlerts`, `btnTestNotification`, `notificationPermissionStatus`.
   - On app startup and settings modal open:
     - Query `isPermissionGranted()`.
     - When `btnTestNotification` is clicked:
       - Request permission if needed: `if (!await isPermissionGranted()) await requestPermission();`
       - Invoke `send_test_notification` backend command.
       - Update permission note text: `"System notifications active"`.
   - Register notification click listener:
     ```typescript
     try {
       await onAction((event) => {
         if (event.actionId === 'tap') {
           getCurrentWebviewWindow().show();
           getCurrentWebviewWindow().setFocus();
         }
       });
     } catch (e) {
       console.warn('Notification action listener initialization:', e);
     }
     ```
   - Listen for `"calibrate_posture"` event from tray menu:
     ```typescript
     listen('calibrate_posture', () => {
       calibratePostureAndDistance();
     });
     ```
   - In `loadSettings()`:
     - Populate checkboxes from `settings.notifications_enabled`, `settings.micro_break_notifications`, `settings.tray_alerts_enabled`, `settings.ergo_tray_alerts`.
   - In `saveSettings()`:
     - Persist `notifications_enabled`, `micro_break_notifications`, `tray_alerts_enabled`, and `ergo_tray_alerts` (`'on'` / `'off'`) via `update_setting`.

**Verify**: `npm run build` -> exit 0

---

## Test plan

- **Unit tests**:
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> test settings update bounds for new keys (`notifications_enabled`, `tray_alerts_enabled`, `micro_break_notifications`, `ergo_tray_alerts`).
  - `src/ergonomics.test.mjs` -> test `formatTrayTitle` covering all state combinations including ergonomic posture and too-close alert badges.
- **Verification of commands**:
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> 30+ tests passing.
  - `npm test` -> 11+ tests passing.
  - `npm run build` -> exit 0.

## Done criteria

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 and all tests pass.
- [ ] `npm test` exits 0 with all ergonomic tray title tests passing.
- [ ] `npm run build` exits 0 without TypeScript errors.
- [ ] When sitting `< 45cm` from screen, tray displays `"⚠️ Move Back!"`.
- [ ] When slouching, tray displays `"⚠️ Sit Up!"`.
- [ ] When both slouching and too close, tray displays `"⚠️ Posture!"`.
- [ ] When in `BreakPrompt`, tray displays `"⚠️ Break!"` and sends notification when enabled.
- [ ] When in micro-break, tray displays `"👁️ <sec>s"` and sends notification when enabled.
- [ ] Tray context menu displays dynamic status (`"FocusGaze: ⚠️ Move Back (<45cm)"`) and `"Recalibrate Baseline Posture"`.
- [ ] Notifications respect DND mode and user settings toggle.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If Tauri v2 `TrayIcon::set_menu` fails or returns an API signature mismatch, stop and report.
- If `@tauri-apps/plugin-notification` fails permission check on macOS without entitlement, stop and report.
- If modifying any file outside the Scope section appears required, stop and report.

## Maintenance notes

- In Tauri v2, `TrayIcon::set_title` is native to macOS menu bar; on Windows/Linux, `TrayIcon::set_tooltip` provides equivalent glanceability. Both are synchronized with ergonomic and rest alert states.
- Notification permissions on macOS Sonoma/Sequoia require standard user approval on first invocation.
