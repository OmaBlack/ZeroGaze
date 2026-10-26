# Plan 040: Unit Tests for Lock Workstation and Camera Error IPC Boundaries

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
- **Depends on**: [030](030-harden-ipc-input-validation-and-expand-test-coverage.md)
- **Category**: test
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

In `src-tauri/src/commands.rs`, `lock_workstation` and `report_camera_error` handle critical failure boundaries:
1. `report_camera_error` receives webcam crash / device disconnect events from frontend MediaPipe and updates state machine watchdog degradation.
2. `lock_workstation` flushes the user's active session, triggers pause state, logs the security event into SQLite, and delegates to OS desktop lock (`idle::lock_os_session`).

Currently, neither command has automated unit tests verifying that state machine pause/flush flags are executed or verifying behavior when state machine errors occur. Adding dedicated unit tests prevents regressions in these security and hardware recovery paths.

## Current state

- Relevant files:
  - `src-tauri/src/commands.rs:28-34`
  - `src-tauri/src/commands.rs:293-308`
  - `src-tauri/src/commands.rs:322-445` (unit tests)

Current code excerpts:

1. `src-tauri/src/commands.rs:28-34`:
```rust
#[tauri::command]
pub fn report_camera_error(error: String, state: State<'_, AppSharedState>) -> StateSnapshot {
    let mut sm = state.sm.lock().unwrap();
    sm.handle_camera_error(&error);
    sm.snapshot()
}
```

2. `src-tauri/src/commands.rs:293-308`:
```rust
#[tauri::command]
pub fn lock_workstation(state: State<'_, AppSharedState>) -> Result<StateSnapshot, String> {
    if let Ok(db) = state.db.lock() {
        let _ = db.log_event("workstation_locked_unrecognized_user", None);
    }
    let snapshot = if let Ok(mut sm) = state.sm.lock() {
        sm.flush_current_session();
        if !sm.is_paused {
            sm.toggle_pause();
        }
        sm.snapshot()
    } else {
        return Err("Failed to lock state machine".to_string());
    };
    crate::idle::lock_os_session()?;
    Ok(snapshot)
}
```

## STOP conditions

1. Tests fail during `cargo test --manifest-path src-tauri/Cargo.toml`.
2. Existing 48 tests regress.

## Step-by-step implementation

### Step 1: Add Unit Tests in `src-tauri/src/commands.rs`

In `commands.rs::tests`:
- Test that `handle_camera_error` flags camera degradation and returns a snapshot in `FallbackInputTracking` or degraded mode depending on current tracking mode.
- Test that workstation lock logic flushes current session and pauses tracking.

### Step 2: Run Cargo Tests

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml
```
Confirm all tests pass.
