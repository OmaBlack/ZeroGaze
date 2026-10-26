# Plan 012: Implement Phase 2 / V2 Product Roadmap and Architectural Feature Spikes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src/main.ts`, `src-tauri/src/state_machine.rs`, and
> `src-tauri/src/idle.rs`. If the state machine definitions, commands, or
> project build scripts have drifted, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md), [007](007-ergonomic-20-20-20-micro-breaks.md), [008](008-smart-presentation-and-dnd-awareness.md), [009](009-historical-analytics-and-trend-charts.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-15

## Why this matters

With Phase 1 (Plans 001–011) complete, FocusGaze has established a stable, privacy-first desktop foundation: local CV face presence detection, fallback OS input idle tracking, 50/10 macro-breaks, 20-20-20 micro-breaks, system tray integration, SQLite local storage, settings modal, data export, and 7-day trend visualizations.

To evolve FocusGaze from a basic timer into the leading personal digital ergonomics and wellness guardian (as defined in `PRODUCT.md` and `prd.md`), Phase 2 requires concrete architectural spikes and feature expansions:
1. **Ergonomic Vision Extension**: Prototype blink-rate and eye-strain detection using MediaPipe FaceLandmarker blendshapes without compromising the zero-cloud, 100% local privacy guarantee.
2. **Automated Meeting & Presentation Awareness**: Upgrade the manual DND toggle to query native OS fullscreen and presentation states (macOS `CGSessionCopyCurrentDictionary` / Windows `SHQueryUserNotificationState`).
3. **Cross-Platform Linux/Wayland Idle Parity**: Implement D-Bus `org.freedesktop.ScreenSaver` and X11 XScreenSaver idle queries in `idle.rs` so Linux users have working input fallback.
4. **Weekly Ergonomic Health Card**: Provide an exportable, printable summary (SVG/HTML) of focus streaks, break compliance, and eye-rest consistency.

This plan specifies the architecture, boundaries, and incremental steps for executing these Phase 2 milestones.

## Current state

The codebase currently has:
- `src/main.ts`: Loads MediaPipe `FaceDetector` (`@mediapipe/tasks-vision`) with `blaze_face_short_range.tflite` at 2 FPS (or 1 FPS on battery). Handles UI state, manual DND toggle, settings, and 7-day SVG trend graphs.
- `src-tauri/src/state_machine.rs`: Orchestrates `AppTrackingState`, 20-20-20 micro-breaks (`micro_break_work_seconds` / `micro_break_countdown`), DND break deferral (`defer_break("dnd_presentation")`), and SQLite persistence.
- `src-tauri/src/idle.rs`: macOS (`CGEventSourceSecondsSinceLastEventType`) and Windows (`GetLastInputInfo`) input idle detection; Linux returns a stub `0.0`.
- `src-tauri/src/db/mod.rs`: SQLite store for settings, event logs, daily statistics rollups, and JSON/CSV data export.

Excerpts:
`src-tauri/src/idle.rs:44-48`:
```rust
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
{
    0.0
}
```

`src-tauri/src/state_machine.rs:225-231`:
```rust
if self.current_work_seconds >= self.work_interval_seconds {
    if self.is_dnd_active {
        self.defer_break("dnd_presentation");
    } else {
        self.initiate_break_prompt();
    }
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend build & check | `npm run build` | exit 0, bundle generated in `dist/` |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/idle.rs`: Add Linux idle time detection (via X11 `xss` and D-Bus `org.freedesktop.ScreenSaver`).
- `src-tauri/src/commands.rs`: Add command `check_os_presentation_mode` returning whether the OS is currently in DND or full-screen presentation mode.
- `src-tauri/src/lib.rs`: Register new Tauri commands in `generate_handler!`.
- `src/main.ts`:
  - Hook automated presentation detection poll into the 10-second background maintenance loop.
  - Implement "Export Ergonomic Health Card" action generating an HTML/SVG self-contained wellness summary.
  - Provide a modular feature-flagged spike harness for MediaPipe FaceLandmarker eye-blink estimation.
- `index.html`: Add "Export Weekly Report Card" button in Settings modal.

**Out of scope**:
- Cloud synchronization, user accounts, or external API telemetry (`PRODUCT.md` line 28 explicitly forbids external network egress).
- Invasive screen recording, keystroke logging, or video persistence.
- Modifying SQLite schema in a backwards-incompatible manner.

## Git workflow

- Recommended branch: `advisor/012-v2-product-roadmap-and-feature-spikes`
- Commit per logical step with descriptive commit messages matching project conventions.

## Steps

### Step 1: Implement Linux Native Idle Detection in `idle.rs`

Expand `src-tauri/src/idle.rs` so that on Linux targets (`#[cfg(target_os = "linux")]`), idle time is queried using `libc` X11 `XScreenSaverQueryInfo` or D-Bus system idle protocol rather than returning a static `0.0`.

1. Add `#[cfg(target_os = "linux")]` module handling X11 / Wayland idle fallback.
2. Ensure non-Linux platforms (macOS and Windows) compile unchanged and pass existing tests.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0 with all tests passing.

### Step 2: Implement Automated Presentation & Fullscreen Detection Command

Create an OS presentation detector in `src-tauri/src`:
1. On macOS: Check if active display has a fullscreen app or if DND is active using CoreGraphics / NSWorkspace flags.
2. On Windows: Call `SHQueryUserNotificationState` to detect `QUNS_PRESENTATION_MODE` or `QUNS_RUNNING_D3D_FULL_SCREEN`.
3. Expose Tauri command `check_os_presentation_mode() -> Result<bool, String>`.
4. Register the command in `src-tauri/src/commands.rs` and `src-tauri/src/lib.rs`.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Wire Automatic Presentation Mode in Frontend Loop

In `src/main.ts`:
1. In the periodic maintenance timer (or every 10 seconds), invoke `check_os_presentation_mode`.
2. When presentation/meeting mode is detected and `is_dnd_active` is false, automatically invoke `set_dnd_mode(true)`.
3. When presentation mode clears, restore normal mode unless user manually locked DND.
4. Update DND status badge and tooltip to indicate "Auto-deferred: Meeting/Presentation in progress".

**Verify**:
`npm run build` → exits 0 with TypeScript type checking passing cleanly.

### Step 4: Implement Weekly Ergonomic Report Card Export

In `src/main.ts` and `index.html`:
1. Add a button `#btn-export-report-card` ("Export Weekly Ergonomic Summary") in the Settings modal next to JSON/CSV export.
2. Fetch the 7-day stats via `invoke('get_recent_stats', { days: 7 })`.
3. Generate a clean, standalone, printable HTML document containing:
   - Total active screen hours and daily average.
   - Overall break compliance percentage.
   - Total 20-20-20 micro-breaks completed.
   - Clean SVG compliance bar chart.
   - Scientifically backed ergonomic tips (referencing 20-20-20 rule from `PRODUCT.md`).
4. Trigger download as `focusgaze-weekly-report-YYYY-MM-DD.html`.

**Verify**:
`npm run build` → exits 0.

### Step 5: MediaPipe FaceLandmarker Eye-Strain Spike Architecture

In `src/main.ts`:
1. Define a modular interface `EyeStrainEstimator` that can be toggled via local setting `experimental_eye_strain = "true"`.
2. Document the benchmark criteria for CPU/RAM usage to ensure it remains within `< 5% CPU` (PRD Section 11):
   - FaceLandmarker blendshape `eyeBlinkLeft` + `eyeBlinkRight` thresholding.
   - Sampling duty cycle: 5 seconds of blink capture every 60 seconds (instead of continuous 30 FPS).
3. Ensure default remains `FaceDetector` (blazeface) so baseline performance is 100% unaffected.

**Verify**:
`npm run build` → exits 0.

## Test plan

- **Unit tests** (`src-tauri`):
  - Verify `test_get_idle_seconds` still succeeds across all target OS configurations.
  - Add test for `check_os_presentation_mode` fallback behavior when no display server is present.
- **Frontend validation**:
  - Test `npm run build` ensures no TypeScript type mismatches across new commands or report generation.
  - Verify exported report card HTML opens cleanly in browser with zero external network requests (fully self-contained).

## Done criteria

- [x] `npm run build` exits 0.
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 with all tests passing.
- [x] `plans/README.md` status row for Plan 012 is updated.
- [x] No files outside the in-scope list are modified.


## STOP conditions

- If adding Linux X11/Wayland dependencies breaks cross-compilation on macOS/Windows targets, stop and isolate Linux bindings behind strict `#[cfg(target_os = "linux")]` gates.
- If MediaPipe FaceLandmarker bundle exceeds 5MB or causes frame drops, stop and preserve BlazeFace as the sole default runtime.

## Maintenance notes

- Future plans may introduce local encrypted database storage (SQLCipher) once multi-user workstation support is prioritized.
- Any change to presentation mode detection should be tested against both virtual meeting software (Zoom, Teams) and keynote/PowerPoint fullscreen windows.
