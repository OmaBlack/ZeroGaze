# ZeroGaze — Feature Matrix & Technical Architecture

ZeroGaze is an on-device, privacy-first screen-break and active work companion built with **Tauri v2**, **MediaPipe Computer Vision**, and **Rust**. It eliminates the false positives of mechanical timers by validating genuine physical presence without saving or transmitting a single image or video frame.

---

## 1. Core Vision & Presence Engine (100% On-Device)

- **Local MediaPipe BlazeFace Inference**: Runs completely in memory via WebAssembly and local TFLite models (`/models/blaze_face_short_range.tflite`). No frames touch persistent storage or network sockets.
- **Presence vs. Idle Discrimination**:
  - **Present**: Face detected within calibrated boundaries.
  - **Active Work Time**: Accumulated only when physically present.
  - **Grace Period (Configurable 10–300s, default 60s)**: Prevents accidental timer pauses when glancing at paper, standing up briefly, or looking aside.
  - **Heartbeat Watchdog**: Automatically falls back to input tracking if camera frames stall for >5 seconds.
- **Hardware Power & Battery Awareness**:
  - Dynamically throttles inference from **2 FPS (500ms)** on AC power down to **0.5 FPS (2000ms)** on battery, and **0.4 FPS (2500ms)** under critical battery levels (<20%).
  - Ambient battery status badge with real-time hardware status indicators.
- **Hardware Device Management**:
  - Multi-camera enumeration, live webcam switching, and hot-plug event detection (`devicechange`).

---

## 2. Digital Ergonomics & Health

- **Ergonomic 20-20-20 Eye-Rest Cadence**:
  - Alerts users every 20 minutes of active screen time to rest eyes on a distant object for 20 seconds.
  - **Interactive Visual Ocular Pursuit Guide**: Integrated smooth-pursuit animated focal dot that exercises ciliary muscles and relieves digital eye fatigue.
- **Ambient Posture & Slouch Drift Detection**:
  - Continuously monitors bounding box vertical position against a calibrated neutral baseline.
  - Triggers a subtle warning pill in the navigation bar (`Aligned` vs `Check Posture`) when a sustained head-forward drop (>25% for >3 seconds) is detected.
  - One-click neutral posture recalibration in preferences.
- **Modular Eye-Strain Estimation Architecture**:
  - Extensible spike harness evaluating blink frequency and ocular fatigue via duty-cycled face landmark blendshapes while preserving the `< 5% CPU` budget.

---

## 3. Work Cadence & Flow Respect

- **Configurable Interval Rhythms**:
  - Customizable work and break intervals (5–180 minutes focus, 1–60 minutes break).
  - **1-Click Cadence Presets**:
    - **50/10 Standard**: ZeroGaze balanced rhythm.
    - **25/5 Pomodoro**: Classic sprint interval.
    - **90/20 Ultradian**: Deep architectural flow.
- **"Wrap Up My Thought" Buffer (2-Minute Soft Grace)**:
  - When a focus session ends, users can trigger a 120-second soft wrap-up buffer to finish a sentence, test, or commit without counting toward skip or snooze penalties.
- **Break Discipline & Compliance Rules**:
  - Configurable snooze limits (0–10, default 2 per break, 5 minutes each).
  - Configurable daily skip limits with accountability warnings.
  - Full-screen / centered Break Mode overlay with breathing pacing reminders and countdown timer.
  - Automatic escalation to Break Mode if initial break prompt is ignored for 2 minutes.

---

## 4. Smart Environment & Meeting Awareness

- **Automated Presentation & Meeting Mode**:
  - Automatically queries native OS notification and display states:
    - **Windows**: `SHQueryUserNotificationState` detects `QUNS_PRESENTATION_MODE`, `QUNS_RUNNING_D3D_FULL_SCREEN`, and `QUNS_QUIET_TIME`.
    - **Webview & Displays**: Fullscreen presentation listener.
  - Automatically defers break prompts during video calls, screen shares, or presentations to avoid meeting disruption.
- **Cross-Platform Native Input Idle Fallback**:
  - Seamless fallback to keyboard/mouse idle monitoring when webcam access is denied, disabled, or in privacy-only mode:
    - **macOS**: Native CoreGraphics event query (`CGEventSourceSecondsSinceLastEventType`).
    - **Windows**: Win32 `GetLastInputInfo`.
    - **Linux**: X11 `xprintidle` and D-Bus `org.freedesktop.ScreenSaver` protocol.

---

## 5. System Tray & Desktop Integration

- **Persistent Daemon Lifecycle**:
  - Runs quietly in the macOS menu bar or Windows/Linux system tray.
  - Intercepts window close events (`CloseRequested`) to minimize to tray instead of quitting.
- **Live Menu Bar Countdown Badge**:
  - Dynamically updates tray title on macOS with remaining focus minutes (`"34m"`) or active break countdown (`"Break 8m"`).
  - Tray icon state indicators:
    - 🟢 Green: Active tracking
    - 🟡 Yellow: Grace period / paused away
    - 🔴 Red: Break overdue / prompt active
    - 🔵 Blue: Break mode in progress
    - ⚪ Grey: Input fallback / camera disabled
- **System Autostart**:
  - Optional launch on system startup via native launch agents (`tauri-plugin-autostart`).
- **Global Desktop Keyboard Shortcuts**:
  - `Cmd/Ctrl + Shift + B`: Take Break Now / End Break
  - `Cmd/Ctrl + Shift + P`: Pause / Resume Tracking
  - `Cmd/Ctrl + Shift + D`: Toggle Meeting / DND Deferral Mode

---

## 6. Privacy, Analytics & Local Data Control

- **Absolute Zero-Telemetry Guarantee**:
  - Zero external network requests, zero telemetry servers, and strict Content Security Policy (`default-src 'self'`).
  - Google Fonts replaced with bundled, self-hosted web fonts for 100% offline air-gapped operation.
- **Local SQLite Data Persistence**:
  - Embedded SQLite database storing daily compliance metrics, active seconds, breaks completed, skips, and event logs.
- **7-Day Trend Visualizations**:
  - Embedded SVG compliance and focus hours chart directly in dashboard.
- **Data Portability & Export**:
  - **JSON Export**: Complete raw session logs and configuration.
  - **CSV Export**: Daily rollups suitable for spreadsheet analysis.
  - **Weekly Ergonomic Health Card**: Generates a self-contained, printable HTML/SVG wellness report with daily averages, compliance ratios, and 20-20-20 tips.
- **Data Erasure**:
  - One-click "Delete All Local Data" with confirmation dialog to purge the local database completely.
