# Plan 035: Unit Test Coverage for Charts and Weekly Ergonomic Report Generation

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

In Plan 031, `renderTrendsChart` and `generateErgonomicReportHtml` were extracted into `src/charts.ts`. However, while `src/ergonomics.ts` has extensive test coverage in `src/ergonomics.test.mjs`, `src/charts.ts` currently has zero unit tests. Specifically:
1. `generateErgonomicReportHtml` must produce well-formed HTML containing user metrics (screen time, breaks taken, breaks skipped, compliance percentage) without throwing on empty stats arrays or divide-by-zero errors.
2. SVG trend bar coordinate and width math must handle varying numbers of days (e.g. 7 days vs 30 days) and zero active screen seconds safely.

Adding isolated unit tests verifies these reporting surfaces remain regression-free.

## Current state

- Relevant files:
  - `src/charts.ts` — Trend chart and ergonomic report generation.
  - `src/ergonomics.test.mjs` — Node test suite.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run frontend tests | `npm test` | exit 0, all tests pass |
| Typecheck / Build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/charts.ts`
- `src/charts.test.mjs` (create or extend `src/ergonomics.test.mjs`)
- `package.json` (update test script to run all test files)

**Out of scope**:
- Do not modify Rust backend files.

## Steps

### Step 1: Add tests for `generateErgonomicReportHtml`
Create `src/charts.test.mjs` using Node's native test runner (`node:test`, `node:assert`):
1. `test('generateErgonomicReportHtml handles standard 7-day stats')`:
   - Assert HTML contains `<title>FocusGaze - Weekly Ergonomic Health Summary</title>`.
   - Assert HTML contains calculated average hours and compliance percentages.
   - Assert all row dates are rendered into table cells.
2. `test('generateErgonomicReportHtml handles empty stats gracefully')`:
   - Pass `[]`.
   - Assert it returns valid HTML with 0h daily average and 100% default compliance without NaN errors.

**Verify**: `node --test src/charts.test.mjs` → exit 0

### Step 2: Update `package.json` test script to include charts tests
In `package.json`:
Update the `test` script so that both `src/ergonomics.ts` and `src/charts.ts` are compiled and tested:
```json
"test": "tsc src/ergonomics.ts src/charts.ts --module esnext --target es2022 --outDir .test-dist && node --test src/*.test.mjs && rm -rf .test-dist"
```

**Verify**: `npm test` → exit 0 (13+ tests passing)

## Done criteria

- [ ] `generateErgonomicReportHtml` covered by unit tests.
- [ ] `npm test` runs both test suites and passes with 0 failures.
- [ ] `npm run build` exits 0.
- [ ] `plans/README.md` updated.
