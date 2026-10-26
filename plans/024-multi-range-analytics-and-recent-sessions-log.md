# Plan 024: Implement Multi-Range Analytics (`7D` / `30D`), Present vs. Active Breakdown, and Recent Session Log

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts against
> `src-tauri/src/db/mod.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`,
> `index.html`, and `src/main.ts`; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [018](018-retention-session-persistence-and-lock-decoupling.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

PRD §4.4 ("Time Logging & Analytics") and §4.9 ("Dashboard UI") specify:
1. Differentiating **Present Time** vs. **Active Time** on the dashboard (`StateSnapshot` already carries `present_seconds_today` alongside `active_seconds_today`, but `src/main.ts:300` only renders `active_seconds_today`).
2. Multi-range historical views (**Week `7D`** and **Month `30D`**) in the trends chart (`src/main.ts:548` currently hardcodes `{ days: 7 }`).
3. Displaying recent focus session timestamps and durations from the `sessions` table (populated by `StateMachine::flush_current_session` in Plan 018).

Surfacing `present_seconds_today`, adding a `7D / 30D` range selector to the trends chart, and adding a `get_recent_sessions` Tauri command with a compact recent-sessions list on the dashboard gives users visibility into their historical work patterns without leaving the main window.

## Current state

Relevant files and excerpts:

1. `src-tauri/src/db/mod.rs:357-379` — `get_all_sessions` exists, and `get_recent_daily_stats(limit_days: i64)` exists at `lines 487-511`:
```rust
    pub fn get_all_sessions(&self) -> Result<Vec<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id
             FROM sessions
             ORDER BY start_ts ASC",
        )?;
```

2. `index.html:105-109` — Today's Active Time stat card:
```html
          <div class="card stat-card">
            <span class="stat-label">Active Time Today</span>
            <div class="stat-value" id="stat-active-today">0h 0m</div>
            <span class="stat-sub">Screen engaged time</span>
          </div>
```

3. `index.html:136-155` — 7-Day Habit & Compliance Trends card:
```html
        <!-- 7-Day Habit & Compliance Trends -->
        <section class="card trends-card">
          <div class="trends-header">
            <div class="trends-title">
              <span class="label">7-DAY FOCUS & BREAK COMPLIANCE</span>
              <span id="streak-badge" class="streak-badge">🔥 1 Day Streak</span>
            </div>
```

## Commands you will need

Note: Prepend `export PATH="$PATH:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin";` when running shell commands.

| Purpose | Command | Expected on success |
|---|---|---|
| Rust typecheck | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0 |
| Rust unit tests | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend unit tests | `npm test` | exit 0 |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `index.html`
- `src/main.ts`
- `src/style.css`

**Out of scope**:
- Adding external charting libraries (keep the lightweight inline SVG renderer).

## Steps

### Step 1: Add `Database::get_recent_sessions` and `commands::get_recent_sessions`

1. In `src-tauri/src/db/mod.rs`:
   - Add `pub fn get_recent_sessions(&self, limit: i64) -> Result<Vec<SessionRecord>>` querying:
     ```sql
     SELECT id, start_ts, end_ts, active_seconds, present_seconds, mode, device_id
     FROM sessions
     ORDER BY end_ts DESC
     LIMIT ?1
     ```
   - Add unit test `test_get_recent_sessions` in `src-tauri/src/db/mod.rs` (`mod tests`).
2. In `src-tauri/src/commands.rs`:
   - Import `SessionRecord` from `crate::db::{DailyStats, SessionRecord};`.
   - Add:
     ```rust
     #[tauri::command]
     pub fn get_recent_sessions(limit: i64, state: State<'_, AppSharedState>) -> Result<Vec<SessionRecord>, String> {
         let db = state.db.lock().map_err(|e| e.to_string())?;
         db.get_recent_sessions(limit).map_err(|e| e.to_string())
     }
     ```
3. In `src-tauri/src/lib.rs`:
   - Register `commands::get_recent_sessions` in `tauri::generate_handler![...]`.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add `7D / 30D` Range Toggle, Present-Time Sub-Label, and Recent Sessions List to `index.html` & `src/style.css`

1. In `index.html`:
   - In the first `.stat-card` (`lines 105-109`), add `id="stat-present-today"` to the `.stat-sub` element:
     ```html
     <span class="stat-sub" id="stat-present-today">Present: 0m 0s • Screen engaged</span>
     ```
   - In `.trends-header` (`lines 137-146`), update the title label to `id="trends-range-label"` (`FOCUS & BREAK COMPLIANCE`) and add a `7D / 30D` pill switcher inside `.trends-legend`:
     ```html
     <div class="trends-range-toggle">
       <button type="button" id="btn-range-7d" class="btn-preset active" data-days="7">7D</button>
       <button type="button" id="btn-range-30d" class="btn-preset" data-days="30">30D</button>
     </div>
     ```
   - At the bottom of `.trends-card` (after `#trends-footer-labels`), add a compact recent-sessions log section:
     ```html
     <div class="recent-sessions-wrap">
       <span class="label">RECENT COMPLETED FOCUS SESSIONS</span>
       <div id="recent-sessions-list" class="recent-sessions-list">
         <span class="text-dim text-sm">Complete a focus session or break to see session logs.</span>
       </div>
     </div>
     ```
2. In `src/style.css`:
   - Add styles for `.trends-range-toggle`, `.recent-sessions-wrap`, `.recent-sessions-list`, and `.session-log-item` (flex row with timestamp, duration badge, and mode tag).

### Step 3: Wire `present_seconds_today`, `7D / 30D` Chart Scaling, and `get_recent_sessions` in `src/main.ts`

In `src/main.ts`:
1. Bind `statPresentTodayEl = document.getElementById('stat-present-today')`, `btnRange7d = document.getElementById('btn-range-7d')`, `btnRange30d = document.getElementById('btn-range-30d')`, and `recentSessionsListEl = document.getElementById('recent-sessions-list')`.
2. In `renderState(snapshot)`:
   - Update `statPresentTodayEl.textContent = \`Present: \${formatHumanDuration(snapshot.present_seconds_today)} • Engaged\`;`.
3. Add `let selectedTrendDays = 7;` and update `refreshTrendsChart()` to:
   - Fetch `await invoke<DailyStats[]>('get_recent_stats', { days: selectedTrendDays })` and render dynamic bar widths (`const barWidth = stats.length > 10 ? Math.max(8, Math.floor(420 / stats.length)) : 36;`) so up to 30 days fit cleanly inside the 600px SVG viewBox.
   - Fetch `await invoke<SessionRecord[]>('get_recent_sessions', { limit: 5 })` and render up to 5 recent sessions in `#recent-sessions-list`.
4. Wire `#btn-range-7d` and `#btn-range-30d` click listeners to update `selectedTrendDays`, toggle `.active`, and call `refreshTrendsChart()`.

**Verify**: `npm test && npm run build && cargo test --manifest-path src-tauri/Cargo.toml` → exits 0.

## Test plan

- File: `src-tauri/src/db/mod.rs` (`mod tests`)
- Cases covered: `test_get_recent_sessions` verifies descending `end_ts` ordering and `limit` enforcement.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml && npm test && npm run build` → all pass.

## Done criteria

- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_get_recent_sessions` passes
- [x] `npm test` exits 0
- [x] `npm run build` exits 0
- [x] `#stat-present-today`, `#btn-range-7d`, `#btn-range-30d`, and `#recent-sessions-list` exist in `index.html` and are wired in `src/main.ts`
- [x] `plans/README.md` status row for Plan 024 updated to `DONE`

## STOP conditions

- Any existing test in `db::tests` breaks.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- When rendering >7 bars in `renderTrendsChart`, only render footer date labels every Nth bar (e.g. `idx % Math.ceil(stats.length / 7) === 0`) so 30-day date labels never overlap horizontally.
