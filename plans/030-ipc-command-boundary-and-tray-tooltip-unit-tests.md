# Plan 030: Implement Comprehensive IPC Command Boundary & Tray Tooltip Unit Test Suite

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

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [028](028-fix-input-only-break-return-autostart-capability-and-compliance-dnd.md), [029](029-optimize-background-tick-loop-harden-settings-and-detection-barrier.md)
- **Category**: tests
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze's Rust backend has extensive tests for `state_machine.rs` and `db/mod.rs`, but `commands.rs` (the IPC entry point for all frontend actions) and `tray.rs` (the menu bar status display) currently have zero direct unit tests:
1. `update_setting` input validation bounds, type parsing, and rejection behavior are completely unexercised by test suites.
2. `import_data_json` error handling (malformed JSON, invalid structures) is not tested at the command boundary.
3. `get_tooltip_for_snapshot` in `tray.rs` generates multi-state status strings for system tray hovering; regressions in tooltip formatting can cause confusing or truncated menu bar information.

Adding isolated unit tests for these surfaces guarantees that frontend commands fail fast with clear errors and that tray status displays remain accurate across all states.

## Current state

- Relevant files:
  - `src-tauri/src/commands.rs` — IPC command handlers.
  - `src-tauri/src/tray.rs` — System tray menu builder and tooltip generator.

Current code excerpts:

1. `src-tauri/src/commands.rs:48-101`:
```rust
#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, AppSharedState>) -> Result<(), String> {
...
```

2. `src-tauri/src/tray.rs:80-100`:
```rust
pub fn get_tooltip_for_snapshot(snapshot: &StateSnapshot) -> String {
    if snapshot.is_paused {
        "FocusGaze: Tracking paused manually".to_string()
    } else if snapshot.state == AppTrackingState::BreakPrompt {
        "FocusGaze: Break interval reached! Time to rest.".to_string()
...
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Specific command tests | `cargo test --manifest-path src-tauri/Cargo.toml -- commands::tests` | exit 0 |
| Specific tray tests | `cargo test --manifest-path src-tauri/Cargo.toml -- tray::tests` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/commands.rs`
- `src-tauri/src/tray.rs`

**Out of scope**:
- Do not modify frontend files in `src/` or `index.html`.
- Do not alter `src-tauri/src/state_machine.rs` logic.

## Steps

### Step 1: Add unit test module to `src-tauri/src/tray.rs`
In `src-tauri/src/tray.rs`:
Add a `#[cfg(test)] mod tests` block testing `get_tooltip_for_snapshot`:
1. `test_tooltip_paused`: Snapshot with `is_paused = true` returns `"FocusGaze: Tracking paused manually"`.
2. `test_tooltip_break_prompt`: Snapshot in `BreakPrompt` returns `"FocusGaze: Break interval reached! Time to rest."`.
3. `test_tooltip_micro_break`: Snapshot with `is_micro_break_active = true` includes `20-20-20 rest` and remaining seconds.
4. `test_tooltip_posture_alerts`: Snapshot in `TrackingActive` with `is_too_close = true` and `is_slouching = true` returns distance/posture warning tooltip.
5. `test_tooltip_active_focus`: Normal tracking snapshot returns focus countdown tooltip.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- tray::tests` → exit 0

### Step 2: Extract setting validation helper or test `update_setting` logic in `src-tauri/src/commands.rs`
In `src-tauri/src/commands.rs`:
1. Extract pure validation function:
   ```rust
   pub fn validate_setting(key: &str, value: &str) -> Result<(), String> { ... }
   ```
   and call `validate_setting(&key, &value)?` in `update_setting`.
2. Add a `#[cfg(test)] mod tests` block testing `validate_setting`:
   - `test_validate_work_interval_bounds`: Accept 1..=180, reject 0, 181, -5, "abc".
   - `test_validate_break_interval_bounds`: Accept 1..=60, reject 0, 61.
   - `test_validate_grace_period_bounds`: Accept 10..=300, reject 9, 301.
   - `test_validate_snooze_and_skip_limits`: Accept 0..=10, reject 11, -1.
   - `test_validate_tracking_mode`: Accept "Auto", "Input only", "Webcam only", reject "Other".
   - `test_validate_boolean_toggles`: Accept "on", "off", reject "invalid".
   - `test_validate_min_face_ratio`: Accept 0.05..=0.5, reject 0.01, 0.9.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- commands::tests` → exit 0

### Step 3: Run full Rust backend test suite
Ensure all new tests pass alongside existing test suites with zero warnings.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0 (35+ passed, 0 failed)

## Test plan

- Test coverage:
  - 10+ new test cases in `src-tauri/src/commands.rs` covering all bounds in `validate_setting`.
  - 5 new test cases in `src-tauri/src/tray.rs` covering all branches in `get_tooltip_for_snapshot`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0.

## Done criteria

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 with 0 warnings.
- [ ] `commands::tests` module passes with all validation boundary cases.
- [ ] `tray::tests` module passes with all tooltip states.
- [ ] `plans/README.md` status row updated to DONE.

## STOP conditions

- If separating `validate_setting` causes signature mismatches with Tauri command macros, keep `update_setting` signature identical and call `validate_setting` internally.

## Maintenance notes

- Any newly introduced settings in future plans should add a corresponding test case to `commands::tests::test_validate_settings`.
