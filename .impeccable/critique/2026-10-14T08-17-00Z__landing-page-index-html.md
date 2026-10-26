---
target: landing-page
total_score: 30
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 0
target_identity: "file:/Applications/MAMP/htdocs/subu/landing-page/index.html"
target_path: /Applications/MAMP/htdocs/subu/landing-page/index.html
timestamp: 2026-10-14T08-17-00Z
slug: landing-page-index-html
---

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Real-time simulator feedback, XP bar calculation, responsive 365-day streak heatmap, live 6-theme switching with zero FOUC |
| 2 | Match System / Real World | 4 | Authentic athletic identity; lifter vocabulary (1RM, barbell plate visualizer, workout splits, PRs) paired with multiplayer habit quest dynamics |
| 3 | User Control and Freedom | 4 | PWA guide modal opens/closes cleanly; theme picker switches freely across all 6 modes; simulator presets test live without reload |
| 4 | Consistency and Standards | 4 | Unified 16px/24px nestable radii scale, standard padding depth across all cards, zero side-tabs or orphaned borders |
| 5 | Error Prevention | 4 | Distinct primary vs outline CTAs, accessible focus rings (:focus-visible), PWA dialog isolates platform installation instructions |
| 6 | Recognition Rather Than Recall | 4 | Simulator presets provide concrete examples of drops and rewards; public quest directory with category pills eliminates blank-canvas inertia |
| 7 | Flexibility and Efficiency | n/a | Persuasive landing page; linear storytelling surface where user accelerators do not apply |
| 8 | Aesthetic and Minimalist Design | 4 | Zero AI slop tells: 0 colored glow halos, 0 text-gradient clipping, 0 bounce easings, 0 icon-tile stacks, authentic athletic cobalt & emerald palette |
| 9 | Error Recovery | 3 | PWA modal provides step-by-step fallback for iOS Safari and Android Chrome; offline logging explained |
| 10 | Help and Documentation | n/a | Persuasive landing page; inline FAQ accordion and interactive playground substitute for documentation |
| **Total** | | **30/32** | **Exceptional (94%)** |

#### Design Specificity Verdict

**LLM assessment**: Subu has been transformed from an AI-styled template into an authentic, high-craft athletic performance platform. The interface now radiates athletic confidence with electric emerald (#10b981), precision cobalt (#2563eb), and sky blue accents grounded against deep obsidian and clean slate layers. Icon-tile stacks were replaced with side-by-side in-flow SVG iconography, typography was unified under the bold athletic `Outfit` family with an expanded typographic scale, all colored zero-offset glow halos were replaced with neutral elevation shadows, and all kickers/eyebrows were excised in compliance with craft-floor standards.

**Deterministic scan**: Automated detector scan found **0 findings** across `landing-page/index.html` (0 slop tells, 0 quality issues):
- `slop`: 0 findings (down from 40).
- `quality`: 0 findings (down from 20).

#### What Changed & Improvements

1. **Slop Tells Eliminated (40 -> 0)**:
   - Excluded all 18 rounded-square icon-tile-stack cards by placing SVGs in flow alongside card titles.
   - Removed all 9 colored zero-offset glow halos (`#7c3aed`, `#a855f7`, `#0284c7`, `#22c55e`, `#f59e0b`), replacing them with physical neutral elevation shadows.
   - Excised all 7 `background-clip: text` clipped gradients on headings and titles in favor of solid high-contrast white `#ffffff`.
   - Replaced all bounce easing curves (`cubic-bezier(0.34, 1.56, ...)`) with smooth ease-out-expo (`cubic-bezier(0.16, 1, 0.3, 1)`).
   - Removed all 3px side-tab pseudo-stripes.
   - Disabled chromatic radial-gradient halo washes (`.blob-1`, `.blob-2`) and synthetic SVG turbulence noise.
   - Excised all 7 section kicker eyebrows (`.section-badge` / `.badge`).

2. **Quality & Accessibility Floor Upgraded (20 -> 0)**:
   - Boosted `--text-secondary` from `#94a3b8` to `#cbd5e1` to guarantee WCAG AAA contrast ratio (≥ 7:1) across dark grounds.
   - Corrected all cramped container paddings across `.stats-grid`, `.heatmap-card`, `.sim-controls-card`, `.theme-preview-card`, `.faq-item`, and `.mockup-xp-bar-container`.
   - Bumped all sub-12px body micro-labels (0.65rem–0.72rem) to accessible 0.8rem (12.8px).
   - Unified typography under `Outfit` with an explicit major-third heading scale (`h1` 2.5rem, `h2` 1.875rem, `h3` 1.375rem, `h4` 1.125rem) to ensure a distinct hierarchy.
