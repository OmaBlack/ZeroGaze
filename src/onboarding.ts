import { invoke } from '@tauri-apps/api/core';

export interface OnboardingElements {
  onboardingModalEl: HTMLDivElement | null;
  settingTrackingMode: HTMLSelectElement | null;
  settingWorkInterval: HTMLInputElement | null;
  settingBreakInterval: HTMLInputElement | null;
}

export function openOnboarding(modalEl: HTMLDivElement | null, closeSettingsCallback?: () => void): void {
  if (!modalEl) return;
  if (closeSettingsCallback) {
    closeSettingsCallback();
  }
  modalEl.classList.remove('hidden');
}

export async function finishOnboarding(
  elements: OnboardingElements,
  useInputOnly: boolean = false,
  stopWebcamCallback?: () => void,
  resetPostureCounters?: () => void
): Promise<void> {
  try {
    if (useInputOnly) {
      if (elements.settingTrackingMode) {
        elements.settingTrackingMode.value = 'Input only';
      }
      await invoke('update_setting', { key: 'tracking_mode', value: 'Input only' });
      if (stopWebcamCallback) {
        stopWebcamCallback();
      }
    }

    const activeOnboardingPreset = document.querySelector<HTMLButtonElement>('.btn-onboarding-preset.active');
    if (activeOnboardingPreset) {
      const work = activeOnboardingPreset.dataset.work || '50';
      const breakM = activeOnboardingPreset.dataset.break || '10';
      if (elements.settingWorkInterval) elements.settingWorkInterval.value = work;
      if (elements.settingBreakInterval) elements.settingBreakInterval.value = breakM;
      await invoke('update_setting', { key: 'work_interval_minutes', value: work });
      await invoke('update_setting', { key: 'break_interval_minutes', value: breakM });
    }

    if (resetPostureCounters) {
      resetPostureCounters();
    }

    await invoke('update_setting', { key: 'onboarding_completed', value: 'true' });
    if (elements.onboardingModalEl) {
      elements.onboardingModalEl.classList.add('hidden');
    }
  } catch (err) {
    console.warn('Onboarding completion error:', err);
    if (elements.onboardingModalEl) {
      elements.onboardingModalEl.classList.add('hidden');
    }
  }
}
