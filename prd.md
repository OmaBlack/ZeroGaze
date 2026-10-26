# Product Requirements Document (PRD)
**Product Name:** ZeroGaze  
**Document Version:** 1.1  
**Status:** Draft  
**Last Updated:** 2026-10-13  
**Owner:** Product / Engineering  

---

## 0. Revision History

| Version | Date | Author | Changes |
|--------|------|--------|---------|
| 1.0 | 2026-10-13 | — | Initial draft |
| 1.1 | 2026-10-13 | — | Added scope prioritization, state machine, platform matrix, data schema, legal/privacy, security, testing, release plan, accessibility, metrics measurement, edge cases, and acceptance criteria. |

---

## 1. Product Vision & Objective

**Vision:** To promote digital wellbeing and prevent burnout by accurately tracking active screen time and encouraging healthy screen-break habits using privacy-first, on-device Computer Vision.

**Objective:** Build a lightweight, persistent desktop application that runs in the system tray. It uses the device’s webcam to determine if the user is physically present in front of the screen, logs accurate “active” usage time, and prompts the user to take breaks based on customizable intervals.

**Primary V1 goal:** Ship a privacy-first, local-only desktop app that reliably distinguishes **present vs. away**, tracks **active work time**, and enforces **configurable break prompts** without sending camera data off-device.

---

## 2. Target Audience

- **Knowledge Workers & Programmers:** Individuals who spend 8+ hours a day at a desk and suffer from eye strain or posture issues.
- **Students:** Those needing focus management (e.g., Pomodoro technique) during long study sessions.
- **Privacy-Conscious Users:** People who want screen-tracking but refuse to use software that sends keystroke/mouse data or screen captures to the cloud.

---

## 3. Scope & Prioritization (MoSCoW)

### 3.1 V1 Must Have

- System tray integration and background lifecycle.
- Local CV presence detection with configurable grace period.
- Fallback to mouse/keyboard idle tracking.
- Local SQLite storage for settings and time logs.
- Dashboard with daily/weekly stats.
- Break prompting with configurable work/break intervals.
- Break overlay / break mode.
- Snooze and skip logging.
- Auto-start option.
- Privacy-first processing: no image/video storage or transmission.
- Camera permission onboarding and fallback handling.
- Accessibility basics: keyboard navigation, high contrast, screen reader labels.
- Error handling for camera denied, busy, disconnected, or failed.
- Platform support for Windows, macOS, and Linux.

### 3.2 V1 Should Have

- CSV/JSON export and import.
- DND / Focus Assist integration.
- Battery-aware CV polling reduction.
- Opt-in anonymous telemetry for success metrics.
- Privacy dashboard explaining camera usage.
- Multi-face event logging.
- Low-light / low-confidence fallback.

### 3.3 V1 Could Have

- Cloud sync.
- Slack/Teams status integration.
- Posture detection.
- Blink-rate / eye-strain tracking.
- Advanced gaze estimation.

### 3.4 V1 Will Not Have

- Cloud backend.
- Keystroke content logging.
- Screen capture or screenshot analysis.
- Biometric identification of specific users.
- Remote monitoring or admin dashboards.

---

## 4. Key Features & Functional Requirements

### 4.1 System Tray Integration & Lifecycle

- **Persistent Background Process:** Runs silently in the system tray (Windows), menu bar (macOS), or system tray (Linux).
- **Auto-Start:** Optional launch on system boot/login.
  - Windows: Registry / Task Scheduler.
  - macOS: Login Items / Launch Agents.
  - Linux: XDG autostart / systemd user service.
- **Tray Icon States:**
  - **Green:** Tracking active.
  - **Yellow:** Paused / Away / Grace period.
  - **Red:** Break overdue.
  - **Blue:** Break mode active.
  - **Grey:** Error / fallback mode / camera unavailable.
- **Context Menu:**
  - Dashboard
  - Settings
  - Pause/Resume Tracking
  - Take Break Now
  - Privacy Dashboard
  - Quit
- **Tooltips:** Explain current state, e.g., “Camera is on because ZeroGaze is checking presence. No images are stored.”
- **Acceptance Criteria:**
  - Tray icon updates within 2 seconds of state change.
  - Context menu accessible via keyboard.
  - Auto-start can be toggled on/off and persists across reboots.
  - Quit stops camera access and background timers.

---

### 4.2 Computer Vision (CV) Presence Detection

- **Face/Eye Detection:** Uses a lightweight local CV model to detect if a human face/eyes are present in the camera frame.
- **Recommended Model:** MediaPipe Face Detection or Face Mesh. OpenCV Haar Cascade as fallback.
- **Frame Rate:** 2–5 FPS default, configurable.
- **Absence Threshold (Grace Period):** If the user looks away or leaves, the timer does not pause immediately. It waits for a configurable threshold (default 60 seconds) before pausing “Active Time.”
- **Privacy-First Processing:**
  - All video processing occurs 100% locally.
  - No images or video frames are saved, cached, or transmitted.
  - Only boolean/derived state data (Present/Not Present, confidence score) is processed.
  - Camera indicator light will be on; provide tooltip and privacy dashboard explanation.
- **Fallback Mechanism:** If no webcam is present or permissions are denied, fallback to traditional mouse/keyboard activity tracking.
- **Low-Light / Low-Confidence Fallback:** If CV confidence drops below threshold for a sustained period (e.g., 60 seconds), automatically switch to input tracking and notify the user.
- **Multiple Faces:** If any face is detected, assume primary user is present for V1. Log a “multi-face event” for analytics. Do not attempt to identify users.
- **Definitions:**
  - **Present:** Face detected within grace period.
  - **Active:** Present AND (keyboard/mouse activity OR CV focus confidence above threshold).
  - **Focused:** Active AND no break overdue AND not in break mode.
  - **Idle:** No presence/input beyond grace period.
  - **Away:** No presence/input beyond grace period.
- **Acceptance Criteria:**
  - Presence detection latency < 3 seconds at 2 FPS.
  - False “present” rate low enough that active time is within 10% of self-reported work time in beta.
  - Fallback triggers within 5 seconds of camera denial/disconnect.
  - No image data written to disk or network.
  - Works across skin tones, glasses, masks, and common lighting conditions in test dataset.

---

### 4.3 Activity Fallback Tracking

- **OS APIs:**
  - Windows: `GetLastInputInfo`
  - macOS: IOKit HID idle time
  - Linux: X11 `XScreenSaver` / Wayland idle protocol where available
- **Permissions:** Some platforms may require accessibility/input monitoring permission. Request only if fallback is needed.
- **Fallback Triggers:**
  - Camera denied.
  - Camera busy.
  - Camera disconnected.
  - CV model failure.
  - User selects “Input tracking only.”
  - Low-light/low-confidence sustained.
  - Battery saver mode.
- **Acceptance Criteria:**
  - Fallback mode continues tracking active/idle time.
  - User is clearly notified which mode is active.
  - No keystroke content is logged; only idle time.

---

### 4.4 Time Logging & Analytics

- **Active vs. Idle Time:** Differentiates between “PC On Time,” “User Present Time,” and “Active Time.”
- **Local Database:** SQLite stores daily logs including:
  - Total active time per day.
  - Number of breaks taken vs. skipped.
  - Timestamps of focus sessions.
  - Snooze counts.
  - Multi-face events.
  - Fallback mode periods.
- **Dashboard UI:** Simple, clean modal window opened from tray showing:
  - Daily/weekly stats.
  - Streaks.
  - Average break compliance.
  - Export button.
  - Data deletion button.
- **Metric Definitions:**
  - **PC On Time:** Time OS is awake and user session is unlocked.
  - **Present Time:** Time face/input presence detected.
  - **Active Time:** Present AND input/gaze confidence above threshold.
  - **Break Compliance:** Breaks taken / breaks prompted.
- **Acceptance Criteria:**
  - Dashboard loads in < 1 second for 365 days of data.
  - Charts render correctly with empty data.
  - Export produces valid CSV/JSON.
  - Delete-all-data removes records and requires confirmation.

---

### 4.5 Break Prompting & Compliance

- **Customizable Intervals:** Users can set work/break ratios (e.g., 50/10, 25/5 Pomodoro).
- **Break Alert:** System notification + subtle sound when work interval ends.
- **Full-Screen/Overlay Break Mode:** If user ignores initial alert, after 2 minutes transition to Break Mode:
  - Calming full-screen or large centered overlay.
  - Countdown timer.
  - Breathing exercise or stretch suggestion.
  - Snooze / Skip / Dismiss controls.
- **Snooze/Skip:**
  - Allow skip, but log as “Skipped Break.”
  - Snooze limit: default 2 snoozes per break, max 5 minutes each.
  - Skip limit: default 2 skips per day before extra accountability prompt.
- **DND / Meeting Detection:**
  - Respect OS Focus Assist / Do Not Disturb.
  - Detect full-screen presentations, video calls, and games; suppress break overlay, log as “Deferred.”
- **Break Compliance Logic:**
  - Break taken if user is away or in break mode for ≥ 50% of break duration.
  - Break skipped if user dismisses or remains active beyond break duration.
  - Break deferred if DND/meeting suppresses prompt.
- **Acceptance Criteria:**
  - Notification appears within 1 second of interval end.
  - Break overlay is keyboard accessible.
  - Snooze/skip actions are logged correctly.
  - DND suppression works on supported platforms.

---

### 4.6 Settings & Preferences

| Setting | Default | Range / Options | Persistence |
|--------|---------|-----------------|-------------|
| Work interval | 50 min | 5–120 min | SQLite |
| Break interval | 10 min | 1–30 min | SQLite |
| Grace period | 60 sec | 10–300 sec | SQLite |
| CV FPS | 2 | 1–5 | SQLite |
| Camera selection | Default | Device list | SQLite |
| Tracking mode | Auto | Auto / Webcam only / Input only | SQLite |
| Auto-start | Off | On/Off | OS + SQLite |
| Break overlay | Full-screen | Full-screen / Centered | SQLite |
| Sound | On | On/Off | SQLite |
| Snooze limit | 2 | 0–5 | SQLite |
| Skip limit | 2 | 0–10 | SQLite |
| Battery mode | On | On/Off | SQLite |
| Data retention | 365 days | 30/90/365/Indefinite | SQLite |
| Telemetry | Off | On/Off | SQLite |
| Reduced motion | Off | On/Off | SQLite |
| High contrast | Off | On/Off | SQLite |

- **Acceptance Criteria:**
  - All settings validate input and show errors.
  - Settings persist across restarts.
  - Reset to defaults available.

---

### 4.7 Data Management & Export

- **Export:** CSV and JSON for sessions, breaks, daily stats.
- **Import:** Restore from ZeroGaze JSON backup.
- **Delete All Data:** Removes SQLite DB, settings, logs; requires typed confirmation.
- **Retention:** Auto-delete logs older than configured retention.
- **Backup:** Manual export; optional auto-backup to user-selected local folder.
- **Acceptance Criteria:**
  - Export/import round-trips without data loss.
  - Delete-all-data leaves no user data in app directories.
  - Retention policy runs daily.

---

### 4.8 Onboarding

1. Welcome and privacy explainer.
2. Camera permission request with preview.
3. Detection test: “We can see you” / “We cannot see you.”
4. Option to skip camera and use input tracking.
5. Set work/break intervals (presets: Pomodoro 25/5, 50/10, Custom).
6. Choose “Start on Boot.”
7. Minimize to tray.

- **Acceptance Criteria:**
  - Onboarding can be completed in < 2 minutes.
  - Skipping camera does not block app usage.
  - Privacy explainer is readable by screen readers.

---

### 4.9 Dashboard UI

- **Views:** Today, Week, Month.
- **Metrics:** Active time, present time, breaks taken/skipped/deferred, streak, compliance %.
- **Charts:** Simple bar charts, no clutter.
- **Empty States:** Helpful messages when no data.
- **Export/Delete:** Buttons in dashboard.
- **Accessibility:** Keyboard navigation, screen reader labels, high contrast.
- **Acceptance Criteria:**
  - Dashboard accessible from tray in one click.
  - All charts have text alternatives.
  - Data loads from local DB only.

---

### 4.10 Notifications & DND

- Use native OS notifications.
- Respect Focus Assist / Do Not Disturb.
- Detect meetings/full-screen apps where possible.
- Provide “Deferred” logging instead of interrupting.
- **Acceptance Criteria:**
  - Notifications do not appear during DND.
  - Deferred breaks are logged with reason.

---

## 5. State Machine & Logic Definitions

### 5.1 States

| State | Description |
|-------|-------------|
| Initializing | App starting, permissions checking |
| TrackingActive | User present and active |
| TrackingGrace | User absent but within grace period |
| PausedAway | User absent beyond grace period |
| BreakPrompt | Break interval reached, alert shown |
| BreakMode | Break overlay active |
| BreakSnoozed | Break deferred by user |
| BreakSkipped | Break skipped by user |
| FallbackInputTracking | CV unavailable, using input idle |
| CameraErrorFallback | Camera error, fallback active |
| Quit | App exiting |

### 5.2 Transitions

- Initializing → TrackingActive: camera OK or fallback ready.
- TrackingActive → TrackingGrace: no face/input.
- TrackingGrace → TrackingActive: face/input returns.
- TrackingGrace → PausedAway: grace expires.
- PausedAway → TrackingActive: face/input returns.
- TrackingActive → BreakPrompt: work interval reached.
- BreakPrompt → BreakMode: user ignores for 2 min.
- BreakPrompt → BreakSnoozed: user snoozes.
- BreakPrompt → BreakSkipped: user skips.
- BreakMode → TrackingActive: break completed or dismissed.
- Any → FallbackInputTracking: camera denied/busy/failed.
- Any → CameraErrorFallback: unrecoverable CV error.
- Any → Quit: user quits.

### 5.3 Acceptance Criteria

- State transitions logged with timestamp.
- No state stuck for > 5 seconds without UI feedback.
- Break state cannot be entered while DND suppresses prompts.

---

## 6. User Flows

1. **Onboarding:** Install → grant camera permission → set intervals → choose auto-start → minimize to tray.
2. **Daily Usage:** Sit at PC → CV detects face → timer starts.
3. **Interruption:** Get coffee → CV loses face → 60s grace → timer pauses.
4. **Return:** Sit down → CV detects face → timer resumes.
5. **Break Time:** 50 min active → tray red → notification “Time for a break!”
6. **Break Execution:** Step away → CV absence → break timer starts → return → work timer resets.
7. **Snooze/Skip:** User snoozes → logged → break re-prompts after snooze.
8. **Camera Error:** Camera denied → fallback to input tracking → user notified.
9. **DND:** Meeting detected → break deferred → logged.

---

## 7. UI/UX Guidelines

- **Minimalist Design:** App should not distract. Clean charts, simple typography.
- **Calming Break UI:** Soft colors, dark mode friendly, subtle ambient animation (breathing circle).
- **Accessibility:** High contrast, screen readers, keyboard navigation, reduced motion.
- **Privacy Dashboard:** Shows what data is collected, what is stored, and why camera light is on.
- **Localization:** All strings externalized; support English V1, i18n-ready.
- **Acceptance Criteria:**
  - WCAG 2.1 AA where feasible.
  - All interactive elements reachable by keyboard.
  - Reduced motion disables breathing animation.

---

## 8. Technical Architecture & Stack Recommendations

### 8.1 Desktop Framework

- **Tauri (Recommended):** Rust backend, web frontend. Lightweight, low memory, native tray.
- **Alternative:** Electron if rapid UI development prioritized; Native (C#/WPF, Swift) if platform-specific performance needed.
- **Technical Spike Required:** Validate Tauri + webcam + MediaPipe at 2–5 FPS within performance budget. If not feasible, use Rust-native camera capture + TensorFlow Lite / MediaPipe C++ sidecar.

### 8.2 Computer Vision Engine

- **MediaPipe:** Face Detection / Face Mesh for presence.
- **OpenCV:** Fallback Haar Cascade.
- **Model Licensing:** Verify MediaPipe model licenses for bundling and offline use.
- **Model Updates:** Optional, signed, local.

### 8.3 Data Storage

- **Local SQLite:** Settings, logs, analytics.
- **No Cloud Backend (V1).**
- **Optional Local Export:** JSON/CSV.

### 8.4 Telemetry

- **Opt-in only.**
- Anonymous aggregates: app version, OS, crash counts, break compliance, active time.
- No camera frames, no keystrokes, no screen content.
- Local queue; user can disable and delete.

### 8.5 Performance Budget

- CPU: < 5% average on target hardware.
- RAM: < 100 MB average.
- CV FPS: 1–5.
- Battery: reduce FPS or switch to input fallback on battery.
- **Acceptance Criteria:** Benchmarks on low-end Windows laptop, MacBook Air, Ubuntu laptop.

---

## 9. Data Schema & Retention

### 9.1 SQLite Tables

- **schema_version:** version, applied_at.
- **settings:** key, value, updated_at.
- **sessions:** id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id.
- **breaks:** id, prompted_ts, start_ts, end_ts, status (taken/skipped/deferred/snoozed), reason.
- **daily_stats:** date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct.
- **events:** id, ts, type, details_json.
- **telemetry_queue:** id, ts, payload_json, sent_at (opt-in).

### 9.2 Retention

- Default 365 days.
- User can choose 30/90/365/Indefinite.
- Auto-delete daily.
- Delete-all-data removes DB and backups.

### 9.3 Timezone & DST

- Store timestamps in UTC.
- Display in local timezone.
- Daily rollover at local midnight.
- Handle DST transitions.

---

## 10. Platform Support Matrix

| Platform | Min Version | Tray | Camera Permission | Auto-Start | Notifications | Input Idle API | Notes |
|----------|-------------|------|-------------------|------------|---------------|----------------|-------|
| Windows | 10/11 | Yes | Privacy Settings | Registry/Task Scheduler | Toast | GetLastInputInfo | Code signing required |
| macOS | 12+ | Menu Bar | TCC prompt | Login Items | Notification Center | IOKit | Notarization required |
| Linux | Ubuntu 22.04+ / Fedora 38+ | Yes | PipeWire/Portal | XDG autostart | libnotify | X11/Wayland | Wayland limitations |

- **Acceptance Criteria:**
  - App installs and runs on each platform.
  - Camera permission flow works.
  - Tray icon and menu behave natively.

---

## 11. Non-Functional Requirements

- **Performance:** CV < 5% CPU, < 100 MB RAM average.
- **Battery:** Reduce polling or fallback on battery.
- **Privacy:** No image/video storage or transmission.
- **Security:** Signed updates, local DB encryption option.
- **Reliability:** Auto-recover from camera/DB errors.
- **Accessibility:** WCAG 2.1 AA where feasible.
- **Localization:** i18n-ready.
- **Maintainability:** Modular architecture, tests.

---

## 12. Privacy, Legal & Compliance

- **GDPR/CCPA:** Camera processing may be considered personal/biometric-adjacent. Conduct DPIA.
- **Consent:** Explicit camera consent during onboarding.
- **Privacy Policy:** Plain-language explanation of local processing, no image storage, no cloud.
- **Data Subject Rights:** Export, delete, rectify.
- **Biometric Data:** No identification, no templates stored. Still review legal classification.
- **Camera Indicator:** Explain why light is on; provide tooltip.
- **Children:** Not intended for children under 13/16.
- **Acceptance Criteria:**
  - Privacy policy accessible in-app.
  - Delete-all-data works.
  - No network calls containing camera data.

---

## 13. Security

- **Local DB:** Optional encryption at rest.
- **Update Signing:** Code signing and notarization.
- **Crash Dumps:** Opt-in, scrubbed of personal data.
- **Telemetry:** Opt-in, anonymous, encrypted in transit.
- **Least Privilege:** Request only necessary permissions.
- **Dependency Scanning:** Regular updates.

---

## 14. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Camera denied | Fallback input tracking, notify user |
| Camera busy | Fallback input tracking, notify user |
| Camera disconnected | Fallback, retry periodically |
| Model failure | Fallback, log error |
| DB corrupt | Backup, recreate, notify user |
| Update failure | Rollback to previous version |
| Lock/sleep/hibernate | Pause tracking, resume on unlock |
| Fast user switching | Pause for inactive user |
| Remote desktop | Pause CV, use input tracking |
| Virtual camera | Detect and warn |
| Multiple faces | Present, log multi-face event |
| Dark room | Low-confidence fallback |
| Battery low | Reduce FPS, fallback if critical |
| DND/meeting | Defer break, log reason |
| Midnight rollover | Split session across days |
| Timezone change | Recalculate daily stats |
| User covers camera | Treat as away after grace |
| No webcam | Input tracking only |

---

## 15. Accessibility & Localization

- **Keyboard Navigation:** All menus, dashboard, break overlay.
- **Screen Readers:** Labels, roles, live regions for break alerts.
- **High Contrast:** Supported.
- **Reduced Motion:** Disable breathing animation.
- **Text Scaling:** Support OS scaling.
- **Localization:** English V1, i18n framework ready.
- **Acceptance Criteria:** Pass internal accessibility audit.

---

## 16. Testing & QA

- **Unit Tests:** State machine, settings, DB.
- **Integration Tests:** Camera, fallback, notifications.
- **E2E Tests:** Onboarding, break flow, export/delete.
- **CV Accuracy Tests:** Diverse dataset for skin tones, glasses, masks, lighting.
- **Performance Tests:** CPU/RAM on low-end hardware.
- **Battery Tests:** Laptop battery drain.
- **Accessibility Tests:** Screen reader, keyboard.
- **Cross-Platform Tests:** Windows, macOS, Linux.
- **Legal/Privacy Review:** Before release.

---

## 17. Release & Updates

- **Installers:** MSI/EXE, DMG, AppImage/DEB/RPM.
- **Code Signing:** Windows Authenticode, macOS notarization.
- **Auto-Update:** Signed updates, rollback.
- **Uninstall:** Remove app; optional remove user data.
- **Release Channels:** Stable, Beta.
- **Acceptance Criteria:** Update does not lose data.

---

## 18. Success Metrics & Measurement

| Metric | Target | Measurement |
|--------|--------|-------------|
| Retention | >60% keep app running >4h/day | Opt-in telemetry / beta surveys |
| Break Compliance | >70% prompted breaks taken | Local logs + opt-in aggregate |
| Performance | <2% users report high CPU/crash | Crash reporting + surveys |
| Accuracy | Active time within 10% self-reported | Beta surveys + local logs |
| CV False Positive | <10% | Test dataset |
| CV False Negative | <10% | Test dataset |

- **Telemetry:** Off by default; opt-in anonymous aggregates.
- **Local Analytics:** Dashboard shows user their own stats.
- **Beta Surveys:** Validate accuracy and compliance.

---

## 19. Risks & Open Questions

| Risk | Mitigation |
|------|------------|
| Camera light anxiety | Explain why; offer input-only mode |
| Multiple users | Any face = present; log multi-face |
| Dark rooms | Low-confidence fallback |
| CV bias | Diverse test dataset; fallback |
| Meeting disruption | DND/full-screen detection; defer |
| Battery drain | Reduce FPS; fallback |
| Legal/biometric classification | DPIA; privacy policy; legal review |
| Tauri + MediaPipe performance | Technical spike; native sidecar fallback |
| Wayland limitations | Input fallback; document limits |
| No cloud metrics | Opt-in telemetry; beta surveys |

**Open Questions:**
- How to reliably detect “focused” vs. “present” without heavier models?
- How to handle external webcams without indicator lights?
- How to handle users who intentionally cover camera?
- What is the legal status of face detection in target markets?
- How to measure break compliance without cloud?

---

## 20. Out of Scope for V1

- Cloud syncing across multiple devices.
- Slack/Teams integration.
- Posture detection.
- Eye-strain tracking (blink rate).
- Biometric user identification.
- Remote monitoring.

---

## 21. Appendices

### A. Definitions

- **Present:** Face or input activity detected within grace period.
- **Active:** Present AND input/gaze confidence above threshold.
- **Focused:** Active AND no break overdue AND not in break mode.
- **Away:** No presence/input beyond grace period.
- **Break Taken:** Away or in break mode for ≥50% of break duration.
- **Break Skipped:** User dismisses or remains active beyond break duration.
- **Break Deferred:** Prompt suppressed by DND/meeting/full-screen.

### B. Acceptance Criteria Summary

- App runs in tray on all supported platforms.
- Camera processing is local only; no image storage/transmission.
- Fallback works when camera unavailable.
- Break prompts, snooze, skip, and compliance logging work.
- Dashboard shows accurate daily/weekly stats.
- Export/delete data works.
- Accessibility basics pass.
- Performance within budget.
- Legal/privacy review completed before release.