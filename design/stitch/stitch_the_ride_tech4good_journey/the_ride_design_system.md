---
name: "The Ride — Tech4Good India"
description: "Warm, cinematic illustrated road-journey design system for a live three-screen interactive story game across India."
---

## Overview

**The Ride** is a 30-minute live interactive story game hosted by the Tech4Good Community in New Delhi. The system spans three synchronized surfaces: a **16:9 Projector Stage** in dark twilight tones for hall-wide legibility, a **Portrait Phone Controller** in warm daylight parchment for rapid audience voting, and a **Laptop Moderator Console** for live pacing, notes, and fallback controls.

The visual language blends warm Indian road-atlas editorial craft with crisp game HUD clarity. Characters are represented by their signature color and object badge (compass, binoculars, linked hands, padlock, wrench) rather than faces, keeping the focus on communities, landscapes, and choices.

## Colors

The palette anchors on **Tech4Good Teal** (`#0F766E` / `#80D5CB`), **Saffron Amber** (`#D97706`), and **Terracotta** (`#C2410C`) over warm espresso-charcoal (`#161310`) for the projector stage and warm ivory (`#FFF8F4`) for mobile and moderator surfaces.

- **Character Personas:** Five persistent identity colors follow each traveller across every screen: Tech4Good Crew (`crew-teal`), Meera (`meera-forest`), Lakshmi (`lakshmi-saffron`), Arif (`arif-indigo`), and Ravi (`ravi-terracotta`). Bright variants are used on dark projector surfaces; base variants are used as badges and accents on light surfaces.
- **Mode Polarity:** Projector screens use `dark:` tokens (`bg-dark-background`, `text-dark-on-surface`) so large typography and illustrations glow in a darkened hall. Phone and Moderator screens use `light:` tokens (`bg-light-surface`, `text-light-on-surface`) for glare-free handheld and laptop readability.

```yaml
colors:
  crew-teal: "#0F766E"
  crew-teal-bright: "#2DD4BF"
  meera-forest: "#15803D"
  meera-forest-bright: "#4ADE80"
  lakshmi-saffron: "#D97706"
  lakshmi-saffron-bright: "#FBBF24"
  arif-indigo: "#4338CA"
  arif-indigo-bright: "#818CF8"
  ravi-terracotta: "#C2410C"
  ravi-terracotta-bright: "#FB923C"
  warning-amber: "#D97706"
  success-green: "#15803D"
  light:
    primary: "#005C55"
    on-primary: "#FFFFFF"
    primary-container: "#0F766E"
    on-primary-container: "#A3FAEF"
    secondary: "#904D00"
    on-secondary: "#FFFFFF"
    secondary-container: "#FE932C"
    on-secondary-container: "#663500"
    tertiary: "#952C00"
    on-tertiary: "#FFFFFF"
    tertiary-container: "#BD3D07"
    on-tertiary-container: "#FFE4DD"
    error: "#BA1A1A"
    on-error: "#FFFFFF"
    error-container: "#FFDAD6"
    on-error-container: "#93000A"
    background: "#FFF8F4"
    on-background: "#1E1B18"
    surface: "#FFF8F4"
    surface-dim: "#E0D9D3"
    surface-bright: "#FFF8F4"
    surface-container-lowest: "#FFFFFF"
    surface-container-low: "#FAF2ED"
    surface-container: "#F4ECE7"
    surface-container-high: "#EEE7E1"
    surface-container-highest: "#E9E1DC"
    on-surface: "#1E1B18"
    surface-variant: "#D9E5E2"
    on-surface-variant: "#3E4947"
    outline: "#6E7977"
    outline-variant: "#BDC9C6"
    inverse-surface: "#33302C"
    inverse-on-surface: "#F7EFEA"
    inverse-primary: "#80D5CB"
  dark:
    primary: "#80D5CB"
    on-primary: "#003733"
    primary-container: "#0F766E"
    on-primary-container: "#A3FAEF"
    secondary: "#FFB77D"
    on-secondary: "#4D2600"
    secondary-container: "#D97707"
    on-secondary-container: "#3C1C00"
    tertiary: "#FFB59D"
    on-tertiary: "#5D1800"
    tertiary-container: "#BD3D07"
    on-tertiary-container: "#FFE4DD"
    error: "#FFB4AB"
    on-error: "#690005"
    error-container: "#93000A"
    on-error-container: "#FFDAD6"
    background: "#161310"
    on-background: "#E9E1DC"
    surface: "#161310"
    surface-dim: "#161310"
    surface-bright: "#3C3835"
    surface-container-lowest: "#100E0B"
    surface-container-low: "#1E1B18"
    surface-container: "#221F1C"
    surface-container-high: "#2D2926"
    surface-container-highest: "#383431"
    on-surface: "#E9E1DC"
    surface-variant: "#3E4947"
    on-surface-variant: "#BDC9C6"
    outline: "#889391"
    outline-variant: "#3E4947"
    inverse-surface: "#E9E1DC"
    inverse-on-surface: "#33302C"
    inverse-primary: "#006A63"
```

## Typography

This design system pairs **Playfair** for expressive, storybook headlines and chapter titles, **Poppins** for clear, high-legibility UI copy and voting options, and **Red Hat Mono** for live kilometer counters, timers, vote percentages, and route telemetry.

On the Projector stage, display and headline levels scale up for back-of-hall legibility (`56px`–`36px`); on Phone screens, `-mobile` counterparts keep headings compact (`32px`–`22px`).

```yaml
typography:
  display-lg:
    fontFamily: "Playfair"
    fontSize: 56px
    fontWeight: 700
    lineHeight: 64px
    letterSpacing: -0.5px
  display-lg-mobile:
    fontFamily: "Playfair"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 38px
    letterSpacing: -0.25px
  display-md:
    fontFamily: "Playfair"
    fontSize: 44px
    fontWeight: 700
    lineHeight: 52px
    letterSpacing: -0.25px
  display-md-mobile:
    fontFamily: "Playfair"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: 0px
  headline-lg:
    fontFamily: "Playfair"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 44px
    letterSpacing: 0px
  headline-lg-mobile:
    fontFamily: "Playfair"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: 0px
  headline-md:
    fontFamily: "Poppins"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 34px
    letterSpacing: 0px
  title-lg:
    fontFamily: "Poppins"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: 0px
  title-md:
    fontFamily: "Poppins"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0.1px
  body-lg:
    fontFamily: "Poppins"
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  body-md:
    fontFamily: "Poppins"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Poppins"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0.2px
  label-sm:
    fontFamily: "Poppins"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.3px
  mono-lg:
    fontFamily: "Red Hat Mono"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: 0px
  mono-md:
    fontFamily: "Red Hat Mono"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.2px
```

## Layout & Spacing

The Projector uses a **Fixed 16:9 Stage Grid** (`max-w-[1440px]` centered or full-bleed 16:9 frame) with a persistent top quest bar, a generous central story/illustration canvas, and a persistent bottom road-convoy HUD. Phone screens use a single-column **Fluid Grid** with `16px`–`24px` page margins and large `56px+` tap targets. The Moderator console uses a **12-column Desktop Split Grid** (controls & live tallies on the left, Moderator Notes & Fallback/Checklist on the right).

```yaml
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 16px
  gutter-lg: 24px
  gutter-xl: 32px
  section: 48px
  page-margin: 24px
```

## Elevation & Depth

Hierarchy relies on **tonal surface layering** (`surface` → `surface-container-low` → `surface-container` → `surface-container-high`) and crisp `1px` `outline-variant` borders rather than heavy drop shadows. On the Projector stage, illustrated artwork sits behind subtle dark scrims so cream and persona-tinted text always clears WCAG AA contrast.

## Shapes

Cards, option buttons, and HUD bars use warm, approachable rounded corners (`12px`–`16px`) while persona badges, status pills, and route milestones use `full` pill radii.

```yaml
rounded:
  sm: 6px
  DEFAULT: 10px
  md: 12px
  lg: 16px
  xl: 24px
  full: 9999px
```

## Motion & Micro-interaction

Transitions are deliberate and story-paced: vote button taps respond immediately (`120ms`), while scene transitions and convoy arrivals glide in smoothly (`300ms`). All animations use `transform` and `opacity` only and respect `prefers-reduced-motion`.

```yaml
motion:
  state-change:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 300ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  convoy-glide:
    duration: 450ms
    delay: 0ms
    timingFunction: cubic-bezier(0.22, 1, 0.36, 1)
```

## Voice & Content Strategy

- **Tone of voice:** Warm, human, curious, and grounded—never corporate or tech-jargon heavy. Speak directly to social-impact practitioners in the room.
- **Capitalisation:** Sentence case for questions, story lines, and voting options; uppercase tracking only for tiny route metadata tags (`2,100 KM`, `CHAPTER 2 OF 5`).
- **Action labels:** Verb-led and concrete on the Moderator console (`Open voting`, `Lock votes`, `Meera joins`, `Ride to Nagpur`).
- **Numbers:** Tabular numerals (`tabular-nums`) for all vote counts, percentages, timers, and kilometer markers.

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html` — `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html` — `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html` — `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Typography** → `@components/typography.html` — `typography-display`, `typography-body`, `typography-label`
