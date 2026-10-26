# Plan 025: Implement First-Run Onboarding, Camera/Distance Calibration & Privacy Explainer Modal

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> `src-tauri/src/db/mod.rs`, `src-tauri/src/tray.rs`, `index.html`,
> `src/main.ts`, and `src/style.css`; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [021](021-wire-seeded-settings-and-webaudio-chimes.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

PRD §4.8 ("Onboarding", `prd.md:265-279`) and §7 ("Privacy Dashboard", `prd.md:370`) specify a guided onboarding and privacy explainer experience:
1. Welcome & 100% on-device privacy assurance (explaining why the webcam indicator light is on and that zero frames are stored or transmitted).
2. Live detection & `~60 cm` posture/distance calibration check (or one-click option to use `"Input only"` mode without a webcam).
3. Focus rhythm preset selection (`50/10 Standard`, `25/5 Pomodoro`, `90/20 Ultradian`).
4. Furthermore, the system tray menu in `src-tauri/src/tray.rs:76` has a `"Privacy Explainer"` item that emits `navigate("privacy")`, which `src/main.ts:1120` currently routes to `openSettings()` instead of a dedicated Privacy & Onboarding modal.

Adding the `#onboarding-modal` in `index.html`, seeding `("onboarding_completed", "false")` in `db/mod.rs`, and opening it automatically on first launch (or whenever the user clicks `"Privacy Explainer"` in the system tray) completes the PRD §4.8 onboarding flow.

## Current state

Relevant files and excerpts:

1. `src-tauri/src/tray.rs:149-158` — `"privacy"` tray menu item emits `navigate("privacy")`:
```rust
            "privacy" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "privacy");
                }
            }
```

2. `src/main.ts:1120-1124` — `navigate` listener currently routes both `"settings"` and `"privacy"` to `openSettings()`:
```ts
  // Listen to tray menu navigation events ("settings", "privacy")
  listen<string>('navigate', (event) => {
    if (event.payload === 'settings' || event.payload === 'privacy') {
      openSettings();
    }
  });
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
- `src-tauri/src/db/mod.rs`
- `index.html`
- `src/main.ts`
- `src/style.css`

**Out of scope**:
- Modifying `src-tauri/src/state_machine.rs`.

## Steps

### Step 1: Seed `onboarding_completed` in `Database::seed_default_settings`

In `src-tauri/src/db/mod.rs`:
1. In `seed_default_settings(&self)` (`lines 150-168`), add `("onboarding_completed", "false")` to the `defaults` array.
2. In `test_db_init_and_defaults` (`lines 544-551`), assert `db.get_setting("onboarding_completed").unwrap() == Some("false".to_string())`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add `#onboarding-modal` Markup to `index.html` and Styles to `src/style.css`

1. In `index.html` (right after `#settings-modal`), add `#onboarding-modal`:
```html
        <!-- First-Run Onboarding & Privacy Explainer Modal -->
        <div id="onboarding-modal" class="modal-backdrop hidden" role="dialog" aria-labelledby="onboarding-title">
          <div class="settings-card onboarding-card">
            <div class="modal-header">
              <h3 id="onboarding-title">Welcome to FocusGaze • Privacy &amp; Setup</h3>
              <button id="btn-close-onboarding" class="btn-icon" title="Close">✕</button>
            </div>
            <div class="settings-body">
              <div class="onboarding-privacy-banner">
                <strong>🛡️ 100% On-Device Privacy Guarantee</strong>
                <p class="text-sm text-dim">
                  FocusGaze processes presence locally in RAM at 2 FPS using MediaPipe BlazeFace. Raw video frames are immediately discarded, never written to disk, and never transmitted over any network.
                </p>
              </div>
              <div class="settings-group">
                <div class="setting-item">
                  <label>1. Live Presence &amp; ~60 cm Distance Check</label>
                  <span id="onboarding-cv-status" class="cv-badge">Checking camera...</span>
                </div>
                <div class="setting-item">
                  <label>Prefer not to use a webcam?</label>
                  <button type="button" id="btn-onboarding-input-only" class="btn btn-secondary">Use Mouse &amp; Keyboard Only</button>
                </div>
              </div>
              <div class="settings-group">
                <div class="setting-item rhythm-presets-wrap">
                  <label>2. Choose Your Focus Rhythm</label>
                  <div class="preset-pill-group">
                    <button type="button" class="btn-onboarding-preset btn-preset active" data-work="50" data-break="10">50/10 Standard</button>
                    <button type="button" class="btn-onboarding-preset btn-preset" data-work="25" data-break="5">25/5 Pomodoro</button>
                    <button type="button" class="btn-onboarding-preset btn-preset" data-work="90" data-break="20">90/20 Ultradian</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button id="btn-complete-onboarding" class="btn btn-primary">Calibrate &amp; Start FocusGaze</button>
            </div>
          </div>
        </div>
```
2. Also add a `"View Privacy & Setup Guide"` button (`id="btn-open-privacy-guide"`) inside `.app-header` or `#settings-modal` so users can reopen it from the UI as well as from the system tray.
3. In `src/style.css`, style `.onboarding-card` and `.onboarding-privacy-banner`.

### Step 3: Wire Onboarding & Privacy Explainer Flow in `src/main.ts`

In `src/main.ts`:
1. Bind `#onboarding-modal`, `#btn-close-onboarding`, `#btn-complete-onboarding`, `#btn-onboarding-input-only`, `#onboarding-cv-status`, and `.btn-onboarding-preset`.
2. Add `openOnboardingModal()` and `completeOnboarding(useInputOnly: boolean = false)`:
   - When `useInputOnly` is `true`, set `settingTrackingMode.value = 'Input only'`, invoke `update_setting` for `tracking_mode = 'Input only'`, and call `stopWebcamTracks()`.
   - Reset `baselineFaceY = null; baselineFaceHeight = null; slouchCounter = 0; tooCloseCounter = 0;` so posture and `~60 cm` distance calibrate on the current frame.
   - Invoke `update_setting` with `key: 'onboarding_completed', value: 'true'` and hide `#onboarding-modal`.
3. In `renderState(snapshot)`, update `#onboarding-cv-status` text (`snapshot.tracking_mode === 'Input only' ? 'Input Mode Active (Camera Off)' : snapshot.is_cv_present ? 'We can see you! (~60 cm baseline ready)' : 'Waiting for face detection...'`).
4. In `listen<string>('navigate', ...)`:
   - Route `event.payload === 'privacy'` to `openOnboardingModal()`, and `event.payload === 'settings'` to `openSettings()`.
5. In `init()`:
   - If `settings.onboarding_completed === 'false'`, call `openOnboardingModal()`.

**Verify**: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

## Test plan

- Backend: `test_db_init_and_defaults` in `src-tauri/src/db/mod.rs` verifies `onboarding_completed` defaults to `"false"` and resets to `"false"` after `delete_all_user_data()`.
- Frontend: `npm test && npm run build`.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml && npm test && npm run build` → all pass.

## Done criteria

- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0
- [x] `npm test` exits 0
- [x] `npm run build` exits 0
- [x] `#onboarding-modal` exists in `index.html` and opens on `navigate("privacy")` or when `onboarding_completed === "false"`
- [x] `plans/README.md` status row for Plan 025 updated to `DONE`

## STOP conditions

- Any existing test fails after adding `onboarding_completed` to `seed_default_settings`.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- Because `Database::delete_all_user_data()` deletes all rows from `settings` and re-runs `seed_default_settings()`, deleting all local data automatically resets `onboarding_completed` to `"false"`, re-presenting the onboarding guide on next launch.
