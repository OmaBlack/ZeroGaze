# Plan 014: Implement Interactive 20-20-20 Visual Eye Exercise Guide and Ambient Posture Slouch Detection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src/main.ts` and `index.html`. If micro-break toast
> handling or MediaPipe loop has drifted, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [007](007-ergonomic-20-20-20-micro-breaks.md), [012](012-v2-product-roadmap-and-feature-spikes.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-15

## Why this matters

The 20-20-20 rule requires shifting ocular focus to relax ciliary muscles, but static timer popups are often ignored or merely dismissed. An interactive, smooth-pursuit visual focal point guides actual eye movements (horizontal and circular saccades) during the 20 seconds. Concurrently, prolonged screen sitting leads to head-forward slouching (cervical spine compression); calculating vertical face drift from existing BlazeFace bounding boxes provides an ambient, zero-overhead posture reminder without adding new biometric models or storing user images.

## Current state

- Relevant files:
  - `src/main.ts:157-163`: Renders `#micro-break-toast` with simple countdown text.
  - `src/main.ts:350-410`: `detectPresence()` processes `faceDetector.detectForVideo()` results (`detections[0].boundingBox`).
  - `index.html:180-188`: `#micro-break-toast` markup containing icon, title, timer, and dismiss button.
  - `src/style.css:870-920`: Micro-break toast styling.

Excerpts:
`src/main.ts:157-163`:
```typescript
if (snapshot.is_micro_break_active) {
  microBreakToastEl.classList.remove('hidden');
  microTimerEl.textContent = `${snapshot.micro_break_seconds_left}s`;
} else {
  microBreakToastEl.classList.add('hidden');
}
```

`index.html:180-188`:
```html
<div id="micro-break-toast" class="micro-break-toast hidden" role="alert" aria-live="polite">
  <div class="micro-toast-icon">👁️</div>
  <div class="micro-toast-body">
    <strong>20-20-20 Eye Rest</strong>
    <p>Look at an object 20 feet away (<span id="micro-timer">20s</span>)</p>
  </div>
  <button id="btn-dismiss-micro" class="btn-micro-dismiss" title="Dismiss micro-break">✕</button>
</div>
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend build & check | `npm run build` | exit 0, bundle generated in `dist/` |
| Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |

## Scope

**In scope**:
- `index.html`:
  - Enhance `#micro-break-toast` with an interactive eye exercise tracking canvas/container (`#eye-exercise-track` and animated focal point).
  - Add an ambient posture status indicator in the top navbar / status bar (`#posture-pill`).
- `src/style.css`:
  - Animations for smooth-pursuit focal dot and calming respiration pacer.
  - Posture indicator styles (neutral calm emerald vs slumped amber warning).
- `src/main.ts`:
  - Implement posture drift estimation: track moving average of bounding box vertical center `yCenter` and normalized height `h`.
  - When `yCenter` drops below calibrated baseline by >25% for >15 consecutive seconds, set `isSlouching = true` and update `#posture-pill`.
  - Provide a calibration button in Settings ("Calibrate Neutral Posture").
  - Animate the 20-second eye exercise guide when `is_micro_break_active` is true.

**Out of scope**:
- Storing or transmitting video frames or face images.
- Full-body skeletal pose estimation (which requires heavy pose models exceeding CPU budgets).

## Steps

### Step 1: Add Interactive Eye Exercise Canvas to Micro-Break Toast

In `index.html` inside `#micro-break-toast`:
1. Add an animated visual track below the text:
   ```html
   <div class="eye-exercise-container">
     <div id="eye-pursuit-dot" class="eye-pursuit-dot"></div>
   </div>
   ```
2. In `src/style.css`:
   - Style `.eye-exercise-container` as a subtle 180px track with glassmorphism border.
   - Animate `.eye-pursuit-dot` using CSS `keyframes` to glide smoothly left-to-right and in a calming figure-eight rhythm over 5-second cycles.

**Verify**:
`npm run build` → exits 0.

### Step 2: Implement Posture Drift Tracker in `src/main.ts`

In `src/main.ts`:
1. Add state variables:
   ```typescript
   let baselineFaceY: number | null = null;
   let baselineFaceHeight: number | null = null;
   let slouchCounter: number = 0;
   let isSlouching: boolean = false;
   ```
2. In `detectPresence(detections)`:
   - When a face is detected with high confidence (>0.7):
   - Calculate `currentY = detection.boundingBox.originY + detection.boundingBox.height / 2`.
   - If `baselineFaceY === null`, calibrate `baselineFaceY = currentY` and `baselineFaceHeight = detection.boundingBox.height`.
   - If `currentY > baselineFaceY + baselineFaceHeight * 0.25`:
     - Increment `slouchCounter++`. If `slouchCounter > 15` (15 seconds of sustained drop), set `isSlouching = true`.
   - Else:
     - Reset `slouchCounter = 0`; set `isSlouching = false`.
3. Update `#posture-pill` UI:
   - Normal: "Posture: Aligned" (dim emerald).
   - Slouch: "Posture: Check Alignment" (subtle amber nudge).

**Verify**:
`npm run build` → exits 0.

### Step 3: Add Posture Calibration Button to Settings

In `index.html`:
1. Add a setting item in `#settings-modal`:
   ```html
   <div class="setting-item">
     <label>Ergonomic Posture Baseline</label>
     <button id="btn-calibrate-posture" class="btn btn-secondary">Recalibrate Now</button>
   </div>
   ```
2. In `src/main.ts`:
   - Bind `btn-calibrate-posture` to reset `baselineFaceY = null` so the next detected frame sets the new neutral desk posture.

**Verify**:
`npm run build` → exits 0.

## Test plan

- **Frontend tests**:
  - `npm run build` verifies clean TypeScript compilation.
  - Verify micro-break toast animates focal dot smoothly without blocking UI thread.
  - Verify posture calibration sets baseline correctly without error.

## Done criteria

- [x] `npm run build` exits 0.
- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] Micro-break toast contains animated smooth-pursuit ocular guide.
- [x] Posture indicator updates when face position drifts downward.
- [x] `plans/README.md` row updated to DONE.


## STOP conditions

- If posture tracking causes false positives when the user tilts their head briefly to read code, ensure the 15-second debounce window prevents premature triggers.
