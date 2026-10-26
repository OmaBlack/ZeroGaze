import test from 'node:test';
import assert from 'node:assert/strict';
import { generateErgonomicReportHtml } from '../.test-dist/charts.js';

test('generateErgonomicReportHtml handles 7-day stats with metrics and table rows', () => {
  const stats = [
    {
      date: '2026-10-15',
      active_seconds: 7200,
      present_seconds: 7000,
      breaks_taken: 4,
      breaks_skipped: 1,
      breaks_deferred: 0,
      compliance_pct: 80,
    },
    {
      date: '2026-10-16',
      active_seconds: 14400,
      present_seconds: 14000,
      breaks_taken: 8,
      breaks_skipped: 0,
      breaks_deferred: 0,
      compliance_pct: 100,
    },
  ];

  const html = generateErgonomicReportHtml(stats, '2026-10-16');

  assert.ok(html.includes('ZeroGaze - Weekly Ergonomic Health Summary'));
  assert.ok(html.includes('Generated on 2026-10-16'));
  assert.ok(html.includes('2026-10-15'));
  assert.ok(html.includes('2026-10-16'));
  assert.ok(html.includes('3.0h')); // (7200 + 14400) / 2 / 3600 = 3.0h
  assert.ok(html.includes('90%')); // (80 + 100) / 2 = 90%
  assert.ok(html.includes('12')); // total breaks taken = 12
  assert.ok(html.includes('1')); // total breaks skipped = 1
});

test('generateErgonomicReportHtml handles empty stats gracefully without division by zero', () => {
  const html = generateErgonomicReportHtml([], '2026-10-21');

  assert.ok(html.includes('ZeroGaze - Weekly Ergonomic Health Summary'));
  assert.ok(html.includes('0.0h'));
  assert.ok(html.includes('100%'));
  assert.ok(!html.includes('NaN'));
});
