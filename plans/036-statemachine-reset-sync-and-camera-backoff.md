# Plan 036: StateMachine Reset Synchronization and Exponential Backoff for Camera Recovery

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [033](033-camera-switch-posture-sync-and-data-purge.md)
- **Category**: bug
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

1. In `src-tauri/src/state_machine.rs`, `StateMachine::reset()` hardcodes default values (`work_interval_seconds = 50 * 60`, `break_interval_seconds = 10 * 60`, `snooze_limit = 2`, etc.). When a user resets data or changes intervals, calling `reset()` clobbers any database configuration back to hardcoded defaults rather than querying the database for seeded/configured values.
2. In `src/main.ts`, a periodic camera recovery timer fires every 10 seconds checking `startWebcam()`. When a user denies camera permission or hardware is disconnected, `startWebcam()` repeatedly logs errors and invokes `report_camera_error` every 10 seconds without backoff, wasting CPU cycles and flooding backend logs.

Synchronizing `reset()` with database settings and adding exponential backoff to the camera recovery probe prevents state clobbering and reduces unneeded hardware polling.

## Current state

- Relevant files:
  - `src-tauri/src/state_machine.rs:166-193` — `StateMachine::reset()`
  - `src/main.ts:1814-1826` — Periodic camera recovery interval

Current code excerpts:

1. `src-tauri/src/state_machine.rs:166-193`:
```rust
    pub fn reset(&mut self) {
        self.current_work_seconds = 0;
        self.grace_seconds_elapsed = 0;
        self.break_prompt_seconds_elapsed = 0;
        self.break_seconds_elapsed = 0;
        self.break_away_seconds = 0;
        self.snoozes_used = 0;
        self.current_break_id = None;
        self.micro_break_work_seconds = 0;
        self.micro_break_countdown = 0;
        self.is_dnd_active = false;
        self.is_wrap_up_active = false;
        self.wrap_up_seconds_left = 0;
        self.is_paused = false;
        self.is_too_close = false;
        self.is_slouching = false;
        self.work_interval_seconds = 50 * 60;
        self.break_interval_seconds = 10 * 60;
        self.grace_period_seconds = 60;
        self.snooze_limit = 2;
        self.skip_limit = 2;
        self.tracking_mode = "Auto".to_string();
        self.session_id = Uuid::new_v4().to_string();
        self.session_start_ts = Utc::now().to_rfc3339();
        self.session_active_seconds = 0;
        self.session_present_seconds = 0;
        self.transition_to(AppTrackingState::Initializing);
    }
```

2. `src/main.ts:1814-1826`:
```ts
  // Periodic OS presentation mode check & camera recovery probe (every 10s)
  await checkPresentationState();
  setInterval(() => {
    void checkPresentationState();
    if (
      !isTrackingPaused &&
      settingTrackingMode?.value !== 'Input only' &&
      !(videoEl.srcObject instanceof MediaStream)
    ) {
      void startWebcam(selectedDeviceId);
    }
  }, 10000);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend test | `npm test` | exit 0, all tests pass |
| Build bundle | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src/main.ts`

**Out of scope**:
- Do not modify database table schemas.
- Do not alter `index.html`.

## Steps

### Step 1: Update `StateMachine::reset(&mut self)` to read from database
In `src-tauri/src/state_machine.rs`:
In `reset(&mut self)`, reload `work_interval_seconds`, `break_interval_seconds`, `grace_period_seconds`, `snooze_limit`, `skip_limit`, and `tracking_mode` from `self.db` (with safe defaults if locked/empty), matching the behavior of `StateMachine::new()`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0

### Step 2: Implement exponential backoff for camera recovery in `src/main.ts`
In `src/main.ts`:
Track camera probe failure count `cameraProbeFailures`.
When `startWebcam()` fails:
Increment `cameraProbeFailures` and schedule the next probe with exponential backoff: `Math.min(10000 * Math.pow(1.5, cameraProbeFailures), 300000)` (starts at 10s, capped at 5 minutes).
When `startWebcam()` succeeds:
Reset `cameraProbeFailures = 0`.

**Verify**: `npm run build && npm test` → exit 0

## Done criteria

- [ ] `StateMachine::reset()` respects database settings.
- [ ] Camera recovery probe uses exponential backoff on repeated failures.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [ ] `npm test` exits 0.
- [ ] `plans/README.md` updated.
