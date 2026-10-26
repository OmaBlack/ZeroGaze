# Plan 009: Implement Historical Analytics and Multi-Day Trend Charts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> the live code in `src-tauri/src/db/mod.rs` and `src-tauri/src/commands.rs`.
> If signatures or structures mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

The dashboard currently only surfaces today's instantaneous statistics (`stat-active-today` and `stat-compliance`). Users cannot review their 7-day focus trends, streak consistency, or multi-day break compliance. Providing a clean, zero-dependency SVG habit chart helps knowledge workers sustain healthy ergonomics across the entire workweek without introducing external charting libraries.

## Current state

- Relevant files:
  - `src-tauri/src/db/mod.rs:251-267` — `get_today_stats(&self, date_str: &str)` queries a single date row.
  - `src-tauri/src/commands.rs:125-128` — `get_today_stats` command.
  - `index.html:93-119` — 4-card statistics grid displaying today's values.
  - `src/main.ts:258-275` — updates today's stats every second from snapshot.
- Current excerpt (`src-tauri/src/commands.rs:125-128`):
```rust
#[tauri::command]
pub fn get_today_stats(date_str: String, state: State<'_, AppSharedState>) -> Result<DailyStats, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.get_today_stats(&date_str).map_err(|e| e.to_string())
}
```
- Design conventions:
  - Zero heavy third-party charting libraries (no Chart.js, D3, or Recharts). Use clean, performant inline SVG with `--text-muted`, `--accent-primary`, and `--card-bg` CSS tokens.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust check | `cargo check` (in `src-tauri`) | exit 0 |
| Rust tests | `cargo test` (in `src-tauri`) | all pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs` (add `get_recent_daily_stats(&self, days: i64) -> Result<Vec<DailyStats>>`)
- `src-tauri/src/commands.rs` (add `get_recent_stats` command)
- `src-tauri/src/lib.rs` (register `get_recent_stats`)
- `index.html` (add `#trends-card` with 7-day bar chart and streak counter)
- `src/style.css` (style chart bars, hover states, axis labels, and streak pill)
- `src/main.ts` (fetch recent stats and construct SVG bars)

**Out of scope**:
- Modifying SQLite table schema.
- Complex multi-series line chart spline curves.

## Steps

### Step 1: Add date-range query in `src-tauri/src/db/mod.rs`

1. In `src-tauri/src/db/mod.rs`:
   ```rust
   pub fn get_recent_daily_stats(&self, limit_days: i64) -> Result<Vec<DailyStats>> {
       let mut stmt = self.conn.prepare(
           "SELECT date, active_seconds, present_seconds, breaks_taken, breaks_skipped, breaks_deferred, compliance_pct
            FROM daily_stats
            ORDER BY date DESC
            LIMIT ?1",
       )?;
       let rows = stmt.query_map(params![limit_days], |row| {
           Ok(DailyStats {
               date: row.get(0)?,
               active_seconds: row.get(1)?,
               present_seconds: row.get(2)?,
               breaks_taken: row.get(3)?,
               breaks_skipped: row.get(4)?,
               breaks_deferred: row.get(5)?,
               compliance_pct: row.get(6)?,
           })
       })?;
       let mut stats = Vec::new();
       for item in rows {
           stats.push(item?);
       }
       stats.reverse(); // Order chronologically ascending
       Ok(stats)
   }
   ```

**Verify**: `cargo test` in `src-tauri` passes.

### Step 2: Expose `get_recent_stats` IPC command

1. In `src-tauri/src/commands.rs`:
   ```rust
   #[tauri::command]
   pub fn get_recent_stats(days: i64, state: State<'_, AppSharedState>) -> Result<Vec<DailyStats>, String> {
       let db = state.db.lock().map_err(|e| e.to_string())?;
       db.get_recent_daily_stats(days).map_err(|e| e.to_string())
   }
   ```
2. In `src-tauri/src/lib.rs`, register `commands::get_recent_stats`.

**Verify**: `cargo check` in `src-tauri` exits 0.

### Step 3: Implement SVG trend card in `index.html`, `style.css`, and `main.ts`

1. In `index.html`, add `<section class="card trends-card">` beneath `.stats-grid`:
   ```html
   <section class="card trends-card">
     <div class="trends-header">
       <span class="label">7-DAY FOCUS & COMPLIANCE TRENDS</span>
       <span id="streak-badge" class="badge badge-success">🔥 1 Day Streak</span>
     </div>
     <div id="chart-container" class="chart-container">
       <svg id="trend-chart" width="100%" height="120" preserveAspectRatio="none"></svg>
     </div>
     <div class="chart-legend">
       <span class="legend-item"><span class="legend-dot active-dot"></span> Active Focus Hours</span>
       <span class="legend-item"><span class="legend-dot break-dot"></span> Breaks Compliance</span>
     </div>
   </section>
   ```
2. In `src/style.css`, style `.trends-card`, `.chart-container`, and `.trends-header`.
3. In `src/main.ts`, add `async function refreshTrendsChart()`:
   - Call `invoke<DailyStats[]>("get_recent_stats", { days: 7 })`.
   - Calculate streaks (consecutive days with `active_seconds > 0`).
   - Dynamically render SVG `<rect>` elements scaled to max daily focus time, with tooltips displaying hours and breaks.

**Verify**: `npm run build` exits 0.

## Test plan

- Unit test in `src-tauri/src/db/mod.rs`:
  - `test_get_recent_daily_stats`: insert stats across multiple dates, verify `get_recent_daily_stats(7)` returns correctly sorted records bounded by 7.
- Verification command: `cargo test -- db::tests::test_get_recent` → passes.

## Done criteria

- [ ] `cargo test` passes with multi-day queries.
- [ ] `npm run build` exits 0.
- [ ] 7-day SVG chart renders on dashboard with active hours and streak pill.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If empty database results cause divide-by-zero errors in chart rendering (provide empty-state placeholder in SVG).
