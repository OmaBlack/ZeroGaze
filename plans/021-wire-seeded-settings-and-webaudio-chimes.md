# Plan 021: Wire Seeded Settings (`cv_fps`, `sound`, `break_overlay`, `data_retention_days`, `reduced_motion`, `high_contrast`) and WebAudio Break Chimes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: This workspace is an unversioned directory (no `.git`).
> Before starting, inspect the "Current state" excerpts against the live code in
> `src-tauri/src/commands.rs`, `src-tauri/src/db/mod.rs`, `index.html`, `src/main.ts`,
> and `src/style.css`; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [017](017-fix-dnd-override-settings-validation-and-skip-limits.md), [018](018-retention-session-persistence-and-lock-decoupling.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

`Database::seed_default_settings` (`src-tauri/src/db/mod.rs:150-168`) seeds 6 settings into SQLite on every installation (`cv_fps`, `sound`, `break_overlay`, `data_retention_days`, `reduced_motion`, `high_contrast`) that correspond to PRD §4.5, §4.6, and §7 requirements, yet none of them have UI controls in `index.html` or runtime consumers in `src/main.ts`. As a result, camera polling is hardcoded to 2 FPS (`500ms`), break prompts and completions are completely silent even though `sound = "on"`, users cannot switch between full-screen and compact centered break overlays, data retention cannot be adjusted from 365 days without editing SQLite directly, and accessibility toggles (`reduced_motion`, `high_contrast`) cannot be activated in-app. Wiring these 6 settings and adding a zero-asset WebAudio chime synthesizer completes the entire PRD §4.6 settings matrix.

## Current state

Relevant files and excerpts:

1. `src-tauri/src/db/mod.rs:150-168` — seeds the 6 currently unwired settings:
```rust
    fn seed_default_settings(&self) -> Result<()> {
        let defaults = [
            ("work_interval_minutes", "50"),
            ("break_interval_minutes", "10"),
            ("grace_period_seconds", "60"),
            ("cv_fps", "2"),
            ("camera_selection", "Default"),
            ("tracking_mode", "Auto"),
            ("auto_start", "off"),
            ("break_overlay", "full-screen"),
            ("sound", "on"),
            ("snooze_limit", "2"),
            ("skip_limit", "2"),
            ("battery_mode", "on"),
            ("data_retention_days", "365"),
            ("reduced_motion", "off"),
            ("high_contrast", "off"),
        ];
```

2. `src-tauri/src/commands.rs:40-75` — `update_setting` validates numeric bounds before saving to `db`:
```rust
#[tauri::command]
pub fn update_setting(key: String, value: String, state: State<'_, AppSharedState>) -> Result<(), String> {
    match key.as_str() {
        "work_interval_minutes" => { ... }
        ...
        "skip_limit" => {
            let lim = value.parse::<i32>().map_err(|_| "Invalid skip_limit".to_string())?;
            if !(0..=10).contains(&lim) {
                return Err("skip_limit must be between 0 and 10".to_string());
            }
        }
        _ => {}
    }
```

3. `src/main.ts:495-499` — `runDetectionLoop` hardcodes `let nextDelay = 500;`:
```ts
  // Determine dynamic FPS: 2 FPS (500ms) on AC, 0.5 FPS (2000ms) on battery, 2500ms if battery < 20%
  let nextDelay = 500;
  if (currentBattery && !currentBattery.charging) {
    nextDelay = currentBattery.level < 0.2 ? 2500 : 2000;
  }
```

4. `index.html:264-295` — `#settings-modal` groups where the new controls belong.

## Commands you will need

Note: Prepend `export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin";` when running shell commands in this environment.

| Purpose | Command | Expected on success |
|---|---|---|
| Rust typecheck | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend unit tests | `npm test` | exit 0, all tests pass |
| Frontend build | `npm run build` | exit 0, `tsc && vite build` succeeds |

## Scope

**In scope**:
- `src-tauri/src/commands.rs`
- `src/ergonomics.ts`
- `src/ergonomics.test.mjs`
- `src/main.ts`
- `index.html`
- `src/style.css`

**Out of scope**:
- Bundling external `.mp3`/`.wav` audio files (use WebAudio API oscillator synthesis for zero-asset offline operation).
- Modifying `src-tauri/src/state_machine.rs`.

## Steps

### Step 1: Validate `cv_fps` and `data_retention_days` in `commands::update_setting`

In `src-tauri/src/commands.rs`:
1. In `update_setting` (`lines 41-73`), add validation arms for:
   - `"cv_fps"`: parse as `i32`, require `(1..=5).contains(&fps)`, otherwise return `Err("cv_fps must be between 1 and 5".to_string())`.
   - `"data_retention_days"`: parse as `i64`, require `(7..=3650).contains(&days)`, otherwise return `Err("data_retention_days must be between 7 and 3650".to_string())`.
2. After `db.set_setting(&key, &value)` (`around line 78`), if `key == "data_retention_days"`, parse `days: i64` and call `let _ = db.cleanup_retention(days);` inside the `state.db.lock()` block so updating retention cleans up expired records immediately.

**Verify**: `cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add `computeDetectionDelayMs` Helper to `src/ergonomics.ts` and Unit Test It

In `src/ergonomics.ts`:
1. Add a pure helper function that computes the detection loop interval in milliseconds from `cvFps` (`1` to `5`), battery charging state, and battery level:
```ts
export function computeDetectionDelayMs(
  cvFps: number = 2,
  isOnBattery: boolean = false,
  batteryLevel: number = 1.0
): number {
  if (isOnBattery) {
    return batteryLevel < 0.2 ? 2500 : 2000;
  }
  const clampedFps = Math.max(1, Math.min(5, Math.round(cvFps || 2)));
  return Math.round(1000 / clampedFps);
}
```
2. In `src/ergonomics.test.mjs`, import `computeDetectionDelayMs` and add a unit test verifying AC delays (`1 FPS -> 1000ms`, `2 FPS -> 500ms`, `5 FPS -> 200ms`) and battery overrides (`2000ms` at 50% battery, `2500ms` at 15% battery).

**Verify**: `npm test` → exits 0.

### Step 3: Add Settings Controls to `index.html` and Accessibility / Compact-Overlay Styles to `src/style.css`

1. In `index.html` inside `#settings-modal`:
   - In the second `.settings-group` (after `#setting-min-face-ratio`), add `#setting-cv-fps`:
     ```html
     <div class="setting-item">
       <label for="setting-cv-fps">Camera Polling Rate (FPS)</label>
       <select id="setting-cv-fps">
         <option value="1">1 FPS (Ultra Low Power)</option>
         <option value="2" selected>2 FPS (Recommended Default)</option>
         <option value="3">3 FPS (Responsive)</option>
         <option value="5">5 FPS (High Precision)</option>
       </select>
     </div>
     ```
   - In the third `.settings-group` (alongside `#setting-autostart`), add controls for `#setting-break-overlay`, `#setting-sound`, `#setting-data-retention`, `#setting-reduced-motion`, and `#setting-high-contrast`:
     ```html
     <div class="setting-item">
       <label for="setting-break-overlay">Break Overlay Style</label>
       <select id="setting-break-overlay">
         <option value="full-screen">Full-Screen Rest Overlay</option>
         <option value="centered">Compact Centered Card</option>
       </select>
     </div>
     <div class="setting-item">
       <label for="setting-data-retention">Local Data Retention</label>
       <select id="setting-data-retention">
         <option value="30">30 Days</option>
         <option value="90">90 Days</option>
         <option value="365" selected>365 Days (1 Year)</option>
         <option value="3650">Indefinite (10 Years)</option>
       </select>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-sound">Audio Cues</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-sound" checked />
         <label for="setting-sound" class="checkbox-label">Play gentle chime on break prompt &amp; completion</label>
       </div>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-reduced-motion">Reduced Motion</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-reduced-motion" />
         <label for="setting-reduced-motion" class="checkbox-label">Disable ambient animations and pulsing effects</label>
       </div>
     </div>
     <div class="setting-item checkbox-item">
       <label for="setting-high-contrast">High Contrast Mode</label>
       <div class="checkbox-row">
         <input type="checkbox" id="setting-high-contrast" />
         <label for="setting-high-contrast" class="checkbox-label">Increase border and text contrast (WCAG AAA)</label>
       </div>
     </div>
     ```
2. In `src/style.css`:
   - Add `.break-mode-overlay.overlay-centered` so when `break_overlay === 'centered'`, `.break-mode-overlay` uses `background: rgba(10, 13, 20, 0.55); backdrop-filter: blur(4px);` instead of an opaque full-screen blackout.
   - Add `body.reduced-motion *, body.reduced-motion *::before, body.reduced-motion *::after { animation: none !important; transition: none !important; }`.
   - Add `body.high-contrast` overrides increasing `--border-subtle: rgba(255, 255, 255, 0.32); --text-muted: #f1f5f9; --text-dim: #e2e8f0;`.

### Step 4: Wire Settings, WebAudio Chimes, and Dynamic FPS Label in `src/main.ts`

In `src/main.ts`:
1. Import `computeDetectionDelayMs` from `./ergonomics`.
2. Bind `#setting-cv-fps`, `#setting-break-overlay`, `#setting-data-retention`, `#setting-sound`, `#setting-reduced-motion`, and `#setting-high-contrast`.
3. Add state variables `configuredCvFps = 2`, `soundEnabled = true`, `breakOverlayMode = 'full-screen'`, `reducedMotion = false`, `highContrast = false`, and `lastRenderedState: string = 'Initializing'`.
4. Add a helper `playBreakChime(kind: 'prompt' | 'complete')` using `window.AudioContext` (wrapped in `try/catch` so headless or restricted environments never throw) that plays a soft 2-note sine/triangle chime when `soundEnabled` is `true`.
5. Add a helper `applyAppearanceSettings()` that toggles `document.body.classList.toggle('reduced-motion', reducedMotion)`, `document.body.classList.toggle('high-contrast', highContrast)`, and `breakModeOverlayEl.classList.toggle('overlay-centered', breakOverlayMode === 'centered')`, and updates the polling metric text in `.preview-metrics` (`Polling: <strong>${configuredCvFps} FPS</strong>`).
6. In `renderState(snapshot)`:
   - Trigger `playBreakChime('prompt')` when transitioning into `'BreakPrompt'` (`lastRenderedState !== 'BreakPrompt' && snapshot.state === 'BreakPrompt'`) and `playBreakChime('complete')` when transitioning from `'BreakMode'` to `'TrackingActive'`.
   - Update `lastRenderedState = snapshot.state;`.
7. In `runDetectionLoop()`:
   - Replace hardcoded `nextDelay = 500` with `computeDetectionDelayMs(configuredCvFps, Boolean(currentBattery && !currentBattery.charging), currentBattery?.level ?? 1.0)`.
8. Load and save all 6 settings in `openSettings()`, `saveSettings()`, and `init()`.

**Verify**: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

## Test plan

- File: `src/ergonomics.test.mjs`
- Cases covered: `computeDetectionDelayMs` for 1, 2, 3, and 5 FPS on AC power, plus 0.5 FPS / low-battery throttling when on battery.
- Verification: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `npm test` exits 0 including `computeDetectionDelayMs` unit tests
- [x] `npm run build` exits 0
- [x] `#setting-cv-fps`, `#setting-break-overlay`, `#setting-data-retention`, `#setting-sound`, `#setting-reduced-motion`, and `#setting-high-contrast` exist in `index.html` and are wired in `src/main.ts`
- [x] `plans/README.md` status row for Plan 021 updated to `DONE`

## STOP conditions

- Any existing test fails after adding validation in `commands::update_setting`.
- WebAudio API synthesis throws an unhandled error when audio output is unavailable.

## Maintenance notes

- Keep `playBreakChime` completely wrapped in `try { ... } catch { ... }` because WebView autoplay policies may block `AudioContext` before the first user interaction.
