# ZeroGaze Privacy Policy

**Effective Date:** October 26, 2026  
**Last Updated:** October 26, 2026  
**Product:** ZeroGaze Desktop Application  
**Compliance Standards:** 
- General Data Protection Regulation (EU GDPR - Regulation (EU) 2016/679)
- Nigeria Data Protection Act 2023 / Nigeria Data Protection Regulation (NDPA / NDPR)

---

## 1. Executive Privacy Statement

ZeroGaze is built on a fundamental architectural principle: **Privacy by Design and Privacy by Default** (Article 25 GDPR; Section 24 NDPA). 

ZeroGaze is an offline-capable, local-first digital wellbeing and ergonomic desktop application designed to prevent eye strain and posture fatigue. **We do not operate remote tracking servers, do not run cloud databases, do not collect personal identifiers over the internet, and do not transmit or store camera frames or video recordings under any circumstances.** All computer vision inferences occur strictly inside your device's random-access memory (RAM) and are discarded in real time.

---

## 2. Data Controller & Contact Information

Under the GDPR and NDPA/NDPR:
- **Developer / Publisher:** nerdtard
- **Data Controller:** nerdtard / ZeroGaze Maintainers
- **Role:** Because ZeroGaze runs purely on your local machine and does not send data to any central server, **you remain in complete control of your local data at all times.**
- **Contact & Privacy Inquiries:** `me@ayoolufemi.name.ng` (or `privacy@zerogaze.local`).

---

## 3. Categories of Data Processed & Architecture

### 3.1 Optical Sensor & Computer Vision Data (In-Memory Only)
- **Data Type:** Real-time camera frames captured via your connected webcam or integrated camera sensor.
- **Processing Mode:** On-device WebAssembly inference using Google MediaPipe BlazeFace.
- **Sampling Frequency:** Throttled to 1–5 frames per second (default: 2 FPS; reduced to 1 FPS on battery power).
- **Retention & Storage:** **ZERO storage.** Raw image frames, pixels, and video streams exist purely in volatile memory (RAM) for milliseconds during scoring and are immediately overwritten. No image, snapshot, or video file is ever written to disk, cache, or external networks.
- **Facial Signatures & Biometric Consideration:**
  - *Standard Mode:* ZeroGaze extracts anonymous bounding boxes and facial landmark coordinates (eye centers, nose tip) strictly to calculate screen distance (~50–75 cm) and posture drift (vertical slouch angle). No facial templates or identities are generated.
  - *Optional Primary User Identity Guard:* When you explicitly choose to "Enroll Face", a normalized geometric relative distance descriptor (non-reversible mathematical landmark vector) is calculated and stored in your device's local application database. This is used solely to verify if the active user matches the enrolled profile and can trigger an automatic workstation lock if an unauthorized user takes the screen. This mathematical signature is non-invertible (a photograph cannot be reconstructed from it) and never leaves your computer.

### 3.2 Operating System Idle Input Metrics (Fallback Mode)
- **Data Type:** Time in seconds since the last physical input event (mouse movement, key press).
- **Processing Mode:** Native OS API calls (`GetLastInputInfo` on Windows, `IOKit` / `CGEventSourceSecondsSinceLastEventType` on macOS, and X11/Wayland idle monitors on Linux).
- **Retention & Storage:** ZeroGaze does **not** log keystrokes, does **not** record pressed keys, does **not** record mouse coordinates, and does **not** capture screen contents. It only queries the elapsed idle duration to pause timers when you leave your desk.

### 3.3 Productivity & Ergonomic Time Logs (Local SQLite Database)
ZeroGaze stores the following operational records in a local SQLite file in your user data directory (`$HOME/Library/Application Support/com.zerogaze.desktop/zerogaze.db` on macOS, `%APPDATA%\com.zerogaze.desktop\zerogaze.db` on Windows, or `~/.local/share/com.zerogaze.desktop/zerogaze.db` on Linux):
- **Daily Aggregates:** Total active focus seconds, physical presence seconds, breaks taken count, breaks skipped count, and compliance percentages.
- **Session Intervals:** Start timestamp (UTC), end timestamp (UTC), duration, and tracking mode (`Auto`, `Input only`, or `Webcam only`).
- **Break Logs:** Timestamps and status (`taken`, `skipped`, `snoozed`, or `completed`).
- **User Settings:** Preferences including work/break intervals, comfort distance, sound toggles, notification permissions, and retention days.

---

## 4. Legal Bases for Processing (GDPR Article 6 & 9; NDPA Section 25)

1. **Consent (Art. 6(1)(a) GDPR; Sec. 25(1)(a) NDPA):**
   - Camera access is granted explicitly by the user via OS system dialogs (e.g., macOS TCC permissions, Windows Privacy prompts) and during first-run onboarding.
   - Enrolling an optional primary user facial signature requires explicit user initiation ("Enroll My Face").
   - You can revoke consent at any moment by selecting "Input only" mode, switching off camera permissions in your operating system, or clicking "Clear ID".
2. **Legitimate Interests (Art. 6(1)(f) GDPR; Sec. 25(1)(c) NDPA):**
   - Processing local session metrics solely to calculate user focus rhythms, trigger break notifications, and provide historical trend visualizations requested by the user.

---

## 5. Third-Party Sharing, Cloud Telemetry & Cross-Border Transfers

- **Third-Party Disclosures:** **None.** ZeroGaze does not sell, license, lease, share, or disclose any user data to advertisers, analytics providers, data brokers, or third-party service providers.
- **Cloud Infrastructure & Telemetry:** There are no remote servers, CDNs, or analytics endpoints connected to ZeroGaze. The application's Content Security Policy (CSP) strictly disallows outbound network requests (`connect-src 'self'`).
- **Cross-Border Data Transfers:** Because all data remains on your physical storage drive, **no international data transfers take place** under GDPR Chapter V or NDPA Sections 41–43.

---

## 6. Data Subject Rights (GDPR Articles 15–22; NDPA Sections 34–40)

ZeroGaze provides built-in, one-click graphical controls within the application settings to satisfy all statutory data protection rights without requiring support requests:

| Statutory Right | Regulatory Provision | In-App Implementation |
|:---|:---|:---|
| **Right to Access & Portability** | Art. 15 & 20 GDPR; Sec. 34 & 38 NDPA | Export your entire history at any time as standardized **JSON** or **CSV** files directly from the *Local Data Portability* menu in Settings. |
| **Right to Erasure ("Right to be Forgotten")** | Art. 17 GDPR; Sec. 34(1)(d) NDPA | Click **"Delete All Local Data"** in the Settings panel to immediately wipe all sessions, daily logs, settings, and biometric facial signatures from your local database. |
| **Right to Rectification** | Art. 16 GDPR; Sec. 34(1)(c) NDPA | Modify your ergonomic comfort distance, presets, camera sources, and intervals at any time via Settings. |
| **Right to Restrict or Object to Processing** | Art. 18 & 21 GDPR; Sec. 36 NDPA | Switch Tracking Mode to **"Input only"** to completely shut down the camera sensor subsystem, stopping all video feed requests and computer vision processing. |
| **Right to Revoke Biometric Enrollment** | Art. 9(2)(a) GDPR; Sec. 30 NDPA | Click **"Clear ID"** in Camera Settings to instantly delete the enrolled facial signature vector. |

---

## 7. Data Retention & Automatic Purge Schedule

- **Configurable Retention Window:** You can choose your preferred retention period in Settings: `30 Days`, `90 Days`, `365 Days (1 Year - Default)`, or `Indefinite`.
- **Automated Local Pruning:** When the application initializes or executes daily database maintenance, any records with timestamps older than the selected retention cutoff are automatically deleted via SQLite transactions.
- **Application Uninstall:** Removing the ZeroGaze application and deleting the local application directory purges all remnants of database files and configuration states.

---

## 8. Technical and Organizational Security Measures (TOMs)

In compliance with Article 32 GDPR and Section 39 NDPA, ZeroGaze enforces the following security controls:
1. **Air-Gapped Local Operation:** Zero external network sockets or telemetry listeners.
2. **Strict Content Security Policy (CSP):** The application webview strictly enforces:
   `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none';`
3. **Local Self-Hosted Assets:** Fonts, MediaPipe BlazeFace models (`.tflite`), and WebAssembly runtimes are packaged locally within the offline application bundle—no remote scripts are downloaded during runtime.
4. **Hardware Access Transparency:** The camera LED indicator hardware light on your device illuminates whenever the sensor is active. A system tray icon and in-app diagnostics dashboard clearly inform you when the camera is running, paused, or operating in input-fallback mode.

---

## 9. Children's Privacy

ZeroGaze is a general productivity and ergonomic tool not directed towards children under 16 years of age (GDPR Art. 8; NDPA Sec. 27). Because ZeroGaze does not collect personal identifiers or transmit data off-device, no children's data is ever gathered or stored externally.

---

## 10. Supervisory Authorities & Complaints

If you have concerns regarding data protection practices, you have the right to lodge a complaint with your competent supervisory data protection authority:
- **European Union / EEA:** Your local national Data Protection Authority (DPA) under the European Data Protection Board (EDPB) directory: [edpb.europa.eu](https://edpb.europa.eu/about-edpb/about-edpb/members_en).
- **Nigeria:** The Nigeria Data Protection Commission (NDPC): [ndpc.gov.ng](https://ndpc.gov.ng) / `info@ndpc.gov.ng`.

---

## 11. Amendments to this Policy

Any updates to this Privacy Policy will be reflected with a revised "Last Updated" timestamp at the top of this document and packaged directly into new version releases of the ZeroGaze application.
