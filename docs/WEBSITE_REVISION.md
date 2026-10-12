# Verdict website revision validation

Complete for the three reported findings. This is the worker's evidence record, not an independent certification. The revision preserves the accepted website, mainnet configuration, ABI files, brand assets, fonts and contract source. Changes are limited to the filter layout, settlement attribution/ranking, three task headings, their tests, documentation and rebuilt static export. Existing build configuration, dependencies, lockfile and ignore rules are unchanged.

## Findings, reproduction and fixes

| Finding | Reproduction | Fix and final check |
| --- | --- | --- |
| `f98a5ce90202b8b579381e26c57c411ac30ec7000c073e3cf041fd4daf8557a5` | Original export at 768×844: document width 856px, filter row 828px, Sort by ended at x=856. Reproduced with both the assigned browser and local Chromium. | `web/src/styles.css:963`: toolbar and filter row can shrink; labels have flexible 260px bases and wrap. The <=680px column rule resets the basis to auto. At 768px the document is 768px and all fields stay within x=28–740. All 16 tested widths pass; keyboard search/token/sort and clear filters work. |
| `e232dc783ee2aee7282419fe8d8b967c3fe120f0eaacc59f8532f2cc4a0a4a6d` | A failing unit regression returned `[]` for a zero-reward resolve. Mainnet-shaped RPC fixtures for two zero-reward markets (IMD finalized, WETH voided) produced no Settlers rows in either period. | `web/src/settlement.ts:7`, `web/src/chain.ts:143`, `web/src/leaderboard.ts:56`: count the four settlement transitions independently; sum reward logs separately. Reward recipients identify contract callers when available; otherwise verify direct transaction data. Both periods now show 0 IMD and 3 actions for one caller, 0 IMD and 1 action for the other. Rewarded actions count once. Failed reads are disclosed and recover on refresh. |
| `367a41bb98a0e4585ba6ca5d335a84bdd403a01f34d9b616b54ddd9f4dcf2fba` | Original h1 values at 390px were “Every question. On chain.”, “On the record.” and “Put a question on chain.” The task identity was left to navigation/supporting copy. | `web/src/App.tsx:489`, `web/src/Leaderboard.tsx:55`, `web/src/CreatePage.tsx:68`: titles now read “Markets”, “Leaderboard” and “Create a market”. The Leaderboard subtitle is “IMD and WETH ranked separately.” All three exact headings are visible within the first 390×844 screen. Styles/fonts/logo are retained. |

The [pinned VerdictMarkets source](https://github.com/identity-md-launches/launch-1346-deploy-repository-s-audited-verdict/blob/083060a/src/VerdictMarkets.sol#L523) confirms that zero configured rewards skip the reward event, while successful settlement transitions still emit their respective lifecycle events. Resolve/propose rewards follow their transitions; finalize/void rewards precede them. Matching uses market ID, transaction hash, action code and log order, including multiple proposals in one transaction. Escalation requests, claims and bounty returns do not count as settlement actions.

## Commands and actual results

Checks ran on 2026-10-12 with the unchanged pinned Node/Vite/TypeScript/Vitest/Playwright toolchain, installed outside the repository through `isolated.mjs`.

| Command | Actual result |
| --- | --- |
| `node web/scripts/isolated.mjs install` | Passed; 80 packages from the existing lockfile under `/tmp/verdict-toolchain-62e0f58870792468`. |
| `node web/scripts/isolated.mjs test:wallet --review-before` | Before rebuilding, 7 checks reproduced all three reports against the accepted export. This mode deliberately expects the old defects and is not a passing test of the fixed export. |
| `node web/scripts/isolated.mjs typecheck` | Passed. An initial type assertion error in a new test fixture was repaired before the final check. |
| `node web/scripts/isolated.mjs test` | 37 tests passed in 3 files. The zero-reward regression first failed against the old implementation as expected. |
| `node web/scripts/isolated.mjs build` | Passed after the final runtime source change; 1,089 modules; relative static assets. |
| `node web/scripts/isolated.mjs test:wallet --review` | 37 assertions passed; tablet/phone/desktop geometry, keyboard filters/table scrolling, three headings, zero-reward rows in both periods and lookup-failure recovery. Three axe scans have zero violations. |
| `node web/scripts/isolated.mjs test:wallet` | Existing 43 assertions and five axe scans passed, including exact approvals, wrapping, creation, claims, settlement simulations and populated rankings. All wallet writes intercepted. |
| `VERDICT_RPC_URL=http://127.0.0.1:33859/rpc/1 node web/scripts/isolated.mjs test:browser` | 59 assertions and eight axe scans passed using live mainnet reads. Checks include first-screen action at 390px, navigation, filters, ABI links, both themes, local fonts, console/resources and eight measured contrast pairs. |
| `node web/scripts/check-export.mjs` | Passed: title/metadata/favicon, relative runtime assets, protected paths, no test fixtures/caches/dependency archives in the export, bundle budget under 8 MiB. Exact bytes/hashes are in `web/validation/export-integrity.json`. |
| `git diff --check` and changed-path inspection | Passed; website/export/tests/documentation and finding responses only. |

The initial browser rechecks stopped on an old heading selector and an overly exact label selector in the harness. Those selectors were corrected; all final scripts exited zero. No product behavior was changed to accommodate the tests. The production export is 771,290 bytes. The conservative complete-submission estimate remains below 6.0 MB versus the 8,388,608-byte limit. No dependencies or required runtime assets were removed.

The original deployment verification record is retained; this revision does not change or re-audit deployed bytecode/ABIs. No signing, transaction broadcast or publication command was run. The committed `dist/` remains the delivery for the publisher to update `verdict.sites.imd.fun`.

## Better Interface review of the affected surfaces

Read and applied the pinned workflow, core principles of all six domains and design-documentation method. Updated `DESIGN.md` from the final source and rendered behavior; preserved the existing license notices.

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility | Checked. Native labeled inputs/selects and status buttons remain; Tab reaches token then sort; the table region scrolls by keyboard. Viewed the visible focus ring on Sort by. Sixteen combined axe scans pass in the tested states. | No human screen-reader session, physical-device or forced-colors review. |
| Layout | Checked. Filters and every status control fit at 320, 360, 390, 680, 681, 720, 767, 768, 769, 820, 883, 884, 900, 901, 1024 and 1440px. Inspected the actual before/after tablet screenshots. Site-wide existing route/reflow checks pass. | Native 200% zoom, RTL and translated layouts were not tested. A viewport reflow check is not a native zoom test. |
| Writing | Checked. Task titles match their routes. Settler help accurately distinguishes rewards and actions; unavailable callers have explicit status/retry guidance. Existing mainnet notice, token units and transaction wording are preserved. | Scope was the reported pages and affected shared flow, not a rewrite of all site copy. |
| Typography | Checked. Existing Archivo/IBM Plex Mono files load. Six-size scale and tabular data styles are retained. Labels wrap inside the revised row, and shorter headings use their natural height. | No font changes or additional font/device matrix. |
| Colors | Checked. Both themes retain their tokens. Eight rendered text/background measurements were repeated: all exceed 4.5:1; exact pairs are in `browser-results.json`. Tablet filters and the zero-reward table also pass axe. | No claim that every future metadata state has been measured. |
| UI | Checked. Existing control surfaces/selected states are retained; empty filter recovery, zero-value rows, verified addresses/ENS, loading failure and refresh recovery were exercised. Table columns remain reachable at 390px without document overflow. | No slow-motion animation-panel replay; the tests emulate reduced motion. |

No unresolved reported defect remains in the reproduced scenarios. Browser and worker checks do not certify all possible future market histories.

## Evidence and remaining limits

- `web/validation/review-reproduction.json` records the original geometry/headings/empty Settlers tables. `review-regressions.json` records the final geometry, rows, periods and checks. Current `browser-results.json` and `wallet-results.json` refer to the revised export.
- `web/tests/settlement.test.ts` covers zero rewards across both collateral types, seven-day boundaries, rewarded transitions without double-counting, correct reward pairing, replacement proposals, ignored escalation/auxiliary logs, incorrect/pending/indirect transaction attribution and failed-read retries. The original question-hash, attestation, fee/default and net-result tests remain.
- Screenshots were generated under disposable `test/scratch/browser/` and opened for inspection: `review-before-markets-768.png`, `review-markets-768.png`, `review-markets-keyboard-768.png`, `review-zero-reward-settlers-390.png`, `review-zero-reward-settlers-values-390.png` and `review-create-390.png`. They are review outputs, not shipped runtime assets.
- The assigned browser initially reproduced the 768px overflow, then its transport closed. The remaining review used the existing local Chromium/Playwright harness with a bounded preview at `/preview/`. WebKit and physical devices were not checked in this revision.
- A transaction sent directly to VerdictMarkets identifies its caller after verifying the mined hash/block, function and market ID. For indirect calls with a reward log, that log identifies the actual contract caller. An indirect call without a reward log needs execution traces; ordinary transaction data cannot establish its internal caller. Such actions are counted as unattributed in a visible notice, never guessed as belonging to the outer sender. Temporary lookup failures use the same notice and retry on refresh.
- Live checks were read-only through the worker's relay. Zero-reward scenarios and wallet writes used clearly isolated fixtures; no mainnet transaction was necessary. Public RPC availability, extension wallets, public DNS/IPFS publication and human auditing remain outside these checks.
