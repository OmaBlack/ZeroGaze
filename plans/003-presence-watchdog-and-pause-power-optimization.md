# Plan 003: Add Presence Detection Watchdog and Pause Hardware Suspension

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check if git is initialized (`git status`). If git is tracked, run:
> `git diff --stat HEAD -- src-tauri/src/state_machine.rs src/main.ts`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-break-flow-and-stats.md
- **Category**: correctness / perf
- **Planned at**: commit `uncommitted`, 2026-10-14
- **Issue**: none

## Why this matters

FocusGaze's backend state machine runs on an independent 1-second timer thread in Rust, while Computer Vision (CV) detection runs in the frontend webview at 2 FPS. If the webview is suspended by macOS App Nap, minimized, or crashed, presence updates stop arriving. Without a watchdog, the backend assumes the user is continuously active and logs false screen time indefinitely. Conversely, when the user explicitly clicks "Pause Tracking", the frontend webcam and MediaPipe inference continue running at 2 FPS on the GPU/CPU, keeping the hardware camera indicator light on and draining laptop battery. This plan resolves both issues by adding a heartbeat watchdog in Rust and suspending hardware polling in TypeScript when paused.

## Current state

Relevant files:
- `src-tauri/src/state_machine.rs` — State machine tick loop and presence handling.
- `src/main.ts` — Webview MediaPipe vision loop and pause toggle handler.

Current code excerpts:

1. `src-tauri/src/state_machine.rs:182-193`:
```rust
            AppTrackingState::TrackingActive => {
                self.current_work_seconds += 1;

                if let Ok(db) = self.db.lock() {
                    let _ = db.increment_daily_seconds(&today, 1, 1);
                }

                if self.current_work_seconds >= self.work_interval_seconds {
                    self.initiate_break_prompt();
                }
            }
```
Notice: `tick_second()` increments work time unconditionally without verifying that presence data was received recently.

2. `src/main.ts:227-262, 301-306`:
```typescript
async function runDetectionLoop() {
  ...
  const result = faceDetector.detectForVideo(videoEl, now);
  ...
  setTimeout(runDetectionLoop, 500);
}
...
btnTogglePause.addEventListener('click', async () => {
  const snapshot = await invoke<StateSnapshot>('toggle_tracking');
  renderState(snapshot);
  iconPause.classList.toggle('hidden');
  iconPlay.classList.toggle('hidden');
});
```
Notice: `runDetectionLoop()` runs unconditionally every 500ms even after `toggle_tracking` returns a paused state.

Repo conventions:
- Timestamps use `chrono::Utc::now().timestamp()`.
- Logging events to database uses `db.log_event("event_name", Some("{\"details\": ...}"))`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Frontend check | `npx tsc --noEmit` | exit 0, no errors |
| Rust check | `cargo check` (in `src-tauri`) | exit 0, no errors |
| Rust test | `cargo test` (in `src-tauri`) | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src/main.ts`

**Out of scope**:
- MediaPipe model weights (`/models/blaze_face_short_range.tflite`).
- Native mouse/keyboard idle APIs in `src-tauri/src/idle.rs`.

## Steps

### Step 1: Add CV heartbeat watchdog to `StateMachine`

In `src-tauri/src/state_machine.rs`:
1. Add `pub last_cv_heartbeat_ts: i64` to `StateMachine`:
   In `StateMachine::new()`:
   ```rust
   last_cv_heartbeat_ts: Utc::now().timestamp(),
   ```
2. In `handle_presence_update(&mut self, present: bool, confidence: f32, multi_face: bool)`:
   Set `self.last_cv_heartbeat_ts = Utc::now().timestamp();` unconditionally on every incoming update.
3. In `tick_second(&mut self)`:
   Add a watchdog check at the beginning of the tick (when not paused and in CV or Auto mode):
   ```rust
   let now_ts = Utc::now().timestamp();
   if (self.state == AppTrackingState::TrackingActive || self.state == AppTrackingState::TrackingGrace)
       && self.tracking_mode != "Input only"
       && (now_ts - self.last_cv_heartbeat_ts) > 5
   {
       // CV updates have ceased for over 5 seconds (webview throttled, crashed, or camera disconnected)
       self.transition_to(AppTrackingState::FallbackInputTracking);
       if let Ok(db) = self.db.lock() {
           let _ = db.log_event("cv_heartbeat_timeout", Some("{\"reason\": \"no_updates_5s\"}"));
       }
   }
   ```
4. In `handle_presence_update`, if `self.state == AppTrackingState::FallbackInputTracking` and `present == true`, automatically recover back to `AppTrackingState::TrackingActive`.

**Verify**: `cargo test` in `src-tauri` → exit 0.

---

### Step 2: Suspend detection and camera stream when paused in `src/main.ts`

In `src/main.ts`:
1. Add a module-level variable: `let isTrackingPaused = false;`.
2. In `renderState(snapshot)`:
   Check `snapshot.state`:
   - If `snapshot.state === 'PausedAway'` or paused, set `isTrackingPaused = true`.
   - Update toggle pause button icon (pause vs play).
3. In `runDetectionLoop()`:
   Check `if (isTrackingPaused)`:
   ```typescript
   if (isTrackingPaused) {
     // Suspend detection loop while paused; poll slowly (every 1000ms) until resumed
     setTimeout(runDetectionLoop, 1000);
     return;
   }
   ```
4. In `btnTogglePause.addEventListener('click', ...)`:
   ```typescript
   btnTogglePause.addEventListener('click', async () => {
     const snapshot = await invoke<StateSnapshot>('toggle_tracking');
     isTrackingPaused = !isTrackingPaused;
     renderState(snapshot);
     iconPause.classList.toggle('hidden', isTrackingPaused);
     iconPlay.classList.toggle('hidden', !isTrackingPaused);
   });
   ```

**Verify**: `npx tsc --noEmit` → exit 0.

## Test plan

1. In `src-tauri/src/state_machine.rs` `mod tests`:
   Add unit test `test_cv_heartbeat_watchdog_timeout()`:
   - Initialize `StateMachine` with in-memory DB.
   - Send `handle_presence_update(true, 0.95, false)` → assert `state == TrackingActive`.
   - Artificially set `sm.last_cv_heartbeat_ts = Utc::now().timestamp() - 6;`.
   - Call `sm.tick_second()`.
   - Assert `sm.state == AppTrackingState::FallbackInputTracking`.
   - Send `handle_presence_update(true, 0.95, false)` → assert state recovers to `TrackingActive`.
2. Run `cargo test` in `src-tauri`. All tests must pass.

## Done criteria

- [ ] `cargo check` and `cargo test` in `src-tauri` pass with 0 errors.
- [ ] `npx tsc --noEmit` exits 0.
- [ ] If no presence update is received for >5s, state machine transitions to `FallbackInputTracking`.
- [ ] When paused, MediaPipe inference is suspended and does not execute at 2 FPS.
- [ ] Resuming tracking restarts the 2 FPS presence loop immediately.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `last_cv_heartbeat_ts` causes immediate fallback during initial app launch, ensure `last_cv_heartbeat_ts` is initialized to `Utc::now().timestamp()` and grace is allowed for first 5 seconds.
