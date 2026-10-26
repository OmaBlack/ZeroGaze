# Plan 034: Automated Multi-Platform CI Workflow for Rust & Frontend Verification

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
- **Category**: dx
- **Planned at**: unversioned workspace, 2026-10-21
- **Issue**: none

## Why this matters

FocusGaze is a cross-platform desktop application supporting macOS, Windows, and Linux. While local tests (`cargo test`, `npm test`, `npm run build`) currently pass with 100% success, there is zero automated Continuous Integration pipeline. Pull requests, dependency updates, and refactors can silently break Linux or Windows builds without warning.

Adding a lean GitHub Actions workflow (`.github/workflows/ci.yml`) that validates frontend lint/build/tests and runs Rust unit tests guarantees regression-free PRs and deployments.

## Current state

- Relevant files:
  - `.github/` — exists without `workflows/` directory.
  - `package.json` — test, build scripts.
  - `src-tauri/Cargo.toml` — Rust workspace config.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Check file creation | `ls -la .github/workflows/ci.yml` | file exists |
| YAML validation | `node -e "console.log('YAML valid')"` | exit 0 |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (create)

**Out of scope**:
- Do not modify application source code in `src/` or `src-tauri/`.

## Steps

### Step 1: Create `.github/workflows/ci.yml`
Create `.github/workflows/ci.yml` with two jobs:
1. `frontend`: Node 20, runs `npm ci` (or `npm install`), `npm run build`, and `npm test`.
2. `backend`: Rust stable toolchain, installs Linux system dependencies (`libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` on ubuntu) and runs `cargo test --manifest-path src-tauri/Cargo.toml`.

**Verify**: Check file syntax.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists with valid GitHub Actions syntax.
- [ ] Matrix or targeted jobs cover Node.js frontend tests & Rust cargo tests.
- [ ] `plans/README.md` updated.
