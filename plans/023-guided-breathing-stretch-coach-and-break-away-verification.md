# Plan 023: Implement Guided Breathing & Desk-Stretch Coach and Physical Away-During-Break Verification

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> `src-tauri/src/state_machine.rs`, `src/ergonomics.ts`, `index.html`,
> `src/main.ts`, and `src/style.css`; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [021](021-wire-seeded-settings-and-webaudio-chimes.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

PRD §4.5 ("Full-Screen/Overlay Break Mode" & "Break Compliance Logic") specifies two key restorative features during `BreakMode`:
1. **Breathing exercise or stretch suggestion** inside the break overlay (`prd.md:202`) with a calming breathing circle (`prd.md:368`, disabled when `reduced_motion` is active per `prd.md:375`). Currently `#break-mode-overlay` (`index.html:175-189`) only displays static 20-20-20 text.
2. **Physical away verification during breaks** (`prd.md:212`, `prd.md:358`): tracking how much of the break the user physically stepped away from the screen (`!is_cv_present`) versus remaining seated in front of the monitor.

Adding `break_away_seconds` to `StateMachine` and `StateSnapshot`, plus a pure `getBreakCoachStep(elapsedSeconds)` helper in `src/ergonomics.ts` that drives a live breathing pacer (Inhale 4s • Hold 4s • Exhale 6s) and rotating ergonomic desk stretches, turns `BreakMode` into an interactive recovery coach.

## Current state

Relevant files and excerpts:

1. `src-tauri/src/state_machine.rs:371-376` — `BreakMode` tick in `tick_second_with_idle`:
```rust
            AppTrackingState::BreakMode => {
                self.break_seconds_elapsed += 1;
                if self.break_seconds_elapsed >= self.break_interval_seconds {
                    self.finish_break(true);
                }
            }
```

2. `index.html:175-189` — current `#break-mode-overlay` markup:
```html
        <!-- Break Mode Overlay (When BreakMode is active) -->
        <div id="break-mode-overlay" class="break-mode-overlay hidden">
          <div class="break-mode-card">
            <div class="break-badge">BREAK IN PROGRESS</div>
            <h2 id="break-mode-timer">00:00</h2>
            <p class="break-guidance">
              20-20-20 Rule: Look at an object 20 feet away for 20 seconds. Relax your shoulders, stretch, and let your eyes rest.
            </p>
            <div class="break-progress-wrap">
              <div id="break-mode-progress-bar" class="break-mode-progress-bar" style="width: 0%"></div>
            </div>
            <div class="break-actions">
              <button id="btn-end-break-early" class="btn btn-secondary">End Break Early</button>
            </div>
          </div>
        </div>
```

## Commands you will need

Note: Prepend `export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin";` when running shell commands.

| Purpose | Command | Expected on success |
|---|---|---|
| Rust typecheck | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0 |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend unit tests | `npm test` | exit 0 |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/state_machine.rs`
- `src/ergonomics.ts`
- `src/ergonomics.test.mjs`
- `index.html`
- `src/main.ts`
- `src/style.css`

**Out of scope**:
- Modifying database table schemas in `src-tauri/src/db/mod.rs`.

## Steps

### Step 1: Track `break_away_seconds` in `StateMachine` and Expose in `StateSnapshot`

In `src-tauri/src/state_machine.rs`:
1. Add `pub break_away_seconds: i64` to `StateSnapshot` and `StateMachine` (initialized to `0` in `new()`, `reset()`, `start_break()`, `skip_break()`, and `finish_break()`).
2. In `tick_second_with_idle` inside the `AppTrackingState::BreakMode` arm (`lines 371-376`):
   - Increment `self.break_seconds_elapsed += 1;`.
   - If `!self.is_cv_present || idle_secs >= 15.0`, increment `self.break_away_seconds += 1;`.
3. Populate `break_away_seconds: self.break_away_seconds` in `StateMachine::snapshot()`.
4. Add unit test `test_break_away_seconds_tracked_during_break_mode` in `src-tauri/src/state_machine.rs` (`mod tests`).

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add `getBreakCoachStep` to `src/ergonomics.ts` and Unit Test It

In `src/ergonomics.ts`:
1. Add `BreakCoachStep` interface and `getBreakCoachStep(elapsedSeconds: number)`:
```ts
export interface BreakCoachStep {
  breathPhase: 'Inhale' | 'Hold' | 'Exhale';
  breathPhaseSecondsLeft: number;
  stretchTitle: string;
  stretchInstruction: string;
}

const DESK_STRETCHES: Array<{ title: string; instruction: string }> = [
  {
    title: '20-20-20 Far Gaze',
    instruction: 'Focus on a distant object at least 20 feet (6 meters) away to relax ciliary eye muscles.',
  },
  {
    title: 'Cervical Neck Release',
    instruction: 'Drop your shoulders away from your ears and gently tilt your head ear-to-shoulder for 15 seconds each side.',
  },
  {
    title: 'Scapular Wall / Desk Squeeze',
    instruction: 'Draw your shoulder blades back and down for 5 seconds to counteract forward screen posture.',
  },
  {
    title: 'Forearm & Wrist Flexor Stretch',
    instruction: 'Extend one arm forward with palm up and gently draw fingers back to release keyboard tension.',
  },
];

/**
 * Computes the current 14-second breathing cycle phase (4s Inhale, 4s Hold, 6s Exhale)
 * and rotates ergonomic desk stretches every 30 seconds.
 */
export function getBreakCoachStep(elapsedSeconds: number): BreakCoachStep {
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const cyclePos = safeElapsed % 14;
  let breathPhase: 'Inhale' | 'Hold' | 'Exhale';
  let breathPhaseSecondsLeft: number;

  if (cyclePos < 4) {
    breathPhase = 'Inhale';
    breathPhaseSecondsLeft = 4 - cyclePos;
  } else if (cyclePos < 8) {
    breathPhase = 'Hold';
    breathPhaseSecondsLeft = 8 - cyclePos;
  } else {
    breathPhase = 'Exhale';
    breathPhaseSecondsLeft = 14 - cyclePos;
  }

  const stretchIdx = Math.floor(safeElapsed / 30) % DESK_STRETCHES.length;
  return {
    breathPhase,
    breathPhaseSecondsLeft,
    stretchTitle: DESK_STRETCHES[stretchIdx].title,
    stretchInstruction: DESK_STRETCHES[stretchIdx].instruction,
  };
}
```
2. In `src/ergonomics.test.mjs`, import `getBreakCoachStep` and add a unit test verifying the `Inhale` (`0..3s`), `Hold` (`4..7s`), and `Exhale` (`8..13s`) phases and 30-second stretch card rotation.

**Verify**: `npm test` → exits 0.

### Step 3: Add Breathing Circle, Stretch Card, and Away-Status Badge to `#break-mode-overlay`

1. In `index.html` (`lines 175-189`), enhance `#break-mode-overlay`:
```html
        <!-- Break Mode Overlay (When BreakMode is active) -->
        <div id="break-mode-overlay" class="break-mode-overlay hidden">
          <div class="break-mode-card">
            <div class="break-badge">BREAK IN PROGRESS</div>
            <h2 id="break-mode-timer">00:00</h2>
            <div id="break-away-pill" class="posture-pill posture-aligned">
              <span class="posture-dot"></span>
              <span id="break-away-label">Step away from screen for full recovery</span>
            </div>
            <div class="breathing-coach-wrap">
              <div id="breathing-orb" class="breathing-orb breath-inhale">
                <span id="breathing-phase-text">Inhale (4s)</span>
              </div>
              <div class="stretch-coach-card">
                <strong id="stretch-coach-title">20-20-20 Far Gaze</strong>
                <p id="stretch-coach-instruction" class="break-guidance">
                  Focus on a distant object at least 20 feet (6 meters) away to relax ciliary eye muscles.
                </p>
              </div>
            </div>
            <div class="break-progress-wrap">
              <div id="break-mode-progress-bar" class="break-mode-progress-bar" style="width: 0%"></div>
            </div>
            <div class="break-actions">
              <button id="btn-end-break-early" class="btn btn-secondary">End Break Early</button>
            </div>
          </div>
        </div>
```
2. In `src/style.css`, add styles for `.breathing-coach-wrap`, `.breathing-orb` (smooth scale transitions for `.breath-inhale`, `.breath-hold`, `.breath-exhale`), and `.stretch-coach-card`.
3. In `src/main.ts`:
   - Add `break_away_seconds: number;` to `StateSnapshot`.
   - Import `getBreakCoachStep` from `./ergonomics`.
   - In `renderState(snapshot)` when `snapshot.state === 'BreakMode'`, update `#breathing-orb`, `#breathing-phase-text`, `#stretch-coach-title`, `#stretch-coach-instruction`, and `#break-away-label` (`!snapshot.is_cv_present ? \`Away from desk • \${formatTime(snapshot.break_away_seconds)} rested\` : \`At desk • Step away for deeper eye rest (\${formatTime(snapshot.break_away_seconds)} away)\``).

**Verify**: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

## Test plan

- Backend: `test_break_away_seconds_tracked_during_break_mode` in `src-tauri/src/state_machine.rs`.
- Frontend: `getBreakCoachStep` unit test in `src/ergonomics.test.mjs`.
- Verification: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_break_away_seconds_tracked_during_break_mode` passes
- [x] `npm test` exits 0; `getBreakCoachStep` test passes
- [x] `npm run build` exits 0
- [x] `#breathing-orb`, `#stretch-coach-title`, and `#break-away-pill` exist in `index.html` and update in `src/main.ts`
- [x] `plans/README.md` status row for Plan 023 updated to `DONE`

## STOP conditions

- Any existing test fails after adding `break_away_seconds` to `StateSnapshot`.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Because `body.reduced-motion *` disables CSS transitions and animations (from Plan 021), the text phase counter (`Inhale (4s)` / `Hold (4s)` / `Exhale (6s)`) inside `#breathing-phase-text` ensures the breathing coach remains fully usable with Reduced Motion enabled.
