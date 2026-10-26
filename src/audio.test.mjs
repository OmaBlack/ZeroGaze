import test from 'node:test';
import assert from 'node:assert/strict';
import { playBreakChime, playPostureWarningChime } from '../.test-dist/audio.js';

test('playBreakChime no-ops cleanly when soundEnabled is false', () => {
  // Should not throw or access window.AudioContext
  assert.doesNotThrow(() => {
    playBreakChime('prompt', false);
    playBreakChime('complete', false);
  });
});

test('playPostureWarningChime throttles calls made within 6000ms cooldown window', () => {
  const initialTs = 100000;
  // If last audio played 2 seconds ago (current Date.now() is much later, so pass a recent fake timestamp):
  const now = Date.now();
  const recentTs = now - 2000; // only 2s ago

  const resultTs = playPostureWarningChime(true, recentTs);
  // Must return the exact same timestamp without re-firing
  assert.equal(resultTs, recentTs);
});

test('playPostureWarningChime no-ops and preserves timestamp when postureAlertSoundEnabled is false', () => {
  const pastTs = 50000;
  const resultTs = playPostureWarningChime(false, pastTs);
  assert.equal(resultTs, pastTs);
});

test('playPostureWarningChime updates timestamp and handles environment with mock AudioContext', () => {
  let createdOscillator = false;
  let startedOscillator = false;

  class MockGainNode {
    gain = {
      setValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
    };
    connect() {}
  }

  class MockOscillator {
    type = 'sine';
    frequency = {
      setValueAtTime: () => {},
    };
    connect() {}
    start() {
      startedOscillator = true;
    }
    stop() {}
  }

  class MockAudioContext {
    currentTime = 0;
    createGain() {
      return new MockGainNode();
    }
    createOscillator() {
      createdOscillator = true;
      return new MockOscillator();
    }
    close() {
      return Promise.resolve();
    }
    get destination() {
      return {};
    }
  }

  // Inject mock window object
  globalThis.window = {
    AudioContext: MockAudioContext,
  };

  const oldTs = Date.now() - 10000; // 10 seconds ago
  const newTs = playPostureWarningChime(true, oldTs);

  assert.ok(newTs > oldTs);
  assert.equal(createdOscillator, true);
  assert.equal(startedOscillator, true);

  // Clean up
  delete globalThis.window;
});
