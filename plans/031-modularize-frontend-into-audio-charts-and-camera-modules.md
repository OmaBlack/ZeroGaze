# Plan 031: Modularize Frontend into Focused Audio, Charts, and Camera Submodules

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
- **Category**: tech-debt
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

`src/main.ts` has grown to over 2,080 lines, conflating eight distinct application responsibilities:
1. WebAudio tone synthesis and frequency ramping.
2. SVG bar chart rendering, streak calculation, and HTML report card generation.
3. MediaPipe WASM model downloading, camera device enumeration, and webcam stream lifecycle.
4. Bounding box canvas overlay rendering.
5. First-run onboarding wizard and privacy explainer.
6. Settings modal loading, persistence, and validation.
7. Real-time state reconciliation (`renderState`).
8. Global hotkeys, desktop notifications, and IPC event listeners.

This monolithic layout creates high cognitive load, increases the risk of regressions during UI edits, and prevents unit testing of chart rendering and audio helpers. Following the successful pattern established in Plan 019 (extracting pure ergonomic logic into `src/ergonomics.ts`), this plan extracts cohesive submodules (`src/audio.ts`, `src/charts.ts`, `src/camera.ts`), leaving `src/main.ts` as a clean application coordinator.

## Current state

- Relevant files:
  - `src/main.ts:419-451` — `playBreakChime`
  - `src/main.ts:272-313` — `playPostureWarningChime`
  - `src/main.ts:980-1115` — `renderTrendsChart`, `refreshTrendsChart`, `exportData`
  - `src/main.ts:1116-1210` — `exportErgonomicReport`
  - `src/main.ts:700-810` — `startWebcam`, `stopWebcamTracks`, `populateCameraDevices`
  - `src/main.ts:934-978` — `drawDetections`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build / Bundler check | `npm run build` | exit 0, built in <1s |
| Unit tests | `npm test` | exit 0, all tests pass |
| Cargo tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0 |

## Scope

**In scope**:
- `src/audio.ts` (create)
- `src/charts.ts` (create)
- `src/camera.ts` (create)
- `src/main.ts` (refactor to import from submodules)

**Out of scope**:
- Do not modify Rust backend files in `src-tauri/`.
- Do not modify `index.html` element IDs or DOM structure.
- Do not alter `style.css`.

## Steps

### Step 1: Extract `src/audio.ts`
Create `src/audio.ts` containing the WebAudio chime helpers:
- `playBreakChime(kind: 'prompt' | 'complete', soundEnabled: boolean): void`
- `playPostureWarningChime(postureAlertSoundEnabled: boolean, lastAudioTs: number): number` (returns updated timestamp)
Export both functions and import them in `src/main.ts`.

**Verify**: `npm run build` → exit 0

### Step 2: Extract `src/charts.ts`
Create `src/charts.ts` containing data visualization and report generation:
- `renderTrendsChart(svg: SVGSVGElement, footer: HTMLElement, streakBadge: HTMLElement | null, stats: DailyStats[]): void`
- `generateErgonomicReportHtml(stats: DailyStats[], today: string): string`
Export these functions and import them into `src/main.ts`.

**Verify**: `npm run build` → exit 0

### Step 3: Extract `src/camera.ts`
Create `src/camera.ts` containing camera device utilities and canvas drawing:
- `drawDetections(canvasEl: HTMLCanvasElement, videoEl: HTMLVideoElement, primary: FaceDetectionCandidate | null, ignoredBackground?: FaceDetectionCandidate[]): void`
- `stopMediaStream(videoEl: HTMLVideoElement | null): void`
- `enumerateVideoDevices(): Promise<MediaDeviceInfo[]>`
Export these helpers and import them into `src/main.ts`.

**Verify**: `npm run build` → exit 0

### Step 4: Verify full build and tests
Confirm that `src/main.ts` is reduced in size by ~600 lines, all imports resolve cleanly, and bundle builds without warnings.

**Verify**: `npm run build && npm test && cargo test --manifest-path src-tauri/Cargo.toml` → all exit 0

## Test plan

- Ensure existing unit tests in `src/ergonomics.test.mjs` continue to pass.
- Verify `generateErgonomicReportHtml` produces valid HTML with table rows matching input stats.

**Verify**: `npm test && npm run build` → all exit 0.

## Done criteria

- [ ] `src/audio.ts`, `src/charts.ts`, and `src/camera.ts` exist with clean exports.
- [ ] `src/main.ts` line count is reduced under 1,500 lines.
- [ ] `npm run build` exits 0 with zero TypeScript errors.
- [ ] `npm test` exits 0.
- [ ] `plans/README.md` status row updated to DONE.

## STOP conditions

- If separating DOM references causes circular dependencies between modules, pass DOM elements as function arguments rather than importing them.

## Maintenance notes

- Frontend submodules remain vanilla TypeScript without external framework dependencies, maintaining fast Vite build times (<500ms).
