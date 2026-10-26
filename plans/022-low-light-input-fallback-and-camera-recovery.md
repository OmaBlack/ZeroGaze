# Plan 022: Implement Low-Light / Active-Input Auto-Fallback and Periodic Camera Recovery Probing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> `src-tauri/src/state_machine.rs`, `src-tauri/src/lib.rs`, and `src/main.ts`;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [021](021-wire-seeded-settings-and-webaudio-chimes.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

PRD §4.2 ("Low-Light / Low-Confidence Fallback") and §14 ("Dark room: Low-confidence fallback" / "Camera disconnected: Fallback, retry periodically") require FocusGaze to automatically fall back to mouse/keyboard input tracking when the user is working in a dark room where the webcam sees 0 faces (`!is_cv_present`) but the user is actively typing or moving the mouse. Currently:
1. `src-tauri/src/lib.rs:66-70` only samples `crate::idle::get_idle_seconds()` when `prev_state == AppTrackingState::FallbackInputTracking`.
2. When `tracking_mode == "Auto"` and the room is dark, `handle_presence_update(false, 0.0, false)` transitions `TrackingActive → TrackingGrace → PausedAway`, pausing the user's work timer even while they are actively typing at the keyboard!
3. If the camera temporarily errors (`CameraErrorFallback`), the frontend never retries re-initializing the camera stream.

Passing `idle_secs` on every tick when in `"Auto"` or `"Input only"` mode allows `StateMachine` to transition from `TrackingGrace` or `PausedAway` into `FallbackInputTracking` when `tracking_mode == "Auto"` and the user has sustained active keyboard/mouse input (`idle_secs < 10.0`) after grace expires, while immediately returning to `TrackingActive` as soon as the room is lit and CV detects their face again.

## Current state

Relevant files and excerpts:

1. `src-tauri/src/lib.rs:66-70` — only samples OS idle time in `FallbackInputTracking`:
```rust
                    let idle_secs = if prev_state == AppTrackingState::FallbackInputTracking {
                        crate::idle::get_idle_seconds()
                    } else {
                        0.0
                    };
```

2. `src-tauri/src/state_machine.rs:344-353` — `TrackingGrace` and `PausedAway` arms in `tick_second_with_idle`:
```rust
            AppTrackingState::TrackingGrace => {
                self.grace_seconds_elapsed += 1;
                if self.grace_seconds_elapsed >= self.grace_period_seconds {
                    self.flush_current_session();
                    self.transition_to(AppTrackingState::PausedAway);
                }
            }
            AppTrackingState::PausedAway => {
                // User away, no active seconds incremented
            }
```

## Commands you will need

Note: Prepend `export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin";` when running shell commands.

| Purpose | Command | Expected on success |
|---|---|---|
| Rust typecheck | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0 |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend unit tests | `npm test` | exit 0 |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src-tauri/src/lib.rs`
- `src/main.ts`

**Out of scope**:
- Modifying `src-tauri/src/idle.rs` or database schema.

## Steps

### Step 1: Implement Low-Light / Active-Input Auto-Fallback in `StateMachine`

In `src-tauri/src/state_machine.rs`:
1. In `tick_second_with_idle(&mut self, idle_secs: f64)` inside the `AppTrackingState::TrackingGrace` arm (`lines 344-350`):
   - When `self.grace_seconds_elapsed >= self.grace_period_seconds`:
     - If `self.tracking_mode == "Auto" && idle_secs < 10.0`:
       - Transition to `AppTrackingState::FallbackInputTracking` (instead of `PausedAway`) and log event `"low_light_input_fallback"` (`Some("{\"reason\": \"cv_absent_but_input_active\"}")`).
     - Otherwise:
       - Call `self.flush_current_session();` and `self.transition_to(AppTrackingState::PausedAway);`.
2. In the `AppTrackingState::PausedAway` arm (`lines 351-353`):
   - If `self.tracking_mode == "Auto" && idle_secs < 5.0`:
     - Transition to `AppTrackingState::FallbackInputTracking` so if the user returns to their desk in a dark room and starts typing, tracking resumes immediately via input fallback.
3. Update `test_presence_transitions` in `src-tauri/src/state_machine.rs` (`lines 688-693`) to use `sm.tick_second_with_idle(120.0)` during the grace-period loop so it simulates the user actually being away (idle `120.0s` > `10.0s`) rather than calling `get_idle_seconds()` on the developer's active machine.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Sample OS Idle Time in `lib.rs` Whenever `tracking_mode != "Webcam only"`

In `src-tauri/src/lib.rs`:
1. In the 1-second background thread (`lines 66-70`), sample `crate::idle::get_idle_seconds()` whenever `prev_state` is `FallbackInputTracking`, `TrackingGrace`, or `PausedAway`:
```rust
                    let idle_secs = if matches!(
                        prev_state,
                        AppTrackingState::FallbackInputTracking
                            | AppTrackingState::TrackingGrace
                            | AppTrackingState::PausedAway
                    ) {
                        crate::idle::get_idle_seconds()
                    } else {
                        0.0
                    };
```

**Verify**: `cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Add Periodic Camera Recovery Probe and Fallback Status Messaging in `src/main.ts`

In `src/main.ts`:
1. In `renderState(snapshot)` inside the CV Status block (`around lines 320-340`):
   - When `snapshot.state === 'FallbackInputTracking' && snapshot.tracking_mode === 'Auto'`, set `cvBadgeEl.textContent = 'Input Fallback (Low Light / No Face)'` and `statCvConfEl.textContent = 'Active via keyboard & mouse — camera standing by'`.
2. In `init()` (`around line 1175`), inside the 10-second `setInterval` maintenance callback (or a dedicated 30-second interval), if `!isTrackingPaused && settingTrackingMode?.value !== 'Input only' && !(videoEl.srcObject instanceof MediaStream)`, call `startWebcam(selectedDeviceId)` to automatically recover if a disconnected/busy webcam becomes available again.

**Verify**: `npm run build` → exits 0.

### Step 4: Add Unit Test for Low-Light Active-Input Fallback in `state_machine.rs`

In `src-tauri/src/state_machine.rs` (`mod tests`), add `test_low_light_active_input_transitions_to_fallback`:
- Create `StateMachine` in `"Auto"` mode, detect face (`TrackingActive`), then lose face (`TrackingGrace`).
- Tick 60 seconds with `sm.tick_second_with_idle(2.0)` (simulating active typing in a dark room).
- Assert `sm.state == AppTrackingState::FallbackInputTracking`.
- Then simulate `sm.tick_second_with_idle(120.0)` and `sm.handle_presence_update(true, 0.92, false)` and assert it recovers to `AppTrackingState::TrackingActive`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

## Test plan

- File: `src-tauri/src/state_machine.rs` (`mod tests`)
- Cases covered:
  - `test_low_light_active_input_transitions_to_fallback`: verifies `TrackingGrace` transitions to `FallbackInputTracking` instead of `PausedAway` when `idle_secs < 10.0` in `"Auto"` mode, and stays in `PausedAway` when `idle_secs >= 10.0`.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_low_light_active_input_transitions_to_fallback` and `test_presence_transitions` pass
- [x] `npm test && npm run build` exits 0
- [x] `plans/README.md` status row for Plan 022 updated to `DONE`

## STOP conditions

- `test_presence_transitions` fails because `tick_second()` sampled live OS input on the test machine — ensure `test_presence_transitions` uses `tick_second_with_idle(120.0)` when simulating an away user.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- In unit tests that simulate a user walking away from the desk, always prefer `sm.tick_second_with_idle(120.0)` over `sm.tick_second()` so the test is deterministic regardless of whether a developer is moving the mouse while running `cargo test`.
