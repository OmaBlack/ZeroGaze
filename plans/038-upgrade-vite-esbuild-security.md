# Plan 038: Upgrade Vite and Esbuild to Resolve GHSA-67mh-4wv8-2f99 Security Advisory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

`npm audit` reports moderate/high severity advisories for `esbuild <=0.24.2` via `vite@5.4.21` (GHSA-67mh-4wv8-2f99). Updating `vite` to the latest patch or updating the lockfile to pull fixed `esbuild >=0.25.0` eliminates vulnerability warnings in automated CI scans and developer workstations.

## Current state

- Relevant files:
  - `package.json:22` — `"vite": "^5.4.2"`
  - `package-lock.json` — pinned `esbuild` version

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Audit check | `npm audit` | 0 vulnerabilities (or 0 high) |
| Bundle check | `npm run build` | exit 0 |
| Tests | `npm test` | exit 0 |

## Scope

**In scope**:
- `package.json`
- `package-lock.json`

**Out of scope**:
- Do not modify frontend TypeScript code or CSS.
- Do not modify Rust backend files.

## Steps

### Step 1: Update package lock / dependencies for esbuild
Run `npm update esbuild` or install secure patched version to satisfy `vite`.

**Verify**: `npm audit` → 0 vulnerabilities

### Step 2: Verify build and tests
Run `npm run build && npm test` to verify build times and test pass rates remain unaffected.

**Verify**: `npm run build && npm test` → exit 0

## Done criteria

- [ ] `npm audit` passes without high-severity vulnerabilities.
- [ ] `npm run build` exits 0.
- [ ] `npm test` exits 0.
- [ ] `plans/README.md` updated.
