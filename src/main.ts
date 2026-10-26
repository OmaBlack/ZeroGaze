import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { isPermissionGranted, requestPermission, onAction } from '@tauri-apps/plugin-notification';
import { FilesetResolver, FaceDetector } from '@mediapipe/tasks-vision';
import {
  applyAppearance,
  hydrateSettingsModal,
  closeSettingsModal,
  persistSettings,
  updateNotificationPermissionBadge,
  type SettingsElements,
  type AppSettingsState,
} from './settings';
import { openOnboarding, finishOnboarding, type OnboardingElements } from './onboarding';
import {
  formatTime,
  formatHumanDuration,
  evaluatePostureDrift,
  selectPrimaryForegroundFace,
  evaluateScreenDistance,
  DutyCycledEyeStrainEstimator,
  computeDetectionDelayMs,
  getBreakCoachStep,
  extractFaceSignature,
  verifyPrimaryUserIdentity,
  recommendComfortDistance,
  inferScreenPresetFromEnvironment,
  type FaceDetectionCandidate,
  type ScreenDistanceEvaluation,
  type ScreenSizePreset,
} from './ergonomics';
import { playBreakChime, playPostureWarningChime } from './audio';
import { renderTrendsChart, generateErgonomicReportHtml, type DailyStats } from './charts';
import { drawDetections, stopMediaStream, enumerateVideoDevices } from './camera';
export type { EyeStrainEstimate, EyeStrainEstimator } from './ergonomics';
export {
  DutyCycledEyeStrainEstimator,
  selectPrimaryForegroundFace,
  evaluateScreenDistance,
  computeDetectionDelayMs,
  getBreakCoachStep,
  extractFaceSignature,
  verifyPrimaryUserIdentity,
} from './ergonomics';

interface StateSnapshot {
  state:
    | 'Initializing'
    | 'TrackingActive'
    | 'TrackingGrace'
    | 'PausedAway'
    | 'BreakPrompt'
    | 'BreakMode'
    | 'BreakSnoozed'
    | 'BreakSkipped'
    | 'FallbackInputTracking'
    | 'CameraErrorFallback';
  active_seconds_today: number;
  present_seconds_today: number;
  current_work_seconds: number;
  work_interval_seconds: number;
  break_interval_seconds: number;
  grace_period_seconds: number;
  grace_seconds_left: number;
  break_seconds_elapsed: number;
  break_away_seconds: number;
  snoozes_used: number;
  snooze_limit: number;
  skips_today: number;
  skip_limit: number;
  compliance_pct: number;
  is_cv_present: boolean;
  cv_confidence: number;
  tracking_mode: string;
  breaks_taken_today: number;
  is_micro_break_active: boolean;
  micro_break_seconds_left: number;
  is_dnd_active: boolean;
  is_wrap_up_active: boolean;
  wrap_up_seconds_left: number;
  is_paused: boolean;
  is_too_close: boolean;
  is_slouching: boolean;
}

interface SessionRecord {
  id: string;
  start_ts: string;
  end_ts: string;
  active_seconds: number;
  present_seconds: number;
  mode: string;
  device_id: string;
}

// DOM Elements - Dashboard
const sessionTimerEl = document.getElementById('session-timer') as HTMLDivElement;
const statusPillEl = document.getElementById('status-pill') as HTMLDivElement;
const statusLabelEl = document.getElementById('status-label') as HTMLSpanElement;
const progressBarEl = document.getElementById('progress-bar') as HTMLDivElement;
const progressTextEl = document.getElementById('progress-text') as HTMLSpanElement;
const progressPctEl = document.getElementById('progress-pct') as HTMLSpanElement;
const graceBannerEl = document.getElementById('grace-banner') as HTMLDivElement;
const graceTextEl = document.getElementById('grace-text') as HTMLSpanElement;
const statActiveTodayEl = document.getElementById('stat-active-today') as HTMLDivElement;
const statPresentTodayEl = document.getElementById('stat-present-today') as HTMLSpanElement;
const statComplianceEl = document.getElementById('stat-compliance') as HTMLDivElement;
const statBreaksCountEl = document.getElementById('stat-breaks-count') as HTMLSpanElement;
const cvBadgeEl = document.getElementById('cv-badge') as HTMLSpanElement;
const statCvConfEl = document.getElementById('stat-cv-conf') as HTMLSpanElement;
const statModeEl = document.getElementById('stat-mode') as HTMLDivElement;
const statBatteryPillEl = document.getElementById('stat-battery-pill') as HTMLDivElement;
const batteryStatusTextEl = document.getElementById('battery-status-text') as HTMLSpanElement;
const btnRange7d = document.getElementById('btn-range-7d') as HTMLButtonElement;
const btnRange30d = document.getElementById('btn-range-30d') as HTMLButtonElement;
const recentSessionsListEl = document.getElementById('recent-sessions-list') as HTMLDivElement;

// DOM Elements - DND & Micro-Breaks
const btnToggleDnd = document.getElementById('btn-toggle-dnd') as HTMLButtonElement;
const microBreakToastEl = document.getElementById('micro-break-toast') as HTMLDivElement;
const microTimerEl = document.getElementById('micro-timer') as HTMLSpanElement;
const btnDismissMicro = document.getElementById('btn-dismiss-micro') as HTMLButtonElement;

// DOM Elements - Modals & Overlays
const breakModalEl = document.getElementById('break-modal') as HTMLDivElement;
const breakModeOverlayEl = document.getElementById('break-mode-overlay') as HTMLDivElement;
const breakModeTimerEl = document.getElementById('break-mode-timer') as HTMLHeadingElement;
const breakModeProgressBarEl = document.getElementById('break-mode-progress-bar') as HTMLDivElement;
const btnEndBreakEarly = document.getElementById('btn-end-break-early') as HTMLButtonElement;
const breakAwayPillEl = document.getElementById('break-away-pill') as HTMLDivElement;
const breakAwayLabelEl = document.getElementById('break-away-label') as HTMLSpanElement;
const breathingOrbEl = document.getElementById('breathing-orb') as HTMLDivElement;
const breathingPhaseTextEl = document.getElementById('breathing-phase-text') as HTMLSpanElement;
const stretchCoachTitleEl = document.getElementById('stretch-coach-title') as HTMLElement;
const stretchCoachInstructionEl = document.getElementById('stretch-coach-instruction') as HTMLParagraphElement;

const settingsModalEl = document.getElementById('settings-modal') as HTMLDivElement;
const btnOpenSettings = document.getElementById('btn-open-settings') as HTMLButtonElement;
const btnCloseSettings = document.getElementById('btn-close-settings') as HTMLButtonElement;
const btnSaveSettings = document.getElementById('btn-save-settings') as HTMLButtonElement;
const btnDeleteAllData = document.getElementById('btn-delete-all-data') as HTMLButtonElement;
const btnExportJson = document.getElementById('btn-export-json') as HTMLButtonElement;
const btnExportCsv = document.getElementById('btn-export-csv') as HTMLButtonElement;
const btnExportReportCard = document.getElementById('btn-export-report-card') as HTMLButtonElement;
const btnImportJson = document.getElementById('btn-import-json') as HTMLButtonElement;
const inputImportJson = document.getElementById('input-import-json') as HTMLInputElement;
const btnOpenPrivacyGuide = document.getElementById('btn-open-privacy-guide') as HTMLButtonElement;
const onboardingModalEl = document.getElementById('onboarding-modal') as HTMLDivElement;
const btnCloseOnboarding = document.getElementById('btn-close-onboarding') as HTMLButtonElement;
const btnCompleteOnboarding = document.getElementById('btn-complete-onboarding') as HTMLButtonElement;
const btnOnboardingInputOnly = document.getElementById('btn-onboarding-input-only') as HTMLButtonElement;
const onboardingCvStatusEl = document.getElementById('onboarding-cv-status') as HTMLSpanElement;

// Settings inputs
const settingWorkInterval = document.getElementById('setting-work-interval') as HTMLInputElement;
const settingBreakInterval = document.getElementById('setting-break-interval') as HTMLInputElement;
const settingGracePeriod = document.getElementById('setting-grace-period') as HTMLInputElement;
const settingSnoozeLimit = document.getElementById('setting-snooze-limit') as HTMLInputElement;
const settingSkipLimit = document.getElementById('setting-skip-limit') as HTMLInputElement;
const settingTrackingMode = document.getElementById('setting-tracking-mode') as HTMLSelectElement;
const settingAutostart = document.getElementById('setting-autostart') as HTMLInputElement;
const settingCameraSelect = document.getElementById('setting-camera-select') as HTMLSelectElement;
const settingMinFaceRatio = document.getElementById('setting-min-face-ratio') as HTMLSelectElement;
const settingCvFps = document.getElementById('setting-cv-fps') as HTMLSelectElement;
const settingBreakOverlay = document.getElementById('setting-break-overlay') as HTMLSelectElement;
const settingDataRetention = document.getElementById('setting-data-retention') as HTMLSelectElement;
const settingSound = document.getElementById('setting-sound') as HTMLInputElement;
const settingReducedMotion = document.getElementById('setting-reduced-motion') as HTMLInputElement;
const settingHighContrast = document.getElementById('setting-high-contrast') as HTMLInputElement;
const settingPostureAlertSound = document.getElementById('setting-posture-alert-sound') as HTMLInputElement;
const settingNotifications = document.getElementById('setting-notifications') as HTMLInputElement;
const settingMicroNotifications = document.getElementById('setting-micro-notifications') as HTMLInputElement;
const settingTrayAlerts = document.getElementById('setting-tray-alerts') as HTMLInputElement;
const settingErgoTrayAlerts = document.getElementById('setting-ergo-tray-alerts') as HTMLInputElement;
const btnTestNotification = document.getElementById('btn-test-notification') as HTMLButtonElement;
const notificationPermissionStatus = document.getElementById('notification-permission-status') as HTMLSpanElement;
const settingLockUnrecognized = document.getElementById('setting-lock-unrecognized') as HTMLInputElement;
const settingScreenPreset = document.getElementById('setting-screen-preset') as HTMLSelectElement;
const settingComfortDistance = document.getElementById('setting-comfort-distance') as HTMLInputElement;
const screenDetectedNote = document.getElementById('screen-detected-note') as HTMLElement;
const comfortRecommendationText = document.getElementById('comfort-recommendation-text') as HTMLElement;
const btnApplyRecommendedDistance = document.getElementById('btn-apply-recommended-distance') as HTMLButtonElement;
const btnEnrollFace = document.getElementById('btn-enroll-face') as HTMLButtonElement;
const btnClearFace = document.getElementById('btn-clear-face') as HTMLButtonElement;
const faceEnrollStatusEl = document.getElementById('face-enroll-status') as HTMLSpanElement;
const previewCameraSelect = document.getElementById('preview-camera-select') as HTMLSelectElement;

let selectedDeviceId: string = '';
let minFaceHeightRatio: number = 0.12;
let configuredCvFps = 2;
let soundEnabled = true;
let postureAlertSoundEnabled = true;
let notificationsEnabled = true;
let microNotificationsEnabled = true;
let trayAlertsEnabled = true;
let ergoTrayAlertsEnabled = true;
let comfortDistanceCm: number = 65;
let screenSizePreset: ScreenSizePreset = 'desktop_monitor';
let breakOverlayMode = 'full-screen';
let reducedMotion = false;
let highContrast = false;
let enrolledFaceSignature: number[] | null = null;
let lastObservedSignature: number[] | null = null;
let lockOnUnrecognized = false;
let identityMismatchCounter = 0;
let isUnrecognizedUserVisible = false;
let lastRenderedState: string = 'Initializing';

function updateFaceEnrollmentUI(customMessage?: string, isError: boolean = false): void {
  const isEnrolled = Array.isArray(enrolledFaceSignature) && enrolledFaceSignature.length === 6;
  if (btnEnrollFace) {
    btnEnrollFace.textContent = isEnrolled ? 'Re-Enroll My Face (Enrolled ✓)' : 'Enroll My Face';
  }
  if (btnClearFace) {
    btnClearFace.disabled = !isEnrolled;
  }
  if (faceEnrollStatusEl) {
    if (customMessage) {
      faceEnrollStatusEl.textContent = customMessage;
      faceEnrollStatusEl.style.color = isError ? '#f87171' : '#34d399';
    } else if (isEnrolled) {
      faceEnrollStatusEl.textContent = 'Enrolled ✓ — Primary user geometric signature active (zero images stored)';
      faceEnrollStatusEl.style.color = '#34d399';
    } else {
      faceEnrollStatusEl.textContent = 'Not enrolled — any foreground face is tracked';
      faceEnrollStatusEl.style.color = '';
    }
  }
}

// Controls
const btnTogglePause = document.getElementById('btn-toggle-pause') as HTMLButtonElement;
const iconPause = document.getElementById('icon-pause') as unknown as SVGElement;
const iconPlay = document.getElementById('icon-play') as unknown as SVGElement;
const btnTakeBreak = document.getElementById('btn-take-break') as HTMLButtonElement;
const btnFinishBreak = document.getElementById('btn-finish-break') as HTMLButtonElement;
const btnWrapUpBreak = document.getElementById('btn-wrap-up-break') as HTMLButtonElement;
const btnSnoozeBreak = document.getElementById('btn-snooze-break') as HTMLButtonElement;
const btnSkipBreak = document.getElementById('btn-skip-break') as HTMLButtonElement;

// Posture & Viewing Distance Tracking Elements
const distancePillEl = document.getElementById('distance-pill') as HTMLDivElement;
const distanceLabelEl = document.getElementById('distance-label') as HTMLSpanElement;
const posturePillEl = document.getElementById('posture-pill') as HTMLDivElement;
const postureLabelEl = document.getElementById('posture-label') as HTMLSpanElement;
const ergoAlertBannerEl = document.getElementById('ergo-alert-banner') as HTMLDivElement;
const ergoAlertTitleEl = document.getElementById('ergo-alert-title') as HTMLElement;
const ergoAlertTextEl = document.getElementById('ergo-alert-text') as HTMLSpanElement;
const btnCalibratePosture = document.getElementById('btn-calibrate-posture') as HTMLButtonElement;
const postureCalibrateStatusEl = document.getElementById('posture-calibrate-status') as HTMLSpanElement;

// Ergonomic Posture & Distance Tracking State
let baselineFaceY: number | null = null;
let baselineFaceHeight: number | null = null;
let slouchCounter: number = 0;
let tooCloseCounter: number = 0;
let isCurrentSlouching: boolean = false;
let currentDistEval: ScreenDistanceEvaluation | null = null;
let lastErgoAlertAudioTs: number = 0;

function getCameraPostureKeys(): { keyY: string; keyH: string } {
  const safeId = (selectedDeviceId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return {
    keyY: `posture_baseline_y_${safeId}`,
    keyH: `posture_baseline_height_${safeId}`,
  };
}

async function loadCameraPostureBaseline(): Promise<void> {
  try {
    const settings = await invoke<Record<string, string>>('get_settings');
    const { keyY, keyH } = getCameraPostureKeys();
    const valY = settings[keyY] || settings['posture_baseline_y'];
    const valH = settings[keyH] || settings['posture_baseline_height'];

    if (valY && valH) {
      const py = parseFloat(valY);
      const ph = parseFloat(valH);
      if (!isNaN(py) && !isNaN(ph) && py > 0 && ph > 20) {
        baselineFaceY = py;
        baselineFaceHeight = ph;
      } else {
        baselineFaceY = null;
        baselineFaceHeight = null;
      }
    } else {
      baselineFaceY = null;
      baselineFaceHeight = null;
    }
  } catch {
    // Keep current baseline or null
  }
  slouchCounter = 0;
  tooCloseCounter = 0;
  updatePostureCalibrationUI();
}

function updatePostureCalibrationUI(customMessage?: string, isError: boolean = false): void {
  const isCalibrated = baselineFaceY !== null && baselineFaceHeight !== null && baselineFaceHeight > 0;
  if (btnCalibratePosture) {
    btnCalibratePosture.textContent = isCalibrated
      ? 'Recalibrate Posture & Distance (Calibrated ✓)'
      : 'Calibrate Posture & Distance';
  }
  if (postureCalibrateStatusEl) {
    if (customMessage) {
      postureCalibrateStatusEl.textContent = customMessage;
      postureCalibrateStatusEl.style.color = isError ? '#f87171' : '#34d399';
    } else if (isCalibrated) {
      const camLabel = selectedDeviceId ? 'selected camera' : 'default camera';
      postureCalibrateStatusEl.textContent = `Calibrated ✓ — Upright baseline locked for ${camLabel}`;
      postureCalibrateStatusEl.style.color = '#34d399';
    } else {
      postureCalibrateStatusEl.textContent = 'Auto-calibrates on upright desk presence (~60 cm reference)';
      postureCalibrateStatusEl.style.color = '';
    }
  }
}

function updateComfortRecommendationUI(): void {
  const detectedPreset = inferScreenPresetFromEnvironment(
    window.screen?.width || 1920,
    window.screen?.height || 1080,
    window.devicePixelRatio || 1
  );
  const rec = recommendComfortDistance(screenSizePreset === 'custom' ? comfortDistanceCm : screenSizePreset);
  const detectedRec = recommendComfortDistance(detectedPreset);

  if (screenDetectedNote) {
    screenDetectedNote.textContent = `Auto-detected display: ${detectedRec.diagonalInchesLabel} (recommends ~${detectedRec.recommendedComfortCm} cm)`;
  }

  if (comfortRecommendationText) {
    comfortRecommendationText.textContent = `Recommended: ~${rec.recommendedComfortCm} cm for ${rec.diagonalInchesLabel} (Safe min: ${rec.minSafeCm} cm • Max comfort: ${rec.maxComfortCm} cm).`;
  }

  if (settingScreenPreset) {
    settingScreenPreset.value = screenSizePreset;
  }
  if (settingComfortDistance) {
    settingComfortDistance.value = String(comfortDistanceCm);
  }
}

function updateErgonomicAlerts(): void {
  const isTooClose = currentDistEval?.isTooCloseWarning === true;
  const isSlouch = isCurrentSlouching;
  const targetCm = currentDistEval?.comfortDistanceCm || comfortDistanceCm || 65;

  if (isTooClose || isSlouch) {
    if (ergoAlertBannerEl && ergoAlertTitleEl && ergoAlertTextEl) {
      ergoAlertBannerEl.classList.remove('hidden');
      if (isTooClose && isSlouch) {
        ergoAlertTitleEl.textContent = 'Too Close & Slouching Detected';
        ergoAlertTextEl.textContent = `Move back (~${currentDistEval?.estimatedCm || 40} cm, target ~${targetCm} cm) and sit upright with aligned shoulders.`;
      } else if (isTooClose) {
        ergoAlertTitleEl.textContent = 'Too Close to Screen';
        ergoAlertTextEl.textContent = `You are ~${currentDistEval?.estimatedCm || 40} cm away. Move back toward your ~${targetCm} cm comfort distance to protect your eyes.`;
      } else {
        ergoAlertTitleEl.textContent = 'Poor Desk Posture Detected';
        ergoAlertTextEl.textContent = 'Head has dropped below your calibrated ergonomic baseline. Lift your chest and align your neck.';
      }
    }
    lastErgoAlertAudioTs = playPostureWarningChime(postureAlertSoundEnabled, lastErgoAlertAudioTs);
  } else {
    if (ergoAlertBannerEl) {
      ergoAlertBannerEl.classList.add('hidden');
    }
  }
}

function updatePostureUI(isSlouching: boolean, isPresent: boolean = true) {
  isCurrentSlouching = isSlouching;
  if (!posturePillEl || !postureLabelEl) return;
  if (!isPresent) {
    isCurrentSlouching = false;
    posturePillEl.className = 'posture-pill posture-aligned';
    postureLabelEl.textContent = 'Posture: —';
    posturePillEl.title = 'Desk Posture: Waiting for foreground user presence';
    updateErgonomicAlerts();
    return;
  }
  if (isSlouching) {
    posturePillEl.className = 'posture-pill posture-slouch posture-slouch-active';
    postureLabelEl.textContent = 'Check Posture';
    posturePillEl.title = 'Desk Posture: Slouching detected. Sit tall and align shoulders.';
  } else {
    posturePillEl.className = 'posture-pill posture-aligned';
    postureLabelEl.textContent = 'Aligned';
    posturePillEl.title = 'Desk Posture: Aligned';
  }
  updateErgonomicAlerts();
}

function updateDistanceUI(distEval: ScreenDistanceEvaluation | null) {
  currentDistEval = distEval;
  if (!distancePillEl || !distanceLabelEl) return;
  if (!distEval) {
    distancePillEl.className = 'posture-pill posture-aligned';
    distanceLabelEl.textContent = 'Distance: —';
    distancePillEl.title = 'Viewing Distance: Waiting for foreground user presence';
    updateErgonomicAlerts();
    return;
  }
  const targetCm = distEval.comfortDistanceCm || comfortDistanceCm || 65;
  if (distEval.isTooCloseWarning || distEval.status === 'too_close') {
    const isLoud = distEval.isTooCloseWarning;
    distancePillEl.className = isLoud ? 'posture-pill posture-slouch posture-slouch-active' : 'posture-pill posture-slouch';
    distanceLabelEl.textContent = `Too Close (~${distEval.estimatedCm} cm)`;
    distancePillEl.title = `Viewing Distance: ~${distEval.estimatedCm} cm. Move back toward your ~${targetCm} cm comfort distance to reduce eye strain.`;
  } else if (distEval.status === 'too_far') {
    distancePillEl.className = 'posture-pill posture-aligned';
    distanceLabelEl.textContent = `~${distEval.estimatedCm} cm (Far)`;
    distancePillEl.title = `Viewing Distance: ~${distEval.estimatedCm} cm (Target: ~${targetCm} cm).`;
  } else {
    distancePillEl.className = 'posture-pill posture-aligned';
    distanceLabelEl.textContent = `~${distEval.estimatedCm} cm`;
    distancePillEl.title = `Viewing Distance: ~${distEval.estimatedCm} cm (Comfort Target: ~${targetCm} cm)`;
  }
  updateErgonomicAlerts();
}

// Preview & Diagnostics Elements
const togglePreviewEl = document.getElementById('toggle-preview') as HTMLDivElement;
const previewToggleBtn = document.getElementById('preview-toggle-btn') as HTMLButtonElement;
const previewContainerEl = document.getElementById('preview-container') as HTMLDivElement;
const videoEl = document.getElementById('webcam') as HTMLVideoElement;
const canvasEl = document.getElementById('canvas-overlay') as HTMLCanvasElement;
const camResolutionEl = document.getElementById('cam-resolution') as HTMLSpanElement;

let faceDetector: FaceDetector | null = null;
let isPreviewOpen = false;
let isDetectionRunning = false;
let isTrackingPaused = false;
let isDndActive = false;

// Battery monitoring
interface BatteryManager {
  charging: boolean;
  level: number;
  addEventListener(type: string, listener: () => void): void;
}
let currentBattery: BatteryManager | null = null;

function stopWebcamTracks(): void {
  stopMediaStream(videoEl);
}

function applyAppearanceSettings(): void {
  applyAppearance(
    reducedMotion,
    highContrast,
    breakOverlayMode,
    configuredCvFps,
    breakModeOverlayEl
  );
}

// Update UI based on StateSnapshot
function renderState(snapshot: StateSnapshot) {
  if (lastRenderedState !== 'BreakPrompt' && snapshot.state === 'BreakPrompt') {
    playBreakChime('prompt', soundEnabled);
  } else if (lastRenderedState === 'BreakMode' && snapshot.state === 'TrackingActive') {
    playBreakChime('complete', soundEnabled);
  }
  lastRenderedState = snapshot.state;

  const wasPaused = isTrackingPaused;
  isTrackingPaused = snapshot.is_paused;
  iconPause.classList.toggle('hidden', isTrackingPaused);
  iconPlay.classList.toggle('hidden', !isTrackingPaused);

  isDndActive = snapshot.is_dnd_active;
  if (btnToggleDnd) {
    btnToggleDnd.classList.toggle('active-dnd', isDndActive);
    const bellOn = document.getElementById('icon-bell-on');
    const bellOff = document.getElementById('icon-bell-off');
    if (bellOn && bellOff) {
      bellOn.classList.toggle('hidden', isDndActive);
      bellOff.classList.toggle('hidden', !isDndActive);
    }
  }

  // Micro-Break Toast
  if (snapshot.is_micro_break_active) {
    microBreakToastEl.classList.remove('hidden');
    microTimerEl.textContent = `${snapshot.micro_break_seconds_left}s`;
  } else {
    microBreakToastEl.classList.add('hidden');
  }

  // Break Mode Overlay & Timer display
  if (snapshot.state === 'BreakMode') {
    breakModeOverlayEl.classList.remove('hidden');
    breakModalEl.classList.add('hidden');

    const remaining = Math.max(0, snapshot.break_interval_seconds - snapshot.break_seconds_elapsed);
    breakModeTimerEl.textContent = formatTime(remaining);

    const coachStep = getBreakCoachStep(snapshot.break_seconds_elapsed);
    if (breathingOrbEl && breathingPhaseTextEl) {
      breathingOrbEl.className = `breathing-orb breath-${coachStep.breathPhase.toLowerCase()}`;
      breathingPhaseTextEl.textContent = `${coachStep.breathPhase} (${coachStep.breathPhaseSecondsLeft}s)`;
    }
    if (stretchCoachTitleEl && stretchCoachInstructionEl) {
      stretchCoachTitleEl.textContent = coachStep.stretchTitle;
      stretchCoachInstructionEl.textContent = coachStep.stretchInstruction;
    }
    if (breakAwayPillEl && breakAwayLabelEl) {
      const awaySecs = snapshot.break_away_seconds || 0;
      if (!snapshot.is_cv_present) {
        breakAwayPillEl.className = 'posture-pill posture-aligned';
        breakAwayLabelEl.textContent = `Away from desk • ${formatTime(awaySecs)} rested`;
      } else {
        breakAwayPillEl.className = 'posture-pill posture-slouch';
        breakAwayLabelEl.textContent = `At desk • Step away for deeper eye rest (${formatTime(awaySecs)} away)`;
      }
    }

    const breakPct = snapshot.break_interval_seconds > 0
      ? Math.min(100, Math.round((snapshot.break_seconds_elapsed / snapshot.break_interval_seconds) * 100))
      : 0;
    breakModeProgressBarEl.style.width = `${breakPct}%`;

    sessionTimerEl.textContent = formatTime(snapshot.break_seconds_elapsed);
  } else {
    breakModeOverlayEl.classList.add('hidden');
    sessionTimerEl.textContent = formatTime(snapshot.current_work_seconds);
  }

  // Progress Bar
  const workTarget = snapshot.work_interval_seconds || 3000;
  const pct = Math.min(100, Math.round((snapshot.current_work_seconds / workTarget) * 100));
  progressBarEl.style.width = `${pct}%`;
  progressPctEl.textContent = `${pct}%`;
  progressTextEl.textContent = `Focus interval: ${Math.floor(snapshot.current_work_seconds / 60)}m / ${Math.floor(workTarget / 60)}m`;

  // Status Pill
  statusPillEl.className = 'status-pill';
  switch (snapshot.state) {
    case 'TrackingActive':
      statusPillEl.classList.add('status-active');
      statusLabelEl.textContent = 'Active • Present';
      break;
    case 'TrackingGrace':
      statusPillEl.classList.add('status-grace');
      statusLabelEl.textContent = 'Grace Period';
      break;
    case 'PausedAway':
      statusPillEl.classList.add('status-away');
      statusLabelEl.textContent = 'Paused • Away';
      break;
    case 'BreakPrompt':
      statusPillEl.classList.add('status-break');
      statusLabelEl.textContent = 'Break Prompt';
      break;
    case 'BreakMode':
      statusPillEl.classList.add('status-breakmode');
      statusLabelEl.textContent = 'Break Mode';
      break;
    case 'FallbackInputTracking':
      statusPillEl.classList.add('status-fallback');
      statusLabelEl.textContent = 'Fallback (Input)';
      break;
    default:
      statusLabelEl.textContent = snapshot.state;
  }

  if (snapshot.is_paused) {
    statusPillEl.className = 'status-pill status-away';
    statusLabelEl.textContent = 'Paused • Manual';
  }

  if (distancePillEl && posturePillEl) {
    const isInputOnly = snapshot.tracking_mode === 'Input only';
    distancePillEl.classList.toggle('hidden', isInputOnly);
    posturePillEl.classList.toggle('hidden', isInputOnly);
    if (snapshot.is_paused || isInputOnly) {
      updatePostureUI(false, false);
      updateDistanceUI(null);
    }
  }

  if (snapshot.is_paused || snapshot.tracking_mode === 'Input only') {
    stopWebcamTracks();
  } else if (wasPaused && !snapshot.is_paused && snapshot.tracking_mode !== 'Input only') {
    startWebcam(selectedDeviceId);
  }

  // Grace Period Banner
  if (snapshot.state === 'TrackingGrace') {
    graceBannerEl.classList.remove('hidden');
    graceTextEl.textContent = `Presence lost. Grace period: ${snapshot.grace_seconds_left}s remaining before pausing.`;
  } else {
    graceBannerEl.classList.add('hidden');
  }

  // Break Prompt Modal
  if (snapshot.state === 'BreakPrompt') {
    breakModalEl.classList.remove('hidden');
    if (btnWrapUpBreak) {
      if (snapshot.is_wrap_up_active) {
        btnWrapUpBreak.textContent = `Wrapping Up (${snapshot.wrap_up_seconds_left}s)`;
        btnWrapUpBreak.disabled = true;
      } else {
        btnWrapUpBreak.textContent = 'Wrap Up (2m)';
        btnWrapUpBreak.disabled = false;
      }
    }
    const snoozesLeft = Math.max(0, snapshot.snooze_limit - snapshot.snoozes_used);
    btnSnoozeBreak.textContent = snoozesLeft > 0 ? `Snooze (5m • ${snoozesLeft} left)` : 'Snooze Limit Reached';
    btnSnoozeBreak.disabled = snoozesLeft === 0;

    const skipsLeft = Math.max(0, snapshot.skip_limit - snapshot.skips_today);
    btnSkipBreak.textContent = skipsLeft > 0 ? `Skip Break (${skipsLeft} left)` : 'Skip Break (Over Limit)';
  } else {
    breakModalEl.classList.add('hidden');
  }

  // Stats Grid
  statActiveTodayEl.textContent = formatHumanDuration(snapshot.active_seconds_today);
  if (statPresentTodayEl) {
    statPresentTodayEl.textContent = `Present: ${formatHumanDuration(snapshot.present_seconds_today)} • Engaged`;
  }
  statComplianceEl.textContent = `${Math.round(snapshot.compliance_pct)}%`;
  statBreaksCountEl.textContent = `${snapshot.breaks_taken_today || 0} taken • ${snapshot.skips_today} skipped`;

  // CV Status
  if (snapshot.tracking_mode === 'Input only') {
    cvBadgeEl.textContent = 'Camera Off (Input Mode)';
    cvBadgeEl.style.color = '#94a3b8';
    cvBadgeEl.style.background = 'rgba(148, 163, 184, 0.15)';
    statCvConfEl.textContent = 'Using mouse & keyboard idle';
  } else if (isUnrecognizedUserVisible) {
    cvBadgeEl.textContent = 'Unrecognized User';
    cvBadgeEl.style.color = '#f87171';
    cvBadgeEl.style.background = 'rgba(248, 113, 113, 0.15)';
    statCvConfEl.textContent = lockOnUnrecognized
      ? `Locking PC in ${Math.max(0, 6 - identityMismatchCounter)} ticks...`
      : 'Focus timer paused (Not Primary User)';
  } else if (snapshot.state === 'FallbackInputTracking' && snapshot.tracking_mode === 'Auto') {
    cvBadgeEl.textContent = 'Input Fallback (Low Light / No Face)';
    cvBadgeEl.style.color = '#38bdf8';
    cvBadgeEl.style.background = 'rgba(56, 189, 248, 0.15)';
    statCvConfEl.textContent = 'Active via keyboard & mouse — camera standing by';
  } else if (snapshot.is_cv_present) {
    cvBadgeEl.textContent = 'User Present';
    cvBadgeEl.style.color = '#4ade80';
    cvBadgeEl.style.background = 'rgba(34, 197, 94, 0.15)';
    statCvConfEl.textContent = `Confidence: ${(snapshot.cv_confidence * 100).toFixed(0)}% • Ocular Comfort: ${eyeStrainSpike.getEstimate().fatigueScore > 0.7 ? 'Rest Soon' : 'Optimal'}`;
  } else {
    cvBadgeEl.textContent = 'No Face Detected';
    cvBadgeEl.style.color = '#facc15';
    cvBadgeEl.style.background = 'rgba(234, 179, 8, 0.15)';
    statCvConfEl.textContent = 'Waiting for presence...';
  }

  statModeEl.textContent = snapshot.tracking_mode || 'Auto (CV)';

  if (onboardingCvStatusEl) {
    onboardingCvStatusEl.textContent =
      snapshot.tracking_mode === 'Input only'
        ? 'Input Mode Active (Camera Off)'
        : snapshot.is_cv_present
          ? 'We can see you! (~60 cm baseline ready)'
          : 'Waiting for face detection...';
  }
}

// Battery state listener
function initBatteryMonitor() {
  if ('getBattery' in navigator) {
    (navigator as unknown as { getBattery: () => Promise<BatteryManager> }).getBattery().then((battery) => {
      currentBattery = battery;
      const updateBatteryUI = () => {
        if (!statBatteryPillEl || !batteryStatusTextEl) return;
        if (!battery.charging) {
          statBatteryPillEl.classList.remove('hidden');
          const pct = Math.round(battery.level * 100);
          batteryStatusTextEl.textContent = battery.level < 0.2
            ? `Low Battery (${pct}%) • Low Power`
            : `Battery Saver (${pct}%) • 0.5 FPS`;
        } else {
          statBatteryPillEl.classList.add('hidden');
        }
      };
      updateBatteryUI();
      battery.addEventListener('chargingchange', updateBatteryUI);
      battery.addEventListener('levelchange', updateBatteryUI);
    }).catch((e) => {
      console.warn('Battery API not available:', e);
    });
  }
}

// MediaPipe Local Initialization
async function initMediaPipe(): Promise<void> {
  try {
    cvBadgeEl.textContent = 'Loading AI Model...';

    // 100% Local Wasm & Model assets
    const vision = await FilesetResolver.forVisionTasks('/wasm');
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: '/models/blaze_face_short_range.tflite',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
    });

    cvBadgeEl.textContent = 'Model Ready';
    if (settingTrackingMode?.value !== 'Input only' && !isTrackingPaused) {
      startWebcam();
    }
  } catch (err: unknown) {
    console.error('Failed to initialize local MediaPipe:', err);
    cvBadgeEl.textContent = 'CV Unavailable';
    const msg = err instanceof Error ? err.message : String(err);
    await invoke('report_camera_error', { error: msg });
  }
}

// Enumerate video devices and populate select dropdowns
async function populateCameraDevices(): Promise<void> {
  const videoDevices = await enumerateVideoDevices();

  const syncSelect = (selectEl: HTMLSelectElement) => {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default Camera';
    selectEl.appendChild(defaultOpt);

    videoDevices.forEach((dev, idx) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Camera ${idx + 1}`;
      if (dev.deviceId === selectedDeviceId) {
        opt.selected = true;
      }
      selectEl.appendChild(opt);
    });

    if (!videoDevices.some((d) => d.deviceId === selectedDeviceId)) {
      defaultOpt.selected = true;
    }
  };

  syncSelect(settingCameraSelect);
  syncSelect(previewCameraSelect);
}

// Start Webcam & Local Detection Loop with optional deviceId
async function startWebcam(deviceId?: string): Promise<void> {
  if (deviceId !== undefined) {
    selectedDeviceId = deviceId;
  }

  // Stop any active media tracks before switching to prevent camera device busy locks
  stopWebcamTracks();

  try {
    const videoConstraints: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 },
    };

    if (selectedDeviceId) {
      videoConstraints.deviceId = { exact: selectedDeviceId };
    } else {
      videoConstraints.facingMode = 'user';
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: false,
    });

    videoEl.srcObject = stream;
    await videoEl.play();

    camResolutionEl.textContent = `Resolution: ${videoEl.videoWidth}x${videoEl.videoHeight}`;

    // Re-populate devices once camera access is granted (labels are now unmasked)
    await populateCameraDevices();

    // Load posture baseline calibrated for this specific camera
    await loadCameraPostureBaseline();

    // Start detection loop
    if (!isDetectionRunning) {
      isDetectionRunning = true;
      runDetectionLoop();
    }
  } catch (err: unknown) {
    console.error('Camera access denied or hardware error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    cvBadgeEl.textContent = 'Camera Blocked';
    await invoke('report_camera_error', { error: msg });
  }
}

// Detection Loop with dynamic battery throttling
async function runDetectionLoop() {
  let nextDelay = 500;
  try {
    if (isTrackingPaused) {
      return;
    }

    try {
      nextDelay = computeDetectionDelayMs(
        configuredCvFps,
        Boolean(currentBattery && !currentBattery.charging),
        currentBattery?.level ?? 1.0
      );
    } catch {
      nextDelay = Math.max(200, Math.round(1000 / configuredCvFps));
    }

    if (!faceDetector || !videoEl || videoEl.readyState < 2) {
      return;
    }

    const now = performance.now();
    const result = faceDetector.detectForVideo(videoEl, now);

    const detections = result.detections || [];
    const frameW = videoEl.videoWidth || 640;
    const frameH = videoEl.videoHeight || 480;
    const { primary, ignoredBackground } = selectPrimaryForegroundFace(
      detections as FaceDetectionCandidate[],
      frameW,
      frameH,
      minFaceHeightRatio
    );

    let present = primary !== null;
    const confidence = present ? primary?.categories?.[0]?.score || 0.8 : 0.0;
    // Background faces are ignored; multiFace is false when a single primary user is isolated
    const multiFace = false;

    if (primary) {
      const currentSig = extractFaceSignature(primary, frameW, frameH);
      if (currentSig) {
        lastObservedSignature = currentSig;
      }
      const idCheck = verifyPrimaryUserIdentity(currentSig, enrolledFaceSignature, identityMismatchCounter);
      identityMismatchCounter = idCheck.nextMismatchCounter;
      if (!idCheck.isRecognized) {
        present = false;
        isUnrecognizedUserVisible = true;
        cvBadgeEl.textContent = 'Unrecognized User';
        statCvConfEl.textContent = lockOnUnrecognized
          ? `Locking PC in ${Math.max(0, 6 - identityMismatchCounter)} ticks...`
          : 'Focus timer paused (Not Primary User)';
        if (lockOnUnrecognized && idCheck.shouldLock) {
          identityMismatchCounter = 0;
          try {
            const lockedSnap = await invoke<StateSnapshot>('lock_workstation');
            renderState(lockedSnap);
          } catch (lockErr) {
            console.warn('Workstation lock failed:', lockErr);
          }
        }
      } else {
        isUnrecognizedUserVisible = false;
      }
    } else {
      isUnrecognizedUserVisible = false;
      identityMismatchCounter = 0;
    }

    // Posture slouch drift & PC viewing distance detection on primary foreground face only
    if (present && primary?.boundingBox) {
      const box = primary.boundingBox;
      const centerY = box.originY + box.height / 2;
      if (baselineFaceY === null || baselineFaceHeight === null) {
        baselineFaceY = centerY;
        baselineFaceHeight = box.height;
        slouchCounter = 0;
        tooCloseCounter = 0;
        updatePostureUI(false, true);
        updatePostureCalibrationUI();
        const { keyY, keyH } = getCameraPostureKeys();
        const yVal = String(Math.round(baselineFaceY * 100) / 100);
        const hVal = String(Math.round(baselineFaceHeight * 100) / 100);
        void invoke('update_setting', { key: keyY, value: yVal }).catch(() => {});
        void invoke('update_setting', { key: keyH, value: hVal }).catch(() => {});
        void invoke('update_setting', { key: 'posture_baseline_y', value: yVal }).catch(() => {});
        void invoke('update_setting', { key: 'posture_baseline_height', value: hVal }).catch(() => {});
      } else {
        const drift = evaluatePostureDrift(centerY, baselineFaceY, baselineFaceHeight, slouchCounter, box.height);
        slouchCounter = drift.nextCounter;
        updatePostureUI(drift.isSlouching, true);
      }

      const distEval = evaluateScreenDistance(box.height, frameH, baselineFaceHeight, tooCloseCounter, comfortDistanceCm);
      tooCloseCounter = distEval.nextTooCloseCounter;
      updateDistanceUI(distEval);
    } else {
      slouchCounter = 0;
      tooCloseCounter = 0;
      updatePostureUI(false, false);
      updateDistanceUI(null);
    }

    const isTooClose = currentDistEval?.isTooCloseWarning === true;
    const isSlouch = isCurrentSlouching === true;

    // Send derived presence state to Rust backend
    const snapshot = await invoke<StateSnapshot>('update_presence', {
      present,
      confidence,
      multiFace,
      isTooClose,
      isSlouching: isSlouch,
    });

    renderState(snapshot);

    // Draw visual feedback on canvas if user toggled preview
    if (isPreviewOpen) {
      drawDetections(canvasEl, videoEl, primary, ignoredBackground);
    }
  } catch (err) {
    console.warn('Detection tick error:', err);
  } finally {
    const delay = isTrackingPaused ? 1000 : nextDelay;
    setTimeout(runDetectionLoop, delay);
  }
}

let selectedTrendDays = 7;

// Habit & Compliance Trends Chart + Recent Sessions Log
async function refreshTrendsChart() {
  try {
    const recentStats = await invoke<DailyStats[]>('get_recent_stats', { days: selectedTrendDays });
    const svg = document.getElementById('trend-chart') as unknown as SVGSVGElement | null;
    const footer = document.getElementById('trends-footer-labels') as HTMLDivElement | null;
    const streakBadge = document.getElementById('streak-badge') as HTMLSpanElement | null;
    renderTrendsChart(svg, footer, streakBadge, recentStats);
  } catch (err) {
    console.warn('Failed to load recent stats for chart:', err);
  }

  if (recentSessionsListEl) {
    try {
      const sessions = await invoke<SessionRecord[]>('get_recent_sessions', { limit: 5 });
      if (sessions.length === 0) {
        recentSessionsListEl.innerHTML =
          '<span class="text-dim text-sm">Complete a focus session or break to see session logs.</span>';
      } else {
        recentSessionsListEl.innerHTML = sessions
          .map((s) => {
            const endDate = new Date(s.end_ts);
            const timeLabel = isNaN(endDate.getTime())
              ? s.end_ts
              : endDate.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
            const modeLabel = s.mode === 'fallback_input' ? 'Input' : 'Webcam CV';
            return `<div class="session-log-item">
              <span>${timeLabel}</span>
              <span><strong>${formatHumanDuration(s.active_seconds)}</strong> active (${modeLabel})</span>
            </div>`;
          })
          .join('');
      }
    } catch (err) {
      console.warn('Failed to load recent sessions:', err);
    }
  }
}

// Data Export Handler
async function exportData(format: 'json' | 'csv') {
  try {
    const content = await invoke<string>(format === 'json' ? 'export_data_json' : 'export_data_csv');
    const mimeType = format === 'json' ? 'application/json' : 'text/csv';
    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `zerogaze-export-${dateStr}.${format}`;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${String(err)}`);
  }
}

// Plan 012: Export Weekly Ergonomic Report Card (Self-Contained HTML/SVG)
async function exportErgonomicReport() {
  try {
    const stats = await invoke<DailyStats[]>('get_recent_stats', { days: 7 });
    const today = new Date().toISOString().split('T')[0];
    const htmlContent = generateErgonomicReportHtml(stats, today);

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zerogaze-ergonomic-report-${today}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Report generation failed: ${String(err)}`);
  }
}

// Plan 012: Automated OS Presentation / Meeting Detection
let manualDndOverride = false;

async function checkPresentationState() {
  try {
    const isOsPres = await invoke<boolean>('check_os_presentation_mode');
    if (isOsPres && !isDndActive && !manualDndOverride) {
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: true });
      renderState(snapshot);
    } else if (!isOsPres && isDndActive && !manualDndOverride) {
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: false });
      renderState(snapshot);
    }
  } catch {
    // Graceful fallback if platform does not support presentation query
  }
}

export const eyeStrainSpike = new DutyCycledEyeStrainEstimator(true);

async function updateNotificationPermissionUI(): Promise<void> {
  await updateNotificationPermissionBadge(notificationPermissionStatus);
}

function getSettingsElements(): SettingsElements {
  return {
    settingsModalEl,
    settingWorkInterval,
    settingBreakInterval,
    settingGracePeriod,
    settingSnoozeLimit,
    settingSkipLimit,
    settingTrackingMode,
    settingAutostart,
    settingCameraSelect,
    previewCameraSelect,
    settingMinFaceRatio,
    settingCvFps,
    settingBreakOverlay,
    settingDataRetention,
    settingSound,
    settingReducedMotion,
    settingHighContrast,
    settingPostureAlertSound,
    settingNotifications,
    settingMicroNotifications,
    settingTrayAlerts,
    settingErgoTrayAlerts,
    settingLockUnrecognized,
    settingScreenPreset,
    settingComfortDistance,
    screenDetectedNote,
    comfortRecommendationText,
    btnApplyRecommendedDistance,
    notificationPermissionStatus,
    breakModeOverlayEl,
  };
}

function getAppSettingsState(): AppSettingsState {
  return {
    selectedDeviceId,
    minFaceHeightRatio,
    configuredCvFps,
    soundEnabled,
    postureAlertSoundEnabled,
    notificationsEnabled,
    microNotificationsEnabled,
    trayAlertsEnabled,
    ergoTrayAlertsEnabled,
    comfortDistanceCm,
    screenSizePreset,
    breakOverlayMode,
    reducedMotion,
    highContrast,
    enrolledFaceSignature,
    lockOnUnrecognized,
  };
}

function getOnboardingElements(): OnboardingElements {
  return {
    onboardingModalEl,
    settingTrackingMode,
    settingWorkInterval,
    settingBreakInterval,
  };
}

// Settings handlers
async function openSettings() {
  try {
    const appState = getAppSettingsState();
    await hydrateSettingsModal(
      getSettingsElements(),
      appState,
      populateCameraDevices,
      loadCameraPostureBaseline,
      updateFaceEnrollmentUI
    );
    selectedDeviceId = appState.selectedDeviceId;
    minFaceHeightRatio = appState.minFaceHeightRatio;
    configuredCvFps = appState.configuredCvFps;
    soundEnabled = appState.soundEnabled;
    postureAlertSoundEnabled = appState.postureAlertSoundEnabled;
    notificationsEnabled = appState.notificationsEnabled;
    microNotificationsEnabled = appState.microNotificationsEnabled;
    trayAlertsEnabled = appState.trayAlertsEnabled;
    ergoTrayAlertsEnabled = appState.ergoTrayAlertsEnabled;
    breakOverlayMode = appState.breakOverlayMode;
    reducedMotion = appState.reducedMotion;
    highContrast = appState.highContrast;
    enrolledFaceSignature = appState.enrolledFaceSignature;
    lockOnUnrecognized = appState.lockOnUnrecognized;
    comfortDistanceCm = appState.comfortDistanceCm;
    screenSizePreset = appState.screenSizePreset as ScreenSizePreset;
    updateComfortRecommendationUI();
  } catch (e) {
    console.warn('Failed to load settings:', e);
  }
}

function closeSettings() {
  closeSettingsModal(settingsModalEl);
}

function openOnboardingModal() {
  openOnboarding(onboardingModalEl, closeSettings);
}

async function completeOnboarding(useInputOnly: boolean = false) {
  await finishOnboarding(
    getOnboardingElements(),
    useInputOnly,
    stopWebcamTracks,
    () => {
      baselineFaceY = null;
      baselineFaceHeight = null;
      slouchCounter = 0;
      tooCloseCounter = 0;
    }
  );
  try {
    const state = await invoke<StateSnapshot>('get_state');
    renderState(state);
  } catch (err) {
    console.warn('Post-onboarding state fetch failed:', err);
  }
}

async function saveSettings() {
  try {
    const appState = getAppSettingsState();
    const { cameraChanged } = await persistSettings(
      getSettingsElements(),
      appState,
      loadCameraPostureBaseline
    );
    selectedDeviceId = appState.selectedDeviceId;
    minFaceHeightRatio = appState.minFaceHeightRatio;
    configuredCvFps = appState.configuredCvFps;
    soundEnabled = appState.soundEnabled;
    postureAlertSoundEnabled = appState.postureAlertSoundEnabled;
    notificationsEnabled = appState.notificationsEnabled;
    microNotificationsEnabled = appState.microNotificationsEnabled;
    trayAlertsEnabled = appState.trayAlertsEnabled;
    ergoTrayAlertsEnabled = appState.ergoTrayAlertsEnabled;
    comfortDistanceCm = appState.comfortDistanceCm;
    screenSizePreset = appState.screenSizePreset as ScreenSizePreset;
    breakOverlayMode = appState.breakOverlayMode;
    reducedMotion = appState.reducedMotion;
    highContrast = appState.highContrast;
    enrolledFaceSignature = appState.enrolledFaceSignature;
    lockOnUnrecognized = appState.lockOnUnrecognized;

    if (settingTrackingMode.value === 'Input only') {
      stopWebcamTracks();
    } else if ((cameraChanged || !(videoEl.srcObject instanceof MediaStream)) && !isTrackingPaused) {
      await startWebcam(selectedDeviceId);
    }

    const state = await invoke<StateSnapshot>('get_state');
    renderState(state);
  } catch (err) {
    alert('Failed to save settings: ' + String(err));
  }
}

async function deleteAllData() {
  if (confirm('Are you sure you want to delete all local history and statistics? This action is permanent and cannot be undone.')) {
    try {
      await invoke('delete_all_data');
      selectedDeviceId = '';
      if (settingCameraSelect) settingCameraSelect.value = '';
      if (previewCameraSelect) previewCameraSelect.value = '';
      enrolledFaceSignature = null;
      lastObservedSignature = null;
      identityMismatchCounter = 0;
      isUnrecognizedUserVisible = false;
      baselineFaceY = null;
      baselineFaceHeight = null;
      slouchCounter = 0;
      tooCloseCounter = 0;
      await loadCameraPostureBaseline();
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

// Event Listeners
function setupEventListeners() {
  // Toggle Preview
  togglePreviewEl.addEventListener('click', () => {
    isPreviewOpen = !isPreviewOpen;
    if (isPreviewOpen) {
      previewContainerEl.classList.remove('hidden');
      previewToggleBtn.textContent = 'Hide Preview';
    } else {
      previewContainerEl.classList.add('hidden');
      previewToggleBtn.textContent = 'Show Preview';
    }
  });

  // Toggle Pause/Resume
  btnTogglePause.addEventListener('click', async () => {
    const snapshot = await invoke<StateSnapshot>('toggle_tracking');
    renderState(snapshot);
  });

  // DND Mode Toggle
  if (btnToggleDnd) {
    btnToggleDnd.addEventListener('click', async () => {
      const nextDnd = !isDndActive;
      manualDndOverride = nextDnd;
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: nextDnd });
      renderState(snapshot);
    });
  }

  // Auto DND on fullscreen presentation
  document.addEventListener('fullscreenchange', async () => {
    const isFullscreen = document.fullscreenElement !== null;
    if (isFullscreen !== isDndActive) {
      const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: isFullscreen });
      renderState(snapshot);
    }
  });

  // Dismiss Micro-Break
  if (btnDismissMicro) {
    btnDismissMicro.addEventListener('click', async () => {
      const snapshot = await invoke<StateSnapshot>('dismiss_micro_break');
      renderState(snapshot);
    });
  }

  // Take Break Now (starts break mode immediately)
  btnTakeBreak.addEventListener('click', async () => {
    const snapshot = await invoke<StateSnapshot>('start_break');
    renderState(snapshot);
  });

  // Modal Actions
  btnFinishBreak.addEventListener('click', async () => {
    const snapshot = await invoke<StateSnapshot>('start_break');
    renderState(snapshot);
  });

  if (btnWrapUpBreak) {
    btnWrapUpBreak.addEventListener('click', async () => {
      const snapshot = await invoke<StateSnapshot>('wrap_up_break');
      renderState(snapshot);
    });
  }

  // Plan 014: Posture & Viewing Distance Recalibration
  if (btnCalibratePosture) {
    btnCalibratePosture.addEventListener('click', async () => {
      try {
        updatePostureCalibrationUI('Sampling upright posture from camera...', false);
        if (!(videoEl.srcObject instanceof MediaStream)) {
          await startWebcam(settingCameraSelect?.value || selectedDeviceId);
        }

        let captured = false;
        if (faceDetector && videoEl && videoEl.readyState >= 2) {
          const result = faceDetector.detectForVideo(videoEl, performance.now());
          const detections = result.detections || [];
          const frameW = videoEl.videoWidth || 640;
          const frameH = videoEl.videoHeight || 480;
          const { primary } = selectPrimaryForegroundFace(
            detections as FaceDetectionCandidate[],
            frameW,
            frameH,
            minFaceHeightRatio
          );
          if (primary?.boundingBox) {
            const box = primary.boundingBox;
            baselineFaceY = box.originY + box.height / 2;
            baselineFaceHeight = box.height;
            slouchCounter = 0;
            tooCloseCounter = 0;
            captured = true;
            const { keyY, keyH } = getCameraPostureKeys();
            const yVal = String(Math.round(baselineFaceY * 100) / 100);
            const hVal = String(Math.round(baselineFaceHeight * 100) / 100);
            await invoke('update_setting', { key: keyY, value: yVal });
            await invoke('update_setting', { key: keyH, value: hVal });
            await invoke('update_setting', { key: 'posture_baseline_y', value: yVal });
            await invoke('update_setting', { key: 'posture_baseline_height', value: hVal });
            updatePostureUI(false, true);
            const distEval = evaluateScreenDistance(box.height, frameH, baselineFaceHeight, 0, comfortDistanceCm);
            updateDistanceUI(distEval);
          }
        }

        if (captured) {
          updatePostureCalibrationUI(
            'Calibrated ✓ — Upright posture & ~60 cm distance baseline saved locally.',
            false
          );
        } else {
          baselineFaceY = null;
          baselineFaceHeight = null;
          slouchCounter = 0;
          tooCloseCounter = 0;
          updatePostureUI(false, false);
          updateDistanceUI(null);
          updatePostureCalibrationUI(
            'Reset — Sit upright looking at the camera; baseline will lock on the next detected frame.',
            false
          );
        }
      } catch (err) {
        updatePostureCalibrationUI(`Calibration error: ${String(err)}`, true);
      }
    });
  }

  // Plan 026: Primary User Identity Guard Enrollment & Clear
  if (btnEnrollFace) {
    btnEnrollFace.addEventListener('click', async () => {
      try {
        updateFaceEnrollmentUI('Sampling camera frame...', false);
        if (!(videoEl.srcObject instanceof MediaStream)) {
          await startWebcam(settingCameraSelect?.value || selectedDeviceId);
        }
        // Try an immediate on-demand detection from the live video element first
        if (faceDetector && videoEl && videoEl.readyState >= 2) {
          const result = faceDetector.detectForVideo(videoEl, performance.now());
          const detections = result.detections || [];
          const frameW = videoEl.videoWidth || 640;
          const frameH = videoEl.videoHeight || 480;
          const { primary } = selectPrimaryForegroundFace(
            detections as FaceDetectionCandidate[],
            frameW,
            frameH,
            minFaceHeightRatio
          );
          if (primary) {
            const liveSig = extractFaceSignature(primary, frameW, frameH);
            if (liveSig && liveSig.length === 6) {
              lastObservedSignature = liveSig;
            }
          }
        }

        if (!lastObservedSignature || lastObservedSignature.length !== 6) {
          updateFaceEnrollmentUI(
            'No face detected in camera feed — look directly at your webcam and click Enroll again.',
            true
          );
          return;
        }

        enrolledFaceSignature = [...lastObservedSignature];
        identityMismatchCounter = 0;
        isUnrecognizedUserVisible = false;
        await invoke('update_setting', {
          key: 'primary_user_signature',
          value: JSON.stringify(enrolledFaceSignature),
        });
        updateFaceEnrollmentUI(
          'Enrolled ✓ — Primary user geometric signature saved locally (zero images stored).',
          false
        );
      } catch (err) {
        updateFaceEnrollmentUI(`Enrollment failed: ${String(err)}`, true);
      }
    });
  }

  if (btnClearFace) {
    btnClearFace.addEventListener('click', async () => {
      try {
        enrolledFaceSignature = null;
        identityMismatchCounter = 0;
        isUnrecognizedUserVisible = false;
        await invoke('update_setting', { key: 'primary_user_signature', value: '' });
        updateFaceEnrollmentUI('Cleared — Primary user identity lock reset.', false);
      } catch (err) {
        updateFaceEnrollmentUI(`Failed to clear ID: ${String(err)}`, true);
      }
    });
  }

  // Plan 013: Focus Cadence Rhythm Presets
  const presetButtons = document.querySelectorAll<HTMLButtonElement>('#settings-modal .preset-pill-group .btn-preset');
  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const work = btn.dataset.work || '50';
      const breakM = btn.dataset.break || '10';
      settingWorkInterval.value = work;
      settingBreakInterval.value = breakM;
    });
  });

  // Plan 025: Onboarding Modal & Presets
  const onboardingPresetButtons = document.querySelectorAll<HTMLButtonElement>('.btn-onboarding-preset');
  onboardingPresetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      onboardingPresetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Comfort Distance & Screen Size Presets
  if (settingScreenPreset) {
    settingScreenPreset.addEventListener('change', () => {
      const selected = settingScreenPreset.value as ScreenSizePreset;
      screenSizePreset = selected;
      if (selected !== 'custom') {
        const rec = recommendComfortDistance(selected);
        comfortDistanceCm = rec.recommendedComfortCm;
        if (settingComfortDistance) {
          settingComfortDistance.value = String(comfortDistanceCm);
        }
      }
      updateComfortRecommendationUI();
    });
  }

  if (settingComfortDistance) {
    settingComfortDistance.addEventListener('input', () => {
      const val = parseInt(settingComfortDistance.value, 10);
      if (!isNaN(val) && val >= 35 && val <= 120) {
        comfortDistanceCm = val;
        // If custom numeric distance differs from preset recommendation, mark preset as custom
        const rec = recommendComfortDistance(screenSizePreset);
        if (screenSizePreset !== 'custom' && val !== rec.recommendedComfortCm) {
          screenSizePreset = 'custom';
          if (settingScreenPreset) settingScreenPreset.value = 'custom';
        }
      }
      updateComfortRecommendationUI();
    });
  }

  if (btnApplyRecommendedDistance) {
    btnApplyRecommendedDistance.addEventListener('click', () => {
      const detectedPreset = inferScreenPresetFromEnvironment(
        window.screen?.width || 1920,
        window.screen?.height || 1080,
        window.devicePixelRatio || 1
      );
      screenSizePreset = detectedPreset;
      const rec = recommendComfortDistance(detectedPreset);
      comfortDistanceCm = rec.recommendedComfortCm;
      updateComfortRecommendationUI();
    });
  }

  if (btnOpenPrivacyGuide) {
    btnOpenPrivacyGuide.addEventListener('click', () => openOnboardingModal());
  }
  if (btnCloseOnboarding) {
    btnCloseOnboarding.addEventListener('click', () => void completeOnboarding(false));
  }
  if (btnCompleteOnboarding) {
    btnCompleteOnboarding.addEventListener('click', () => void completeOnboarding(false));
  }
  if (btnOnboardingInputOnly) {
    btnOnboardingInputOnly.addEventListener('click', () => void completeOnboarding(true));
  }

  if (btnRange7d && btnRange30d) {
    btnRange7d.addEventListener('click', () => {
      selectedTrendDays = 7;
      btnRange7d.classList.add('active');
      btnRange30d.classList.remove('active');
      void refreshTrendsChart();
    });
    btnRange30d.addEventListener('click', () => {
      selectedTrendDays = 30;
      btnRange30d.classList.add('active');
      btnRange7d.classList.remove('active');
      void refreshTrendsChart();
    });
  }

  btnEndBreakEarly.addEventListener('click', async () => {
    const snapshot = await invoke<StateSnapshot>('complete_break', { taken: true });
    renderState(snapshot);
    refreshTrendsChart();
  });

  btnSnoozeBreak.addEventListener('click', async () => {
    try {
      const snapshot = await invoke<StateSnapshot>('snooze_break');
      renderState(snapshot);
    } catch (err) {
      alert(String(err));
    }
  });

  btnSkipBreak.addEventListener('click', async () => {
    if (btnSkipBreak.textContent?.includes('Over Limit')) {
      if (!confirm('You have reached your daily skip limit. Skipping another break may increase eye strain. Skip anyway?')) {
        return;
      }
    }
    const snapshot = await invoke<StateSnapshot>('skip_break');
    renderState(snapshot);
  });

  // Settings modal listeners
  btnOpenSettings.addEventListener('click', openSettings);
  btnCloseSettings.addEventListener('click', closeSettings);
  btnSaveSettings.addEventListener('click', saveSettings);
  btnDeleteAllData.addEventListener('click', deleteAllData);

  // Plan 027: Test Notification Button
  if (btnTestNotification) {
    btnTestNotification.addEventListener('click', async () => {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const perm = await requestPermission();
          granted = perm === 'granted';
        }
        await updateNotificationPermissionUI();
        if (!granted) {
          alert('Desktop notifications permission was not granted by the OS.');
          return;
        }
        await invoke('send_test_notification');
      } catch (err) {
        alert(`Failed to send test notification: ${String(err)}`);
      }
    });
  }

  // Plan 027: Desktop Notification Action / Click Window Focus
  try {
    void onAction(async (notification) => {
      console.log('Notification action received:', notification);
      try {
        const win = getCurrentWebviewWindow();
        await win.show();
        await win.setFocus();
      } catch (err) {
        console.warn('Failed to focus window from notification action:', err);
      }
    });
  } catch (err) {
    console.warn('Failed to attach notification onAction handler:', err);
  }

  // Export buttons
  if (btnExportJson) {
    btnExportJson.addEventListener('click', () => exportData('json'));
  }
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => exportData('csv'));
  }
  if (btnExportReportCard) {
    btnExportReportCard.addEventListener('click', exportErgonomicReport);
  }
  if (btnImportJson && inputImportJson) {
    btnImportJson.addEventListener('click', () => {
      inputImportJson.click();
    });
    inputImportJson.addEventListener('change', async () => {
      const file = inputImportJson.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const count = await invoke<number>('import_data_json', { jsonPayload: text });
        const state = await invoke<StateSnapshot>('get_state');
        renderState(state);
        await refreshTrendsChart();
        alert(`Successfully imported ${count} records from backup.`);
      } catch (err) {
        alert(`Import failed: ${String(err)}`);
      } finally {
        inputImportJson.value = '';
      }
    });
  }

  // Camera selection change in preview calibration
  if (previewCameraSelect) {
    previewCameraSelect.addEventListener('change', async () => {
      selectedDeviceId = previewCameraSelect.value;
      if (settingCameraSelect) {
        settingCameraSelect.value = selectedDeviceId;
      }
      await invoke('update_setting', { key: 'selected_camera_id', value: selectedDeviceId });
      await startWebcam(selectedDeviceId);
    });
  }

  // Auto-refresh camera device list when hardware changes (plugging/unplugging webcam)
  navigator.mediaDevices?.addEventListener('devicechange', async () => {
    await populateCameraDevices();
  });

  // Listen to tray menu navigation events ("settings", "privacy")
  listen<string>('navigate', (event) => {
    if (event.payload === 'privacy') {
      openOnboardingModal();
    } else if (event.payload === 'settings') {
      openSettings();
    }
  });

  // Plan 027: Listen for tray "recalibrate_posture" menu action
  listen('calibrate_posture', () => {
    if (btnCalibratePosture) {
      btnCalibratePosture.click();
    }
  });

  // Listen to Tauri backend 1-second state broadcasts
  listen<StateSnapshot>('state_change', (event) => {
    renderState(event.payload);
  });

  // Plan 015: Desktop keyboard shortcuts (Cmd/Ctrl + Shift + B/P/D)
  window.addEventListener('keydown', async (e) => {
    const isCmdOrCtrl = e.metaKey || e.ctrlKey;
    if (isCmdOrCtrl && e.shiftKey) {
      if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        const snapshot = await invoke<StateSnapshot>('take_break_now');
        renderState(snapshot);
      } else if (e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const snapshot = await invoke<StateSnapshot>('toggle_tracking');
        renderState(snapshot);
      } else if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const nextDnd = !isDndActive;
        manualDndOverride = nextDnd;
        const snapshot = await invoke<StateSnapshot>('set_dnd_mode', { enabled: nextDnd });
        renderState(snapshot);
      }
    }
  });
}

// Initial Boot
async function init() {
  setupEventListeners();
  initBatteryMonitor();

  try {
    const settings = await invoke<Record<string, string>>('get_settings');
    if (settings.selected_camera_id) {
      selectedDeviceId = settings.selected_camera_id;
    }
    if (settings.min_face_height_ratio) {
      const parsed = parseFloat(settings.min_face_height_ratio);
      if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
        minFaceHeightRatio = parsed;
      }
    }
    if (settings.tracking_mode && settingTrackingMode) {
      settingTrackingMode.value = settings.tracking_mode;
    }
    if (settings.cv_fps) {
      configuredCvFps = parseInt(settings.cv_fps, 10) || 2;
      if (settingCvFps) settingCvFps.value = settings.cv_fps;
    }
    if (settings.break_overlay) {
      breakOverlayMode = settings.break_overlay;
      if (settingBreakOverlay) settingBreakOverlay.value = settings.break_overlay;
    }
    if (settings.data_retention_days && settingDataRetention) {
      settingDataRetention.value = settings.data_retention_days;
    }
    if (settings.sound !== undefined) {
      soundEnabled = settings.sound === 'on';
      if (settingSound) settingSound.checked = soundEnabled;
    }
    if (settings.posture_alert_sound !== undefined) {
      postureAlertSoundEnabled = settings.posture_alert_sound === 'on';
      if (settingPostureAlertSound) settingPostureAlertSound.checked = postureAlertSoundEnabled;
    }
    if (settings.notifications_enabled !== undefined) {
      notificationsEnabled = settings.notifications_enabled === 'on';
      if (settingNotifications) settingNotifications.checked = notificationsEnabled;
    }
    if (settings.micro_break_notifications !== undefined) {
      microNotificationsEnabled = settings.micro_break_notifications === 'on';
      if (settingMicroNotifications) settingMicroNotifications.checked = microNotificationsEnabled;
    }
    if (settings.tray_alerts_enabled !== undefined) {
      trayAlertsEnabled = settings.tray_alerts_enabled === 'on';
      if (settingTrayAlerts) settingTrayAlerts.checked = trayAlertsEnabled;
    }
    if (settings.ergo_tray_alerts !== undefined) {
      ergoTrayAlertsEnabled = settings.ergo_tray_alerts === 'on';
      if (settingErgoTrayAlerts) settingErgoTrayAlerts.checked = ergoTrayAlertsEnabled;
    }
    if (settings.reduced_motion !== undefined) {
      reducedMotion = settings.reduced_motion === 'on';
      if (settingReducedMotion) settingReducedMotion.checked = reducedMotion;
    }
    if (settings.high_contrast !== undefined) {
      highContrast = settings.high_contrast === 'on';
      if (settingHighContrast) settingHighContrast.checked = highContrast;
    }
    if (settings.lock_on_unrecognized_user !== undefined) {
      lockOnUnrecognized = settings.lock_on_unrecognized_user === 'on';
      if (settingLockUnrecognized) settingLockUnrecognized.checked = lockOnUnrecognized;
    }
    if (settings.primary_user_signature) {
      try {
        const parsedSig = JSON.parse(settings.primary_user_signature);
        if (Array.isArray(parsedSig) && parsedSig.length === 6) {
          enrolledFaceSignature = parsedSig;
        }
      } catch {
        enrolledFaceSignature = null;
      }
    }
    if (settings.screen_size_preset !== undefined) {
      screenSizePreset = settings.screen_size_preset as ScreenSizePreset;
    }
    if (settings.comfort_distance_cm !== undefined) {
      const parsed = parseInt(settings.comfort_distance_cm, 10);
      if (!isNaN(parsed) && parsed >= 35 && parsed <= 120) {
        comfortDistanceCm = parsed;
      }
    }
    await loadCameraPostureBaseline();
    updateFaceEnrollmentUI();
    updateComfortRecommendationUI();
    applyAppearanceSettings();
    await updateNotificationPermissionUI();
    if (settings.onboarding_completed === 'false') {
      openOnboardingModal();
    }
  } catch (err) {
    console.warn('Initial settings load error:', err);
  }

  try {
    const initialState = await invoke<StateSnapshot>('get_state');
    renderState(initialState);
  } catch (err) {
    console.warn('Initial state fetch error:', err);
  }

  await refreshTrendsChart();
  await initMediaPipe();

  // Periodic OS presentation mode check & camera recovery probe with exponential backoff
  await checkPresentationState();
  setInterval(() => {
    void checkPresentationState();
  }, 10000);

  let cameraProbeFailures = 0;
  async function probeCameraRecovery() {
    if (
      !isTrackingPaused &&
      settingTrackingMode?.value !== 'Input only' &&
      !(videoEl.srcObject instanceof MediaStream)
    ) {
      try {
        await startWebcam(selectedDeviceId);
        if (videoEl.srcObject instanceof MediaStream) {
          cameraProbeFailures = 0;
        } else {
          cameraProbeFailures++;
        }
      } catch {
        cameraProbeFailures++;
      }
    }
    // Exponential backoff: 10s, 15s, 22.5s ... capped at 5 minutes (300,000ms)
    const nextInterval = Math.min(10000 * Math.pow(1.5, Math.min(cameraProbeFailures, 8)), 300000);
    setTimeout(probeCameraRecovery, nextInterval);
  }
  setTimeout(probeCameraRecovery, 10000);
}

window.addEventListener('DOMContentLoaded', init);

