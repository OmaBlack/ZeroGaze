# Plan 002: Fix System Tray Lifecycle Handlers and Prevent Window Close Termination

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check if git is initialized (`git status`). If git is tracked, run:
> `git diff --stat HEAD -- src-tauri/src/tray.rs src-tauri/src/lib.rs`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-fix-break-flow-and-stats.md
- **Category**: bug
- **Planned at**: commit `uncommitted`, 2026-10-14
- **Issue**: none

## Why this matters

FocusGaze is designed as a persistent system tray utility that runs silently in the background. Currently, clicking "Pause Tracking" or "Take Break Now" in the tray context menu does nothing because their menu item IDs (`"toggle"` and `"break_now"`) are completely missing from the menu event handler. Furthermore, closing the main window terminates the process because Tauri's default close behavior is not intercepted. Fixing this ensures the app stays running in the tray upon window close and that all tray actions function as expected.

## Current state

Relevant files:
- `src-tauri/src/tray.rs` — Tray menu construction and menu event dispatcher.
- `src-tauri/src/lib.rs` — Main Tauri setup, app state management, and tick loop.

Current code excerpts:

1. `src-tauri/src/tray.rs:73-74, 100-125`:
```rust
    let toggle_item = MenuItemBuilder::with_id("toggle", "Pause Tracking").build(app)?;
    let break_now_item = MenuItemBuilder::with_id("break_now", "Take Break Now").build(app)?;
...
        .on_menu_event(|app, event| match event.id().as_ref() {
            "dashboard" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "settings");
                }
            }
            "privacy" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.emit("navigate", "privacy");
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
```
Notice `"toggle"` and `"break_now"` are absent from the `match` branches.

2. `src-tauri/src/lib.rs:23-26`:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
```
Notice no `.on_window_event()` is configured to intercept `tauri::WindowEvent::CloseRequested`.

Repo conventions:
- Use `app.state::<AppSharedState>()` to access managed shared state.
- Broadcast updates to the frontend using `app.emit("state_change", &snapshot)`.
- Use `app.get_webview_window("main")` to interact with the main window.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Rust check | `cargo check` (in `src-tauri`) | exit 0, no errors |
| Rust test | `cargo test` (in `src-tauri`) | exit 0, all tests pass |

## Scope

**In scope**:
- `src-tauri/src/tray.rs`
- `src-tauri/src/lib.rs`

**Out of scope**:
- Tray icon pixel generation logic in `create_colored_icon`.
- State machine transition logic in `state_machine.rs`.

## Steps

### Step 1: Handle `"toggle"` and `"break_now"` in tray `.on_menu_event`

In `src-tauri/src/tray.rs`:
Add imports if needed: `use crate::AppSharedState;`.
In `.on_menu_event`:
```rust
            "toggle" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.toggle_pause();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);

                // Update tray tooltip & icon immediately
                if let Some(tray) = app.tray_by_id(TRAY_ID) {
                    let icon = get_icon_for_state(snapshot.state);
                    let tooltip = get_tooltip_for_state(snapshot.state);
                    let _ = tray.set_icon(Some(icon));
                    let _ = tray.set_tooltip(Some(tooltip));
                }
            }
            "break_now" => {
                let state = app.state::<AppSharedState>();
                let snapshot = if let Ok(mut sm) = state.sm.lock() {
                    sm.start_break();
                    sm.snapshot()
                } else {
                    return;
                };
                let _ = app.emit("state_change", &snapshot);

                // Focus main window so user sees the break countdown
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
```

**Verify**: `cargo check` in `src-tauri` → exit 0.

---

### Step 2: Intercept window close event to hide to tray

In `src-tauri/src/lib.rs`:
Chain `.on_window_event()` on the builder:
```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
```

**Verify**: `cargo check` in `src-tauri` → exit 0.

---

### Step 3: Run full Rust test suite

Run `cargo test` in `src-tauri` to ensure no regressions in existing state machine or database tests.

**Verify**: `cargo test` in `src-tauri` → exit 0, all tests pass.

## Test plan

- Test manually or via integration test:
  1. Trigger `"toggle"` menu event; verify state changes to paused and broadcasts `state_change`.
  2. Trigger `"break_now"` menu event; verify state transitions to `BreakMode` and main window is unhidden.
  3. Emit `WindowEvent::CloseRequested` on main window; verify `prevent_close()` is called and window remains hidden rather than closing the application process.

## Done criteria

- [ ] `cargo check` in `src-tauri` exits 0.
- [ ] `cargo test` in `src-tauri` exits 0.
- [ ] Tray menu `"toggle"` toggles pause in StateMachine and emits `state_change`.
- [ ] Tray menu `"break_now"` transitions to `BreakMode` and brings window to focus.
- [ ] Closing main window hides the window without stopping tracking or exiting the application.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `app.state::<AppSharedState>()` panics because state is managed after tray setup, move tray initialization in `lib.rs` to right after `app.manage(AppSharedState { ... })`.
- If `tauri::WindowEvent::CloseRequested` is not found, check Tauri v2 WindowEvent documentation.
