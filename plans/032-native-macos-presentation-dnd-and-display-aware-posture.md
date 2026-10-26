# Plan 032: Native macOS Presentation/DND Meeting Detection and Camera-Aware Posture Profiles

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
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [028](028-fix-input-only-break-return-autostart-capability-and-compliance-dnd.md), [029](029-optimize-background-tick-loop-harden-settings-and-detection-barrier.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze promises smart meeting and presentation awareness (`FEATURES.md:57-61`), automatically deferring break prompts when users are presenting or in full-screen video meetings:
1. On Windows, `SHQueryUserNotificationState` detects `QUNS_PRESENTATION_MODE` and `QUNS_RUNNING_D3D_FULL_SCREEN`. On macOS, `idle.rs:121` currently returns a hardcoded `false`, forcing macOS users to manually press `Cmd+Shift+D` to avoid break prompts during Keynote, Zoom, Google Meet, or PowerPoint presentations.
2. Desk workers often alternate between a laptop screen (built-in webcam at a lower angle) and an external monitor (mounted webcam at eye level). Currently, `posture_baseline_y` and `posture_baseline_height` are stored globally; switching between built-in and external webcams causes false slouch alerts until the user manually recalibrates.

Delivering native macOS full-screen presentation detection and keying posture baselines by `selected_camera_id` delivers automated meeting protection across macOS and seamless docking/undocking ergonomics.

## Current state

- Relevant files:
  - `src-tauri/src/idle.rs:121-125` — macOS presentation query returning `false`.
  - `src-tauri/src/commands.rs:237-240` — `check_os_presentation_mode` command.
  - `src/main.ts:881-897` — Posture baseline storage and retrieval.

Current code excerpts:

1. `src-tauri/src/idle.rs:121-125`:
```rust
    #[cfg(target_os = "macos")]
    {
        // Safe check on macOS: fallback to false if no presentation query is active
        false
    }
```

2. `src/main.ts:884-893`:
```ts
      if (baselineFaceY === null || baselineFaceHeight === null) {
        baselineFaceY = centerY;
        baselineFaceHeight = box.height;
        slouchCounter = 0;
        tooCloseCounter = 0;
        updatePostureUI(false, true);
        updatePostureCalibrationUI();
        void invoke('update_setting', { key: 'posture_baseline_y', value: String(Math.round(baselineFaceY * 100) / 100) }).catch(() => {});
        void invoke('update_setting', { key: 'posture_baseline_height', value: String(Math.round(baselineFaceHeight * 100) / 100) }).catch(() => {});
      }
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| TypeScript check | `npm run build` | exit 0, no errors |
| Frontend tests | `npm test` | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/idle.rs`
- `src/main.ts`

**Out of scope**:
- Do not modify Windows Win32 APIs in `src-tauri/src/idle.rs`.
- Do not modify database schemas in `src-tauri/src/db/mod.rs`.

## Steps

### Step 1: Implement macOS full-screen presentation query in `idle.rs`
In `src-tauri/src/idle.rs`:
On macOS, detect whether the frontmost application window occupies full-screen dimensions or matches presentation software (Keynote, PowerPoint, Zoom, Teams, Google Chrome fullscreen):
```rust
    #[cfg(target_os = "macos")]
    {
        // Query frontmost window or display presentation status
        // Using CoreGraphics window query or process check
        let is_pres = check_macos_presentation_state();
        is_pres
    }
```
Implement `check_macos_presentation_state() -> bool` safely without crashing if permissions are standard.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml -- idle::tests` → exit 0

### Step 2: Key posture baselines by `selected_camera_id`
In `src/main.ts`:
Store posture calibration settings using camera-specific keys:
- `posture_baseline_y_${selectedDeviceId || 'default'}`
- `posture_baseline_height_${selectedDeviceId || 'default'}`
When changing cameras or starting webcam:
Load the baseline specific to `selectedDeviceId`. If found, apply it; if not found, prompt or initialize fresh baseline.

**Verify**: `npm run build` → exit 0

### Step 3: Verify end-to-end build and tests
Run all cargo tests and frontend build to verify zero regressions.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml && npm run build && npm test` → all exit 0

## Test plan

- In `src-tauri/src/idle.rs`:
  - Verify `test_is_presentation_mode_active` returns a boolean without panic or crash on macOS.
- In frontend:
  - Verify switching camera IDs loads the respective camera's posture baseline and resets counters.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml && npm test` → exit 0.

## Done criteria

- [ ] `src-tauri/src/idle.rs` implements non-trivial macOS presentation query.
- [ ] Posture calibration supports per-camera profiles.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [ ] `npm run build` exits 0.
- [ ] `plans/README.md` status row updated to DONE.

## STOP conditions

- If CoreGraphics APIs on macOS require elevated permissions that trigger permission alerts, fallback safely to checking known meeting process names (`zoom.us`, `Keynote`, `Microsoft PowerPoint`).

## Maintenance notes

- Per-camera posture keys fall back to `'default'` when device IDs are empty or privacy-masked by the browser.
