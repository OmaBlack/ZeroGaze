// Format seconds into HH:MM:SS
export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => v.toString().padStart(2, '0')).join(':');
}

// Format seconds into "Xh Ym" or "Ym Zs"
export function formatHumanDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${totalSeconds % 60}s`;
}

// Calculate consecutive recent days with active_seconds > 60
export function calculateStreakDays(stats: Array<{ active_seconds: number }>): number {
  let streak = 0;
  for (let i = stats.length - 1; i >= 0; i--) {
    if (stats[i].active_seconds > 60) streak++;
    else break;
  }
  return streak;
}

// Evaluate posture slouch drift from bounding box center and baseline
export function evaluatePostureDrift(
  centerY: number,
  baselineY: number,
  baselineHeight: number,
  currentCounter: number,
  currentHeight?: number
): { nextCounter: number; isSlouching: boolean } {
  const safeBaseH = Math.max(20, baselineHeight);
  // Slouching drops head vertically in the frame (> 12% of face height) or leans head forward + down
  const verticalDrop = centerY - baselineY;
  const isDropped = verticalDrop > safeBaseH * 0.12;
  const isForwardSlouch =
    currentHeight !== undefined &&
    currentHeight > safeBaseH * 1.18 &&
    verticalDrop > safeBaseH * 0.06;

  if (isDropped || isForwardSlouch) {
    const nextCounter = currentCounter + 1;
    return { nextCounter, isSlouching: nextCounter >= 6 };
  }
  return { nextCounter: 0, isSlouching: false };
}

export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface FaceDetectionCandidate {
  boundingBox?: BoundingBox;
  categories?: Array<{ score?: number }>;
  keypoints?: Array<{ x: number; y: number }>;
}

export interface PrimaryFaceSelectionResult<T extends FaceDetectionCandidate> {
  /** The foreground user's face, or null if all faces are too small/far in the background */
  primary: T | null;
  /** Faces rejected as background bystanders or too far away */
  ignoredBackground: T[];
}

/**
 * Selects the primary user in front of the PC and ignores smaller/off-center faces in the background.
 * - Rejects faces whose bounding-box height is smaller than `minHeightRatio` of the frame height (default 12% = too far away).
 * - Ranks remaining faces by area weighted by horizontal centrality, then filters out any secondary face
 *   whose area is `< 45%` of the primary face's area (background bystander).
 */
export function selectPrimaryForegroundFace<T extends FaceDetectionCandidate>(
  detections: T[],
  frameWidth: number = 640,
  frameHeight: number = 480,
  minHeightRatio: number = 0.12
): PrimaryFaceSelectionResult<T> {
  if (!detections || detections.length === 0) {
    return { primary: null, ignoredBackground: [] };
  }

  const safeW = frameWidth > 0 ? frameWidth : 640;
  const safeH = frameHeight > 0 ? frameHeight : 480;

  const validForeground: Array<{ det: T; area: number; score: number }> = [];
  const ignoredBackground: T[] = [];

  for (const det of detections) {
    const box = det.boundingBox;
    if (!box || box.width <= 0 || box.height <= 0) {
      ignoredBackground.push(det);
      continue;
    }

    const heightRatio = box.height / safeH;
    if (heightRatio < minHeightRatio) {
      // Face is too small / far in the background to be the PC operator
      ignoredBackground.push(det);
      continue;
    }

    const area = box.width * box.height;
    const centerX = box.originX + box.width / 2;
    const normalizedCenterOffset = Math.min(1, Math.abs(centerX - safeW / 2) / (safeW / 2));
    // Centrality bonus (0.7 to 1.0) favors the person seated directly in front of the monitor
    const centralityWeight = 1 - 0.3 * normalizedCenterOffset;
    validForeground.push({ det, area, score: area * centralityWeight });
  }

  if (validForeground.length === 0) {
    return { primary: null, ignoredBackground };
  }

  validForeground.sort((a, b) => b.score - a.score);
  const primaryEntry = validForeground[0];

  for (let i = 1; i < validForeground.length; i++) {
    ignoredBackground.push(validForeground[i].det);
  }

  return {
    primary: primaryEntry.det,
    ignoredBackground,
  };
}

export type ScreenDistanceStatus = 'too_close' | 'optimal' | 'too_far';

export interface ScreenDistanceEvaluation {
  estimatedCm: number;
  status: ScreenDistanceStatus;
  nextTooCloseCounter: number;
  isTooCloseWarning: boolean;
  comfortDistanceCm: number;
}

export type ScreenSizePreset = 'compact_laptop' | 'standard_laptop' | 'desktop_monitor' | 'large_ultrawide' | 'custom';

export interface ScreenDistanceRecommendation {
  preset: ScreenSizePreset;
  diagonalInchesLabel: string;
  recommendedComfortCm: number;
  minSafeCm: number;
  maxComfortCm: number;
  description: string;
}

/**
 * Recommends optimal ergonomic viewing distance based on display diagonal size and OSHA / optometric standards.
 * - 13"-14" Laptops: ~50 cm (min safe 40 cm)
 * - 15"-16" Standard Laptops: ~55 cm (min safe 45 cm)
 * - 24"-27" Desktop Monitors (Default): ~65 cm (min safe 50 cm)
 * - 32"+ / Ultrawide Displays: ~75 cm (min safe 60 cm)
 */
export function recommendComfortDistance(
  presetOrInches: ScreenSizePreset | number = 'desktop_monitor'
): ScreenDistanceRecommendation {
  if (typeof presetOrInches === 'number') {
    const inches = presetOrInches;
    if (inches <= 14) {
      return {
        preset: 'compact_laptop',
        diagonalInchesLabel: `${inches}" Compact Laptop`,
        recommendedComfortCm: 50,
        minSafeCm: 40,
        maxComfortCm: 70,
        description: 'Recommended for 13"–14" laptops (arms-length near range).',
      };
    } else if (inches <= 17) {
      return {
        preset: 'standard_laptop',
        diagonalInchesLabel: `${inches}" Standard Laptop`,
        recommendedComfortCm: 55,
        minSafeCm: 45,
        maxComfortCm: 75,
        description: 'Recommended for 15"–17" laptops (standard viewing distance).',
      };
    } else if (inches <= 29) {
      return {
        preset: 'desktop_monitor',
        diagonalInchesLabel: `${inches}" Desktop Display`,
        recommendedComfortCm: 65,
        minSafeCm: 50,
        maxComfortCm: 90,
        description: 'Recommended for 24"–27" external displays (arms-length full reach).',
      };
    } else {
      return {
        preset: 'large_ultrawide',
        diagonalInchesLabel: `${inches}" Large / Ultrawide Display`,
        recommendedComfortCm: 75,
        minSafeCm: 60,
        maxComfortCm: 105,
        description: 'Recommended for 32"+ and ultrawide screens (relaxed deep desk posture).',
      };
    }
  }

  switch (presetOrInches) {
    case 'compact_laptop':
      return {
        preset: 'compact_laptop',
        diagonalInchesLabel: '13"–14" Compact Laptop',
        recommendedComfortCm: 50,
        minSafeCm: 40,
        maxComfortCm: 70,
        description: 'Near-field focus for compact screens (~50 cm).',
      };
    case 'standard_laptop':
      return {
        preset: 'standard_laptop',
        diagonalInchesLabel: '15"–16" Standard Laptop',
        recommendedComfortCm: 55,
        minSafeCm: 45,
        maxComfortCm: 75,
        description: 'Standard laptop distance (~55 cm).',
      };
    case 'large_ultrawide':
      return {
        preset: 'large_ultrawide',
        diagonalInchesLabel: '32"+ / Ultrawide Display',
        recommendedComfortCm: 75,
        minSafeCm: 60,
        maxComfortCm: 105,
        description: 'Deeper desk setup for large displays (~75 cm).',
      };
    case 'desktop_monitor':
    default:
      return {
        preset: 'desktop_monitor',
        diagonalInchesLabel: '24"–27" Desktop Display',
        recommendedComfortCm: 65,
        minSafeCm: 50,
        maxComfortCm: 90,
        description: 'Standard ergonomic desktop distance (~65 cm).',
      };
  }
}

/**
 * Automatically infers a display preset from window.screen dimensions and devicePixelRatio.
 */
export function inferScreenPresetFromEnvironment(
  screenWidth: number = 1920,
  screenHeight: number = 1080,
  devicePixelRatio: number = 2
): ScreenSizePreset {
  const effectiveWidth = Math.max(screenWidth, screenHeight);
  // macOS Retina / high-DPI laptops typically have pixel width around 1440-1800 (logical) or 2560-3024 (physical)
  // On external 4K or 1440p displays, logical width is 2560+ or pixel ratio is 1 with width >= 1920
  if (devicePixelRatio > 1 && effectiveWidth <= 1512) {
    // 13"-14" MacBook / compact laptop (1440x900 or 1512x982 logical)
    return 'compact_laptop';
  } else if (devicePixelRatio > 1 && effectiveWidth <= 1728) {
    // 15"-16" MacBook Pro (1728x1117 logical)
    return 'standard_laptop';
  } else if (effectiveWidth >= 3440) {
    // 34" Ultrawide or large 4K TV/monitor
    return 'large_ultrawide';
  } else {
    // Typical 24"-27" 1080p, 1440p, or scaled 4K monitor
    return 'desktop_monitor';
  }
}

/**
 * Estimates viewing distance in centimeters from face bounding-box height relative to frame height
 * or calibrated baseline height (~60 cm reference ergonomic distance).
 * - Clamps the 60 cm reference height to realistic webcam optical bounds (`20%`–`30%` of frame height)
 *   so that booting the app while leaning too close or sitting far back never locks the scale at 60 cm.
 * - Triggers `isTooCloseWarning` after 6 consecutive ticks below the minimum threshold (comfortDistanceCm * 0.75, or 45 cm default)
 *   to avoid false alarms on brief leans.
 */
export function evaluateScreenDistance(
  faceHeight: number,
  frameHeight: number = 480,
  baselineHeight: number | null = null,
  tooCloseCounter: number = 0,
  targetComfortCm: number = 60
): ScreenDistanceEvaluation {
  const safeFrameH = frameHeight > 0 ? frameHeight : 480;
  const defaultRef60Cm = safeFrameH * 0.25;
  const minRef60Cm = safeFrameH * 0.20;
  const maxRef60Cm = safeFrameH * 0.30;
  const referenceHeightAt60Cm =
    baselineHeight && baselineHeight > 0
      ? Math.max(minRef60Cm, Math.min(maxRef60Cm, baselineHeight))
      : defaultRef60Cm;

  const rawCm = faceHeight > 0 ? (referenceHeightAt60Cm / faceHeight) * 60 : 60;
  const estimatedCm = Math.max(25, Math.min(150, Math.round(rawCm)));

  // Comfort distance scaling: too-close warning triggers when closer than 75% of comfort distance (or min 40 cm)
  const safeComfortCm = Math.max(40, Math.min(110, targetComfortCm));
  const tooCloseThresholdCm = Math.max(38, Math.round(safeComfortCm * 0.75));
  const tooFarThresholdCm = Math.round(safeComfortCm * 1.55);

  if (estimatedCm < tooCloseThresholdCm) {
    const nextTooCloseCounter = tooCloseCounter + 1;
    return {
      estimatedCm,
      status: 'too_close',
      nextTooCloseCounter,
      isTooCloseWarning: nextTooCloseCounter >= 6,
      comfortDistanceCm: safeComfortCm,
    };
  }

  if (estimatedCm > tooFarThresholdCm) {
    return {
      estimatedCm,
      status: 'too_far',
      nextTooCloseCounter: 0,
      isTooCloseWarning: false,
      comfortDistanceCm: safeComfortCm,
    };
  }

  return {
    estimatedCm,
    status: 'optimal',
    nextTooCloseCounter: 0,
    isTooCloseWarning: false,
    comfortDistanceCm: safeComfortCm,
  };
}

export interface EyeStrainEstimate {
  blinkRatePerMinute: number;
  fatigueScore: number;
  isBlinking: boolean;
  timestamp: number;
}

export interface EyeStrainEstimator {
  isEnabled(): boolean;
  sampleBlink(eyeBlinkLeft: number, eyeBlinkRight: number): void;
  getEstimate(): EyeStrainEstimate;
}

export class DutyCycledEyeStrainEstimator implements EyeStrainEstimator {
  private enabled: boolean = false;
  private blinkTimestamps: number[] = [];
  private lastBlinkState: boolean = false;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  sampleBlink(eyeBlinkLeft: number, eyeBlinkRight: number): void {
    if (!this.enabled) return;
    const isCurrentlyBlinking = (eyeBlinkLeft + eyeBlinkRight) / 2 > 0.5;
    const now = Date.now();

    if (isCurrentlyBlinking && !this.lastBlinkState) {
      this.blinkTimestamps.push(now);
      this.blinkTimestamps = this.blinkTimestamps.filter((t) => now - t <= 60000);
    }
    this.lastBlinkState = isCurrentlyBlinking;
  }

  getEstimate(): EyeStrainEstimate {
    const now = Date.now();
    this.blinkTimestamps = this.blinkTimestamps.filter((t) => now - t <= 60000);
    const bpm = this.blinkTimestamps.length;
    const fatigueScore = Math.max(0, Math.min(1, (16 - bpm) / 16));
    return {
      blinkRatePerMinute: bpm,
      fatigueScore,
      isBlinking: this.lastBlinkState,
      timestamp: now,
    };
  }
}

export function computeDetectionDelayMs(
  cvFps: number = 2,
  isOnBattery: boolean = false,
  batteryLevel: number = 1.0
): number {
  if (isOnBattery) {
    return batteryLevel < 0.2 ? 2500 : 2000;
  }
  const clampedFps = Math.max(1, Math.min(5, Math.round(cvFps || 2)));
  return Math.round(1000 / clampedFps);
}

export interface BreakCoachStep {
  breathPhase: 'Inhale' | 'Hold' | 'Exhale';
  breathPhaseSecondsLeft: number;
  stretchTitle: string;
  stretchInstruction: string;
}

const DESK_STRETCHES: Array<{ title: string; instruction: string }> = [
  {
    title: '20-20-20 Far Gaze',
    instruction: 'Focus on a distant object at least 20 feet (6 meters) away to relax ciliary eye muscles.',
  },
  {
    title: 'Cervical Neck Release',
    instruction: 'Drop your shoulders away from your ears and gently tilt your head ear-to-shoulder for 15 seconds each side.',
  },
  {
    title: 'Scapular Wall / Desk Squeeze',
    instruction: 'Draw your shoulder blades back and down for 5 seconds to counteract forward screen posture.',
  },
  {
    title: 'Forearm & Wrist Flexor Stretch',
    instruction: 'Extend one arm forward with palm up and gently draw fingers back to release keyboard tension.',
  },
];

/**
 * Computes the current 14-second breathing cycle phase (4s Inhale, 4s Hold, 6s Exhale)
 * and rotates ergonomic desk stretches every 30 seconds.
 */
export function getBreakCoachStep(elapsedSeconds: number): BreakCoachStep {
  const safeElapsed = Math.max(0, Math.floor(elapsedSeconds));
  const cyclePos = safeElapsed % 14;
  let breathPhase: 'Inhale' | 'Hold' | 'Exhale';
  let breathPhaseSecondsLeft: number;

  if (cyclePos < 4) {
    breathPhase = 'Inhale';
    breathPhaseSecondsLeft = 4 - cyclePos;
  } else if (cyclePos < 8) {
    breathPhase = 'Hold';
    breathPhaseSecondsLeft = 8 - cyclePos;
  } else {
    breathPhase = 'Exhale';
    breathPhaseSecondsLeft = 14 - cyclePos;
  }

  const stretchIdx = Math.floor(safeElapsed / 30) % DESK_STRETCHES.length;
  return {
    breathPhase,
    breathPhaseSecondsLeft,
    stretchTitle: DESK_STRETCHES[stretchIdx].title,
    stretchInstruction: DESK_STRETCHES[stretchIdx].instruction,
  };
}

export type FaceSignature = number[];

export interface IdentityVerificationResult {
  isRecognized: boolean;
  similarityScore: number;
  nextMismatchCounter: number;
  shouldLock: boolean;
}

/**
 * Extracts a 6-element scale- and translation-invariant geometric ratio vector from
 * MediaPipe BlazeFace 6 keypoints and boundingBox.
 *
 * MediaPipe's `FaceDetector` returns `keypoints` normalized in `[0.0, 1.0]` relative to
 * `(frameWidth, frameHeight)`, whereas `boundingBox` (`originX`, `originY`, `width`, `height`)
 * is in pixels. This function converts normalized keypoints into pixel coordinates first
 * so that all Euclidean distances and box ratios are computed in isotropic pixel space.
 */
export function extractFaceSignature(
  candidate: FaceDetectionCandidate | null | undefined,
  frameWidth: number = 640,
  frameHeight: number = 480
): FaceSignature | null {
  const box = candidate?.boundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    return null;
  }

  const safeW = frameWidth > 1 ? frameWidth : 640;
  const safeH = frameHeight > 1 ? frameHeight : 480;
  const boxAspectRatio = box.width / Math.max(1, box.height);

  const kp = candidate?.keypoints;
  if (!kp || kp.length < 4) {
    const r = (v: number) => Math.round(v * 10000) / 10000;
    return [r(0.6), r(1.15), r(0.55), r(2.15), r(0.42), r(boxAspectRatio)];
  }

  // Convert normalized [0..1] keypoints to pixel coordinates if needed
  const isNormalized =
    kp.every((pt) => Math.abs(pt.x) <= 1.5 && Math.abs(pt.y) <= 1.5) &&
    (box.width > 2 || box.height > 2);
  const toPx = (pt: { x: number; y: number }) => ({
    x: isNormalized ? pt.x * safeW : pt.x,
    y: isNormalized ? pt.y * safeH : pt.y,
  });

  const p0 = toPx(kp[0]); // right eye
  const p1 = toPx(kp[1]); // left eye
  const p2 = toPx(kp[2]); // nose tip
  const p3 = toPx(kp[3]); // mouth center
  const p4 = kp.length >= 6 ? toPx(kp[4]) : { x: box.originX, y: (p0.y + p1.y) / 2 };
  const p5 = kp.length >= 6 ? toPx(kp[5]) : { x: box.originX + box.width, y: (p0.y + p1.y) / 2 };

  const eyeDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (eyeDist <= 1e-3) {
    return null;
  }

  const eyeMidX = (p0.x + p1.x) / 2;
  const eyeMidY = (p0.y + p1.y) / 2;

  const eyeToNoseRatio = Math.hypot(p2.x - eyeMidX, p2.y - eyeMidY) / eyeDist;
  const eyeToMouthRatio = Math.hypot(p3.x - eyeMidX, p3.y - eyeMidY) / eyeDist;
  const noseToMouthRatio = Math.hypot(p3.x - p2.x, p3.y - p2.y) / eyeDist;
  const earSpanRatio = Math.hypot(p5.x - p4.x, p5.y - p4.y) / eyeDist;
  const eyeToBoxWidthRatio = eyeDist / Math.max(1, box.width);

  const raw = [
    eyeToNoseRatio,
    eyeToMouthRatio,
    noseToMouthRatio,
    earSpanRatio,
    eyeToBoxWidthRatio,
    boxAspectRatio,
  ];
  if (raw.some((v) => !Number.isFinite(v) || v <= 0)) {
    return null;
  }

  return raw.map((v) => Math.round(v * 10000) / 10000);
}

/**
 * Verifies whether the current foreground face signature matches the enrolled Primary User.
 * Triggers `shouldLock: true` after 6 consecutive mismatching ticks (~3 seconds at 2 FPS).
 */
export function verifyPrimaryUserIdentity(
  currentSig: number[] | null | undefined,
  enrolledSig: number[] | null | undefined,
  mismatchCounter: number,
  tolerance: number = 0.28
): IdentityVerificationResult {
  if (!enrolledSig || enrolledSig.length !== 6) {
    return {
      isRecognized: true,
      similarityScore: 1,
      nextMismatchCounter: 0,
      shouldLock: false,
    };
  }

  if (!currentSig || currentSig.length !== 6) {
    const nextMismatch = mismatchCounter + 1;
    return {
      isRecognized: false,
      similarityScore: 0,
      nextMismatchCounter: nextMismatch,
      shouldLock: nextMismatch >= 6,
    };
  }

  let sumRelDiff = 0;
  for (let i = 0; i < 6; i++) {
    sumRelDiff += Math.abs(currentSig[i] - enrolledSig[i]) / Math.max(0.15, Math.abs(enrolledSig[i]));
  }
  const meanDiff = sumRelDiff / 6;
  const similarityScore = Math.max(0, Math.min(1, 1 - meanDiff));
  const isRecognized = meanDiff <= tolerance;

  if (isRecognized) {
    return {
      isRecognized: true,
      similarityScore,
      nextMismatchCounter: 0,
      shouldLock: false,
    };
  }

  const nextMismatchCounter = mismatchCounter + 1;
  return {
    isRecognized: false,
    similarityScore,
    nextMismatchCounter,
    shouldLock: nextMismatchCounter >= 6,
  };
}

/**
 * Computes the glanceable tray badge / title text reflecting current focus state,
 * ocular rest timers, break prompts, or ergonomic alerts (too close / slouching).
 */
export function formatTrayTitle(
  state: string,
  isPaused: boolean,
  isMicroBreakActive: boolean,
  microBreakSecondsLeft: number,
  currentWorkSeconds: number,
  workIntervalSeconds: number,
  breakSecondsElapsed: number,
  breakIntervalSeconds: number,
  isTooClose: boolean = false,
  isSlouching: boolean = false,
  trayAlertsEnabled: boolean = true,
  ergoTrayAlertsEnabled: boolean = true
): string | null {
  if (!trayAlertsEnabled) return null;
  if (isPaused) return 'Paused';
  if (isMicroBreakActive) return `👁️ ${microBreakSecondsLeft}s`;
  if (state === 'BreakPrompt') return '⚠️ Break!';
  if (state === 'BreakMode') {
    const rem = Math.max(0, breakIntervalSeconds - breakSecondsElapsed);
    return `Break ${Math.ceil(rem / 60)}m`;
  }
  if (state === 'TrackingActive') {
    if (ergoTrayAlertsEnabled) {
      if (isTooClose && isSlouching) return '⚠️ Posture!';
      if (isTooClose) return '⚠️ Move Back!';
      if (isSlouching) return '⚠️ Sit Up!';
    }
    const rem = Math.max(0, workIntervalSeconds - currentWorkSeconds);
    return `${Math.ceil(rem / 60)}m`;
  }
  return null;
}

