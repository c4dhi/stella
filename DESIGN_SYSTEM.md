# STELLA Design System

A comprehensive guide to the visual design language used across the STELLA landing page.

## Brand Identity

**STELLA** - System for Testing & Engineering of Large-Language Conversational Agents

The design conveys:
- Scientific precision and research credibility
- Futuristic AI technology
- Elegance and sophistication
- Transparency and openness

---

## Color Palette

### Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-primary` | `#0a0a14` | Main page background |
| `bg-secondary` | `#0f0f1a` | Section alternates, cards |

### Accent Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `accent-violet` | `#7c3aed` | Primary accent, CTAs, highlights |
| `accent-cyan` | `#06b6d4` | Secondary accent, status indicators |
| `accent-blue` | `#3b82f6` | Tertiary accent, gradients |

### Text Colors
| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `#ffffff` | Headings, important text |
| `text-secondary` | `rgba(255, 255, 255, 0.6)` | Body text, descriptions |
| `text-muted` | `rgba(255, 255, 255, 0.4)` | Subtle labels, metadata |

### Gradient Combinations
```css
/* Primary text gradient */
background: linear-gradient(135deg, #fff 0%, #7c3aed 50%, #06b6d4 100%);

/* Button gradient */
background: linear-gradient(to right, #7c3aed, #3b82f6);

/* Glow effect */
box-shadow: 0 0 100px rgba(124, 58, 237, 0.5), 0 0 200px rgba(6, 182, 212, 0.3);
```

---

## Typography

### Font Families
- **Headings**: Playfair Display (serif) - elegant, editorial feel
- **Body**: Inter (sans-serif) - clean, readable, modern

### Scale
| Element | Size | Weight | Tracking |
|---------|------|--------|----------|
| H1 (Hero) | `clamp(4rem, 12vw, 10rem)` | 400 | Tight |
| H2 (Section) | `text-5xl md:text-6xl` | 400 | Normal |
| H3 (Card) | `text-2xl` | 600 | Tight |
| Body | `text-lg` | 400 | Normal |
| Label | `text-xs` | 600 | `0.3em` (uppercase) |

### Text Styles
```jsx
// Section label (appears before headings)
<div className="text-xs font-semibold tracking-[0.3em] uppercase text-accent-violet">
  <span className="w-10 h-[1px] bg-accent-violet"></span>
  Label Text
</div>

// Gradient text
<span className="text-gradient">STELLA</span>

// Navigation brand
<div className="font-serif text-2xl font-semibold tracking-[0.3em]">
```

---

## Spacing

### Section Padding
- Vertical: `py-44` (176px)
- Horizontal: `px-8 md:px-20`

### Component Gaps
- Large: `gap-28` (112px) - Grid sections
- Medium: `gap-16` (64px) - Footer columns
- Small: `gap-10` (40px) - Card lists
- Tiny: `gap-6` (24px) - Button groups

### Content Max Widths
- Hero text: `max-w-[1000px]`
- Section intro: `max-w-[800px]`
- Body paragraphs: `max-w-[600px]` or `max-w-[700px]`

---

## Components

### Cards
```jsx
// Standard card
<div className="p-12 bg-white/5 border border-white/5 rounded-3xl
               hover:bg-accent-violet/5 hover:border-accent-violet/20
               hover:-translate-y-1 transition-all duration-500">
```

### Buttons

**Primary CTA:**
```jsx
<button className="px-8 py-4 bg-gradient-to-r from-accent-violet to-accent-blue
                   rounded-full text-white font-semibold text-lg
                   shadow-lg shadow-accent-violet/30
                   hover:shadow-xl hover:shadow-accent-violet/40
                   hover:-translate-y-1 transition-all duration-300">
```

**Status Badge:**
```jsx
<div className="inline-flex items-center gap-3 px-6 py-3
                bg-gradient-to-r from-accent-violet/20 to-accent-cyan/20
                border border-accent-violet/40 rounded-full backdrop-blur-sm">
  <span className="relative flex h-2.5 w-2.5">
    <span className="animate-ping absolute h-full w-full rounded-full bg-accent-cyan opacity-75" />
    <span className="relative rounded-full h-2.5 w-2.5 bg-accent-cyan" />
  </span>
  <span className="text-base font-medium tracking-wider text-white/90">Coming Soon</span>
</div>
```

### Links
```jsx
// Navigation link with underline animation
<a className="text-text-secondary text-sm font-medium tracking-widest uppercase
              relative group hover:text-white transition-colors">
  Link Text
  <span className="absolute -bottom-2 left-0 w-0 h-[1px] bg-accent-violet
                   transition-all duration-300 group-hover:w-full" />
</a>
```

---

## The Sphere

The animated sphere is the central visual element representing STELLA's AI core.

### Structure
```jsx
<div className="relative w-[300px] h-[300px] animate-[breathe_4s_ease-in-out_infinite]">
  {/* Outer glow */}
  <div className="absolute w-[150%] h-[150%] -top-1/4 -left-1/4
                  bg-[radial-gradient(circle,rgba(124,58,237,0.3)_0%,transparent_60%)]" />

  {/* Orbit ring */}
  <div className="absolute border border-accent-violet/20 rounded-full
                  animate-[spin_25s_linear_infinite] w-[160%] h-[160%]"
       style={{ transform: 'rotateX(70deg)' }} />

  {/* Main sphere with gradient */}
  <div className="main-sphere w-full h-full rounded-full
                  animate-[sphere-rotate_20s_linear_infinite]" />

  {/* Inner rotating glow */}
  <div className="w-full h-full rounded-full animate-[sphere-rotate-reverse_15s_linear_infinite] opacity-60"
       style={{ background: 'radial-gradient(circle at 40% 40%, rgba(6, 182, 212, 0.4) 0%, transparent 50%)' }} />
</div>
```

### Sphere Gradient (CSS)
```css
.main-sphere {
  background:
    radial-gradient(circle at 30% 30%, rgba(124, 58, 237, 0.8) 0%, transparent 50%),
    radial-gradient(circle at 70% 60%, rgba(6, 182, 212, 0.6) 0%, transparent 40%),
    radial-gradient(circle at 50% 80%, rgba(59, 130, 246, 0.5) 0%, transparent 40%),
    radial-gradient(circle at 50% 50%, rgba(20, 20, 40, 1) 0%, rgba(10, 10, 20, 1) 100%);
  box-shadow:
    0 0 100px rgba(124, 58, 237, 0.5),
    0 0 200px rgba(6, 182, 212, 0.3),
    inset 0 0 100px rgba(0, 0, 0, 0.5),
    inset 0 -50px 100px rgba(124, 58, 237, 0.3);
}
```

---

## Animations

### Core Animations
| Name | Duration | Purpose |
|------|----------|---------|
| `breathe` | 4s | Subtle sphere scale pulsing |
| `glow-breathe` | 4s | Glow intensity cycling |
| `sphere-rotate` | 20s | Slow sphere rotation |
| `sphere-rotate-reverse` | 15s | Counter-rotation for depth |

### Scroll-Triggered Reveals
Uses Intersection Observer with GSAP for scroll-driven animations:
```jsx
// Reveal component pattern
<div className="opacity-0 translate-y-[60px] transition-all duration-1000"
     style={{ transitionDelay: `${delay}s` }}>
```

### Hover Transitions
Standard duration: `duration-300` to `duration-500`
Easing: Default ease or `cubic-bezier(0.16, 1, 0.3, 1)`

---

## Visual Effects

### Background Grid Pattern
```jsx
<div className="bg-[linear-gradient(rgba(124,58,237,0.03)_1px,transparent_1px),
                   linear-gradient(90deg,rgba(124,58,237,0.03)_1px,transparent_1px)]
                bg-[size:100px_100px]
                [mask-image:radial-gradient(ellipse_at_center,black_0%,transparent_70%)]" />
```

### Radial Gradient Overlays
```jsx
// Section background accents
<div className="bg-[radial-gradient(ellipse_at_30%_50%,rgba(124,58,237,0.15)_0%,transparent_50%),
                   radial-gradient(ellipse_at_70%_50%,rgba(6,182,212,0.1)_0%,transparent_50%)]" />
```

### Glass Effect
```jsx
// Glassmorphism for navigation
className="bg-gradient-to-b from-bg-primary/90 to-transparent backdrop-blur-xl"
```

### Borders
- Standard: `border border-white/5`
- Hover: `border-accent-violet/20` or `border-accent-violet/30`
- Active: `border-accent-violet/40`

---

## Responsive Breakpoints

Following Tailwind defaults:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

### Common Patterns
```jsx
// Sphere sizing
className="w-[200px] sm:w-[260px] md:w-[300px] lg:w-[340px] xl:w-[380px]"

// Text scaling
className="text-5xl md:text-6xl"
className="text-4xl md:text-5xl"

// Layout shifts
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
className="px-8 md:px-20"
```

---

## Selection & Cursor

```css
/* Custom selection color */
::selection {
  @apply bg-accent-violet/30 text-white;
}

/* Interactive elements use custom cursor states */
.interactive { cursor: pointer; }
```

---

## Z-Index Layers

| Layer | Z-Index | Usage |
|-------|---------|-------|
| Navigation | `z-[1000]` | Fixed header |
| Story text | `z-30` | Scroll sequence text |
| Sphere | `z-20` | Main sphere during scroll |
| Hero content | `z-10` | Initial hero section |
| Background | Default | Patterns, grids |

---

## Icon Usage

Icons from **Lucide React** library:
- Stroke width: `1.5`
- Size: `w-6 h-6` (small) to `w-7 h-7` (cards)
- Color: `text-accent-violet`

```jsx
import { Zap, Sparkles, Rocket } from 'lucide-react';

<item.Icon className="w-7 h-7 text-accent-violet" strokeWidth={1.5} />
```

---

## Dark Mode

The site is dark-mode only:
```css
:root {
  color-scheme: dark;
}
```

All colors are designed for dark backgrounds. There is no light mode variant.
