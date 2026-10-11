# Verdict design system

## Overview

Verdict is a public interface for people and agents using on-chain prediction markets. The implementation uses an ink canvas, expanded headings, precise mono labels, quiet structural borders and a green primary action. The home page introduces the product and immediately offers **Explore markets**. Market pages prioritize the question, outcome pools, betting and verifiable settlement evidence. All displayed market records come from the contracts; unavailable or empty data receives an explicit state.

Source of truth: [`web/src/styles.css`](web/src/styles.css), shared components in [`web/src/components.tsx`](web/src/components.tsx), and page composition in [`web/src/App.tsx`](web/src/App.tsx). Dark is the default. A local-storage preference selects light mode; no analytics or remote theme service is used.

## Colors

Primitive colors are `--ink: #0A0F0D`, `--cream: #F2EFE6`, `--green: #2EE67A`, and `--green-light: #0B8F45`. Components consume the semantic roles below.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | ink | cream | Page and field background |
| `--text` | cream | ink | Main text, logo node, navigation |
| `--accent` | green | green-light | Primary action, focus, logo branches, pool bars |
| `--surface` | `#111A15` | `#E9EBE2` | Cards, panels, footer, dialog |
| `--surface-raised` | `#19251E` | `#DDE3D7` | Selected controls, notices, hover |
| `--border` | `#34473B` | `#A2B09E` | Noninteractive separators and structure |
| `--control-border` | `#667F6B` | `#6B7A68` | Button, input, select and radio-choice boundaries |
| `--muted` | `#A5B6A8` | `#4B6050` | Secondary text and units |
| `--soft` | `#24372B` | `#D5E3D3` | Testnet banner and result surfaces |
| `--warning` | `#E7BF77` | `#735017` | Schedule risk and provisional state |
| `--danger` | `#FFABAA` | `#A32929` | Errors and invalid fields |
| `--focus` | accent | accent | 2px focus perimeter with 4px offset |
| `--on-accent` | ink | ink | Text on filled primary actions |

Measured rendered text contrast: body 16.802:1 in both themes; muted copy on a panel 8.336:1 dark / 5.649:1 light; primary action 11.698:1 dark / 4.626:1 light. The light accent heading is 3.632:1 and is reserved for large type. Small ordinary links use the text color. Statuses always include a written label; color and dots supplement it. Detailed measurements are retained in the browser report.

## Typography

All three webfont faces are self-hosted in `web/public/fonts/` and copied to `dist/fonts/`, with their OFL licenses. The rendered browser check confirmed they loaded.

- **Archivo 800, 125% width** (`archivo-expanded-800.woff2`): headings, wordmark, large statistics. CSS uses `font-weight: 800` and `font-stretch: 125%`; the font was obtained at those axes. Fallback: Arial, sans-serif.
- **IBM Plex Mono 400 / 500**: labels, controls, amounts, times, statuses, code and tables. Fallback: monospace. Numeric data uses `font-variant-numeric: tabular-nums`.
- **Arial / Helvetica / sans-serif**: explanatory paragraphs and long risk text.

The six-size scale in CSS is 13, 16, 20, 28, 40 and 64px (`--s-caption`, `--s-body`, `--s-subhead`, `--s-heading`, `--s-title`, `--s-display`). The desktop home heading is 64px; it becomes 40px below 1100px and 28px below 370px. Ordinary page headings use 40px, then 28px on mobile. Long market questions use 28px desktop / 20px mobile. Panel headings use 20px; captions and dense labels use 13px. All editable fields use 16px.

Body line height is 1.6, multi-line card questions 1.45–1.6, and market headings 1.4–1.5. The short hero is 1.08–1.12. Headings use balanced wrapping; full questions use pretty wrapping and `overflow-wrap:anywhere` so on-chain addresses remain available. Long-form content is capped at 72ch. Exact token amounts are available via native hover titles; times show the viewer’s local timezone with UTC on hover. Raw oracle figures retain their original units.

## Layout

The common `.container` and header cap at 1280px, including 40px inline padding. Recurrent spacing is based on 4px increments: controls use 8–16px internal gaps, panels 24–28px padding, sections 44–64px separation. Components wrap content rather than clipping questions or identifiers.

- Above 1100px: two-column home hero, five-column statistics, two-column market cards, and a 340px market sidebar.
- At 1100px: container padding becomes 28px and the market sidebar becomes 300px.
- At 900px: navigation becomes a disclosed menu, stats use three columns, the market sidebar becomes a pair of panels above the main details, and the creator form becomes one column.
- At 680px: 20px page margins, single-column cards, two-column stats with a full-width burn row, a stacked five-step explanation, and a compact hero without its decorative diagram. The betting panel appears before market details; permissionless settlement controls follow the details. The theme action remains available inside mobile navigation.
- At 370px: margins become 16px and the hero type reduces to 28px.

The first screen at 390×844 contains the brand, explicit testnet banner, product explanation and Explore markets action. Browser checks covered home reflow at 320, 360, 390, 820 and 1440px; market, creator and risk flows were also inspected at 390px. Tables use a labeled, keyboard-focusable horizontal scroll region. JSON disclosures preserve all content, wrap long values, and provide keyboard focus for scrolling. Native 200% browser zoom and physical devices were not tested.

## Elevation & depth

Most structure is flat: one-pixel borders separate panels, cards and tables. Tonal surfaces distinguish notices and selected controls. The wallet account menu uses a restrained `0 16px 48px #0004` shadow. The native wallet dialog uses a dark translucent backdrop with 4px blur. The home’s concentric diagram is decorative, static, and hidden from assistive technology; it is not a live market chart.

## Shapes

Buttons use 5px radii; inputs, badges and disclosures use 4px; section containers use 6px; cards and panels use 7px; the hero diagram uses 8px; the wallet dialog uses 12px. Outcome bars are 5px high, with 2px radii. Circular nodes and step numbers share the logo’s geometry. The `Logo` component preserves the exact supplied 240×240 viewBox, rotated rounded rectangles and three circles. The favicon uses the same mark on ink.

## Components

| Component or pattern | Source | Behavior |
| --- | --- | --- |
| `Logo` / `.brand` | `components.tsx`, `App.tsx` | Theme-aware mark and VERDICT wordmark; home link has an accessible name |
| Buttons / `.primary` / `.text-link` | `styles.css` | Filled primary emphasis, bordered secondary actions, navigation links; 44px controls; visible keyboard focus |
| `MarketCard` / `Odds` | `components.tsx` | Full on-chain question, textual status, per-outcome pool shares, capacity and deadline; percentages are not guaranteed payouts |
| `StatusBadge` | `components.tsx` | Seven explicit lifecycle labels; text makes state understandable without color |
| `DataBoundary` / `Empty` | `components.tsx` | Loading, RPC failure/retry and contextual empty-state actions |
| `ActionButton` | `components.tsx` | Simulates for the wallet before enabling; explains rejection; simulates again before sending; refreshes eligibility every 15 seconds |
| `WalletButton` / wallet dialog | `wallet.tsx` | EIP-6963 choices; native modal keyboard handling, Escape close and focus return; no wallet secrets stored |
| `BetPanel` | `MarketPage.tsx` | Radio outcomes, exact decimal amount, presets, balance, cap checks, estimate and approval/bet progress |
| Timeline / evidence disclosures | `MarketPage.tsx` | Transaction links, local time/UTC hover, authenticated evidence, raw JSON and hashes; missing evidence has a visible explanation |
| Creator form / review | `CreatePage.tsx` | On-chain access gate, labeled fields, focused validation errors, schedule warning, immutable JSON/hash preview and bounty approval |
| Portfolio position / activity | `Portfolio.tsx` | Credited stakes, exact claim calculation, refunds and transaction history; claimed positions remain visible |
| Agent table | `App.tsx` | Sortable aggregation with explicit column/row headers; agent 0 is people; horizontal scrolling on small screens |

Interactions use native buttons, links, selects, details, radio inputs and a dialog. The skip link focuses the main region. Decorative arrows and the hero diagram are hidden from assistive technology. Errors and transaction progress use alert/status semantics. Transaction notices name their action and remain until dismissed after pending work finishes. Hover, focus, disabled, loading, empty, disconnected, rejected and confirmed states are implemented.

Motion is limited to a 120ms press transform and the loading indicator, both inside `prefers-reduced-motion: no-preference`. Theme switching has no color transition, so it snaps rather than animating the whole interface. There is no autoplay or entrance animation.

## Do’s and don’ts

- Start a new page with `PageIntro` inside the common container. Use `DataBoundary` around data-dependent content and native links for route changes.
- Keep chain-specific facts in `config.ts`; derive user-visible state from the chain reader and domain helpers. Preserve hash routing and relative runtime assets.
- Use the existing text and control roles. Keep control boundaries distinct from quiet structural separators, and preserve the light-mode ink text on green buttons.
- Show full questions and hashes through wrapping/disclosure. Do not replace missing RPC data with example markets or fabricated statistics.
- Reuse `ActionButton` for settlement and `wallet.send` for wallet mutations. Keep the reason beside an unavailable action and show transaction confirmation explicitly.
- Add fields with persistent labels, meaningful units and inline errors. Review the result at 390px and run the production browser checks after changing shared layout.

## Guidance attribution

Design review applied the pinned Better Interface reference across accessibility, layout, writing, typography, colors and UI. It is adapted from [Jakub Krehel’s Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) (MIT). This documentation method is adapted from [Paul Bakaus’s Impeccable document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). The supplied combined licenses and notices are retained in [docs/BETTER_INTERFACE_LICENSE.txt](docs/BETTER_INTERFACE_LICENSE.txt).
