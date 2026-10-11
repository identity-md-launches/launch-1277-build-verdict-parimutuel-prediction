# Verdict website validation

## Scope and result

**Complete for the stated website scope.** The static export, source, lockfile, design documentation and reproducible checks are delivered. This is a worker validation record, not an independent security audit or network certification. No site publication or on-chain transaction was performed.

Reviewed pages: home, market directory, market detail, connected/disconnected portfolio, agent ranking, creator gate/form/review, and settlement/risks. The default is Sepolia and dark mode. Ethereum is configured only for question data. Current live records contain market 1 (Finalized, Yes) and market 2 (Voided); the site shows a truthful empty open-market state. Simulated open markets, approved/denied creator access and unclaimed positions exist only inside the browser test harness.

The final source is in `web/`; the publisher-ready export is `dist/`. All assets are local and routes use URL hashes. The label is `verdict`, with canonical metadata for `https://verdict.sites.imd.fun`. Public RPCs are the only external runtime data service. EIP-6963 wallet announcements supply wallet providers.

## Actual checks

Revision validation ran on 2026-10-11 with Node 24.21.0, Vite 7.1.7, TypeScript 5.9.2, Vitest 3.2.4, Playwright 1.56.1 and Chromium 141.0.7390.37. Both the supplied MCP browser and the repository’s Playwright harness worked in this run. The harness serves the actual production export at `/preview/` and closes its server/browser on completion. MCP screenshots of the live export were inspected at 390×844 and 1440×900. Dependencies and browser binaries were installed under `/tmp`; no system configuration was changed.

| Command / check | Actual result |
| --- | --- |
| `node web/scripts/isolated.mjs install` | Passed. Exact lockfile installed outside the repository; 80 packages. Manifests and lockfiles unchanged. |
| `node web/scripts/isolated.mjs build` | Passed after the final source changes. 430 modules; relative asset URLs; no final build warnings. |
| `node web/scripts/isolated.mjs typecheck` | Passed (`tsc --noEmit`). |
| `node web/scripts/isolated.mjs test` | Passed: 14 domain tests, including the numeric-definition-key regression. |
| `node web/scripts/isolated.mjs test:browser` | Passed: 28 live production-browser checks; 12 reviewed contrast pairs passed; no uncaught page errors or failed requests. |
| `node web/scripts/isolated.mjs test:wallet` | Passed: 37 deterministic wallet/RPC/browser checks, including all six permissionless controls. Ten simulated wallet sends; no broadcasts. |
| `node web/scripts/isolated.mjs test:wallet --revision` | Passed: 37 additional checks covering all reported UI failures and related recovery paths; no broadcasts. |
| Nine axe scans across the two wallet suites | Zero violations for the tested WCAG A/AA rule tags in the nine recorded states. This is not a claim of complete accessibility conformance. |
| `VERDICT_NODE_MODULES=/tmp/verdict-tools/node_modules node web/scripts/verify-contracts.mjs` (previous round, not rerun) | Previously passed for all three contracts; unchanged source/ABI/configured runtime hashes retained: compiled ABI canonical hashes equal the manifest, full runtime hashes equal configuration, and compiled runtime matches after masking compiler-recorded immutable slots. |
| `git diff --check` | Passed. |
| `node web/scripts/check-export.mjs` / export-path inspection | Relative scripts/styles/fonts/favicon, title and social metadata present; required assets retained; no dependency/cache directories or archives in the deliverable; existing build configuration, contract sources and dependencies unchanged. |

The equivalent standard scripts are available in `web/package.json`. The isolated runner was also exercised, so the README’s clean installation/build route is tested. Compiler output, temporary configs, package caches and browser profiles stayed under `/tmp`.

Final machine-readable reports are retained in:

- [`web/validation/browser-results.json`](../web/validation/browser-results.json)
- [`web/validation/wallet-results.json`](../web/validation/wallet-results.json)
- [`web/validation/contract-verification.json`](../web/validation/contract-verification.json)
- [`web/validation/export-integrity.json`](../web/validation/export-integrity.json)
- [`web/validation/revision-before.json`](../web/validation/revision-before.json) — measurements of the untouched export
- [`web/validation/revision-results.json`](../web/validation/revision-results.json) — regression assertions and final geometry/fonts/times
- [`.imd-responses.json`](../.imd-responses.json) — all nine reviewer responses

## Required data regressions

`web/tests/domain.test.ts` uses captured, public Sepolia records in `chain-fixture.json`; fixtures are excluded from the production bundle.

- Integer-like definition keys serialize lexicographically (`"10"` before `"2"`), including nested objects inside arrays; array order is preserved. The supplied numeric-key question hash is `0x0a41f72a223cc698a45e850e2ff389ae113890033df5b0fef53320ee31a7f53b`. This new test failed before the canonicalizer fix.
- Market 1’s exact question hashes to `0x50477e7b428ae78e43a979cc48ce0a7524746a0579d03570944489ff3ee3e800` under recursive sorted-key, compact JSON canonicalization.
- Transaction `0x56f6682a2dafbed218caa9d9cb798795e6257b557ba8309e6850c9134f5420f5` decodes as `complete`; its callback arguments recover an attestation whose `keccak256(abi.encode(attestation))` equals the matched `Answered.attHash`. Its bool answer is Yes, and request/body identities are verified. Corrupted hash, request and body cases are rejected.
- Bool labels, full 18-decimal bucket bounds, address-list keys, bytes32-list keys and “None of these” are covered. Bytes32 text is generated and decoded by viem, not handwritten.
- Market 1 is Finalized / Yes; market 2 is Voided. Closed, Asked, matched Answered, Open and Provisional precedence is also tested.
- Inclusive 10,000-block chunk boundaries, refund arithmetic, final-winner remainder, agent aggregation, optional evidence/definitions, escalation panel/quorum doubling, creator schedules and numeric bounds are covered.

Live browser checks independently read the two markets and the example attestation through the configured RPCs. Runtime logs start at deploy block 11888875. The captured fixtures’ numeric blocks were produced and round-tripped through RPC conversion code, not manually converted hex.

## Interaction coverage

Live production export at a `/preview/` subpath:

- Market navigation; Finalized/Voided filters; search/empty recovery; pool sort; market evidence; raw JSON disclosure; UUID panel link; actual final Yes result.
- Disconnected portfolio; wallet chooser empty state; Escape dismissal and focus return; creator-access explanation; agent ranking and sort.
- 390px first-screen heading and primary-action bounds; home reflow at 320, 360, 390 and 820px; desktop at 1440px. Market/risk pages checked at 390px. Dark/light switching and local font loading verified.
- Keyboard skip link and main focus; console/page errors and local resource failures checked.

Deterministic EIP-6963 wallet with fully intercepted RPC traffic:

- Primary-provider refusal and successful fallback; chain switch to Sepolia; exact approval and bet calldata `(id, outcome, amount, 0)`; contract simulation errors and disabled actions; oversized-bet rejection; wallet rejection and dismissal of its notice.
- Approved creator gate, validation focus, evidence-window warning, uint bucket preview, exact bounty approval, compact create bodies and denial for a non-approved creator.
- `stakes`, `totalStake` and `claimed` reads; winning and refund positions; claim calldata.
- Request answer and escalation preserve original creation bytes; submit answer sends the recovered attestation; finalize, refund and claim use their correct methods and market IDs. Each action is enabled through a successful mock simulation and re-simulated before the mock send.
- Creator and bet layouts checked at 390px. Accessibility scans covered open market/dark, creator review/dark, portfolio mobile/dark, portfolio desktop/light, home/light, risks/light and agent table/light.

The mock wallet deliberately represents several lifecycle stages using captured contract bytecode and RPC records. These checks validate the UI’s wallet/RPC integration and encoding, not the behavior of a real extension or the execution of new transactions on Sepolia.

## Better Interface consolidated review

The pinned workflow and core principles of all six domains were read and applied while implementing the site. The final system is documented in `DESIGN.md`; upstream attribution and the supplied license/notice texts are preserved.

| Domain | Coverage | Evidence and boundaries |
| --- | --- | --- |
| Accessibility | Checked | Native controls, labels, heading structure, status text, focus rules, skip link, modal Escape/focus return, table headers, focusable JSON scroll regions, reduced-motion opt-in, and nine automated scans. Creator review keyboard submission/focus also checked. No human screen-reader session, physical touch-device session or native 200% zoom. |
| Layout | Checked | Shared 1280px edges, wrapping questions/hashes, above-fold real market question/pools/View market action, desktop and narrow screenshots, measured document overflow at the listed widths, wrapped toolbars and scrollable table. No RTL or translated-layout test; the product is English only. |
| Writing | Checked | Action labels match contract calls; exact testnet warning; honest RPC/empty states; approval and confirmation text; immutable-market warning; fee/guardian/oracle risks. Refund is explained as enabling deposit claims; Claim transfers the wallet’s amount. |
| Typography | Checked | Archivo 800 / 125% and both Plex Mono faces confirmed loaded; six-size scale; 16px fields; tabular numbers; full-address and bytes32 review wrapping; Mono 500 dashboard/portfolio/fee figures; local review time in Asia/Taipei and UTC hover. Other OS font-rendering engines were not tested. |
| Colors | Checked | Both themes; computed opaque foreground/background pairs measured; 12 text/control pairs pass their applicable 4.5:1 or 3:1 threshold. Status text supplements color. Decorative diagram lines and quiet structural separators are not used as text or essential controls. |
| UI | Checked | Normal, selected, disabled, pending, rejected, confirmed, disconnected, empty and disclosure states reviewed through source and exercised flows. Local assets, all primary interactions and screenshots checked. Forced RPC recovery and same-wallet draft preservation pass, including scheduled refresh with an advanced browser clock. Motion source is reduced-motion-aware; animation-panel slow playback was not performed. |

### Revision findings and fixes

All nine reports reproduced before implementation; `.imd-responses.json` records the complete IDs and individual outcomes. Initial geometry came from the untouched static export; intercepted RPC fixtures reproduced transient failures without any signing or broadcasting. The new numeric-key unit test first failed against the original canonicalizer. Changes are confined to the affected site components/helpers, their tests, export and documentation.

| Severity / domain | Final source location | Reproduction, fix and recheck |
| --- | --- | --- |
| High / Layout | `web/src/App.tsx:308`, `web/src/styles.css:1927` | Live 390×844 first card began at y=1376.73; only hero/stats were initially visible. Removed hero-proof copy, compacted mobile hero, and moved open/recent markets ahead of statistics. Full question now occupies y=468.50–622.06 and View market y=790.06–830.06. Live and fixture suites assert the actual card/action, not only the directory link. |
| High / Layout / Typography | `web/src/CreatePage.tsx:516` | List review widened document to 627/623/1575px at 390/360/1440. Reused `.mono.outcome-label` wrapping; final document widths equal each viewport and both complete keys remain readable. |
| Medium / Data | `web/src/domain.ts:29` | Numeric definition keys were reordered by JSON.stringify. Direct recursive lexicographic serialization fixes them; numeric-key and original market vectors pass. |
| Medium / Writing / UI | `web/src/MarketPage.tsx:376`, `web/src/config.ts:73` | Failure link constructed a job ID from an oracle request and returned HTTP 404. It now opens `/oracle` (HTTP 200) and displays the request UUID. All successful job links still derive from recovered panelJobId; the example panel URL returned HTTP 200. |
| Medium / UI | `web/src/MarketPage.tsx:71` | Refresh after transaction-lookup recovery made zero new reads. Successful snapshots now retry failures and retain verified records. No-new-block/event refresh makes one transaction read, restores Hash verified and enables Submit answer on an Answered fixture. Later refresh during an outage preserves verified evidence without another lookup. |
| Medium / UI / Accessibility | `web/src/CreatePage.tsx:48` | New-block refresh erased every draft field and review. Account/deployment-scoped access checks retain the mounted form. Manual and automatic refresh (browser clock advanced 31 seconds) preserve all fields/review; access error/retry also preserves them while disabling creation. Revocation removes the form; disconnect/reconnect resets it. |
| Low / Typography | `web/src/styles.css:649`, `:1471`, `:1492` | Dashboard totals used Archivo 800. Homepage, portfolio and fee numbers now compute to IBM Plex Mono 500, normal stretch and tracking. Heading/wordmark styling retained. |
| Medium / Typography / Writing | `web/src/CreatePage.tsx:525` | Taipei 12:00 input became UTC-only 04:00 review. Shared Time now renders Jan 1, 2030, 12:00 PM with UTC title and exact ISO datetime; misleading helper removed. |
| Low / Writing | `web/src/App.tsx:327` | Zero-open-market headline claimed a question was open. Plain “No markets are open for betting” copy and settled-market action now match the count; recent records appear above the guidance. Open-market fixture suppresses the empty state. |

The first layout correction still placed the action below the fold because the section subtitle wrapped its directory link onto another row. Removed that redundant subtitle and rechecked: the final action fits at y=830 without changing or truncating the MarketCard content. No additional redesign was made. Regression harness selectors/clock probes were repaired against the actual rendered labels and RPC method; the reported final results are from completed runs.

### Initial implementation findings (retained history)

The following entries describe the previously accepted round; their line numbers refer to that round’s source. The revision above supersedes its overly broad first-screen claim and its uncovered creator/attestation edge cases.

| Severity / domain | Final source location | Finding, correction and recheck |
| --- | --- | --- |
| Medium / Accessibility | `web/src/App.tsx:587` | Agent names lacked explicit row-header semantics. Added row/column scopes. Browser row-header assertion and agent axe scan pass. |
| High / Colors | `web/src/styles.css:73` | White text on the specified light green was 4.176:1, below 4.5:1 for small button text. Changed `--on-accent` to ink; rendered ratio is 4.626:1. Light scans pass. |
| Medium / Colors | `web/src/styles.css:35`, `:67`, `:1108` | Quiet structural borders were also used for controls (1.941:1 against dark page). Added separate control-border roles for buttons/inputs/radio choices. Rendered secondary-button boundaries are 4.070:1 dark and 3.785:1 light. |
| Medium / Layout / UI | `web/src/App.tsx:140` | Mobile initially hid the only theme toggle. Added a theme action inside the disclosed navigation; both mobile theme paths exercised and screenshots inspected. |
| Medium / Writing / Data | `web/src/MarketPage.tsx:388` | Oracle figure was initially divided by 10^18 indiscriminately. Market 1’s figure is the raw integer 18. Now display the raw figure with an explicit units qualifier; uint answer/bucket formatting remains 18-decimal. |
| Low / Accessibility | `web/src/styles.css:215`, `web/src/App.tsx:51` | Offscreen skip-link positioning could appear in full-page captures after route focus scrolled the page. Switched to clipping until focus and prevented focus-induced route scrolling. Keyboard skip/focus checks and screenshots rechecked. |
| Medium / UI / Data | `web/src/store.tsx:37`, `web/src/wallet.tsx:275` | A confirmation could encounter an older in-flight read, and refresh failure could still claim success. Refresh now serializes a fresh snapshot and returns success explicitly; the notice distinguishes confirmed transaction from failed refresh. Standard send/refresh integration rechecked; forced overlapping-network timing was reviewed in source, not separately fault-injected. |
| Medium / UI | `web/src/chain.ts:172` | Subdividing every failed log query multiplied timeout/offline waits. Only explicit result/block-range refusals trigger subdivision. Publicnode-first fallback passes; all-provider timeout exhaustion was not waited through. |
| Medium / Accessibility | `web/src/MarketPage.tsx:524`, `web/src/CreatePage.tsx:525` | Long JSON disclosures needed an explicit keyboard scroll target. Added named `tabIndex=0` preformatted regions; shared focus styles apply. Disclosure/browser checks pass. |
| Medium / Writing / UI | `web/src/components.tsx:273` | A prior wallet rejection remained visible on the next route without context or dismissal. Transaction notices now name the action and allow dismissal after pending work completes. Rejection/dismissal browser check passes; creator screenshot re-captured. |

### Rendered evidence

Task attachments under `artifacts/` include `home-desktop.png`, `home-mobile.png`, `home-mobile-light.png`, `markets-desktop.png`, `market-desktop.png`, `market-mobile.png`, `risks-desktop.png`, `focus-desktop.png`, `bet-mobile.png`, `create-desktop.png` and `create-mobile.png`. The last three use explicitly simulated wallet/market states. Revision captures include `revision-before-home.png`, `revision-before-review.png`, `revision-home-mobile.png`, `revision-home-desktop.png`, `revision-list-review-mobile.png`, `revision-attestation-error.png` and `revision-home-open-mobile.png`; the revision wallet captures use intercepted fixtures. The live `home-mobile.png`, `home-mobile-light.png`, `home-desktop.png` and MCP captures `revision-live-home-mobile.png` / `revision-live-home-desktop.png` were also inspected. The artifact directory is excluded by the supplied Git configuration and collected separately; no ignore files were changed. Durable textual/JSON results are included in Git under `docs/` and `web/validation/`.

## Limitations and completion

The site and requested checks are complete. Live writes were not broadcast; a real installed wallet, hardware wallet, Safari/Firefox, physical phones, human screen-reader operation, native zoom, forced-colors rendering and a deployed DNS/IPFS origin remain untested. The browser inspections used an actual local production export, not screenshots inferred from source. Automated accessibility results cover the enumerated states, not every possible on-chain string or failure.

Public RPCs can be unavailable, throttle requests or reorganize recent chain history. The application has fallback/retry messaging and a 24-block overlap, but it is not a persistent indexer or an independent proof of RPC honesty. Wallet transactions can still revert if chain state changes after simulation. The live tests use the known Sepolia example markets and captured immutable transaction evidence; later chain activity can change directory counts and totals.

All implementation changes are confined to the website, export and documentation. Existing Solidity source, build configuration, dependencies and ignore files were preserved. The production export has no test fixtures, private configuration, node_modules, caches, backend code or dependency archives. `export-integrity.json` records final bytes and asset hashes. The export is 684,853 bytes. The conservative bundle bound sums the raw prospective tree, all existing compressed Git objects and a 200,000-byte reserve; it remains below 5.2 MB against the 8,388,608-byte limit. The publisher’s actual Git bundle was not created here.
