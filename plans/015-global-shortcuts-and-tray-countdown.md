# Plan 015: Implement Global Desktop Keyboard Shortcuts and Live Tray Title Countdown

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/lib.rs` and `src-tauri/src/tray.rs`. If
> plugin initialization or tray tick loop has changed, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [002](002-fix-tray-lifecycle-and-window-close.md), [008](008-smart-presentation-and-dnd-awareness.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-15

## Why this matters

FocusGaze runs silently as a background tray application while programmers and knowledge workers operate in full-screen IDEs, terminals, and editors. Bringing the main window into focus just to pause tracking or trigger an early break disrupts deep work. Global operating system shortcuts (`Cmd/Ctrl+Shift+B` to break, `Cmd/Ctrl+Shift+P` to pause, `Cmd/Ctrl+Shift+D` to toggle DND) alongside a glanceable menu-bar countdown badge allow seamless control without window switching.

## Current state

- Relevant files:
  - `src-tauri/Cargo.toml`: Tauri v2 plugins currently loaded (`tauri-plugin-log`, `tauri-plugin-notification`, `tauri-plugin-autostart`).
  - `src-tauri/src/lib.rs:56-99`: 1-second background tick loop updates tray icon and broadcasts snapshot to frontend.
  - `src-tauri/src/tray.rs`: Builds tray icon and handles menu clicks.
  - `index.html`: Settings modal.

Excerpts:
`src-tauri/src/lib.rs:82-87`:
```rust
if let Some(tray) = handle.tray_by_id(TRAY_ID) {
    let icon = get_icon_for_state(current_state);
    let tooltip = get_tooltip_for_state(current_state);
    let _ = tray.set_icon(Some(icon));
    let _ = tray.set_tooltip(Some(tooltip));
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend build & check | `npm run build` | exit 0, bundle generated in `dist/` |

## Scope

**In scope**:
- `src-tauri/Cargo.toml`: Add `tauri-plugin-global-shortcut = "2"`.
- `src-tauri/src/lib.rs`:
  - Register `tauri_plugin_global_shortcut::Builder`.
  - Bind `CommandOrControl+Shift+B` -> `take_break_now()`.
  - Bind `CommandOrControl+Shift+P` -> `toggle_pause()`.
  - Bind `CommandOrControl+Shift+D` -> `toggle_dnd()`.
  - In the 1-second background loop, update tray title on supported platforms (macOS menu bar): `tray.set_title(Some(&format!("{m}m")))`.
- `index.html`: Add a "Global Keyboard Shortcuts" reference card inside `#settings-modal`.

**Out of scope**:
- Custom shortcut remapping editor (default standard bindings provide zero-friction coverage).
- Modifying keyboard input idle detection in `idle.rs`.

## Steps

### Step 1: Add `tauri-plugin-global-shortcut` to Cargo.toml and Register Plugin

In `src-tauri/Cargo.toml`:
1. Add `tauri-plugin-global-shortcut = "2"` under `[dependencies]`.
2. In `src-tauri/src/lib.rs`:
   - Initialize the plugin:
     ```rust
     .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
         // handle shortcut triggers
     }).build())
     ```
   - Register shortcuts on app ready:
     - `CommandOrControl+Shift+B`: Trigger `start_break()`.
     - `CommandOrControl+Shift+P`: Trigger `toggle_pause()`.
     - `CommandOrControl+Shift+D`: Toggle DND mode.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Update Live Tray Title Countdown

In `src-tauri/src/lib.rs`:
In the 1-second tick loop, compute remaining minutes in current focus session:
```rust
let remaining_secs = sm.work_interval_seconds.saturating_sub(sm.current_work_seconds);
let mins_left = remaining_secs / 60;
if let Some(tray) = handle.tray_by_id(TRAY_ID) {
    if sm.state == AppTrackingState::TrackingActive {
        let _ = tray.set_title(Some(format!("{mins_left}m")));
    } else if sm.state == AppTrackingState::BreakMode {
        let break_left = sm.break_interval_seconds.saturating_sub(sm.break_seconds_elapsed) / 60;
        let _ = tray.set_title(Some(format!("Break {break_left}m")));
    } else {
        let _ = tray.set_title(None::<String>);
    }
}
```

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 3: Add Keyboard Shortcuts Reference to Settings Modal

In `index.html` inside `#settings-modal`:
Add a clean shortcut reference card:
```html
<div class="setting-item shortcuts-card">
  <h4>Global Shortcuts</h4>
  <div class="shortcut-list">
    <div class="shortcut-row"><span>Take Break Now</span><kbd>⌘/Ctrl + Shift + B</kbd></div>
    <div class="shortcut-row"><span>Pause / Resume</span><kbd>⌘/Ctrl + Shift + P</kbd></div>
    <div class="shortcut-row"><span>Toggle DND</span><kbd>⌘/Ctrl + Shift + D</kbd></div>
  </div>
</div>
```

**Verify**:
`npm run build` → exits 0.

## Test plan

- **Backend tests**:
  - `cargo check --manifest-path src-tauri/Cargo.toml` passes.
  - `cargo test --manifest-path src-tauri/Cargo.toml` passes all unit tests.
- **Frontend tests**:
  - `npm run build` validates clean HTML/CSS/TS bundle generation.

## Done criteria

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0.
- [x] `npm run build` exits 0.
- [x] Shortcuts reference card visible in Settings modal.
- [x] `plans/README.md` row updated to DONE.


## STOP conditions

- If registering global shortcuts conflicts with existing OS bindings, gracefully log a warning instead of failing app launch.
