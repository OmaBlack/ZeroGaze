import { calculateStreakDays, formatHumanDuration } from './ergonomics.js';

export interface DailyStats {
  date: string;
  active_seconds: number;
  present_seconds: number;
  breaks_taken: number;
  breaks_skipped: number;
  breaks_deferred: number;
  compliance_pct: number;
}

export function renderTrendsChart(
  svg: SVGSVGElement | null,
  footer: HTMLElement | null,
  streakBadge: HTMLElement | null,
  stats: DailyStats[]
): void {
  if (!svg || !footer) return;

  // Calculate streak (consecutive recent days with active_seconds > 60)
  const streak = calculateStreakDays(stats);
  if (streakBadge) {
    streakBadge.textContent = `${streak} Day Streak`;
  }

  svg.innerHTML = '';
  footer.innerHTML = '';

  if (stats.length === 0) {
    svg.innerHTML = '<text x="50%" y="55" fill="#64748b" text-anchor="middle" font-size="12">No recent session data yet</text>';
    return;
  }

  const maxActive = Math.max(...stats.map((s) => s.active_seconds), 3600);
  const width = 600;
  const height = 90;
  const barWidth = stats.length > 10 ? Math.max(8, Math.floor(420 / stats.length)) : 36;
  const gap = (width - stats.length * barWidth) / (stats.length + 1);
  const labelStep = stats.length > 7 ? Math.ceil(stats.length / 7) : 1;

  stats.forEach((day, idx) => {
    const x = gap + idx * (barWidth + gap);
    const activeH = Math.max(6, (day.active_seconds / maxActive) * height);
    const y = height - activeH;

    // Active focus bar
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x.toString());
    rect.setAttribute('y', y.toString());
    rect.setAttribute('width', barWidth.toString());
    rect.setAttribute('height', activeH.toString());
    rect.setAttribute('rx', '4');
    rect.setAttribute('fill', '#38bdf8');
    rect.setAttribute('opacity', '0.85');

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${day.date}: ${formatHumanDuration(day.active_seconds)} focus, ${Math.round(day.compliance_pct)}% compliance`;
    rect.appendChild(title);
    svg.appendChild(rect);

    // Compliance dot
    if (day.compliance_pct > 0) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', (x + barWidth / 2).toString());
      circle.setAttribute('cy', Math.max(10, y - 8).toString());
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', '#10b981');
      svg.appendChild(circle);
    }

    // Day label (spaced when rendering > 7 bars)
    if (idx % labelStep === 0 || idx === stats.length - 1) {
      const label = document.createElement('span');
      const d = new Date(day.date + 'T00:00:00');
      label.textContent = isNaN(d.getTime())
        ? day.date.slice(5)
        : stats.length > 7
          ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : d.toLocaleDateString(undefined, { weekday: 'short' });
      footer.appendChild(label);
    }
  });
}

export function generateErgonomicReportHtml(stats: DailyStats[], today: string): string {
  const totalActiveSecs = stats.reduce((acc, s) => acc + s.active_seconds, 0);
  const avgActiveHours = (totalActiveSecs / (stats.length || 1) / 3600).toFixed(1);
  const totalBreaksTaken = stats.reduce((acc, s) => acc + s.breaks_taken, 0);
  const totalBreaksSkipped = stats.reduce((acc, s) => acc + s.breaks_skipped, 0);
  const avgCompliance = stats.length > 0
    ? Math.round(stats.reduce((acc, s) => acc + s.compliance_pct, 0) / stats.length)
    : 100;

  const rowsHtml = stats.map((s) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #2d3748; text-align: start;">${s.date}</td>
      <td style="padding: 10px; border-bottom: 1px solid #2d3748; text-align: end;">${(s.active_seconds / 3600).toFixed(1)}h</td>
      <td style="padding: 10px; border-bottom: 1px solid #2d3748; text-align: end; color: #34d399;">${s.breaks_taken}</td>
      <td style="padding: 10px; border-bottom: 1px solid #2d3748; text-align: end; color: #f87171;">${s.breaks_skipped}</td>
      <td style="padding: 10px; border-bottom: 1px solid #2d3748; text-align: end; font-weight: 600; color: ${s.compliance_pct >= 70 ? '#34d399' : '#fbbf24'};">${s.compliance_pct}%</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZeroGaze - Weekly Ergonomic Health Summary</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0a0d14; color: #f3f4f6; margin: 0; padding: 24px; }
    .card { max-width: 720px; margin-inline: auto; background: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 32px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { margin-top: 0; font-size: 24px; color: #34d399; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .subtitle { color: #9ca3af; font-size: 14px; margin-bottom: 24px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr)); gap: 16px; margin-bottom: 28px; }
    .metric-box { min-width: 0; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 24px; font-weight: bold; color: #fff; margin-bottom: 4px; }
    .metric-label { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
    .table-wrap { width: 100%; overflow-x: auto; margin-bottom: 28px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: start; padding: 10px; border-bottom: 2px solid #374151; color: #9ca3af; font-size: 12px; text-transform: uppercase; }
    th.num { text-align: end; }
    .ergo-tips { background: rgba(52, 211, 153, 0.08); border-inline-start: 4px solid #34d399; padding: 16px; border-radius: 4px; font-size: 13px; line-height: 1.6; color: #d1fae5; }
    .footer { margin-top: 24px; text-align: center; font-size: 12px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <h1>ZeroGaze • Weekly Ergonomic Summary</h1>
    <div class="subtitle">Generated on ${today} • 100% On-Device Privacy Guaranteed</div>
    <div class="metrics">
      <div class="metric-box">
        <div class="metric-value">${avgActiveHours}h</div>
        <div class="metric-label">Daily Avg Time</div>
      </div>
      <div class="metric-box">
        <div class="metric-value" style="color: #34d399;">${avgCompliance}%</div>
        <div class="metric-label">Compliance</div>
      </div>
      <div class="metric-box">
        <div class="metric-value" style="color: #34d399;">${totalBreaksTaken}</div>
        <div class="metric-label">Breaks Taken</div>
      </div>
      <div class="metric-box">
        <div class="metric-value" style="color: #f87171;">${totalBreaksSkipped}</div>
        <div class="metric-label">Breaks Skipped</div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th class="num">Screen Time</th>
            <th class="num">Taken</th>
            <th class="num">Skipped</th>
            <th class="num">Compliance</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div class="ergo-tips">
      <strong>Ergonomic Insight (20-20-20 Rule):</strong>
      For every 20 minutes of continuous focus, gaze at an object 20 feet away for at least 20 seconds. This allows ciliary eye muscles to relax, restoring natural blink rates and preventing digital ocular fatigue.
    </div>
    <div class="footer">ZeroGaze Desktop • Privacy-First Screen Wellbeing</div>
  </div>
</body>
</html>`;
}
