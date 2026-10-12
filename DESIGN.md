# Verdict design system

## Overview

Verdict serves people and agents using Ethereum prediction markets. The existing ink, cream and green identity, expanded headings, mono controls, logo and local fonts are retained. The product explanation and **Explore markets** action precede open markets and per-token statistics. Market detail prioritizes the question, schedule, bet controls and inspectable evidence. Missing data is an explicit loading, retry or empty state, never a sample market.

The implementation is in [web/src/styles.css](web/src/styles.css), [shared components](web/src/components.tsx) and [App.tsx](web/src/App.tsx). Dark is the default; light mode is a local preference. The mainnet notice replaces the old banner and stays visible on every route.

Task pages use direct `PageIntro` titles: **Markets**, **Leaderboard** and **Create a market**. Their existing Archivo styling and natural height are preserved; Leaderboard's supporting line is “IMD and WETH ranked separately.”

## Colors

Reuse the existing hex primitives and semantic properties; do not introduce a second color system.

| Role | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `--ink` = `#0A0F0D` | `--cream` = `#F2EFE6` | Page and fields |
| `--text` | cream | ink | Main text and navigation |
| `--accent` | `--green` = `#2EE67A` | `--green-light` = `#0B8F45` | Primary action, logo, focus, pool bars |
| `--surface` | `#111A15` | `#E9EBE2` | Cards, panels, notice, footer |
| `--surface-raised` | `#19251E` | `#DDE3D7` | Selected/hover states |
| `--border` | `#34473B` | `#A2B09E` | Structural separators |
| `--control-border` | `#667F6B` | `#6B7A68` | Interactive boundaries |
| `--muted` | `#A5B6A8` | `#4B6050` | Secondary copy and units |
| `--soft` | `#24372B` | `#D5E3D3` | Result surfaces |
| `--warning` | `#E7BF77` | `#735017` | Schedule/provisional notices |
| `--danger` | `#FFABAA` | `#A32929` | Errors |
| `--focus` | accent | accent | 2px focus outline, 4px offset |
| `--on-accent` | ink | ink | Text on green buttons |

Rendered Chromium measurements: body/page 16.802:1 in both themes; muted/page 9.067:1 dark and 5.914:1 light; primary button text/fill 11.698:1 dark and 4.626:1 light; mainnet notice text/surface 15.447:1 dark and 16.049:1 light. Exact pairs and checks are in [the browser report](web/validation/browser-results.json). Written status labels supplement every status color.

## Typography

The three existing local font files and OFL licenses remain under `web/public/fonts/` and are included in `dist/fonts/`:

- Archivo 800 at 125% width (`archivo-expanded-800.woff2`) for headings and wordmark; Arial/sans-serif fallback.
- IBM Plex Mono 400 and 500 for controls, labels, token amounts, times, code and tables; monospace fallback.
- Arial / Helvetica / sans-serif for explanatory copy.

The six CSS sizes are **13, 16, 20, 28, 40 and 64px** (`--s-caption` through `--s-display`). Desktop hero uses 64px, then 40px at 1100px and 28px at 680px. Page titles become 28px on mobile; long market headings use 28px/20px. Inputs stay 16px. Body line height is 1.6; multi-line market text is 1.4–1.6; the short hero is 1.08–1.12. Headings balance; body text wraps naturally; addresses and questions can break anywhere. Guide text has a 72ch maximum measure.

Amounts use tabular numerals, explicit IMD/WETH units, and an exact hover value. Negative fractional results retain a minus sign. Display precision is three decimals for IMD and five for WETH; values below that precision are marked. UTC comes first (`Thu 15 Oct 22:00 UTC`), with local time in the native tooltip and a dotted underline. Date inputs retain native controls but are labeled and parsed as UTC. Raw oracle figures identify themselves as raw rather than claiming a token unit.

## Layout

The common container and header cap at 1280px with 40px inline padding. Spacing follows the established 4px increments: controls use 8–16px gaps, panels 24–28px padding, and sections 44–64px separation.

- Desktop: two-column hero/cards; three-part market schedule; separate IMD and WETH statistic cards; market and guide sidebars; two-column creator form/review.
- At 1100px: 28px container padding, tighter header gaps and a 300px market sidebar.
- At 900px: disclosed navigation, creator form in one column, market sidebar panels above details.
- At 680px: 20px margins; stacked cards, token statistics and schedule; compact hero without the decorative diagram; bet panel before details; settlement controls after details. Mobile theme switching lives in navigation.
- At 370px: 16px margins and narrower control padding.

The guide content and sidebar have `min-width: 0` so fee tables scroll inside their own region without widening the page. Tables use a labeled, keyboard-focusable horizontal scroll container; long JSON and identifiers remain available through wrapping and native disclosures. The WETH unwrap form wraps into a full-width field followed by actions on phones.

The Markets toolbar and filter row also have `min-width: 0`. Filter labels use `flex: 1 1 260px` inside a wrapping flex row with a 24px gap. At 768px the search/token fields share a row and Sort by takes the next full row; status buttons wrap within the container. At 680px and below, the existing column layout uses a 16px gap and an automatic field basis. Revision checks cover 320, 360, 390, 680, 681, 720, 767, 768, 769, 820, 883, 884, 900, 901, 1024 and 1440px without document overflow; see [the revision report](docs/WEBSITE_REVISION.md).

Rendered checks cover home at 320, 360, 390, 768, 1024 and 1440px; every main route at 360, 1024 and 1440px; populated market, creator, portfolio and leaderboard flows at 360px. The 390×844 first screen visibly contains the brand, mainnet notice, product description and Explore markets action. Native browser zoom, physical devices and translated/RTL layouts were not tested.

## Elevation & depth

Structure is primarily flat, using one-pixel borders and tonal surfaces. The wallet account menu retains `0 16px 48px #0004`; the native wallet dialog has a translucent backdrop with 4px blur. The concentric hero diagram is static, decorative and hidden from assistive technology.

## Shapes

Buttons use 5px radii; inputs and badges 4px; section containers 6px; cards/panels 7px; hero diagram 8px; wallet dialog 12px. Outcome bars are 5px high with 2px radii. The existing `Logo` SVG retains its 240×240 viewBox, rotated rounded bars and circular nodes. Favicon and social image are unchanged.

## Components

| Component / pattern | Source | Reuse and states |
| --- | --- | --- |
| `PageIntro`, `Empty`, `DataBoundary` | `components.tsx` | Page hierarchy; contextual empty action; loading and RPC retry |
| `Logo`, navigation, `.mainnet-notice` | `components.tsx`, `App.tsx` | Brand and persistent network context; native links, mobile menu, skip link |
| `Token`, `Time` | `components.tsx` | Explicit token and UTC/local display; use `symbol` for market collateral, default IMD only for bounty amounts |
| `MarketCard`, `Odds`, `StatusBadge` | `components.tsx` | URI title/question fallback, textual lifecycle, token pools, cap and close; odds represent pool share |
| `ActionButton` | `components.tsx` | Enables only after simulation for current account/arguments/snapshot; adjacent reason; optional IMD reward; rechecks every 15s and before send |
| `WalletButton` and native dialog | `wallet.tsx` | EIP-6963 provider choices, chain switching, progress, rejection, Escape and focus return |
| Bet panel and schedule | `MarketPage.tsx` | Radio outcomes, token presets, exact approval, balance/cap checks, fee-based estimate, shortfall wrapping, UTC dates |
| Timeline and bounty ledger | `MarketPage.tsx` | Transaction links, actual IMD rewards, oracle spend and returned bounty; decoded evidence and raw disclosures |
| Creator form/review | `CreatePage.tsx` | Allowlist gate; focused errors; UTC T and defaults; token/reward/bounty; stable review estimates and explicit reset |
| Positions, history, WETH form | `Portfolio.tsx` | Separate token totals, retained claimed positions, claim/refund, partial/full unwrap |
| Leaderboard groups | `Leaderboard.tsx` | Four native category buttons, period select, independent token tables, ENS/address links and share intent |
| `FeeTable`, agent guide | `ForAgents.tsx` | On-chain fee/cap table, address links and local ABI downloads |

Native buttons, links, selects, radio controls, details and dialog supply keyboard behavior. Inputs have persistent labels; validation focuses the failing field and uses alert text. Progress is a status region; transaction notices remain until dismissed. No external X widget is loaded: sharing uses normal links.

Settlers retain rows with zero IMD rewards and verified actions. An adjacent status notice states how many actions lack verified callers and offers refresh guidance, so an incomplete attribution is distinguishable from no activity. Reward amounts and action counts use the existing table typography and mobile scroll region.

Motion is limited to 120ms press transforms and the loading indicator, gated by `prefers-reduced-motion: no-preference`. No autoplay or entrance animation is present. Theme switching changes colors immediately rather than transitioning the page.

## Do's and don'ts

Start another page with `PageIntro` in the common container and wrap data-dependent content with `DataBoundary`. Reuse the existing six type sizes and semantic colors. Keep the most important action within the phone's first screen when possible, with secondary actions neutral.

Always carry a market's token into `Token` and fee calculations. Keep IMD bounty values separate. Use `Time` for timestamps; do not reintroduce local-first dates or a testnet selector. Reuse the simulation-gated actions and wallet transaction pipeline. Preserve full questions/hashes through wrapping or disclosure, and never substitute fixtures for unavailable RPC data.

## Guidance attribution

The six-domain review follows the pinned [Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) guidance by Jakub Krehel (MIT). This documentation structure adapts [Impeccable's document reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) by Paul Bakaus (Apache-2.0). Existing combined license and notices remain in [docs/BETTER_INTERFACE_LICENSE.txt](docs/BETTER_INTERFACE_LICENSE.txt).
