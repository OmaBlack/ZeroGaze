import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime,
  formatHumanDuration,
  calculateStreakDays,
  evaluatePostureDrift,
  selectPrimaryForegroundFace,
  evaluateScreenDistance,
  DutyCycledEyeStrainEstimator,
  computeDetectionDelayMs,
  getBreakCoachStep,
  extractFaceSignature,
  verifyPrimaryUserIdentity,
  formatTrayTitle,
  recommendComfortDistance,
  inferScreenPresetFromEnvironment,
} from '../.test-dist/ergonomics.js';

test('formatTime formats seconds into HH:MM:SS', () => {
  assert.equal(formatTime(0), '00:00:00');
  assert.equal(formatTime(65), '00:01:05');
  assert.equal(formatTime(3661), '01:01:01');
});

test('formatHumanDuration formats hours/minutes and minutes/seconds', () => {
  assert.equal(formatHumanDuration(45), '0m 45s');
  assert.equal(formatHumanDuration(125), '2m 5s');
  assert.equal(formatHumanDuration(3660), '1h 1m');
});

test('calculateStreakDays counts consecutive recent days with >60s active', () => {
  assert.equal(calculateStreakDays([]), 0);
  assert.equal(
    calculateStreakDays([
      { active_seconds: 120 },
      { active_seconds: 30 },
      { active_seconds: 300 },
      { active_seconds: 180 },
    ]),
    2
  );
  assert.equal(
    calculateStreakDays([
      { active_seconds: 200 },
      { active_seconds: 10 },
    ]),
    0
  );
});

test('evaluatePostureDrift triggers slouching after 6 consecutive drifted frames (vertical drop or forward slouch)', () => {
  const baselineY = 100;
  const baselineHeight = 80; // 12% threshold = +9.6 -> > 109.6

  let counter = 0;
  for (let i = 1; i <= 5; i++) {
    const res = evaluatePostureDrift(114, baselineY, baselineHeight, counter);
    counter = res.nextCounter;
    assert.equal(counter, i);
    assert.equal(res.isSlouching, false);
  }

  const sixth = evaluatePostureDrift(114, baselineY, baselineHeight, counter);
  assert.equal(sixth.nextCounter, 6);
  assert.equal(sixth.isSlouching, true);

  // Forward-head slouch (height expanded > 18% and slight vertical drop > 6%)
  const forwardCheck = evaluatePostureDrift(106, baselineY, baselineHeight, 5, 98);
  assert.equal(forwardCheck.nextCounter, 6);
  assert.equal(forwardCheck.isSlouching, true);

  const recovered = evaluatePostureDrift(104, baselineY, baselineHeight, sixth.nextCounter, 80);
  assert.equal(recovered.nextCounter, 0);
  assert.equal(recovered.isSlouching, false);
});

test('selectPrimaryForegroundFace isolates closest PC user and ignores background faces', () => {
  // 1. Only a tiny distant background face (< 12% of 480px = 57.6px) -> treated as absent
  const distantOnly = [
    { boundingBox: { originX: 300, originY: 180, width: 35, height: 40 }, categories: [{ score: 0.9 }] },
  ];
  const res1 = selectPrimaryForegroundFace(distantOnly, 640, 480, 0.12);
  assert.equal(res1.primary, null);
  assert.equal(res1.ignoredBackground.length, 1);

  // 2. Primary foreground user + smaller background bystander + distant background face
  const fgUser = { boundingBox: { originX: 250, originY: 140, width: 130, height: 140 }, categories: [{ score: 0.96 }] };
  const bgCoworker = { boundingBox: { originX: 50, originY: 160, width: 65, height: 70 }, categories: [{ score: 0.88 }] };
  const farPasserby = { boundingBox: { originX: 520, originY: 200, width: 30, height: 35 }, categories: [{ score: 0.81 }] };

  const res2 = selectPrimaryForegroundFace([farPasserby, bgCoworker, fgUser], 640, 480, 0.12);
  assert.equal(res2.primary, fgUser);
  assert.equal(res2.ignoredBackground.length, 2);
});

test('evaluateScreenDistance estimates cm, clamps extreme baselines, and warns after 6 consecutive too-close ticks', () => {
  const baselineHeight = 120; // calibrated at ~60 cm

  // At baseline height -> ~60 cm, optimal
  const opt = evaluateScreenDistance(120, 480, baselineHeight, 0);
  assert.equal(opt.estimatedCm, 60);
  assert.equal(opt.status, 'optimal');
  assert.equal(opt.isTooCloseWarning, false);

  // Even if auto-calibrated while leaning very close (e.g. baselineHeight = 220px), optical clamping prevents 220px from reporting 60 cm
  const clampedTooClose = evaluateScreenDistance(220, 480, 220, 0);
  assert.equal(clampedTooClose.status, 'too_close');
  assert.ok(clampedTooClose.estimatedCm < 45);

  // Leaning very close (faceHeight = 200 -> 36 cm < 45 cm)
  let counter = 0;
  for (let i = 1; i <= 5; i++) {
    const step = evaluateScreenDistance(200, 480, baselineHeight, counter);
    counter = step.nextCounter ?? step.nextTooCloseCounter;
    assert.equal(step.estimatedCm, 36);
    assert.equal(step.status, 'too_close');
    assert.equal(step.isTooCloseWarning, false);
  }

  const sixth = evaluateScreenDistance(200, 480, baselineHeight, counter);
  assert.equal(sixth.nextTooCloseCounter, 6);
  assert.equal(sixth.isTooCloseWarning, true);

  // Scaled comfort distance test: with 75 cm comfort (ultrawide), 52 cm is too close (< 75*0.75 = 56 cm)
  const ultrawideTooClose = evaluateScreenDistance(138, 480, baselineHeight, 0, 75);
  assert.equal(ultrawideTooClose.status, 'too_close');
  assert.equal(ultrawideTooClose.comfortDistanceCm, 75);

  // With 50 cm comfort (compact laptop), 48 cm is optimal (>= 50*0.75 = 38 cm)
  const laptopNear = evaluateScreenDistance(150, 480, baselineHeight, 0, 50);
  assert.equal(laptopNear.status, 'optimal');
  assert.equal(laptopNear.comfortDistanceCm, 50);
});

test('recommendComfortDistance gives optometrically sound targets based on screen presets and inches', () => {
  const compact = recommendComfortDistance('compact_laptop');
  assert.equal(compact.recommendedComfortCm, 50);
  assert.equal(compact.minSafeCm, 40);

  const std = recommendComfortDistance('standard_laptop');
  assert.equal(std.recommendedComfortCm, 55);

  const desktop = recommendComfortDistance('desktop_monitor');
  assert.equal(desktop.recommendedComfortCm, 65);

  const ultrawide = recommendComfortDistance('large_ultrawide');
  assert.equal(ultrawide.recommendedComfortCm, 75);

  // Numeric diagonal inches
  assert.equal(recommendComfortDistance(13).recommendedComfortCm, 50);
  assert.equal(recommendComfortDistance(16).recommendedComfortCm, 55);
  assert.equal(recommendComfortDistance(27).recommendedComfortCm, 65);
  assert.equal(recommendComfortDistance(34).recommendedComfortCm, 75);
});

test('inferScreenPresetFromEnvironment detects laptops vs large displays', () => {
  // 14" MacBook Pro
  assert.equal(inferScreenPresetFromEnvironment(1512, 982, 2), 'compact_laptop');
  // 16" MacBook Pro
  assert.equal(inferScreenPresetFromEnvironment(1728, 1117, 2), 'standard_laptop');
  // 34" Ultrawide monitor
  assert.equal(inferScreenPresetFromEnvironment(3440, 1440, 1), 'large_ultrawide');
  // Standard 24"-27" external display
  assert.equal(inferScreenPresetFromEnvironment(1920, 1080, 1), 'desktop_monitor');
});

test('DutyCycledEyeStrainEstimator tracks blink transitions and fatigue score', () => {
  const est = new DutyCycledEyeStrainEstimator(true);
  assert.equal(est.isEnabled(), true);
  assert.equal(est.getEstimate().blinkRatePerMinute, 0);
  assert.equal(est.getEstimate().fatigueScore, 1);

  // Simulate 8 open->closed->open blink cycles
  for (let i = 0; i < 8; i++) {
    est.sampleBlink(0.8, 0.8); // closed
    est.sampleBlink(0.1, 0.1); // open
  }

  const snap = est.getEstimate();
  assert.equal(snap.blinkRatePerMinute, 8);
  assert.equal(snap.fatigueScore, 0.5);
  assert.equal(snap.isBlinking, false);
});

test('computeDetectionDelayMs computes AC delays and battery overrides', () => {
  assert.equal(computeDetectionDelayMs(1, false, 1.0), 1000);
  assert.equal(computeDetectionDelayMs(2, false, 1.0), 500);
  assert.equal(computeDetectionDelayMs(3, false, 1.0), 333);
  assert.equal(computeDetectionDelayMs(5, false, 1.0), 200);
  assert.equal(computeDetectionDelayMs(5, true, 0.5), 2000);
  assert.equal(computeDetectionDelayMs(5, true, 0.15), 2500);
});

test('getBreakCoachStep cycles breathing phases and rotates desk stretches every 30s', () => {
  const s0 = getBreakCoachStep(0);
  assert.equal(s0.breathPhase, 'Inhale');
  assert.equal(s0.breathPhaseSecondsLeft, 4);
  assert.equal(s0.stretchTitle, '20-20-20 Far Gaze');

  const s5 = getBreakCoachStep(5);
  assert.equal(s5.breathPhase, 'Hold');
  assert.equal(s5.breathPhaseSecondsLeft, 3);

  const s10 = getBreakCoachStep(10);
  assert.equal(s10.breathPhase, 'Exhale');
  assert.equal(s10.breathPhaseSecondsLeft, 4);

  const s30 = getBreakCoachStep(30);
  assert.equal(s30.stretchTitle, 'Cervical Neck Release');

  const s60 = getBreakCoachStep(60);
  assert.equal(s60.stretchTitle, 'Scapular Wall / Desk Squeeze');
});

test('extractFaceSignature and verifyPrimaryUserIdentity are scale-invariant and trigger lock after 6 mismatches', () => {
  const primaryFace = {
    boundingBox: { originX: 200, originY: 100, width: 120, height: 150 },
    keypoints: [
      { x: 235, y: 145 }, // right eye
      { x: 285, y: 145 }, // left eye (eyeDist = 50)
      { x: 260, y: 175 }, // nose
      { x: 260, y: 205 }, // mouth
      { x: 205, y: 150 }, // right ear
      { x: 315, y: 150 }, // left ear
    ],
  };

  // Same user scaled by 1.5x and shifted
  const scaledPrimaryFace = {
    boundingBox: { originX: 100, originY: 50, width: 180, height: 225 },
    keypoints: primaryFace.keypoints.map((p) => ({
      x: 100 + (p.x - 200) * 1.5,
      y: 50 + (p.y - 100) * 1.5,
    })),
  };

  const enrolledSig = extractFaceSignature(primaryFace);
  const scaledSig = extractFaceSignature(scaledPrimaryFace);
  assert.ok(enrolledSig && enrolledSig.length === 6);
  assert.ok(scaledSig && scaledSig.length === 6);

  // Ratios 0..3 and 5 are strictly identical under scaling
  assert.equal(enrolledSig[0], scaledSig[0]);
  assert.equal(enrolledSig[1], scaledSig[1]);
  assert.equal(enrolledSig[2], scaledSig[2]);
  assert.equal(enrolledSig[3], scaledSig[3]);
  assert.equal(enrolledSig[5], scaledSig[5]);

  const matchCheck = verifyPrimaryUserIdentity(scaledSig, enrolledSig, 0);
  assert.equal(matchCheck.isRecognized, true);
  assert.equal(matchCheck.nextMismatchCounter, 0);
  assert.equal(matchCheck.shouldLock, false);

  // Different facial geometry (intruder with very different proportions)
  const intruderFace = {
    boundingBox: { originX: 200, originY: 100, width: 160, height: 120 },
    keypoints: [
      { x: 245, y: 145 },
      { x: 275, y: 145 }, // eyeDist = 30
      { x: 260, y: 195 }, // much longer nose relative to eyeDist
      { x: 260, y: 245 }, // much lower mouth
      { x: 190, y: 150 }, // wider ears
      { x: 330, y: 150 },
    ],
  };
  const intruderSig = extractFaceSignature(intruderFace);

  let mismatchCounter = 0;
  for (let i = 1; i <= 5; i++) {
    const check = verifyPrimaryUserIdentity(intruderSig, enrolledSig, mismatchCounter);
    mismatchCounter = check.nextMismatchCounter;
    assert.equal(check.isRecognized, false);
    assert.equal(mismatchCounter, i);
    assert.equal(check.shouldLock, false);
  }

  const sixthCheck = verifyPrimaryUserIdentity(intruderSig, enrolledSig, mismatchCounter);
  assert.equal(sixthCheck.isRecognized, false);
  assert.equal(sixthCheck.nextMismatchCounter, 6);
  assert.equal(sixthCheck.shouldLock, true);

  // MediaPipe real-world coordinate test: normalized [0..1] keypoints + pixel boundingBox on 640x480 frame
  const normalizedMediaPipeFace = {
    boundingBox: { originX: 200, originY: 100, width: 120, height: 150 },
    keypoints: primaryFace.keypoints.map((p) => ({
      x: p.x / 640,
      y: p.y / 480,
    })),
  };
  const normalizedSig = extractFaceSignature(normalizedMediaPipeFace, 640, 480);
  assert.deepEqual(normalizedSig, enrolledSig);
});

test('formatTrayTitle formats alert titles, ocular rests, and focus minutes correctly', () => {
  // Disabled
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 100, 3000, 0, 600, false, false, false), null);

  // Paused
  assert.equal(formatTrayTitle('TrackingActive', true, false, 0, 100, 3000, 0, 600), 'Paused');

  // Micro break active (takes precedence over active work countdown)
  assert.equal(formatTrayTitle('TrackingActive', false, true, 19, 1200, 3000, 0, 600), '👁️ 19s');

  // Break prompt
  assert.equal(formatTrayTitle('BreakPrompt', false, false, 0, 3000, 3000, 0, 600), '⚠️ Break!');

  // Break mode active
  assert.equal(formatTrayTitle('BreakMode', false, false, 0, 3000, 3000, 120, 600), 'Break 8m');

  // TrackingActive with ergonomic alerts
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 500, 3000, 0, 600, true, false, true, true), '⚠️ Move Back!');
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 500, 3000, 0, 600, false, true, true, true), '⚠️ Sit Up!');
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 500, 3000, 0, 600, true, true, true, true), '⚠️ Posture!');

  // Ergonomic alerts disabled by user setting -> displays focus minutes remaining
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 500, 3000, 0, 600, true, true, true, false), '42m');

  // Normal active tracking countdown (3000s - 500s = 2500s -> ceil(2500/60) = 42m)
  assert.equal(formatTrayTitle('TrackingActive', false, false, 0, 500, 3000, 0, 600, false, false, true, true), '42m');
});


