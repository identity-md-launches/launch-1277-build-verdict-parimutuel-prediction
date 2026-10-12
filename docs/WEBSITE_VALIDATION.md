# Verdict mainnet website validation

The original migration report below is retained as history. The subsequent [website revision report](WEBSITE_REVISION.md) supersedes its settler-attribution limitation and records the final export's regression checks, typecheck, build and six-domain review. Browser and wallet JSON records were regenerated against the revised export; the contract-verification record remains from the original migration.

## Scope and result

**Complete for the website implementation and static delivery.** Source, unchanged package manifest/lockfile, built `dist/`, updated design documentation and repeatable checks are included. Publication of the existing `verdict` site is the network publisher's handoff; no publication command, deployment, signing or transaction broadcast occurred here. This is a worker report, not an independent security audit or behavioral certification.

This update retains the existing React/Vite/TypeScript/viem stack, logo, favicon, social image and fonts. Mainnet is the only runtime network. The older pinned project/deployment/network inputs describe the previous Sepolia release; the explicit task's new mainnet addresses, block, RPC order and ABI commit take precedence. Root Solidity, Foundry files, dependencies, package manifests/lockfiles, existing frontend build configuration, ignore rules, `.github` and environment files were not changed.

Reviewed surfaces: Home, Markets, Market detail/betting/settlement, Portfolio/WETH, Leaderboard, For agents, Create gate/form/review, and How it works/risks. The real mainnet deployment had **zero markets** at the checked block. Populated and permissionless transaction states were exercised in labeled, deterministic test fixtures, never injected into the production application.

## Commands and actual outcomes

Checks ran on 2026-10-12 with Node 22.23.3, Vite 7.1.7, TypeScript 5.9.2, Vitest 3.2.4 and Playwright 1.56.1, using the installed Chromium executable. Dependencies were installed from the existing lockfile into `/tmp/verdict-toolchain-62e0f58870792468`. The production build itself makes no network requests.

| Check | Actual result |
| --- | --- |
| `node web/scripts/isolated.mjs install` | Passed; 80 packages installed outside the repository; manifests and lockfile unchanged. |
| `node web/scripts/isolated.mjs build` | Passed after the final runtime source change; 1,088 modules; relative assets in `dist/`. |
| `node web/scripts/isolated.mjs typecheck` | Passed; `tsc --noEmit`. |
| `node web/scripts/isolated.mjs test` | Passed; **28 tests** across two files. |
| `VERDICT_RPC_URL=http://127.0.0.1:42311/rpc/1 node web/scripts/isolated.mjs test:browser` | Passed; **59 assertions**, live Ethereum reads through the supplied relay, eight axe scans, eight measured contrast pairs. No uncaught browser exceptions or failed resources. |
| `node web/scripts/isolated.mjs test:wallet` | Passed; **43 assertions**, five axe scans; all writes intercepted by the EIP-6963/RPC mock. |
| `VERDICT_RPC_URL=http://127.0.0.1:42311/rpc/1 node web/scripts/isolated.mjs verify:contracts` | Passed at block **26,173,856**. All three ABIs match commit `083060a`; runtime hashes match the configured observations; IMD/WETH addresses, 18 decimals, fees/caps, oracle asset/Intake and **172,800-second** config delay checked. Maximum reward is **0.25 IMD**. |
| `node web/scripts/check-export.mjs` | Passed: required metadata/favicon, relative HTML/CSS assets, local ABI/font assets, no test fixtures in runtime, no dependency/cache archives, no testnet configuration, protected build paths unchanged, budget under 8 MiB. |
| `git diff --check` and explicit changed-path inspection | Passed; changes confined to website/export/documentation; no contract or dependency edits. |

The export is **769,522 bytes**. The conservative bundle calculation includes the complete prospective tree, all existing compressed Git objects and a 200,000-byte reserve; it is below **5.6 MB**, versus the 8,388,608-byte cap. The exact final figure and asset hashes are in [export-integrity.json](../web/validation/export-integrity.json). No ignore rules or submodules were introduced.

Machine-readable records:

- [browser-results.json](../web/validation/browser-results.json): live-read production-browser assertions, loaded fonts, rendered contrast and eight axe scans.
- [wallet-results.json](../web/validation/wallet-results.json): intercepted wallet/RPC assertions, five axe scans and transaction count.
- [contract-verification.json](../web/validation/contract-verification.json): mainnet observations and ABI provenance checks.
- [export-integrity.json](../web/validation/export-integrity.json): static assets, hashes, protected-path and size checks.

Older `revision-before.json` / `revision-results.json` are retained historical records for the previous release, not evidence for this mainnet update.

## Required domain regressions

`web/tests/domain.test.ts` retains the historical canonical question vector, outcome/lifecycle checks and refund/remainder arithmetic. Historical Sepolia data and its legacy ABI are test-only, not network configurations or production imports.

`web/tests/mainnet.test.ts` checks:

- The specified Sepolia transaction `0x6fde2f00922dee130e2baff65d7b69cea6a2d309f350f3ee70569540368cf8c8`, obtained read-only through the supplied Sentio endpoint after other historical endpoints failed. Its `0x0f6261af` calldata decodes to an attestation whose exact hash is **`0xbc73ea73342c3d01812021081a175e84761c5b55636dce4c32d0b44057cdc811`**. The successful receipt and matching oracle event are retained with the fixture.
- Per-token fee splits and separate integer rounding: IMD 150/50/50 bps, WETH 150/0/100 bps; no mixed-token arithmetic.
- `2 × oracle price + 5 × reward` bounty minimum; maximum reward, collateral slot, uint256, one-hour answer window and 365-day deadline guards.
- Mainnet oracle consumer binding, UTC defaults and block estimates; the fixed `Thu 15 Oct 22:00 UTC` example.
- Exact outcome labels, question hashing and body generation through the retained suite.
- Claimed/unclaimed net results, winning and losing stakes, voids, three-finalized-market minimum, seven-day settlement boundaries, multiple-wallet agent aggregation, creator fees and IMD settler totals. Fractional losses preserve their minus sign.
- Superseded answers cannot be proposed or mark the latest pending primary ask as answered.
- Inline/linked URI titles, credential-free JSON fetches, size limits and unavailable-metadata fallback.

## Interaction and rendering coverage

The supplied browser connector returned `Transport closed`. The allowed foreground Playwright scripts therefore served the **actual production export under `/preview/`**, launched local Chromium, captured screenshots and closed their server/browser. Screenshots were opened for visual inspection with the image viewer; rendered claims below are not inferred solely from source.

Live-read browser checks:

- Product and primary action visible within the first 390×844 screen; exact document title, notice, preserved local fonts and no testnet banner.
- Home reflow at 320, 360, 390, 768, 1024 and 1440px; each main route at 360, 1024 and 1440px. Zero measured document overflow in those final checks.
- Both themes; body, secondary copy, primary action and mainnet notice contrast measured from computed foreground/background pairs. All eight exceed 4.5:1; all 13 combined axe scans report zero violations in the tested A/AA rule sets.
- Keyboard skip link/main focus; mobile navigation open/select/close; native wallet dialog Escape; status/token/search filters and clear-filter recovery; leaderboard categories/periods; local ABI download links.

Mocked wallet checks:

- Primary RPC refusal and ordered fallback; switch to chain 1; exact IMD approval and `bet(id,outcome,amount,0)` encoding; pool-cap rejection and recoverable wallet rejection.
- Insufficient WETH disables betting and offers Wrap ETH; `deposit()` sends the exact shortfall; subsequent approval targets WETH. Portfolio `withdraw(amount)` and both-token positions/refund claims work through simulated calls.
- Creator allowlist gate, focused field errors, UTC T defaults in a Los Angeles browser timezone, reward/bounty defaults, WETH collateral with IMD bounty approval, mainnet consumer body, reviewed data preserved through a refreshed block, and correct new create tuple.
- Settlement action rejection reasons, four reward labels, request/propose/escalate/finalize/void calldata after successful simulations, attestation recovery, and UTC display/local hover.
- Populated Traders/Agents/Creators/Settlers tables, reverse plus forward-checked ENS, token-specific share intent, seven-day controls, and mobile table containment.

Screenshots are generated in `test/scratch/browser/` and deliberately excluded from submission: `home-dark-390.png`, both desktop home themes, `market-imd-360.png`, `market-weth-360.png`, `create-360.png`, `portfolio-360.png`, `leaderboard-360.png`, and `settlement-desktop.png`. These paths are reproducible inspection outputs, not required runtime assets. Failed intermediate screenshots remain only in disposable scratch space.

## Better Interface consolidated review

The pinned workflow, core principles of all six domains, documentation method and license were read and applied. [DESIGN.md](../DESIGN.md) records final implemented tokens, typography, components and responsive behavior. The existing combined license/notice file is preserved.

| Domain | Coverage | Evidence / boundaries |
| --- | --- | --- |
| Accessibility | Checked | Native controls and labels, headings, skip/main focus, dialog Escape, status/reason text, keyboard-focusable table regions, motion opt-in, 13 automated scans. Human screen-reader sessions and physical touch testing not performed. |
| Layout | Checked | First-screen action, shared edges, stacked mobile forms/schedules, long identifiers, guide-table containment, measured reflow at the listed widths, viewed screenshots. Native 200% zoom, translated layouts and RTL not reviewed. |
| Writing | Checked | Exact mainnet notice; distinct wrap/approve/bet/claim actions; token units; reward upper bounds; UTC labels; minimum funding hints; empty-state recovery; assumptions for rankings documented. |
| Typography | Checked | Existing three local font faces load; six-size scale retained; 16px fields; wrapping; stable numeric style and negative fractional values. No font substitution or new external font request. |
| Colors | Checked | Both existing themes; eight rendered text/background contrast measurements pass. Axe checks cover additional tested states. No claim that every possible future metadata/content state has been measured. |
| UI | Checked | Loading/empty/rejected/confirmed states; simulation-gated actions; theme switching; preserved brand; wallet and creation review flow. Slow-motion animation-panel replay not performed; motion is minimal and reduced-motion checks use emulation. |

### Findings and dispositions

| Severity | Final source location | Finding, change and recheck |
| --- | --- | --- |
| High | `web/src/config.ts:23`, `web/src/chain.ts:222` | Prior network/ABI was Sepolia and single-token. Replaced runtime network/ABIs with the specified mainnet deployment, code checks and slot reads. Live contract verification and ABI comparison passed. |
| High | `web/src/wallet.tsx`, `web/src/Portfolio.tsx`, `web/src/leaderboard.ts:19` | Legacy single-token totals/approvals could misrepresent WETH. Amounts and approvals now follow collateral; bounty stays IMD. Both-token mock writes, portfolio checks and economic unit tests pass. |
| High | `web/src/domain.ts:107` | Inspection found a fractional negative result could lose its sign after formatting integer `-0`. Format absolute magnitude then apply the sign. New negative-result regression passes. |
| Medium | `web/src/styles.css:2354` | First browser pass reproduced 360px overflow on For agents: the fee table expanded the guide grid item. Added `min-width: 0` to guide content/sidebar. Route rechecks at 360/1024/1440px and axe pass. |
| Medium | `web/src/components.tsx:86`, `web/src/create.ts:263` | Local-first times and earlier defaults conflicted with the brief. UTC display/input parsing, target T and measured block defaults replace them. Fixed UTC vector and Los Angeles browser interaction pass. |
| Medium | `web/src/chain.ts:38`, `web/src/Leaderboard.tsx` | Custom chain definition lacked the ENS resolver configuration. Retained viem mainnet chain contracts while overriding the required RPC list. Reverse and forward mock resolution now render the ENS name and preserve Etherscan links. |
| Medium | `web/src/CreatePage.tsx:132` | Automatic block refresh could alter a reviewed evidence estimate. The estimation snapshot stays fixed until the explicit reset; price/reward changes invalidate review. A refreshed-block browser regression preserves the reviewed evidence blocks. |
| Medium | `web/src/components.tsx:303`, `web/src/domain.ts:139` | New account/arguments/snapshot must not inherit old simulation eligibility; an old delivered answer must not mark a newer ask answered. Eligibility is keyed to the checked context and latest-ask status is used. Settlement mock checks and superseded-answer unit tests pass. |

No unresolved blocking finding remains in the tested website scope.

## Limits and assumptions

- Live read checks establish the sampled empty mainnet state, not successful real-value writes. No wallet extension, key, signed transaction or on-chain broadcast was used. The runtime-hash check compares observed code with the configured observations; it is not an independent compilation or audit of the mainnet Solidity.
- The worker's paid loopback RPC handled real Ethereum reads. Public endpoint ordering/fallback was exercised with mocks; public-browser CORS and long-term service availability were not independently certified. The loopback override is not shipped.
- The required historical attestation fixture is from Sepolia only as test data. Production supports mainnet exclusively.
- Leaderboard definitions, including settlement-time seven-day windows, win-rate meaning and rounding allocation between agent labels, are stated in the UI/README. Settler action counts follow emitted `SettlerRewarded` events; actions emitting none cannot be attributed from those logs. Agent IDs are not authenticated identities.
- URI metadata is optional display data. A remote host/CORS/size/timeout failure falls back to the committed question. Inline creation metadata is self-contained. Future evidence block times are estimates and labeled as such.
- ENS and linked metadata may depend on public resolver/gateway availability. Unavailable ENS leaves the wallet address visible. No analytics or embedded social widget exists.
- Human screen-reader, physical-device, native zoom, RTL/localization and public DNS/IPFS publication checks remain unperformed. Automated accessibility results are limited to the recorded states.
