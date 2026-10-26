# Plan 019: Add Backend StateMachine Edge-Case Tests and Extract Pure Frontend Ergonomic Logic with Unit Tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts below
> against `src/main.ts`, `package.json`, and `src-tauri/src/state_machine.rs`.
> On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [016](016-enforce-tracking-mode-and-pause-sync.md), [017](017-fix-dnd-override-settings-validation-and-skip-limits.md), [018](018-retention-session-persistence-and-lock-decoupling.md)
- **Category**: tests
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

All automated tests in FocusGaze currently live in Rust (`src-tauri/src/`), while `src/main.ts` (~1,100 lines) has zero automated test coverage for its time formatters, posture slouch drift evaluator, streak calculator, and `DutyCycledEyeStrainEstimator`. Extracting the pure, DOM-independent ergonomic and formatting logic into `src/ergonomics.ts` and testing it via Node's built-in test runner (`node --test` with TypeScript strip/compile, requiring zero external npm dependencies) establishes a fast, offline-compatible frontend verification gate alongside expanded Rust state-machine edge-case tests.

## Current state

- Relevant files:
  - `src/main.ts` — contains `formatTime` (`lines 161-166`), `formatHumanDuration` (`lines 169-174`), posture slouch drift logic (`lines 458-477`), streak calculation (`lines 538-542`), and `DutyCycledEyeStrainEstimator` (`lines 742-794`).
  - `package.json` — scripts (`dev`, `build`, `preview`, `tauri`).
  - `src-tauri/src/state_machine.rs` — unit test module (`lines 557-700`).

- Current code excerpts:

`src/main.ts:160-175`:
```ts
// Format seconds into HH:MM:SS
function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
}

// Format seconds into "Xh Ym"
function formatHumanDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${totalSeconds % 60}s`;
}
```

`src/main.ts:742-794`:
```ts
export interface EyeStrainEstimate {
  blinkRatePerMinute: number;
  fatigueScore: number;
  isBlinking: boolean;
  timestamp: number;
}
...
export class DutyCycledEyeStrainEstimator implements EyeStrainEstimator {
...
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src/ergonomics.ts` (create)
- `src/ergonomics.test.mjs` (create — or `.ts` compiled via `tsc` for `node --test`)
- `src/main.ts` (import pure functions/classes from `./ergonomics`)
- `package.json` (add `"test"` script)
- `src-tauri/src/state_machine.rs` (expand `#[cfg(test)] mod tests`)

**Out of scope**:
- Adding external npm test dependencies (the environment may run offline; use Node's built-in `node:test` and `node:assert/strict` modules).
- Modifying `index.html` or `src/style.css`.

## Steps

### Step 1: Extract Pure Logic into `src/ergonomics.ts`

Create `src/ergonomics.ts` exporting:
1. `formatTime(totalSeconds: number): string`
2. `formatHumanDuration(totalSeconds: number): string`
3. `calculateStreakDays(stats: Array<{ active_seconds: number }>): number`
4. `evaluatePostureDrift(centerY: number, baselineY: number, baselineHeight: number, currentCounter: number): { nextCounter: number; isSlouching: boolean }`
5. `EyeStrainEstimate`, `EyeStrainEstimator`, and `DutyCycledEyeStrainEstimator`.

Update `src/main.ts` to import and use these exports from `./ergonomics` (and re-export `EyeStrainEstimate`, `EyeStrainEstimator`, `DutyCycledEyeStrainEstimator` so existing exports on `src/main.ts` remain intact).

**Verify**:
`npm run build` → exits 0.

### Step 2: Create Frontend Unit Tests Using `node:test`

1. Create `src/ergonomics.test.mjs` (or compile `src/ergonomics.ts` with `npx tsc src/ergonomics.ts --module esnext --target es2022 --outDir dist-test` in `"test"` script) using `node:test` and `node:assert/strict` to test:
   - `formatTime(0)` -> `"00:00:00"`, `formatTime(3661)` -> `"01:01:01"`.
   - `formatHumanDuration(45)` -> `"0m 45s"`, `formatHumanDuration(7500)` -> `"2h 5m"`.
   - `calculateStreakDays` with consecutive active days (`> 60s`), a gap day (`<= 60s`), and an empty array.
   - `evaluatePostureDrift` below and above the `baselineY + baselineHeight * 0.25` threshold across 6 consecutive frames (`isSlouching: true` on frame 6, reset to `0` when upright).
   - `DutyCycledEyeStrainEstimator` when disabled vs. enabled, counting blink rising edges and computing `fatigueScore`.
2. Add `"test": "tsc src/ergonomics.ts --module esnext --target es2022 --outDir .test-dist && node --test src/ergonomics.test.mjs && rm -rf .test-dist"` to `package.json` scripts.

**Verify**:
`npm test` → exits 0, all frontend unit tests pass.

### Step 3: Expand `state_machine.rs` Edge-Case Unit Tests

In `src-tauri/src/state_machine.rs` (`mod tests`), add unit tests for:
1. `test_break_prompt_auto_escalates_after_120s`: verify that 120 ticks in `BreakPrompt` (when `is_wrap_up_active == false`) automatically transitions to `BreakMode`.
2. `test_break_snoozed_reprompts_after_300s`: verify that 300 ticks in `BreakSnoozed` transitions back to `BreakPrompt`.
3. `test_skip_break_updates_daily_compliance`: take 1 break and skip 1 break on the same day, and assert `sm.snapshot().skips_today == 1`, `sm.snapshot().breaks_taken_today == 1`, and `(sm.snapshot().compliance_pct - 50.0).abs() < 0.01`.
4. `test_fallback_input_tracking_idle_threshold`: use `sm.tick_second_with_idle(10.0)` vs `sm.tick_second_with_idle(120.0)` in `FallbackInputTracking` and verify `current_work_seconds` only increments when `idle_secs < grace_period_seconds as f64`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

## Test plan

- Frontend unit tests: `src/ergonomics.test.mjs` run via `npm test`.
- Backend unit tests: `src-tauri/src/state_machine.rs` run via `cargo test --manifest-path src-tauri/Cargo.toml`.

## Done criteria

- [x] `npm test` exits 0 with all frontend tests passing
- [x] `npm run build` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 with all new state-machine edge-case tests passing
- [x] No leftover `.test-dist` directory in working tree
- [x] `plans/README.md` status row for Plan 019 updated to `DONE`

## STOP conditions

- Node version in environment is older than Node 18 and lacks `node:test`.
- Any existing test fails after refactoring `src/main.ts` imports.

## Maintenance notes

- Keep `src/ergonomics.ts` free of DOM (`document`, `window`) and Tauri (`@tauri-apps/api`) imports so it can always be unit-tested in plain Node without mocking browser globals.
