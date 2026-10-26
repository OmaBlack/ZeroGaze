# Plan 011: Implement Auto-Start on System Boot (Tray Daemon Launch)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/lib.rs` and `src-tauri/Cargo.toml`. If
> signatures or plugin setup mismatches, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [004](004-settings-modal-and-privacy-management.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

FocusGaze is designed as a persistent background wellbeing companion in the system tray. Requiring users to manually launch the application every time they reboot their computer breaks habit loops and leaves hours of screen time untracked. Providing a clean "Start on boot" toggle in the Settings modal ensures continuous protection against digital eye strain without user friction.

## Current state

- Relevant files:
  - `src-tauri/Cargo.toml` — Rust dependencies; lacks `tauri-plugin-autostart`.
  - `package.json` — JS dependencies; lacks `@tauri-apps/plugin-autostart`.
  - `src-tauri/src/lib.rs:56-65` — Tauri plugin initialization pipeline.
  - `index.html:84-123` — Settings modal containing interval and data management controls.
  - `src/main.ts` — Settings modal event listeners.
- Current excerpt (`src-tauri/src/lib.rs:56-61`):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::new().build())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| NPM install | `npm install @tauri-apps/plugin-autostart@^2.0.0` | exit 0 |
| Cargo check | `cargo check` (in `src-tauri`) | exit 0 |
| Rust tests | `cargo test` (in `src-tauri`) | all pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/Cargo.toml` (add `tauri-plugin-autostart = "2"`)
- `src-tauri/src/lib.rs` (register `tauri_plugin_autostart::init`)
- `package.json` (add `@tauri-apps/plugin-autostart`)
- `index.html` (add "Launch on system startup" checkbox inside `#settings-modal`)
- `src/main.ts` (query `isEnabled()` and bind change listener to `enable()` / `disable()`)

**Out of scope**:
- Custom manual platform launch agent daemon scripting (handled by the official plugin).

## Steps

### Step 1: Install and configure `tauri-plugin-autostart`

1. In `src-tauri/Cargo.toml`, add under `[dependencies]`:
   ```toml
   tauri-plugin-autostart = "2"
   ```
2. In root directory, install JS package:
   ```bash
   npm install @tauri-apps/plugin-autostart@^2.0.0
   ```
3. In `src-tauri/src/lib.rs`, add plugin initialization:
   ```rust
   .plugin(tauri_plugin_autostart::init(
       tauri_plugin_autostart::MacosLauncher::LaunchAgent,
       Some(vec!["--minimized"]),
   ))
   ```

**Verify**: `cargo check` in `src-tauri` exits 0.

### Step 2: Add auto-start toggle to Settings modal

1. In `index.html` inside `#settings-modal` `.settings-grid`:
   ```html
   <div class="settings-group">
     <label for="setting-autostart">System Startup</label>
     <div class="checkbox-row">
       <input type="checkbox" id="setting-autostart" />
       <label for="setting-autostart" class="checkbox-label">Launch FocusGaze on system login</label>
     </div>
   </div>
   ```
2. In `src/style.css`, add styling for `.checkbox-row` and `.checkbox-label` ensuring proper alignment and keyboard focus outlines.

**Verify**: `npm run build` exits 0.

### Step 3: Wire JS autostart plugin API in `src/main.ts`

1. Import plugin functions:
   ```typescript
   import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
   ```
2. In settings initialization:
   ```typescript
   const autostartCheckbox = document.getElementById("setting-autostart") as HTMLInputElement;
   if (autostartCheckbox) {
     try {
       autostartCheckbox.checked = await isEnabled();
     } catch (e) {
       console.warn("Autostart check failed:", e);
     }
     autostartCheckbox.addEventListener("change", async () => {
       try {
         if (autostartCheckbox.checked) {
           await enable();
         } else {
           await disable();
         }
       } catch (e) {
         console.error("Autostart update failed:", e);
       }
     });
   }
   ```

**Verify**: `npm run build` exits 0.

## Test plan

- Verify via `cargo check` and `npm run build`.
- Manual verification: toggling the checkbox calls `enable()` / `disable()` without errors.

## Done criteria

- [ ] `cargo check` and `npm run build` exit 0.
- [ ] Settings modal displays "Launch FocusGaze on system login" checkbox reflecting actual state.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If macOS permission restrictions prevent writing to `~/Library/LaunchAgents` in sandboxed dev environment.
