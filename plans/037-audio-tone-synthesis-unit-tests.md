# Plan 037: Audio Module Tone Synthesis Unit Test Suite with Mock AudioContext

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
- **Depends on**: [031](031-modularize-frontend-into-audio-charts-and-camera-modules.md)
- **Category**: tests
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

`src/audio.ts` manages tone synthesis for break prompts, completions, and loud ergonomic warning chimes. It includes critical throttling logic (`lastErgoAlertAudioTs` 6-second cooldown) and AudioContext autoplay error handling. Currently, `src/audio.ts` is the only extracted helper submodule with zero unit tests.

Adding unit tests for `playBreakChime` and `playPostureWarningChime` using a lightweight mock AudioContext guarantees that sound toggles, timestamp throttling, and frequency scheduling remain intact.

## Current state

- Relevant files:
  - `src/audio.ts` — Tone synthesis helpers.
  - `package.json` — Test script.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend test suite | `npm test` | exit 0, all tests pass |
| Bundle check | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/audio.test.mjs` (create)
- `package.json` (include in test script)

**Out of scope**:
- Do not modify Rust backend files.

## Steps

### Step 1: Create `src/audio.test.mjs`
Create `src/audio.test.mjs` testing:
1. `playBreakChime` no-ops when `soundEnabled = false`.
2. `playPostureWarningChime` throttles alerts if invoked within 6 seconds (`now - lastAudioTs < 6000`).
3. `playPostureWarningChime` returns updated timestamp when alert triggers.
4. `playPostureWarningChime` gracefully ignores environments where AudioContext throws or is undefined.

**Verify**: `node --test src/audio.test.mjs` → exit 0

### Step 2: Update `package.json` test script
Compile `src/audio.ts` alongside other modules in `package.json`:
```json
"test": "tsc src/ergonomics.ts src/charts.ts src/audio.ts --module esnext --target es2022 --outDir .test-dist && node --test src/ergonomics.test.mjs src/charts.test.mjs src/audio.test.mjs && rm -rf .test-dist"
```

**Verify**: `npm test` → exit 0 (16+ tests passing)

## Done criteria

- [ ] `src/audio.test.mjs` exists and passes.
- [ ] `npm test` passes all tests.
- [ ] `npm run build` exits 0.
- [ ] `plans/README.md` updated.
