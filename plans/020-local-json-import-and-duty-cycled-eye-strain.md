# Plan 020: Implement Local JSON Backup Import/Restore and Wire Duty-Cycled Eye-Strain Blink Estimator

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: Compare the "Current state" excerpts below
> against `src-tauri/src/db/mod.rs`, `src-tauri/src/commands.rs`,
> `src-tauri/src/lib.rs`, `index.html`, and `src/main.ts`. On a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: [018](018-retention-session-persistence-and-lock-decoupling.md), [019](019-backend-edge-case-and-frontend-unit-tests.md)
- **Category**: direction
- **Planned at**: unversioned workspace, 2026-10-18

## Why this matters

Two high-value features specified in `prd.md` and `FEATURES.md` are half-built in the codebase:
1. **Local JSON Backup Import (`prd.md:58, 254, 259`)**: `ExportBundle` in `src-tauri/src/db/mod.rs` already derives `Serialize` and `Deserialize`, and users can export JSON backups, but there is no `import_data_json` command or UI button to restore a backup when migrating machines or recovering from a reset.
2. **Live Ocular Fatigue / Blink-Rate Indicator (`FEATURES.md:32-33`, `src/main.ts:741-794`)**: `DutyCycledEyeStrainEstimator` is already implemented in the frontend, and MediaPipe `FaceDetector` returns 6 facial keypoints (right eye `[0]`, left eye `[1]`, nose tip `[2]`, mouth `[3]`, right ear tragion `[4]`, left ear tragion `[5]`). Duty-cycling estimator updates during active CV sessions and surfacing an ambient ocular comfort indicator in the Computer Vision Status card completes the promised digital eye-strain architecture without exceeding the `<5%` CPU budget.

## Current state

- Relevant files:
  - `src-tauri/src/db/mod.rs` — `ExportBundle` (`lines 42-48`), `export_json` (`lines 404-412`).
  - `src-tauri/src/commands.rs` — `export_data_json` (`lines 130-134`).
  - `src-tauri/src/lib.rs` — `tauri::generate_handler![...]`.
  - `index.html` — `.settings-data-zone` export buttons (`lines 283-287`).
  - `src/main.ts` — `exportData` (`lines 600-618`) and `eyeStrainSpike` (`lines 794`).

- Current code excerpts:

`src-tauri/src/db/mod.rs:42-48`:
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportBundle {
    pub exported_at: String,
    pub daily_stats: Vec<DailyStats>,
    pub sessions: Vec<SessionRecord>,
    pub breaks: Vec<BreakRecord>,
}
```

`index.html:279-288`:
```html
              <div class="settings-data-zone">
                <h4>Local Data Portability</h4>
                <p class="text-sm text-dim">Export complete session, break, and compliance logs.</p>
                <div class="export-buttons-row">
                  <button id="btn-export-json" class="btn btn-secondary">Export JSON</button>
                  <button id="btn-export-csv" class="btn btn-secondary">Export CSV</button>
                  <button id="btn-export-report-card" class="btn btn-secondary">Export Ergonomic Report</button>
                </div>
              </div>
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` | exit 0, no errors |
| Cargo test | `cargo test --manifest-path src-tauri/Cargo.toml` | exit 0, all tests pass |
| Frontend test | `npm test` | exit 0, all tests pass |
| Frontend build | `npm run build` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/db/mod.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/lib.rs`
- `index.html`
- `src/main.ts`

**Out of scope**:
- Cloud sync or external network requests (strictly prohibited by `PRODUCT.md`).
- Bundling heavy new TFLite models in `public/models/`.

## Steps

### Step 1: Implement `Database::import_json` and `commands::import_data_json`

1. In `src-tauri/src/db/mod.rs`:
   - Add `pub fn import_json(&mut self, json_str: &str) -> Result<usize>`:
     - Deserialize `bundle: ExportBundle = serde_json::from_str(json_str).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))?;`.
     - Open a transaction (`let tx = self.conn.transaction()?;`) and upsert each row in `bundle.daily_stats`, `bundle.sessions`, and `bundle.breaks` using `INSERT OR REPLACE INTO ...`.
     - Commit the transaction and return `Ok(bundle.daily_stats.len() + bundle.sessions.len() + bundle.breaks.len())`.
2. In `src-tauri/src/commands.rs`:
   - Add:
     ```rust
     #[tauri::command]
     pub fn import_data_json(json_payload: String, state: State<'_, AppSharedState>) -> Result<usize, String> {
         let mut db = state.db.lock().map_err(|e| e.to_string())?;
         db.import_json(&json_payload).map_err(|e| e.to_string())
     }
     ```
3. In `src-tauri/src/lib.rs`:
   - Register `commands::import_data_json` in `tauri::generate_handler![...]`.

**Verify**:
`cargo check --manifest-path src-tauri/Cargo.toml` → exits 0.

### Step 2: Add Round-Trip Export/Import Unit Test in `db/mod.rs`

In `src-tauri/src/db/mod.rs` (`mod tests`):
- Add `test_export_and_import_json_roundtrip`:
  - Populate `db1` with `daily_stats`, a `SessionRecord`, and a `BreakRecord`.
  - Call `let json = db1.export_json().unwrap();`.
  - Create a fresh `mut db2 = Database::new_in_memory().unwrap();`, call `let count = db2.import_json(&json).unwrap();`.
  - Assert `count == 3` and verify `db2.get_all_daily_stats()`, `db2.get_all_sessions()`, and `db2.get_all_breaks()` match `db1`.

**Verify**:
`cargo test --manifest-path src-tauri/Cargo.toml` → exits 0, all tests pass.

### Step 3: Wire JSON Backup Import Button and Duty-Cycled Eye-Strain Status in Frontend

1. In `index.html`:
   - Inside `.settings-data-zone .export-buttons-row`, add:
     ```html
     <button type="button" id="btn-import-json" class="btn btn-secondary">Import JSON</button>
     <input type="file" id="input-import-json" accept="application/json,.json" class="hidden" />
     ```
2. In `src/main.ts`:
   - Wire `#btn-import-json` to trigger `inputImportJson.click()`.
   - When a file is selected, read its text via `await file.text()`, invoke `import_data_json({ jsonPayload: text })`, refresh `get_state` and `refreshTrendsChart()`, and alert the number of restored records.
   - Enable `eyeStrainSpike` in duty-cycled mode (`new DutyCycledEyeStrainEstimator(true)`) and update `statCvConfEl` during `TrackingActive` to include ocular strain status alongside confidence (`Confidence: 95% • Ocular Comfort: Optimal`).

**Verify**:
`npm test && npm run build` → exits 0.

## Test plan

- Backend test: `test_export_and_import_json_roundtrip` in `src-tauri/src/db/mod.rs` verifying lossless JSON export and import across `daily_stats`, `sessions`, and `breaks`.
- Frontend test & build: `npm test` and `npm run build`.

## Done criteria

- [x] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0; `test_export_and_import_json_roundtrip` passes
- [x] `npm test` exits 0
- [x] `npm run build` exits 0
- [x] `#btn-import-json` and `#input-import-json` exist in `index.html` and invoke `import_data_json`
- [x] `plans/README.md` status row for Plan 020 updated to `DONE`

## STOP conditions

- Deserializing malformed JSON in `import_json` panics instead of returning `Result::Err` — never use `.unwrap()` on user-supplied JSON in `import_json`.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

- `Database::import_json` must always execute inside a SQLite transaction (`self.conn.transaction()`) so a partial or invalid import rolls back cleanly without corrupting existing local history.
