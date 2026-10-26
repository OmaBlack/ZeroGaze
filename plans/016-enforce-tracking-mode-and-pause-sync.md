# Plan 016: Enforce TrackingMode ("Input only" / "Webcam only") and Synchronize Pause State Across Backend, Tray, and Webcam Lifecycle

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts below
> against the live code in `src-tauri/src/state_machine.rs`,
> `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/tray.rs`,
> and `src/main.ts`. On any mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md), [002](002-fix-tray-lifecycle-and-window-close.md), [003](003-presence-watchdog-and-pause-power-optimization.md)
- **Category**: bug
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

FocusGaze's core privacy and agency commitments (`PRODUCT.md` Principles 1 & 4) promise that users can switch to `"Input only (Mouse & Keyboard)"` to disable the webcam completely, select `"Webcam only"` to prevent keyboard/mouse fallback, or pause tracking from either the system tray or dashboard. Today, selecting `"Input only"` still starts the webcam and runs MediaPipe GPU inference every 500ms (which forces the backend back into `TrackingActive`), selecting `"Webcam only"` still falls back to input tracking on camera error/timeout, and toggling pause from the system tray menu desynchronizes from the frontend `isTrackingPaused` state (leaving the webcam running and inverting the dashboard pause button).

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs` — core state machine, `StateSnapshot`, `handle_presence_update`, `handle_camera_error`, `tick_second`, and `toggle_pause`.
  - `src-tauri/src/commands.rs` — Tauri IPC commands (`update_setting`).
  - `src-tauri/src/lib.rs` — 1-second background tick loop updating tray title and icon.
  - `src-tauri/src/tray.rs` — system tray menu event handler (`"toggle"`).
  - `src/main.ts` — frontend `StateSnapshot` interface, `renderState`, `initMediaPipe`, `startWebcam`, `runDetectionLoop`, and `saveSettings`.

- Current code excerpts:

`src-tauri/src/state_machine.rs:23-48`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub state: AppTrackingState,
    pub active_seconds_today: i64,
    pub present_seconds_today: i64,
    pub current_work_seconds: i64,
    pub work_interval_seconds: i64,
    pub break_interval_seconds: i64,
    pub grace_period_seconds: i64,
    pub grace_seconds_left: i64,
    pub break_seconds_elapsed: i64,
    pub snoozes_used: i32,
    pub snooze_limit: i32,
    pub skips_today: i64,
    pub skip_limit: i32,
    pub compliance_pct: f64,
    pub is_cv_present: bool,
    pub cv_confidence: f32,
    pub tracking_mode: String, // "Auto", "Webcam only", "Input only"
    pub breaks_taken_today: i64,
    pub is_micro_break_active: bool,
    pub micro_break_seconds_left: i64,
    pub is_dnd_active: bool,
    pub is_wrap_up_active: bool,
    pub wrap_up_seconds_left: i64,
}
```

`src-tauri/src/state_machine.rs:146-210`:
```rust
    pub fn handle_presence_update(&mut self, present: bool, confidence: f32, multi_face: bool) {
        self.last_cv_heartbeat_ts = Utc::now().timestamp();
        self.is_cv_present = present;
        self.cv_confidence = confidence;
...
        if self.is_paused {
            return;
        }
...
    }

    pub fn handle_camera_error(&mut self, _err: &str) {
        if self.state != AppTrackingState::FallbackInputTracking {
            self.transition_to(AppTrackingState::FallbackInputTracking);
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("camera_error_fallback", Some("{\"source\": \"webcam_failure\"}"));
            }
        }
    }

    pub fn tick_second(&mut self) {
        if self.is_paused {
            return;
        }

        let now_ts = Utc::now().timestamp();
        if (self.state == AppTrackingState::TrackingActive || self.state == AppTrackingState::TrackingGrace)
            && self.tracking_mode != "Input only"
            && (now_ts - self.last_cv_heartbeat_ts) > 5
        {
            self.transition_to(AppTrackingState::FallbackInputTracking);
            if let Ok(db) = self.db.lock() {
                let _ = db.log_event("cv_heartbeat_timeout", Some("{\"reason\": \"no_updates_5s\"}"));
            }
        }
```

`src-tauri/src/commands.rs:65-68`:
```rust
        } else if key == "tracking_mode" {
            sm.tracking_mode = value;
        }
```

`src/main.ts:321-344`:
```ts
async function initMediaPipe(): Promise<void> {
  try {
    cvBadgeEl.textContent = 'Loading AI Model...';
    const vision = await FilesetResolver.forVisionTasks('/wasm');
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/models/blaze_face_short_range.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });

    cvBadgeEl.textContent = 'Model Ready';
    startWebcam();
  } catch (err: unknown) {
...
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
- `src-tauri/src/lib.rs`
- `src-tauri/src/tray.rs`
- `src/main.ts`

**Out of scope**:
- `src-tauri/src/idle.rs` (OS idle detection implementation is unchanged).
- `src-tauri/src/db/mod.rs` (SQLite schema is unchanged in this plan).
- `index.html` and `src/style.css`.

## Steps

### Step 1: Add `is_paused` to `StateSnapshot` and Enforce `tracking_mode` in `StateMachine`

In `src-tauri/src/state_machine.rs`:
1. Add `pub is_paused: bool` to `StateSnapshot` and populate `is_paused: self.is_paused` inside `StateMachine::snapshot()`.
2. In `StateMachine::new()`, set initial `state`:
   ```rust
   let initial_state = if tm == "Input only" {
       AppTrackingState::FallbackInputTracking
   } else {
       AppTrackingState::Initializing
   };
   ```
3. Add a helper method `pub fn set_tracking_mode(&mut self, mode: String)` on `StateMachine`:
   ```rust
   pub fn set_tracking_mode(&mut self, mode: String) {
       self.tracking_mode = mode;
       if self.tracking_mode == "Input only" {
           self.is_cv_present = false;
           self.cv_confidence = 0.0;
           if !matches!(
               self.state,
               AppTrackingState::BreakPrompt | AppTrackingState::BreakMode | AppTrackingState::BreakSnoozed
           ) {
               self.transition_to(AppTrackingState::FallbackInputTracking);
           }
       } else if self.tracking_mode == "Webcam only" && self.state == AppTrackingState::FallbackInputTracking {
           self.transition_to(AppTrackingState::PausedAway);
       }
   }
   ```
4. In `StateMachine::handle_presence_update()`:
   - Return early if `self.tracking_mode == "Input only"` so stray CV ticks cannot force `FallbackInputTracking` into `TrackingActive`.
5. In `StateMachine::handle_camera_error()`:
   - If `self.tracking_mode == "Webcam only"`, transition to `AppTrackingState::CameraErrorFallback` instead of `AppTrackingState::FallbackInputTracking`.
6. In `StateMachine::tick_second()`:
   - If `self.state == AppTrackingState::Initializing && self.tracking_mode == "Input only"`, transition to `AppTrackingState::FallbackInputTracking`.
   - For the 5-second CV heartbeat timeout (`(now_ts - self.last_cv_heartbeat_ts) > 5`):
     - When `self.tracking_mode == "Auto"`, transition to `AppTrackingState::FallbackInputTracking` (current behavior).
     - When `self.tracking_mode == "Webcam only"`, transition to `AppTrackingState::PausedAway` instead of `FallbackInputTracking`.
   - In the `AppTrackingState::FallbackInputTracking` arm, only accumulate work seconds if `self.tracking_mode != "Webcam only"`.
7. In `src-tauri/src/commands.rs`:
   - Replace `sm.tracking_mode = value;` with `sm.set_tracking_mode(value);`.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Reflect `is_paused` in System Tray Title and Icon

In `src-tauri/src/lib.rs`:
1. In the 1-second background loop (`lines 78-102`), check `snapshot.is_paused`:
   - When `snapshot.is_paused` is `true`, set tray title to `Some("Paused".to_string())`, set tray icon to `create_colored_icon(234, 179, 8, 255)` (Yellow), and set tooltip to `"FocusGaze: Tracking paused manually"`.
2. In `src-tauri/src/tray.rs`:
   - In the `"toggle"` menu event handler (`lines 115-131`), when `snapshot.is_paused` is `true`, set the yellow icon and `"FocusGaze: Tracking paused manually"` tooltip, and update the tray title to `Some("Paused")`.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Synchronize Frontend Pause & Webcam Hardware Lifecycle in `src/main.ts`

In `src/main.ts`:
1. Add `is_paused: boolean;` to the `StateSnapshot` interface (`lines 6-40`).
2. Add a helper `stopWebcamTracks()` that stops all tracks on `videoEl.srcObject` if it is a `MediaStream` and clears `videoEl.srcObject = null`.
3. In `renderState(snapshot: StateSnapshot)`:
   - Synchronize `const wasPaused = isTrackingPaused; isTrackingPaused = snapshot.is_paused;`.
   - Update `#icon-pause` and `#icon-play` visibility directly inside `renderState`:
     ```ts
     iconPause.classList.toggle('hidden', isTrackingPaused);
     iconPlay.classList.toggle('hidden', !isTrackingPaused);
     ```
   - When `snapshot.is_paused` is `true`, set `statusPillEl.className = 'status-pill status-away'` and `statusLabelEl.textContent = 'Paused • Manual'`.
   - If `snapshot.is_paused || snapshot.tracking_mode === 'Input only'`, call `stopWebcamTracks()`.
   - If `wasPaused && !snapshot.is_paused && snapshot.tracking_mode !== 'Input only'`, call `startWebcam(selectedDeviceId)`.
   - In the CV Status badge block (`lines 278-290`), if `snapshot.tracking_mode === 'Input only'`, display `cvBadgeEl.textContent = 'Camera Off (Input Mode)'` and `statCvConfEl.textContent = 'Using mouse & keyboard idle'`.
4. In `initMediaPipe()` (`lines 321-344`):
   - Only call `startWebcam()` if the current tracking mode is not `'Input only'` and `!isTrackingPaused`.
5. In `saveSettings()` (`lines 832-870`):
   - If `settingTrackingMode.value === 'Input only'`, call `stopWebcamTracks()`.
   - Otherwise, if the webcam is not currently active (`!(videoEl.srcObject instanceof MediaStream)`) and `!isTrackingPaused`, call `await startWebcam(selectedDeviceId)`.
6. In `btnTogglePause` click handler (`lines 900-907`) and the `Cmd/Ctrl+Shift+P` keydown handler (`lines 1053-1060`):
   - Remove the manual `isTrackingPaused = !isTrackingPaused` and `iconPause`/`iconPlay` toggles before `renderState(snapshot)`, since `renderState(snapshot)` now authoritatively syncs from `snapshot.is_paused`.

**Verify**:
`npm run build` → exits 0.

### Step 4: Add Unit Tests for `TrackingMode` and `is_paused` in `state_machine.rs`

In `src-tauri/src/state_machine.rs` (`mod tests`):
1. Add `test_input_only_mode_ignores_cv_and_tracks_input`:
   - Create `StateMachine`, call `sm.set_tracking_mode("Input only".to_string())`, verify `sm.state == AppTrackingState::FallbackInputTracking`.
   - Call `sm.handle_presence_update(true, 0.99, false)` and verify `sm.state` remains `AppTrackingState::FallbackInputTracking`.
2. Add `test_webcam_only_mode_does_not_fallback_to_input`:
   - Create `StateMachine`, call `sm.set_tracking_mode("Webcam only".to_string())`, call `sm.handle_presence_update(true, 0.95, false)`.
   - Set `sm.last_cv_heartbeat_ts = Utc::now().timestamp() - 10; sm.tick_second();`.
   - Verify `sm.state == AppTrackingState::PausedAway` (not `FallbackInputTracking`).
   - Call `sm.handle_camera_error("denied")` and verify `sm.state == AppTrackingState::CameraErrorFallback`.
3. Add `test_pause_reflected_in_snapshot`:
   - Toggle pause via `sm.toggle_pause()`, verify `sm.snapshot().is_paused == true`, and verify `sm.tick_second()` does not increment `current_work_seconds`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

## Test plan

- File: `src-tauri/src/state_machine.rs` (`#[cfg(test)] mod tests`), modeled after existing `test_cv_heartbeat_watchdog_timeout`.
- Cases covered:
  - `"Input only"` mode initializes/transitions to `FallbackInputTracking` and ignores `handle_presence_update`.
  - `"Webcam only"` mode transitions to `PausedAway` on heartbeat timeout and `CameraErrorFallback` on camera error without entering `FallbackInputTracking`.
  - `toggle_pause()` updates `snapshot().is_paused` and halts work counter accumulation.
- Verification command: `cargo test --manifest-path src-tauri/Cargo.toml` → all 17+ unit tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; new tests `test_input_only_mode_ignores_cv_and_tracks_input`, `test_webcam_only_mode_does_not_fallback_to_input`, and `test_pause_reflected_in_snapshot` pass
- [x] `npm run build` exits 0 with no TypeScript errors
- [x] `plans/README.md` status row for Plan 016 updated to `DONE`

## STOP conditions

- The code at the locations in "Current state" does not match the excerpts.
- Any verification command fails twice after a reasonable fix attempt.
- The fix requires modifying files outside the "In scope" list.

## Maintenance notes

- `StateSnapshot.is_paused` is now the single source of truth for pause status across the tray menu, global keyboard shortcuts, and dashboard UI. Do not reintroduce separate boolean flags in `src/main.ts` that toggle independently of `renderState(snapshot)`.
- Whenever `tracking_mode === 'Input only'` or `is_paused === true`, `stopWebcamTracks()` ensures the hardware webcam LED turns off immediately.
