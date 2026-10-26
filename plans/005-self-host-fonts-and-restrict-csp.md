# Plan 005: Eliminate Third-Party Font CDNs and Enforce Strict Content Security Policy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**:
> Check if git is initialized (`git status`). If git is tracked, run:
> `git diff --stat HEAD -- index.html src/style.css src-tauri/tauri.conf.json`
> Compare the "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `uncommitted`, 2026-10-14
- **Issue**: none

## Why this matters

FocusGaze is advertised as a 100% on-device, local-only digital wellbeing app with zero external tracking. However, `index.html` currently connects to Google Fonts CDNs (`fonts.googleapis.com` and `fonts.gstatic.com`) on startup, leaking the user's IP address, OS, and launch timestamp to third-party servers. Furthermore, `tauri.conf.json` has `"csp": null`, disabling Content Security Policy hardening. This plan switches typography to privacy-safe system font stacks (or local font assets) and introduces a strict CSP that permits local WebAssembly execution while blocking unvetted outbound connections.

## Current state

Relevant files:
- `index.html` — Contains external Google Fonts `<link>` tags.
- `src/style.css` — Defines font family variables.
- `src-tauri/tauri.conf.json` — Tauri configuration with `"csp": null`.

Current code excerpts:

1. `index.html:7-12`:
```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
```

2. `src-tauri/tauri.conf.json:24-26`:
```json
    "security": {
      "csp": null
    }
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Frontend check | `npx tsc --noEmit` | exit 0, no errors |
| Frontend build | `npm run build` | exit 0, dist generated |
| Rust check | `cargo check` (in `src-tauri`) | exit 0, no errors |

## Scope

**In scope**:
- `index.html`
- `src/style.css`
- `src-tauri/tauri.conf.json`

**Out of scope**:
- MediaPipe WASM and model files in `public/wasm` and `public/models`.

## Steps

### Step 1: Remove external Google Fonts references from `index.html`

In `index.html`:
Remove lines 7 through 12 containing `preconnect` and `href="https://fonts.googleapis.com/..."`.

**Verify**: `npx tsc --noEmit` → exit 0.

---

### Step 2: Update typography to high-quality system font stacks in `src/style.css`

In `src/style.css`:
Update `--font-sans` and `--font-mono` to modern native font stacks:
```css
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
```
This preserves clean, crisp typography on macOS (San Francisco), Windows (Segoe UI), and Linux without requiring network requests.

**Verify**: `npx tsc --noEmit` → exit 0.

---

### Step 3: Configure strict Content Security Policy in `src-tauri/tauri.conf.json`

In `src-tauri/tauri.conf.json`:
Replace `"csp": null` with:
```json
    "security": {
      "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none';"
    }
```
*Note*: `'wasm-unsafe-eval'` is strictly required for `@mediapipe/tasks-vision` WebAssembly binary instantiation in local memory.

**Verify**: `cargo check` in `src-tauri` → exit 0.

## Test plan

1. Build frontend bundle: `npm run build` → exit 0.
2. Check `dist/index.html`: verify no references to `fonts.googleapis.com` or `fonts.gstatic.com` exist.
3. Verify `tauri.conf.json` parses as valid JSON:
   `node -e "JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'))"` → no syntax error.

## Done criteria

- [ ] `npm run build` succeeds with exit 0.
- [ ] No external CDN URLs exist in `index.html`.
- [ ] `tauri.conf.json` defines a valid Content Security Policy.
- [ ] MediaPipe WebAssembly initialization remains functional under `'wasm-unsafe-eval'`.
- [ ] `plans/README.md` status row updated.

## STOP conditions

- If MediaPipe WASM throws a CSP violation on startup, ensure `'wasm-unsafe-eval'` is present in `script-src` directive.
