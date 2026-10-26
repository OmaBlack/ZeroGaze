# Plan 033: Camera Switch Posture Synchronization and Data Purge Hygiene

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [032](032-native-macos-presentation-dnd-and-display-aware-posture.md)
- **Category**: bug
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze introduces per-camera posture calibration baselines (`posture_baseline_y_${safeId}`). However:
1. When a user switches cameras directly inside the Settings modal (`#setting-camera-select`), `saveSettings()` persists `selected_camera_id`, but does not immediately call `loadCameraPostureBaseline()`. If the user has paused tracking or the stream does not re-trigger `startWebcam()`, the in-memory posture baseline remains stuck on the prior camera's baseline, producing false slouch/distance warnings.
2. In `deleteAllData()`, while backend SQLite tables are purged via `delete_all_data`, any loaded per-camera posture settings keys in memory or localStorage/session aren't explicitly notified, and the camera select isn't reset to default.

Synchronizing camera switching with immediate posture baseline loading and ensuring full state sanitization on data purge closes these state inconsistencies.

## Current state

- Relevant files:
  - `src/main.ts:1244-1270` — `saveSettings()` camera selection change logic.
  - `src/main.ts:1278-1300` — `deleteAllData()` reset and purge sequence.

Current code excerpts:

1. `src/main.ts:1244-1270`:
```ts
    const newCameraId = settingCameraSelect ? settingCameraSelect.value : selectedDeviceId;
    const cameraChanged = newCameraId !== selectedDeviceId;
    selectedDeviceId = newCameraId;
    await invoke('update_setting', { key: 'selected_camera_id', value: selectedDeviceId });
    if (previewCameraSelect) {
      previewCameraSelect.value = selectedDeviceId;
    }
...
    if (settingTrackingMode.value === 'Input only') {
      stopWebcamTracks();
    } else if ((cameraChanged || !(videoEl.srcObject instanceof MediaStream)) && !isTrackingPaused) {
      await startWebcam(selectedDeviceId);
    }
```

2. `src/main.ts:1278-1300`:
```ts
async function deleteAllData() {
  if (confirm('Are you sure you want to delete all local history and statistics? This action is permanent and cannot be undone.')) {
    try {
      await invoke('delete_all_data');
      enrolledFaceSignature = null;
      lastObservedSignature = null;
      identityMismatchCounter = 0;
      isUnrecognizedUserVisible = false;
      baselineFaceY = null;
      baselineFaceHeight = null;
      slouchCounter = 0;
      tooCloseCounter = 0;
      updateFaceEnrollmentUI();
      updatePostureCalibrationUI();
      closeSettings();
      const state = await invoke<StateSnapshot>('get_state');
      renderState(state);
      refreshTrendsChart();
    } catch (err) {
      alert('Failed to delete data: ' + String(err));
    }
  }
}
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build / Bundler check | `npm run build` | exit 0, built cleanly |
| Frontend tests | `npm test` | exit 0, all tests pass |
| Cargo tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0 |

## Scope

**In scope**:
- `src/main.ts`

**Out of scope**:
- Do not modify Rust backend files in `src-tauri/`.
- Do not alter `index.html`.

## Steps

### Step 1: Ensure `loadCameraPostureBaseline()` runs immediately on camera switch in `saveSettings`
In `src/main.ts` inside `saveSettings()`:
If `cameraChanged` is true:
1. Await `loadCameraPostureBaseline()`.
2. Ensure `settingCameraSelect` and `previewCameraSelect` remain synchronized.
3. If tracking is currently active and not in "Input only" mode, invoke `startWebcam(selectedDeviceId)`.

**Verify**: `npm run build` → exit 0

### Step 2: Ensure `deleteAllData()` resets selected camera to default
In `src/main.ts` inside `deleteAllData()`:
1. Reset `selectedDeviceId = ''`.
2. Reset `settingCameraSelect.value = ''` and `previewCameraSelect.value = ''`.
3. Clear `baselineFaceY = null`, `baselineFaceHeight = null`, `slouchCounter = 0`, `tooCloseCounter = 0`.
4. Ensure `loadCameraPostureBaseline()` is awaited so any active camera profile is cleared.

**Verify**: `npm run build && npm test` → exit 0

## Done criteria

- [ ] `saveSettings` calls `loadCameraPostureBaseline()` whenever the camera device changes.
- [ ] `deleteAllData` resets `selectedDeviceId` to default and synchronizes selects.
- [ ] `npm run build` exits 0.
- [ ] `npm test` exits 0.
- [ ] `plans/README.md` updated.

## STOP conditions

- If camera switching causes race conditions while `startWebcam()` is in flight, ensure `stopWebcamTracks()` finishes before the new stream initializes.
