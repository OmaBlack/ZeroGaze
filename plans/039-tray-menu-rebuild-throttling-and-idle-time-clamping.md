# Plan 039: Tray Menu Rebuild Throttling and Idle Time Clamping

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
- **Depends on**: [036](036-statemachine-reset-sync-and-camera-backoff.md)
- **Category**: perf
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

1. In `src-tauri/src/lib.rs:160-174`, every second where ergonomic alert status (`current_ergo_alert != prev_ergo_alert`) or state changes, the background loop executes `create_tray_menu(&handle, &snapshot)` and `tray.set_menu(Some(new_menu))`. When user posture drifts back and forth across thresholds, rebuilding and replacing the native tray menu every second generates redundant IPC round trips, risks dismissing the menu while open, and churns macOS/Windows menu handles. Since `tray.set_title` and `tray.set_tooltip` already reflect posture alerts live every second, the full tray menu should only be reconstructed when structural menu items actually change (e.g. state transitions like entering/exiting `BreakPrompt`, `BreakMode`, `micro_break_active`, or pause state toggles).
2. In `src-tauri/src/idle.rs:20-85`, macOS `CGEventSourceSecondsSinceLastEventType` or clock adjustments can return negative or out-of-bound idle floats. Clamping the idle seconds return to `idle_secs.max(0.0)` guarantees non-negative deltas in `tick_second_with_idle` and prevents anomalous grace period activations.

## Current state

- Relevant files:
  - `src-tauri/src/lib.rs:159-174`
  - `src-tauri/src/idle.rs:21-42`

Current code excerpts:

1. `src-tauri/src/lib.rs:159-174`:
```rust
                    // Rebuild tray menu and update icon on state, pause, micro-break, or ergo alert change
                    if current_state != prev_state
                        || snapshot.is_paused != prev_paused
                        || snapshot.is_micro_break_active != prev_micro_active
                        || current_ergo_alert != prev_ergo_alert
                    {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            if !snapshot.is_paused {
                                let icon = get_icon_for_state(current_state);
                                let _ = tray.set_icon(Some(icon));
                            }
                            if let Ok(new_menu) = crate::tray::create_tray_menu(&handle, &snapshot) {
                                let _ = tray.set_menu(Some(new_menu));
                            }
                        }
                    }
```

2. `src-tauri/src/idle.rs:21-42`:
```rust
pub fn get_idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    unsafe {
        // kCGEventSourceStateCombinedSessionState = 0
        // kCGAnyInputEventType = u32::MAX (~0)
        CGEventSourceSecondsSinceLastEventType(0, u32::MAX)
    }
```

## STOP conditions

1. `cargo test --manifest-path src-tauri/Cargo.toml` fails.
2. Tray menu fails to render structural items on state transition.

## Step-by-step implementation

### Step 1: Clamp Idle Seconds in `src-tauri/src/idle.rs`

Modify `get_idle_seconds()` so that macOS and Windows outputs are clamped to `0.0` or greater:
```rust
    #[cfg(target_os = "macos")]
    unsafe {
        let secs = CGEventSourceSecondsSinceLastEventType(0, u32::MAX);
        if secs.is_nan() || secs < 0.0 {
            0.0
        } else {
            secs
        }
    }
```

### Step 2: Throttle Full Menu Rebuilding in `src-tauri/src/lib.rs`

Update the menu rebuild condition in `src-tauri/src/lib.rs`:
- Update tray icon whenever `current_state != prev_state` or `snapshot.is_paused != prev_paused`.
- Structural menu reconstruction is triggered on `current_state != prev_state`, `snapshot.is_paused != prev_paused`, `snapshot.is_micro_break_active != prev_micro_active`, or when entering/exiting an ergo alert state (`current_ergo_alert != prev_ergo_alert`).

### Step 3: Run Unit Tests

Execute:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
Confirm all 48+ tests pass.
