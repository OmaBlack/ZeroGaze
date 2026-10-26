# Plan 029: Optimize Background Tick Loop, Harden Settings Validation, Add Detection Error Barrier, and Clean Unused Dependencies

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
- **Depends on**: [028](028-fix-input-only-break-return-autostart-capability-and-compliance-dnd.md)
- **Category**: perf
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

1. In `src-tauri/src/lib.rs`, the background 1-second timer thread queries SQLite for 4 settings (`notifications_enabled`, `micro_break_notifications`, `tray_alerts_enabled`, `ergo_tray_alerts`) every single second (~14,400 queries/hour), locking the SQLite mutex and causing unnecessary disk I/O and CPU wakeups while the app sits idle in the system tray.
2. In `src-tauri/src/commands.rs`, `update_setting` lacks validation for key settings (`tracking_mode`, `break_overlay`, `sound`, `posture_alert_sound`, `reduced_motion`, `high_contrast`, `lock_on_unrecognized_user`, `min_face_height_ratio`), silently allowing arbitrary or corrupted strings to be saved into SQLite.
3. In `src/main.ts`, the preamble of `runDetectionLoop` (battery query and delay computation) sits outside the `try/catch` block. Any uncaught runtime error prevents `setTimeout(runDetectionLoop, ...)` from scheduling; `isDetectionRunning` stays `true`, permanently freezing camera presence and ergonomic tracking until app restart.
4. In `package.json`, `@tauri-apps/plugin-shell` is installed as a production dependency but is never used anywhere in the codebase.

Fixing these eliminates background I/O churn, prevents invalid configuration states, guarantees resilience against camera loop death, and cleans up the dependency manifest.

## Current state

- Relevant files:
  - `src-tauri/src/lib.rs:94-104` — Background 1-second loop settings queries.
  - `src-tauri/src/commands.rs:48-101` — Settings validation boundary.
  - `src/main.ts:813-835, 925-933` — MediaPipe detection loop scheduling.
  - `package.json:18` — Unused `@tauri-apps/plugin-shell` dependency.

Current code excerpts:

1. `src-tauri/src/lib.rs:94-104`:
```rust
                    // Fetch current user notification and tray settings
                    let (notifs_enabled, micro_notifs_enabled, tray_alerts_enabled, ergo_tray_alerts) = {
                        if let Ok(db) = timer_db.lock() {
                            let n = db.get_setting("notifications_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            let mn = db.get_setting("micro_break_notifications").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            let ta = db.get_setting("tray_alerts_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            let ea = db.get_setting("ergo_tray_alerts").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            (n, mn, ta, ea)
                        } else {
                            (true, true, true, true)
                        }
                    };
```

2. `src-tauri/src/commands.rs:48-101`:
```rust
#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, AppSharedState>) -> Result<(), String> {
    match key.as_str() {
        "work_interval_minutes" => { ... }
...
        "notifications_enabled"
        | "tray_alerts_enabled"
        | "micro_break_notifications"
        | "ergo_tray_alerts" => {
            if value != "on" && value != "off" {
                return Err(format!("{} must be 'on' or 'off'", key));
            }
        }
        _ => {}
    }
```

3. `src/main.ts:813-832`:
```ts
// Detection Loop with dynamic battery throttling
async function runDetectionLoop() {
  if (isTrackingPaused) {
    setTimeout(runDetectionLoop, 1000);
    return;
  }

  const nextDelay = computeDetectionDelayMs(
    configuredCvFps,
    Boolean(currentBattery && !currentBattery.charging),
    currentBattery?.level ?? 1.0
  );

  if (!faceDetector || !videoEl || videoEl.readyState < 2) {
    setTimeout(runDetectionLoop, nextDelay);
    return;
  }

  try {
    const now = performance.now();
...
```

4. `package.json:18`:
```json
    "@tauri-apps/plugin-shell": "^2.0.0"
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| TypeScript check | `npm run build` | exit 0, no errors |
| Frontend tests | `npm test` | exit 0, all 11 tests pass |

## Scope

**In scope**:
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src/main.ts`
- `package.json`

**Out of scope**:
- Do not modify `src-tauri/src/db/mod.rs` schema or table definitions.
- Do not modify `src-tauri/src/state_machine.rs`.

## Steps

### Step 1: Cache notification and tray settings in memory in `lib.rs`
In `src-tauri/src/lib.rs`:
Instead of reading 4 settings from SQLite on every 1-second iteration, query settings once every 30 seconds or maintain atomic/in-memory cached booleans, or check a counter `tick_count % 10 == 0`:
```rust
                    // Refresh settings cache from DB every 10 ticks instead of every 1s
                    if tick_count % 10 == 0 {
                        if let Ok(db) = timer_db.lock() {
                            cached_notifs_enabled = db.get_setting("notifications_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_micro_notifs_enabled = db.get_setting("micro_break_notifications").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_tray_alerts_enabled = db.get_setting("tray_alerts_enabled").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                            cached_ergo_tray_alerts = db.get_setting("ergo_tray_alerts").unwrap_or(None).map(|v| v == "on").unwrap_or(true);
                        }
                    }
                    tick_count = tick_count.wrapping_add(1);
```
This reduces SQLite queries by 90% while keeping settings updates responsive.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0

### Step 2: Harden settings validation in `commands.rs`
In `src-tauri/src/commands.rs`:
Add strict validation branches to `update_setting`:
```rust
        "tracking_mode" => {
            if value != "Auto" && value != "Input only" && value != "Webcam only" {
                return Err("tracking_mode must be 'Auto', 'Input only', or 'Webcam only'".to_string());
            }
        }
        "break_overlay" => {
            if value != "full-screen" && value != "toast-only" && value != "centered" {
                return Err("break_overlay must be 'full-screen', 'toast-only', or 'centered'".to_string());
            }
        }
        "sound"
        | "posture_alert_sound"
        | "reduced_motion"
        | "high_contrast"
        | "lock_on_unrecognized_user"
        | "onboarding_completed" => {
            if value != "on" && value != "off" && value != "true" && value != "false" {
                return Err(format!("{} must be 'on'/'off' or boolean string", key));
            }
        }
        "min_face_height_ratio" => {
            let r = value.parse::<f64>().map_err(|_| "Invalid min_face_height_ratio".to_string())?;
            if !(0.05..=0.5).contains(&r) {
                return Err("min_face_height_ratio must be between 0.05 and 0.5".to_string());
            }
        }
```

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0

### Step 3: Wrap `runDetectionLoop` in a top-level error & scheduling barrier
In `src/main.ts`:
Refactor `runDetectionLoop` so that `setTimeout(runDetectionLoop, delay)` is ALWAYS scheduled, even if `computeDetectionDelayMs` or battery queries fail:
```ts
async function runDetectionLoop() {
  let nextDelay = 500;
  try {
    if (isTrackingPaused) {
      return;
    }

    try {
      nextDelay = computeDetectionDelayMs(
        configuredCvFps,
        Boolean(currentBattery && !currentBattery.charging),
        currentBattery?.level ?? 1.0
      );
    } catch {
      nextDelay = Math.max(200, Math.round(1000 / configuredCvFps));
    }

    if (!faceDetector || !videoEl || videoEl.readyState < 2) {
      return;
    }

    // Inference and presence dispatch...
    const now = performance.now();
    const result = faceDetector.detectForVideo(videoEl, now);
    ...
  } catch (err) {
    console.warn('Detection tick error:', err);
  } finally {
    const delay = isTrackingPaused ? 1000 : nextDelay;
    setTimeout(runDetectionLoop, delay);
  }
}
```

**Verify**: `npm run build` → exit 0

### Step 4: Remove unused `@tauri-apps/plugin-shell` dependency
In `package.json`:
Remove line 18 (`"@tauri-apps/plugin-shell": "^2.0.0",`).

**Verify**: `npm run build` → exit 0

## Test plan

- Test settings validation rejection:
  - Call `update_setting` with `tracking_mode = "invalid"`, assert error.
  - Call `update_setting` with `break_overlay = "invalid"`, assert error.
  - Call `update_setting` with `min_face_height_ratio = "0.99"`, assert error.
- Test detection loop resilience:
  - Simulate missing detector or video error in frontend, verify loop continues to tick without unhandled rejection.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml && npm test && npm run build` → all exit 0.

## Done criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `npm test` exits 0.
- [ ] `@tauri-apps/plugin-shell` is removed from `package.json`.
- [ ] `plans/README.md` status row updated to DONE.

## STOP conditions

- If `update_setting` rejects a valid setting value used by frontend or tests, STOP and update allowed list.
- If removing `@tauri-apps/plugin-shell` causes bundler resolution issues, verify no lingering imports exist.

## Maintenance notes

- When adding new settings in future plans, always register explicit validation bounds in `commands::update_setting`.
