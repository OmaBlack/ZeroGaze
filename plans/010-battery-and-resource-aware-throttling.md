# Plan 010: Implement Dynamic Battery and Resource-Aware Vision Throttling

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src/main.ts`. If loop timing or camera setup mismatches,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [003](003-presence-watchdog-and-pause-power-optimization.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

FocusGaze uses MediaPipe BlazeFace WebAssembly running locally on the user's CPU/GPU. While plan 003 suspends camera inference when tracking is explicitly paused, mobile laptop users running on battery power still experience unnecessary energy consumption when inference runs at a fixed 2 FPS continuously for hours. Dynamically throttling CV inference to 0.5 FPS on battery—and falling back to OS input tracking below 20% battery—extends mobile battery life significantly without compromising presence detection.

## Current state

- Relevant files:
  - `src/main.ts:104-124` — `loopCv()` processes frames and schedules next tick via `setTimeout(loopCv, 500)`.
  - `index.html:107-119` — displays Computer Vision Status and Active Tracking Mode.
- Current excerpt (`src/main.ts:114-123`):
```typescript
try {
  const detections = detector.detectForVideo(videoElement, timestamp);
  const present = (detections.detections?.length ?? 0) > 0;
  const confidence = present ? (detections.detections[0].categories?.[0]?.score ?? 0.8) : 0;
  const multiFace = (detections.detections?.length ?? 0) > 1;

  await invoke("update_presence", { present, confidence, multiFace });
} catch (e) {
  console.error("Inference error:", e);
}

setTimeout(loopCv, 500);
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend build | `npm run build` | exit 0 |
| Rust check | `cargo check` (in `src-tauri`) | exit 0 |

## Scope

**In scope**:
- `src/main.ts` (integrate `navigator.getBattery()`, adjust CV tick interval dynamically, trigger fallback mode on critical battery)
- `index.html` (add battery saver status indicator in CV card)
- `src/style.css` (battery status badge styling)

**Out of scope**:
- Native C++/Rust OS battery callbacks (standard browser Battery API handles WebKit/WebView2).
- Lowering display brightness.

## Steps

### Step 1: Detect battery power state in `src/main.ts`

1. Define interface and state:
   ```typescript
   interface BatteryStatus {
     charging: boolean;
     level: number;
   }
   let currentBattery: BatteryStatus | null = null;
   ```
2. Initialize battery monitor:
   ```typescript
   if ("getBattery" in navigator) {
     (navigator as any).getBattery().then((battery: any) => {
       const update = () => {
         currentBattery = {
           charging: battery.charging,
           level: battery.level
         };
         updateBatteryUI();
       };
       update();
       battery.addEventListener("chargingchange", update);
       battery.addEventListener("levelchange", update);
     });
   }
   ```

**Verify**: `npm run build` exits 0.

### Step 2: Implement dynamic CV loop throttling

1. In `loopCv()`, determine delay dynamically:
   ```typescript
   let nextDelay = 500; // default 2 FPS on AC
   if (currentBattery && !currentBattery.charging) {
     if (currentBattery.level < 0.20) {
       // Critical battery: switch to native input fallback to save camera hardware power
       nextDelay = 3000;
       await invoke("update_setting", { key: "tracking_mode", value: "Input only" });
     } else {
       // On battery power: drop to 0.5 FPS (1 frame every 2 seconds)
       nextDelay = 2000;
     }
   }
   setTimeout(loopCv, nextDelay);
   ```

**Verify**: `npm run build` exits 0.

### Step 3: Add battery mode badge in `index.html` and `src/style.css`

1. In `index.html` inside `.stat-card` for CV status, add:
   ```html
   <div id="stat-battery-pill" class="badge badge-neutral hidden">
     <span>🔋 Battery Saver (0.5 FPS)</span>
   </div>
   ```
2. In `src/main.ts`, update `updateBatteryUI()`:
   - When on battery, unhide `#stat-battery-pill`. When on AC power or charging, hide it.

**Verify**: `npm run build` exits 0.

## Test plan

- Manual test via DevTools / Battery API simulation:
  - Verify that when `charging: false`, the loop interval adjusts to 2000ms.
  - Verify badge displays `Battery Saver`.
  - Verify that when `charging: true`, loop interval returns to 500ms (2 FPS).

## Done criteria

- [ ] `npm run build` exits 0.
- [ ] No regression in presence detection when operating at 0.5 FPS on battery.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `navigator.getBattery` is unavailable in the platform webview (fallback safely to standard 500ms interval).
