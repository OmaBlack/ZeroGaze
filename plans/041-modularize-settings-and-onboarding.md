# Plan 041: Modularize Settings and Onboarding from Main Frontend Script

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
- **Depends on**: [031](031-modularize-charts-audio-camera.md)
- **Category**: refactor
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

`src/main.ts` is currently ~1,847 lines long. Although audio synthesis, camera lifecycle, and chart rendering were previously modularized into `src/audio.ts`, `src/camera.ts`, and `src/charts.ts`, the settings modal management and first-run onboarding wizard occupy ~400 lines of DOM event wiring, appearance theme switching, and form hydration.

Extracting these concerns into `src/settings.ts` and `src/onboarding.ts`:
1. Reduces `src/main.ts` cognitive load and separates view lifecycle from settings persistence.
2. Keeps UI modules cleanly decoupled and enables direct unit testing of settings serialization.
3. Improves TypeScript compile times and developer ergonomics.

## Current state

- Relevant files:
  - `src/main.ts`
  - `src/settings.ts` (to be created)
  - `src/onboarding.ts` (to be created)

## STOP conditions

1. `npm run build` fails with TypeScript type errors.
2. `npm test` fails.
3. Settings modal cannot open or save settings.

## Step-by-step implementation

### Step 1: Create `src/settings.ts`
Extract settings modal opening, closing, population, appearance switching (dark/light/system, accent color, reduced motion), and save handlers into `src/settings.ts`.

### Step 2: Create `src/onboarding.ts`
Extract the multi-step onboarding wizard DOM wiring, step transitions, camera permission prompt, and completion handler into `src/onboarding.ts`.

### Step 3: Wire into `src/main.ts`
Import functions from `src/settings.ts` and `src/onboarding.ts` in `src/main.ts` and verify build and tests:
```bash
npm test && npm run build
```
