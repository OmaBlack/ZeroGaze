import { invoke } from '@tauri-apps/api/core';
import { isEnabled, enable, disable } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted } from '@tauri-apps/plugin-notification';

export interface SettingsElements {
  settingsModalEl: HTMLDivElement;
  settingWorkInterval: HTMLInputElement;
  settingBreakInterval: HTMLInputElement;
  settingGracePeriod: HTMLInputElement;
  settingSnoozeLimit: HTMLInputElement;
  settingSkipLimit: HTMLInputElement | null;
  settingTrackingMode: HTMLSelectElement;
  settingAutostart: HTMLInputElement | null;
  settingCameraSelect: HTMLSelectElement | null;
  previewCameraSelect: HTMLSelectElement | null;
  settingMinFaceRatio: HTMLSelectElement | null;
  settingCvFps: HTMLSelectElement | null;
  settingBreakOverlay: HTMLSelectElement | null;
  settingDataRetention: HTMLSelectElement | null;
  settingSound: HTMLInputElement | null;
  settingReducedMotion: HTMLInputElement | null;
  settingHighContrast: HTMLInputElement | null;
  settingPostureAlertSound: HTMLInputElement | null;
  settingNotifications: HTMLInputElement | null;
  settingMicroNotifications: HTMLInputElement | null;
  settingTrayAlerts: HTMLInputElement | null;
  settingErgoTrayAlerts: HTMLInputElement | null;
  settingLockUnrecognized: HTMLInputElement | null;
  settingScreenPreset: HTMLSelectElement | null;
  settingComfortDistance: HTMLInputElement | null;
  screenDetectedNote: HTMLElement | null;
  comfortRecommendationText: HTMLElement | null;
  btnApplyRecommendedDistance: HTMLButtonElement | null;
  notificationPermissionStatus: HTMLSpanElement | null;
  breakModeOverlayEl: HTMLDivElement | null;
}

export interface AppSettingsState {
  selectedDeviceId: string;
  minFaceHeightRatio: number;
  configuredCvFps: number;
  soundEnabled: boolean;
  postureAlertSoundEnabled: boolean;
  notificationsEnabled: boolean;
  microNotificationsEnabled: boolean;
  trayAlertsEnabled: boolean;
  ergoTrayAlertsEnabled: boolean;
  comfortDistanceCm: number;
  screenSizePreset: string;
  breakOverlayMode: string;
  reducedMotion: boolean;
  highContrast: boolean;
  enrolledFaceSignature: number[] | null;
  lockOnUnrecognized: boolean;
}

export function applyAppearance(
  reducedMotion: boolean,
  highContrast: boolean,
  breakOverlayMode: string,
  configuredCvFps: number,
  breakModeOverlayEl: HTMLDivElement | null
): void {
  document.body.classList.toggle('reduced-motion', reducedMotion);
  document.body.classList.toggle('high-contrast', highContrast);
  if (breakModeOverlayEl) {
    breakModeOverlayEl.classList.toggle('overlay-centered', breakOverlayMode === 'centered');
  }
  const pollingSpan = document.querySelector('.preview-metrics span:first-child');
  if (pollingSpan) {
    pollingSpan.innerHTML = `Polling: <strong>${configuredCvFps} FPS</strong>`;
  }
}

export async function updateNotificationPermissionBadge(statusEl: HTMLSpanElement | null): Promise<void> {
  if (!statusEl) return;
  try {
    const granted = await isPermissionGranted();
    if (granted) {
      statusEl.textContent = 'Active (Granted)';
      statusEl.style.color = '#34d399';
    } else {
      statusEl.textContent = 'Not Granted (Click Test to Request)';
      statusEl.style.color = '#fbbf24';
    }
  } catch {
    statusEl.textContent = 'Desktop Notifications Supported';
    statusEl.style.color = '';
  }
}

export async function hydrateSettingsModal(
  elements: SettingsElements,
  state: AppSettingsState,
  populateCameras: () => Promise<void>,
  loadPostureBaseline: () => Promise<void>,
  updateFaceEnrollment: () => void
): Promise<void> {
  const settings = await invoke<Record<string, string>>('get_settings');
  if (settings.work_interval_minutes && elements.settingWorkInterval) {
    elements.settingWorkInterval.value = settings.work_interval_minutes;
  }
  if (settings.break_interval_minutes && elements.settingBreakInterval) {
    elements.settingBreakInterval.value = settings.break_interval_minutes;
  }
  if (settings.grace_period_seconds && elements.settingGracePeriod) {
    elements.settingGracePeriod.value = settings.grace_period_seconds;
  }
  if (settings.snooze_limit && elements.settingSnoozeLimit) {
    elements.settingSnoozeLimit.value = settings.snooze_limit;
  }
  if (settings.skip_limit && elements.settingSkipLimit) {
    elements.settingSkipLimit.value = settings.skip_limit;
  }
  if (settings.tracking_mode && elements.settingTrackingMode) {
    elements.settingTrackingMode.value = settings.tracking_mode;
  }
  if (settings.cv_fps && elements.settingCvFps) {
    elements.settingCvFps.value = settings.cv_fps;
    state.configuredCvFps = parseInt(settings.cv_fps, 10) || 2;
  }
  if (settings.break_overlay && elements.settingBreakOverlay) {
    elements.settingBreakOverlay.value = settings.break_overlay;
    state.breakOverlayMode = settings.break_overlay;
  }
  if (settings.data_retention_days && elements.settingDataRetention) {
    elements.settingDataRetention.value = settings.data_retention_days;
  }
  if (settings.sound !== undefined && elements.settingSound) {
    state.soundEnabled = settings.sound === 'on';
    elements.settingSound.checked = state.soundEnabled;
  }
  if (settings.posture_alert_sound !== undefined && elements.settingPostureAlertSound) {
    state.postureAlertSoundEnabled = settings.posture_alert_sound === 'on';
    elements.settingPostureAlertSound.checked = state.postureAlertSoundEnabled;
  }
  if (settings.notifications_enabled !== undefined && elements.settingNotifications) {
    state.notificationsEnabled = settings.notifications_enabled === 'on';
    elements.settingNotifications.checked = state.notificationsEnabled;
  }
  if (settings.micro_break_notifications !== undefined && elements.settingMicroNotifications) {
    state.microNotificationsEnabled = settings.micro_break_notifications === 'on';
    elements.settingMicroNotifications.checked = state.microNotificationsEnabled;
  }
  if (settings.tray_alerts_enabled !== undefined && elements.settingTrayAlerts) {
    state.trayAlertsEnabled = settings.tray_alerts_enabled === 'on';
    elements.settingTrayAlerts.checked = state.trayAlertsEnabled;
  }
  if (settings.ergo_tray_alerts !== undefined && elements.settingErgoTrayAlerts) {
    state.ergoTrayAlertsEnabled = settings.ergo_tray_alerts === 'on';
    elements.settingErgoTrayAlerts.checked = state.ergoTrayAlertsEnabled;
  }
  if (settings.reduced_motion !== undefined && elements.settingReducedMotion) {
    state.reducedMotion = settings.reduced_motion === 'on';
    elements.settingReducedMotion.checked = state.reducedMotion;
  }
  if (settings.high_contrast !== undefined && elements.settingHighContrast) {
    state.highContrast = settings.high_contrast === 'on';
    elements.settingHighContrast.checked = state.highContrast;
  }
  if (settings.lock_on_unrecognized_user !== undefined && elements.settingLockUnrecognized) {
    state.lockOnUnrecognized = settings.lock_on_unrecognized_user === 'on';
    elements.settingLockUnrecognized.checked = state.lockOnUnrecognized;
  }
  if (settings.primary_user_signature) {
    try {
      const parsedSig = JSON.parse(settings.primary_user_signature);
      if (Array.isArray(parsedSig) && parsedSig.length === 6) {
        state.enrolledFaceSignature = parsedSig;
      } else {
        state.enrolledFaceSignature = null;
      }
    } catch {
      state.enrolledFaceSignature = null;
    }
  } else {
    state.enrolledFaceSignature = null;
  }
  if (settings.screen_size_preset !== undefined) {
    state.screenSizePreset = settings.screen_size_preset;
    if (elements.settingScreenPreset) {
      elements.settingScreenPreset.value = state.screenSizePreset;
    }
  }
  if (settings.comfort_distance_cm !== undefined) {
    const parsedCm = parseInt(settings.comfort_distance_cm, 10);
    if (!isNaN(parsedCm) && parsedCm >= 35 && parsedCm <= 120) {
      state.comfortDistanceCm = parsedCm;
      if (elements.settingComfortDistance) {
        elements.settingComfortDistance.value = String(parsedCm);
      }
    }
  }

  updateFaceEnrollment();

  if (settings.selected_camera_id !== undefined) {
    state.selectedDeviceId = settings.selected_camera_id;
  }
  await loadPostureBaseline();
  if (settings.min_face_height_ratio) {
    const parsed = parseFloat(settings.min_face_height_ratio);
    if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
      state.minFaceHeightRatio = parsed;
    }
    if (elements.settingMinFaceRatio) {
      elements.settingMinFaceRatio.value = settings.min_face_height_ratio;
    }
  }
  await populateCameras();
  if (elements.settingCameraSelect) {
    elements.settingCameraSelect.value = state.selectedDeviceId;
  }

  if (elements.settingAutostart) {
    try {
      elements.settingAutostart.checked = await isEnabled();
    } catch (e) {
      console.warn('Autostart check failed:', e);
    }
  }
  await updateNotificationPermissionBadge(elements.notificationPermissionStatus);
  elements.settingsModalEl.classList.remove('hidden');
}

export function closeSettingsModal(modalEl: HTMLDivElement): void {
  modalEl.classList.add('hidden');
}

export async function persistSettings(
  elements: SettingsElements,
  state: AppSettingsState,
  loadPostureBaseline: () => Promise<void>
): Promise<{ cameraChanged: boolean }> {
  await invoke('update_setting', { key: 'work_interval_minutes', value: elements.settingWorkInterval.value });
  await invoke('update_setting', { key: 'break_interval_minutes', value: elements.settingBreakInterval.value });
  await invoke('update_setting', { key: 'grace_period_seconds', value: elements.settingGracePeriod.value });
  await invoke('update_setting', { key: 'snooze_limit', value: elements.settingSnoozeLimit.value });
  if (elements.settingSkipLimit) {
    await invoke('update_setting', { key: 'skip_limit', value: elements.settingSkipLimit.value });
  }
  await invoke('update_setting', { key: 'tracking_mode', value: elements.settingTrackingMode.value });
  if (elements.settingCvFps) {
    await invoke('update_setting', { key: 'cv_fps', value: elements.settingCvFps.value });
    state.configuredCvFps = parseInt(elements.settingCvFps.value, 10) || 2;
  }
  if (elements.settingBreakOverlay) {
    await invoke('update_setting', { key: 'break_overlay', value: elements.settingBreakOverlay.value });
    state.breakOverlayMode = elements.settingBreakOverlay.value;
  }
  if (elements.settingDataRetention) {
    await invoke('update_setting', { key: 'data_retention_days', value: elements.settingDataRetention.value });
  }
  if (elements.settingSound) {
    state.soundEnabled = elements.settingSound.checked;
    await invoke('update_setting', { key: 'sound', value: state.soundEnabled ? 'on' : 'off' });
  }
  if (elements.settingPostureAlertSound) {
    state.postureAlertSoundEnabled = elements.settingPostureAlertSound.checked;
    await invoke('update_setting', { key: 'posture_alert_sound', value: state.postureAlertSoundEnabled ? 'on' : 'off' });
  }
  if (elements.settingNotifications) {
    state.notificationsEnabled = elements.settingNotifications.checked;
    await invoke('update_setting', { key: 'notifications_enabled', value: state.notificationsEnabled ? 'on' : 'off' });
  }
  if (elements.settingMicroNotifications) {
    state.microNotificationsEnabled = elements.settingMicroNotifications.checked;
    await invoke('update_setting', { key: 'micro_break_notifications', value: state.microNotificationsEnabled ? 'on' : 'off' });
  }
  if (elements.settingTrayAlerts) {
    state.trayAlertsEnabled = elements.settingTrayAlerts.checked;
    await invoke('update_setting', { key: 'tray_alerts_enabled', value: state.trayAlertsEnabled ? 'on' : 'off' });
  }
  if (elements.settingErgoTrayAlerts) {
    state.ergoTrayAlertsEnabled = elements.settingErgoTrayAlerts.checked;
    await invoke('update_setting', { key: 'ergo_tray_alerts', value: state.ergoTrayAlertsEnabled ? 'on' : 'off' });
  }
  if (elements.settingReducedMotion) {
    state.reducedMotion = elements.settingReducedMotion.checked;
    await invoke('update_setting', { key: 'reduced_motion', value: state.reducedMotion ? 'on' : 'off' });
  }
  if (elements.settingHighContrast) {
    state.highContrast = elements.settingHighContrast.checked;
    await invoke('update_setting', { key: 'high_contrast', value: state.highContrast ? 'on' : 'off' });
  }
  if (elements.settingScreenPreset) {
    state.screenSizePreset = elements.settingScreenPreset.value;
    await invoke('update_setting', { key: 'screen_size_preset', value: state.screenSizePreset });
  }
  if (elements.settingComfortDistance) {
    const parsedCm = parseInt(elements.settingComfortDistance.value, 10);
    if (!isNaN(parsedCm) && parsedCm >= 35 && parsedCm <= 120) {
      state.comfortDistanceCm = parsedCm;
      await invoke('update_setting', { key: 'comfort_distance_cm', value: String(parsedCm) });
    }
  }

  if (elements.settingLockUnrecognized) {
    state.lockOnUnrecognized = elements.settingLockUnrecognized.checked;
    await invoke('update_setting', {
      key: 'lock_on_unrecognized_user',
      value: state.lockOnUnrecognized ? 'on' : 'off',
    });
  }
  await invoke('update_setting', {
    key: 'primary_user_signature',
    value: state.enrolledFaceSignature ? JSON.stringify(state.enrolledFaceSignature) : '',
  });

  applyAppearance(
    state.reducedMotion,
    state.highContrast,
    state.breakOverlayMode,
    state.configuredCvFps,
    elements.breakModeOverlayEl
  );

  if (elements.settingMinFaceRatio) {
    await invoke('update_setting', { key: 'min_face_height_ratio', value: elements.settingMinFaceRatio.value });
    const parsed = parseFloat(elements.settingMinFaceRatio.value);
    if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
      state.minFaceHeightRatio = parsed;
    }
  }

  const newCameraId = elements.settingCameraSelect ? elements.settingCameraSelect.value : state.selectedDeviceId;
  const cameraChanged = newCameraId !== state.selectedDeviceId;
  state.selectedDeviceId = newCameraId;
  await invoke('update_setting', { key: 'selected_camera_id', value: state.selectedDeviceId });
  if (elements.previewCameraSelect) {
    elements.previewCameraSelect.value = state.selectedDeviceId;
  }
  if (cameraChanged) {
    await loadPostureBaseline();
  }

  if (elements.settingAutostart) {
    try {
      if (elements.settingAutostart.checked) {
        await enable();
      } else {
        await disable();
      }
    } catch (e) {
      console.warn('Autostart update failed:', e);
    }
  }

  closeSettingsModal(elements.settingsModalEl);
  return { cameraChanged };
}
