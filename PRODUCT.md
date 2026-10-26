# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are programmers, knowledge workers, and desk professionals who spend 8+ hours a day in front of screens and suffer from digital eye strain, physical stiffness, and focus fatigue. They value deep focus but need gentle, non-disruptive cadences to rest their eyes and stretch. They actively reject intrusive corporate monitoring tools, cloud telemetry, and surveillance software that log keystrokes or record screen captures.

## Product Purpose

ZeroGaze exists to promote long-term digital wellbeing and prevent burnout by accurately tracking active work time and guiding healthy screen-break habits using 100% on-device Computer Vision. Success means the user sustains healthy 50/10 focus-and-rest rhythms, reduces eye fatigue through regular 20-20-20 visual rest, and feels complete confidence that their webcam data never leaves their local device.

## Positioning

Unlike intrusive productivity trackers (which record screens, track URLs, or send data to corporate cloud servers) or naive timer apps (which count down blindly even when the user stepped away for coffee), ZeroGaze uses lightweight local computer vision to verify physical presence without storing or transmitting a single image frame. It only accumulates active work time when the user is genuinely in front of the screen.

## Operating Context

Runs silently as a persistent system tray utility in macOS (menu bar) and Windows/Linux (tray). Polling operates in the background at 2 FPS using local MediaPipe BlazeFace WebAssembly inference with automatic fallback to native OS mouse/keyboard idle tracking. The main interface operates within a compact, dark-mode desktop window (960x680) designed for fast glanceability, clear status reassurance, and non-distracting ambient feedback.

## Capabilities and Constraints

- **On-Device Computer Vision**: Real-time presence and focus detection running locally in-memory at 2 FPS; raw frames are processed on the local GPU/CPU and immediately discarded.
- **Privacy Guarantee**: Zero cloud servers, zero external telemetry or analytics transmission, no account requirement, and zero image/video persistence.
- **Grace Period**: Configurable grace window (default 60s) before pausing active work counters when the user glances away or temporarily stands up.
- **Break Modes**: Automated break prompts at configurable intervals (default 50m work, 10m break), supporting Snooze (5m, capped at 2) and Skip (capped at 2).
- **Local Persistence**: SQLite database stored in application data directory for local daily compliance statistics and user settings.
- **Platform Constraints**: Tauri v2 desktop application bundle targeting macOS, Windows, and Linux.

## Brand Commitments

- **Name**: ZeroGaze
- **Voice**: Calm, reassuring, unobtrusive, scientifically grounded (referencing the 20-20-20 rule for eye strain and ergonomic micro-breaks).
- **Tone**: Respectful of deep work; never scolding or aggressive.
- **Visual Stance**: Deep nocturnal dark mode (`#0a0d14`), clean high-contrast legibility, calm emerald and cyan status accents, and zero gimmicky or simulated surveillance aesthetics.

## Evidence on Hand

- Complete Product Requirements Document: [prd.md](file:///Users/blackair/FocusGaze/prd.md) (v1.1).
- Local MediaPipe BlazeFace TFLite model and WASM binaries in `public/models/` and `public/wasm/`.
- Local SQLite database layer in `src-tauri/src/db/mod.rs`.

## Product Principles

1. **Privacy is Absolute, Not a Setting**: Vision processing happens 100% in local memory; no frame ever touches persistent storage or a network socket.
2. **Presence-Aware, Not Punitive**: Rest intervals honor actual presence rather than mechanical wall-clock timers; breaks are earned through real screen engagement.
3. **Calm and Non-Intrusive**: Ambient status communication through system tray color states and high-contrast glanceable badges that stay out of the way of flow.
4. **Transparency & User Agency**: The user always maintains full control to pause tracking, customize intervals, take breaks early, or erase all local data in one click.

## Accessibility & Inclusion

- Compliance with WCAG AA contrast standards (minimum 4.5:1 for body and data labels).
- Full keyboard navigation for modal controls and break action shortcuts.
- Clear semantic state descriptions rather than relying on color indicators alone.
- Support for system reduced-motion and high-contrast display modes.
