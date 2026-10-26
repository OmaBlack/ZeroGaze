# Plan 026: Implement Primary User Facial Signature Verification and Automatic OS Screen Lock on Unrecognized User

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> `src-tauri/src/idle.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`,
> `src-tauri/src/db/mod.rs`, `src/ergonomics.ts`, `index.html`, and `src/main.ts`;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [021](021-wire-seeded-settings-and-webaudio-chimes.md), [025](025-first-run-onboarding-and-privacy-explainer.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

Currently, FocusGaze filters out smaller background faces (`selectPrimaryForegroundFace`), but if the primary user walks away and another person sits down in front of the PC (or leans into the foreground), FocusGaze treats them as the active user and keeps the workstation unlocked. By computing a lightweight, 100% local, privacy-preserving geometric facial signature vector from the 6 normalized MediaPipe BlazeFace keypoints (left eye, right eye, nose tip, mouth center, left ear tragion, right ear tragion — invariant to scale, translation, and 2D head tilt, with zero raw images stored) and comparing incoming foreground detections against the enrolled Primary User profile, FocusGaze can:
1. Distinguish the enrolled **Primary User** from an **Unrecognized User** seated at the PC.
2. Pause active focus time accumulation when an unrecognized face is in front of the screen.
3. Optionally trigger a native OS workstation lock (`lock_workstation` on macOS, Windows, and Linux) after a configurable number of consecutive unrecognized ticks (default `6` ticks ≈ 3 seconds at 2 FPS) with a visible countdown warning so the primary user can recalibrate or cancel if needed.

## Current state

Relevant files and excerpts:

1. `src/ergonomics.ts:48-57` — `FaceDetectionCandidate` currently includes `boundingBox` and `categories`:
```ts
export interface FaceDetectionCandidate {
  boundingBox?: BoundingBox;
  categories?: Array<{ score?: number }>;
}
```
MediaPipe `FaceDetector` detections also provide `keypoints: NormalizedKeypoint[]` (`Array<{ x: number; y: number }>` with 6 landmarks: `[0]` right eye, `[1]` left eye, `[2]` nose tip, `[3]` mouth, `[4]` right ear, `[5]` left ear).

2. `src-tauri/src/idle.rs:121-132` — platform-specific OS integration module where native OS lock commands (`lock_os_session`) fit naturally alongside `get_idle_seconds()` and `is_presentation_mode_active()`.

3. `src-tauri/src/db/mod.rs:150-169` — `seed_default_settings` seeds default settings in SQLite.

## Commands you will need

Note: Prepend `export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin";` when running shell commands.

| Purpose | Command | Expected on success |
|---|---|---|
| Rust typecheck | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0 |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend unit tests | `npm test` | exit 0, all tests pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/idle.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/db/mod.rs`
- `src/ergonomics.ts`
- `src/ergonomics.test.mjs`
- `src/main.ts`
- `index.html`

**Out of scope**:
- Saving raw camera frames or images to disk or transmitting anything over the network (only a 6-float geometric ratio vector is stored in local SQLite settings).
- Executing actual OS screen lock during `cargo test` unit tests.

## Steps

### Step 1: Add Native OS Workstation Lock (`lock_os_session`) and Tauri Command (`lock_workstation`)

1. In `src-tauri/src/idle.rs`, add `pub fn lock_os_session() -> Result<(), String>`:
   - On `#[cfg(target_os = "macos")]`:
     Execute `pmset displaysleepnow` via `std::process::Command::new("pmset").arg("displaysleepnow").status()` (which immediately sleeps the display and triggers macOS screen lock if password-on-wake is enabled) and also invoke CGSession / `/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession -suspend` if available; return `Ok(())` if `pmset` succeeds.
   - On `#[cfg(target_os = "windows")]`:
     Call `rundll32.exe user32.dll,LockWorkStation` via `std::process::Command`.
   - On `#[cfg(target_os = "linux")]`:
     Try `loginctl lock-session`, falling back to `xdg-screensaver lock`.
2. In `src-tauri/src/commands.rs`, add:
   ```rust
   #[tauri::command]
   pub fn lock_workstation(state: State<'_, AppSharedState>) -> Result<StateSnapshot, String> {
       if let Ok(db) = state.db.lock() {
           let _ = db.log_event("workstation_locked_unrecognized_user", None);
       }
       let snapshot = if let Ok(mut sm) = state.sm.lock() {
           sm.flush_current_session();
           if !sm.is_paused {
               sm.toggle_pause();
           }
           sm.snapshot()
       } else {
           return Err("Failed to lock state machine".to_string());
       };
       crate::idle::lock_os_session()?;
       Ok(snapshot)
   }
   ```
3. In `src-tauri/src/lib.rs`, register `commands::lock_workstation` in `tauri::generate_handler![...]`.
4. In `src-tauri/src/db/mod.rs`, add `("lock_on_unrecognized_user", "off")` and `("primary_user_signature", "")` to `seed_default_settings`.

**Verify**: `cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Implement Scale- & Tilt-Invariant Facial Keypoint Signature & Verification in `src/ergonomics.ts`

In `src/ergonomics.ts`:
1. Extend `FaceDetectionCandidate` with optional `keypoints?: Array<{ x: number; y: number }>;`.
2. Add `FaceSignature` (`number[]`) and pure functions:
   - `extractFaceSignature(candidate: FaceDetectionCandidate): number[] | null`:
     - Requires `candidate.keypoints && candidate.keypoints.length >= 6` and `candidate.boundingBox`.
     - Computes inter-ocular distance `eyeDist = Math.hypot(kp[1].x - kp[0].x, kp[1].y - kp[0].y)`. If `eyeDist <= 1e-4`, return `null`.
     - Normalizes keypoint pairwise distances by `eyeDist` (scale- & rotation-invariant geometric ratios):
       1. `eyeToNoseRatio`: distance from eye midpoint to nose (`kp[2]`) / `eyeDist`
       2. `eyeToMouthRatio`: distance from eye midpoint to mouth (`kp[3]`) / `eyeDist`
       3. `noseToMouthRatio`: distance from nose (`kp[2]`) to mouth (`kp[3]`) / `eyeDist`
       4. `earSpanRatio`: distance between right ear (`kp[4]`) and left ear (`kp[5]`) / `eyeDist`
       5. `eyeToBoxWidthRatio`: `eyeDist / Math.max(1, box.width)`
       6. `boxAspectRatio`: `box.width / Math.max(1, box.height)`
     - Returns the 6-element number array rounded to 4 decimals.
   - `verifyPrimaryUserIdentity(currentSig: number[] | null, enrolledSig: number[] | null, mismatchCounter: number, tolerance: number = 0.28): { isRecognized: boolean; similarityScore: number; nextMismatchCounter: number; shouldLock: boolean }`:
     - If `!enrolledSig || enrolledSig.length !== 6`: returns `{ isRecognized: true, similarityScore: 1, nextMismatchCounter: 0, shouldLock: false }` (no profile enrolled yet).
     - If `!currentSig || currentSig.length !== 6`: returns `{ isRecognized: false, similarityScore: 0, nextMismatchCounter: mismatchCounter + 1, shouldLock: mismatchCounter + 1 >= 6 }`.
     - Computes mean relative L1 distance across the 6 geometric features:
       `meanDiff = sum(|currentSig[i] - enrolledSig[i]| / Math.max(0.1, |enrolledSig[i]|)) / 6`.
     - `similarityScore = Math.max(0, Math.min(1, 1 - meanDiff))`.
     - `isRecognized = meanDiff <= tolerance`.
     - If `isRecognized`, `nextMismatchCounter = 0`, `shouldLock = false`.
     - If `!isRecognized`, `nextMismatchCounter = mismatchCounter + 1`, `shouldLock = nextMismatchCounter >= 6` (6 consecutive mismatches ≈ 3 seconds).
3. In `src/ergonomics.test.mjs`, add unit tests for `extractFaceSignature` and `verifyPrimaryUserIdentity` verifying:
   - Scale invariance (same person closer/farther produces matching ratios and `isRecognized === true`).
   - Different facial geometry produces `isRecognized === false` and triggers `shouldLock === true` on the 6th consecutive frame.

**Verify**: `npm test` → exits 0.

### Step 3: Add Primary User Enrollment & Auto-Lock Controls in `index.html` and `src/main.ts`

1. In `index.html` inside `#settings-modal` (in the second `.settings-group` next to `#btn-calibrate-posture`), add:
   ```html
   <div class="setting-item">
     <label>Primary User Identity Guard</label>
     <div class="preset-pill-group">
       <button type="button" id="btn-enroll-face" class="btn btn-secondary">Enroll My Face</button>
       <button type="button" id="btn-clear-face" class="btn btn-ghost">Clear ID</button>
     </div>
   </div>
   <div class="setting-item checkbox-item">
     <label for="setting-lock-unrecognized">Unauthorized User Lock</label>
     <div class="checkbox-row">
       <input type="checkbox" id="setting-lock-unrecognized" />
       <label for="setting-lock-unrecognized" class="checkbox-label">Lock PC if an unrecognized face sits at the screen (3s)</label>
     </div>
   </div>
   ```
2. In `src/main.ts`:
   - Import `extractFaceSignature` and `verifyPrimaryUserIdentity` from `./ergonomics`.
   - Maintain `enrolledFaceSignature: number[] | null = null`, `lastObservedSignature: number[] | null = null`, `lockOnUnrecognized = false`, and `identityMismatchCounter = 0`.
   - In `runDetectionLoop()`:
     - When `primary` is detected, compute `const currentSig = extractFaceSignature(primary); if (currentSig) lastObservedSignature = currentSig;`.
     - Run `const idCheck = verifyPrimaryUserIdentity(currentSig, enrolledFaceSignature, identityMismatchCounter);`.
     - `identityMismatchCounter = idCheck.nextMismatchCounter;`.
     - If `!idCheck.isRecognized`:
       - Treat `present` as `false` when calling `update_presence` so an unrecognized person never accumulates the primary user's focus time!
       - Update `cvBadgeEl.textContent = 'Unrecognized User'` and `statCvConfEl.textContent = lockOnUnrecognized ? \`Locking PC in \${Math.max(0, 6 - identityMismatchCounter)} ticks...\` : 'Focus timer paused (Not Primary User)'`.
       - If `lockOnUnrecognized && idCheck.shouldLock`:
         - Reset `identityMismatchCounter = 0;` and invoke `await invoke<StateSnapshot>('lock_workstation')`.
   - Wire `#btn-enroll-face` to save `JSON.stringify(lastObservedSignature)` to `update_setting({ key: 'primary_user_signature', value })` (or alert if no face is currently visible in the camera).
   - Wire `#btn-clear-face` to clear `enrolledFaceSignature = null` and save `primary_user_signature: ''`.
   - Load and save `lock_on_unrecognized_user` and `primary_user_signature` in `openSettings()`, `saveSettings()`, and `init()`.

**Verify**: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

## Test plan

- Frontend unit tests in `src/ergonomics.test.mjs`:
  - `extractFaceSignature` extracts 6 normalized geometric features and is invariant to uniform scaling.
  - `verifyPrimaryUserIdentity` recognizes matching signatures and triggers `shouldLock = true` after 6 consecutive mismatches.
- Backend unit tests in `src-tauri/src/db/mod.rs`:
  - Verifies `lock_on_unrecognized_user` and `primary_user_signature` default settings.
- Verification command: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `npm test` exits 0; new unit tests for `extractFaceSignature` and `verifyPrimaryUserIdentity` pass
- [x] `npm run build` exits 0
- [x] `#btn-enroll-face`, `#btn-clear-face`, and `#setting-lock-unrecognized` exist in `index.html` and are wired in `src/main.ts`
- [x] `plans/README.md` status row for Plan 026 updated to `DONE`

## STOP conditions

- Any test calls `lock_os_session()` directly during `cargo test` (which would lock the developer's screen during test runs) — never call `lock_os_session()` inside `#[cfg(test)]`.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Only the 6-float geometric ratio array (`primary_user_signature`, e.g. `[0.58, 1.12, 0.54, 1.85, 0.42, 0.93]`) is stored in SQLite `settings`. No image or biometric template capable of reconstructing a face is ever stored.
