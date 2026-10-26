# Plan 006: Implement Local Data Export (CSV and JSON) and Backup

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
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [001](001-fix-break-flow-and-stats.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-14

## Why this matters

FocusGaze is positioned as a 100% local, privacy-first desktop application. While users can currently delete their data (`delete_all_data`), they cannot export their history or create backups. Adding CSV and JSON export allows privacy-conscious knowledge workers to analyze their focus rhythms in spreadsheets and backup their local database before machine migration or data clearing.

## Current state

- Relevant files:
  - `src-tauri/src/db/mod.rs` — owns SQLite connection and queries (`DailyStats`, `SessionRecord`, `BreakRecord`).
  - `src-tauri/src/commands.rs` — exposes IPC commands to frontend; currently has `delete_all_data` but no export endpoint.
  - `src-tauri/src/lib.rs` — registers invocable Tauri commands.
  - `index.html` — settings modal with "Delete All Local Data" button; lacks export buttons.
  - `src/main.ts` — binds UI events to Tauri backend invocations.
- Current excerpt (`src-tauri/src/commands.rs:118-123`):
```rust
#[tauri::command]
pub fn delete_all_data(state: State<'_, AppSharedState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_all_user_data().map_err(|e| e.to_string())
}
```
- Exemplar conventions:
  - Error handling: return `Result<T, String>` from Tauri commands, mapping rusqlite errors with `.map_err(|e| e.to_string())`.
  - Design tokens: adhere to `--bg-card`, `--border`, `--text-primary`, `--text-muted` in `src/style.css`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust check | `cargo check` (in `src-tauri`) | exit 0 |
| Rust tests | `cargo test` (in `src-tauri`) | all pass (≥8 tests) |
| Frontend build | `npm run build` | exit 0, 0 TS errors |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs` (add export query methods)
- `src-tauri/src/commands.rs` (add `export_data_json` and `export_data_csv` commands)
- `src-tauri/src/lib.rs` (register export commands in `generate_handler![]`)
- `index.html` (add "Export Data (JSON)" and "Export Data (CSV)" buttons in Settings modal)
- `src/main.ts` (handle export button clicks and trigger download/save)

**Out of scope**:
- Cloud sync or remote API uploads.
- Any modification to existing `daily_stats` aggregation logic.

## Steps

### Step 1: Add query and export methods in `src-tauri/src/db/mod.rs`

1. Define an `ExportBundle` struct containing:
   ```rust
   #[derive(Debug, Serialize, Deserialize)]
   pub struct ExportBundle {
       pub exported_at: String,
       pub daily_stats: Vec<DailyStats>,
       pub sessions: Vec<SessionRecord>,
       pub breaks: Vec<BreakRecord>,
   }
   ```
2. Implement `Database::get_all_daily_stats(&self) -> Result<Vec<DailyStats>>`, `get_all_sessions(&self) -> Result<Vec<SessionRecord>>`, and `get_all_breaks(&self) -> Result<Vec<BreakRecord>>`.
3. Implement `Database::export_json(&self) -> Result<String>` using `serde_json::to_string_pretty`.
4. Implement `Database::export_csv_daily(&self) -> Result<String>` formatting header: `date,active_seconds,present_seconds,breaks_taken,breaks_skipped,breaks_deferred,compliance_pct`.

**Verify**: `cargo test` in `src-tauri` passes.

### Step 2: Expose Tauri IPC commands in `src-tauri/src/commands.rs` and `lib.rs`

1. Add `export_data_json(state: State<'_, AppSharedState>) -> Result<String, String>` returning the JSON bundle string.
2. Add `export_data_csv(state: State<'_, AppSharedState>) -> Result<String, String>` returning the CSV formatted string.
3. Register both commands in `tauri::generate_handler![...]` inside `src-tauri/src/lib.rs`.

**Verify**: `cargo check` in `src-tauri` exits 0.

### Step 3: Add Export UI controls in `index.html` and `src/main.ts`

1. In `index.html` inside `#settings-modal` privacy section, add:
   ```html
   <div class="settings-group">
     <label>Data Portability</label>
     <div class="modal-buttons" style="margin-top: 8px;">
       <button id="btn-export-json" class="btn btn-secondary">Export JSON</button>
       <button id="btn-export-csv" class="btn btn-secondary">Export CSV</button>
     </div>
   </div>
   ```
2. In `src/main.ts`, bind `#btn-export-json` and `#btn-export-csv`:
   - Call `invoke("export_data_json")` or `invoke("export_data_csv")`.
   - Create a dynamic `<a>` download element with `URL.createObjectURL(new Blob([content], { type: 'application/json' }))` and filename `focusgaze-export-[YYYY-MM-DD].json` / `.csv`.

**Verify**: `npm run build` exits 0.

## Test plan

- Unit tests in `src-tauri/src/db/mod.rs`:
  - `test_export_json_empty_and_populated`: seed dummy session/break records, verify `export_json` returns valid JSON with correct counts.
  - `test_export_csv_daily`: verify CSV header and row parsing.
- Verification command: `cargo test -- db::tests::test_export` → passes.

## Done criteria

- [ ] `cargo check` exits 0 in `src-tauri`.
- [ ] `cargo test` passes all tests with new export unit tests.
- [ ] `npm run build` exits 0.
- [ ] Clicking "Export JSON" and "Export CSV" generates valid file downloads.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If `serde_json` or `rusqlite` versions fail to compile with `ExportBundle`.
- If browser CSP blocks `Blob` creation for downloads (check `blob:` in `tauri.conf.json`).
