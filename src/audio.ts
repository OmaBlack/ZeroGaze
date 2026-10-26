// WebAudio synthesizers for focus break chimes and ergonomic warnings

export function playBreakChime(kind: 'prompt' | 'complete', soundEnabled: boolean): void {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = kind === 'prompt' ? [523.25, 659.25] : [587.33, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.36);
    });
    setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    }, 900);
  } catch {
    // WebView autoplay policy or missing audio device — ignore silently
  }
}

export function playPostureWarningChime(postureAlertSoundEnabled: boolean, lastAudioTs: number): number {
  if (!postureAlertSoundEnabled) return lastAudioTs;
  const now = Date.now();
  // Throttle loud audio warning to at most once every 6 seconds to prevent annoyance while maintaining strong salience
  if (now - lastAudioTs < 6000) return lastAudioTs;
  const updatedTs = now;

  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return updatedTs;
    const ctx = new AudioCtx();
    const ctxTime = ctx.currentTime;
    // Loud, urgent two-tone alert: 880 Hz (A5) -> 440 Hz (A4) with assertive sawtooth harmonic bite
    const tones = [
      { freq: 880, start: 0, duration: 0.18, gain: 0.22 },
      { freq: 440, start: 0.22, duration: 0.28, gain: 0.25 },
    ];
    tones.forEach((t) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(t.freq, ctxTime + t.start);
      gainNode.gain.setValueAtTime(0.001, ctxTime + t.start);
      gainNode.gain.exponentialRampToValueAtTime(t.gain, ctxTime + t.start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, ctxTime + t.start + t.duration);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(ctxTime + t.start);
      osc.stop(ctxTime + t.start + t.duration + 0.01);
    });
    setTimeout(() => {
      try {
        void ctx.close();
      } catch {
        // ignore
      }
    }, 900);
  } catch {
    // Audio device or autoplay restriction
  }
  return updatedTs;
}
