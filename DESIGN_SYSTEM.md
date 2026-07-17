# STELLA Design System

The visual design language for the STELLA landing page and documentation site.
Imported from the Claude Design project **"STELLA Design System"** and implemented in
`docs-site/src/css/custom.css` and `docs-site/tailwind.config.js`.

## Brand Identity

**STELLA** — open-source voice-conversation infrastructure for research.

The design is **dark-first and engineered**: crisp cool-neutral (zinc) surfaces, hairline
structure, monospace "signal" for metadata and code, and a single electric purple accent.
It conveys scientific precision, self-hosted control, and technical credibility — no
decorative gradients competing for attention.

The system ships **both dark and light themes**, toggled via `[data-theme]`. Dark is the
primary, design-led mode.

---

## Color Palette

All colors are exposed as CSS variables in `:root` (light) and `[data-theme='dark']` (dark).
Prefer the `var(--token)` names below over raw hex so theming stays consistent.

### Neutrals — cool zinc (not warm stone)

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--bg` | `#08090a` | `#fafafa` | Page background |
| `--bg-2` | `#0b0d0e` | `#f4f4f5` | Alternate background |
| `--surface` | `#111315` | `#ffffff` | Cards, panels |
| `--surface-2` | `#18181b` | `#fafafa` | Raised / nested surfaces |
| `--text` | `#fafafa` | `#0a0a0a` | Headings, primary text |
| `--text-2` | `#a1a1aa` | `#52525b` | Body text |
| `--muted` | `#71717a` | `#71717a` | Labels, metadata |

### Borders — hairline

| Token | Dark | Light |
|-------|------|-------|
| `--border` | `rgba(255,255,255,.10)` | `#e4e4e7` |
| `--border-strong` | `rgba(255,255,255,.16)` | `#d4d4d8` |
| `--grid-line` | `rgba(255,255,255,.04)` | `rgba(0,0,0,.035)` |

### Accent — one electric purple

| Token | Dark | Light | Usage |
|-------|------|-------|-------|
| `--accent` | `#a855f7` | `#9333ea` | Links, highlights, accent dots |
| `--accent-bright` | `#c084fc` | `#7c3aed` | Hover/bright accent, gradient text |
| `--accent-solid` | `#7c3aed` | `#7c3aed` | Primary button fill |
| `--accent-hover` | `#6d28d9` | `#6d28d9` | Primary button hover |
| `--on-accent` | `#ffffff` | `#ffffff` | Text on accent |

### Semantic

| Token | Value | Usage |
|-------|-------|-------|
| `--success` | `#22c55e` | Online / pass / "green" agent |
| `--warning` | `#eab308` | Caution |
| `--destructive` | `#ef4444` | Error / fail |
| `--info` | `#3b82f6` | Info / "custom" agent variant |

Blue and green appear **only** as semantic colors (e.g. differentiating agent variants).
They are never used decoratively — purple is the single brand accent.

### Accent glow

```css
/* Dark */ --glow: 0 0 48px rgba(168, 85, 247, .32);
/* Light */ --glow: 0 0 48px rgba(147, 51, 234, .18);
```

Reserved for primary actions and the hero accent — used sparingly.

---

## Typography

| Family | Token | Usage |
|--------|-------|-------|
| **Inter** | `--ifm-font-family-base` | All headings and body (weight 600 for headings, tight tracking) |
| **JetBrains Mono** | `--ifm-font-family-monospace` | Code, labels, metadata, version chips, "terminal" signal |

There is **no serif**. Headings are Inter 600 with negative letter-spacing — engineered, not editorial.

Eyebrow / section labels: monospace, uppercase, `letter-spacing: .16em`, in `--accent-bright`,
often preceded by a small glowing accent dot.

---

## Radius & Shape

Modest, consistent corners — no fully-round pill buttons for primary actions.

| Token | Value |
|-------|-------|
| `--r-sm` / `--stella-radius-sm` | `0.375rem` |
| `--r-md` / `--stella-radius-md` | `0.5rem` (buttons, inputs) |
| `--r-lg` / `--stella-radius-lg` | `0.75rem` (cards) |
| `--r-xl` / `--stella-radius-xl` | `1rem` |

Small status badges may use a pill radius; primary CTAs use `--r-md`.

---

## Components

### Primary button
```css
background: var(--accent-solid);
color: var(--on-accent);
padding: 12px 20px;
border-radius: var(--r-md);
box-shadow: var(--glow);
font-weight: 600;
/* hover */ background: var(--accent-hover);
```

### Secondary button
```css
background: var(--surface);
color: var(--text);
border: 1px solid var(--border);
border-radius: var(--r-md);
/* hover */ border-color: var(--border-strong); background: var(--surface-2);
```

### Card
```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: var(--r-lg);
/* hover */ border-color: var(--border-strong);
```

---

## Background Pattern

The signature backdrop is a subtle **engineered dot-grid**, not a line grid or layered glows:

```css
background-image: radial-gradient(var(--grid-line) 1px, transparent 1px);
background-size: 32px 32px;
```

The hero pairs this dot-grid with one or two soft purple radial glows; everything else
relies on the dot-grid alone. Exposed as `--bg-dot-color` / `--bg-dot-spacing` and the
`.constellation-bg` helper.

---

## Implementation Notes

- Design tokens live in `docs-site/src/css/custom.css` (`:root`, `[data-theme='dark']`,
  plus a Shadcn-compatible HSL block for landing components).
- Tailwind (`docs-site/tailwind.config.js`) maps `primary.*` to the purple scale and the
  `sans` / `mono` families to Inter / JetBrains Mono. `preflight` is disabled to avoid
  clobbering Docusaurus base styles.
- Icons: **Lucide React**, `strokeWidth={1.5}`, colored with `--accent`.
- Both themes are first-class; design and review in dark mode first.
