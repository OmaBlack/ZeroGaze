# ZeroGaze

> **Privacy-first, 100% on-device active work tracker, ergonomic posture monitor, and 20-20-20 screen break companion.**

[![Build Mac and Windows](https://github.com/OmaBlack/ZeroGaze/actions/workflows/build-all.yml/badge.svg)](https://github.com/OmaBlack/ZeroGaze/actions/workflows/build-all.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-emerald.svg)]()

ZeroGaze helps programmers and desk professionals prevent digital eye strain, neck stiffness, and burnout without compromising their privacy.

Unlike traditional timer apps that count down blindly even when you step away, or invasive employee trackers that record screens and log keystrokes, ZeroGaze uses lightweight, 100% on-device computer vision to verify genuine physical presence.

---

## ✨ Features

- 👁️ **Genuine Active Work Tracking**: Logs screen time only when you are physically in front of your workstation, avoiding the false positives of naive timers.
- 🧘 **Ergonomic 20-20-20 Micro-Breaks**: Prompts you every 20 minutes to gaze at an object 20 feet away for 20 seconds, featuring a smooth visual pursuit animation to relieve ocular muscle fatigue.
- 📐 **Ambient Posture & Distance Monitor**: Detects sustained slouching and warns you if you lean closer than 45 cm to the screen.
- ⏱️ **Flexible Rhythm Presets**: One-click **50/10 Standard**, **25/5 Pomodoro**, and **90/20 Ultradian** cadences, plus a 2-minute "Wrap Up My Thought" buffer.
- 🔒 **100% On-Device Privacy Guarantee**: Zero cloud servers, zero external telemetry, and no account requirement. All computer vision inference occurs in temporary RAM at 2 FPS and is discarded immediately. No video frames or photos are ever saved to disk or transmitted over any network.
- ⌨️ **Input Fallback Mode**: Prefer not to use a webcam? Switch to keyboard and mouse idle tracking with one click.
- 📊 **Local Data Portability**: Export your logs as JSON, CSV, or self-contained weekly HTML/SVG ergonomic health report cards.
- 🖥️ **Persistent System Tray / Menu Bar Daemon**: Runs quietly in the background with real-time status badges and quick-action menus.

---

## 🛠️ Architecture & Tech Stack

- **Framework**: [Tauri v2](https://v2.tauri.app/) (Rust backend + Webview frontend)
- **Computer Vision**: [Google MediaPipe BlazeFace](https://developers.google.com/mediapipe) running via WebAssembly
- **Frontend**: TypeScript, HTML5 Canvas, Vanilla CSS (dark nocturnal design system)
- **Database**: Embedded SQLite (rusqlite) stored in local application data directory
- **Platform APIs**: Native system tray, autostart on system boot, and OS desktop notifications

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [Rust](https://www.rust-lang.org/) (stable)
- OS-specific Tauri dependencies: [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Installation

```bash
# Clone the repository
git clone https://github.com/OmaBlack/ZeroGaze.git
cd ZeroGaze

# Install frontend dependencies
npm install
```

### Development

```bash
# Run web frontend in Vite dev server
npm run dev

# Run desktop application with Tauri
npm run tauri dev
```

### Running Tests

```bash
# Run frontend unit tests
npm test

# Run Rust backend test suite
cargo test --manifest-path src-tauri/Cargo.toml
```

### Building for Release

```bash
# Build production desktop bundle for your current OS
npm run tauri build
```

---

## 📄 Privacy Policy

ZeroGaze adheres to the strictest data protection standards:
- [PRIVACY.md](PRIVACY.md) (Markdown)
- [PRIVACY.txt](PRIVACY.txt) (Plain Text for Microsoft Store compliance)

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).
