# Verdict

Verdict is a static React / TypeScript interface for the new **Ethereum mainnet** markets. It supports IMD and WETH pools, exact token approvals, ETH wrapping, WETH unwrapping, IMD settler rewards, oracle evidence, creation and claims. It has no backend, analytics or trackers. Brand, logo, local fonts, and the title **Verdict** are preserved.

The site label remains **`verdict`**, at **https://verdict.sites.imd.fun**. The finished export is [dist/index.html](dist/index.html); source and the existing pinned lockfile are under [web/](web/package.json). Only website source, tests, export and documentation changed. Solidity, dependencies, manifests/lockfiles and existing build configuration were preserved.

## Install, preview and rebuild

Use Node **22.18+** and npm (validated with Node 22.23.3). The isolated runner installs the existing lockfile into a content-addressed temporary directory, outside this repository. Once installed, building, typechecking and unit tests need no network.

```sh
node web/scripts/isolated.mjs install
node web/scripts/isolated.mjs typecheck
node web/scripts/isolated.mjs test
node web/scripts/isolated.mjs build
node web/scripts/isolated.mjs preview
```

Open the preview URL printed by Vite. `dev` runs the development server. The production build replaces `dist/`, so rebuild after source changes. A standard local workflow also works: `cd web`, `npm ci`, then `npm run build`, `npm run typecheck`, `npm test` or `npm run preview`. Never submit generated dependencies or caches. The checked export can be served directly without Node or a build step.

## Validate

```sh
node web/scripts/isolated.mjs browser:install
node web/scripts/isolated.mjs test:browser
node web/scripts/isolated.mjs test:wallet
node web/scripts/isolated.mjs verify:contracts
node web/scripts/check-export.mjs
```

The browser scripts manage a foreground preview under `/preview/`, run Chromium, and close both browser and server. They use the preinstalled IMD Chromium when available, the installed Playwright browser otherwise, or `CHROMIUM_EXECUTABLE` when provided. The public browser check uses live mainnet reads. On this worker it ran with the provided relay:

```sh
VERDICT_RPC_URL=http://127.0.0.1:42311/rpc/1 node web/scripts/isolated.mjs test:browser
VERDICT_RPC_URL=http://127.0.0.1:42311/rpc/1 node web/scripts/isolated.mjs verify:contracts
```

That loopback endpoint is only a verification override; it is absent from the production export. The wallet suite intercepts all RPC and wallet writes. It validates wrapping, approvals, bets, creation, settlement, claims, ENS and rankings without signing or broadcasting transactions. `verify:contracts` compares the ABI exports against the pinned source and checks mainnet code hashes, collateral configuration, token decimals, oracle asset/Intake and the 48-hour configuration delay. It does not compile the historical Solidity in this repository.

Actual results and limits are in [docs/WEBSITE_VALIDATION.md](docs/WEBSITE_VALIDATION.md), with machine-readable records in [web/validation/](web/validation/). Unit tests cover the required question-hash vector, supplied Intake v2 attestation/hash, outcome labels, fee rounding per token, bounty minimum, UTC defaults and win/loss/void leaderboard results. Screenshots are generated in disposable `test/scratch/browser/`; no preview, browser profile or cache is part of the site.

## Publish the static export

The assignment publisher pins the contents of **`dist/`** and updates the existing **`verdict`** site after submission. It does not rebuild. No publishing command or on-chain transaction was run here. On another static host, upload the same directory unchanged. `base: './'`, relative assets and hash routes allow hosting at a gateway subpath without server rewrites. Keep the ABI downloads, fonts/licenses, favicon, social image, scripts and styles together.

Include `web/`, its unchanged package manifest/lockfile, `dist/`, `DESIGN.md` and website documentation in the submission. Do not include `node_modules`, caches, npm archives or `test/scratch`. No ignore rules were changed. The export is about 0.77 MB; the conservative complete Git submission estimate is below 5.6 MB against the 8 MiB limit (exact figures are recorded by the export check).

## Mainnet deployment and behavior

[web/src/config.ts](web/src/config.ts) is the runtime configuration. Ethereum chain **1** is the only configured network. Logs start at block **26,172,752** in inclusive chunks of at most **5,000 blocks**. The ordered fallback is Tenderly, MEV Blocker, then PublicNode, using the URLs from the brief.

| Contract / token | Mainnet address |
| --- | --- |
| VerdictMarkets | `0x279ac25fb2ef2239241c439a007f39c42f99e334` |
| VerdictOracle | `0x8ce069975ae8c69bf7cb2bd225aafa43ba307931` |
| VerdictBurnVault | `0xb1dfe46f912543e366175201edb298263911a1aa` |
| IMD | `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7` |
| WETH9 | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` |
| IMD Intake v2 | `0xa43e6f75ee006411f79ac1c84120606c2330de82` |

The ABIs come from [the mainnet repository at 083060a](https://github.com/identity-md-launches/launch-1346-deploy-repository-s-audited-verdict/tree/083060a/docs/agents/abi). `web/src/abi/provenance.json` records canonical hashes. They are also downloadable from the static site. **The unchanged root Solidity and its documentation below describe the earlier release; do not derive mainnet website ABIs from that tree.**

- A snapshot pins pools/configuration to its scanned block and checks market count against creation logs. Refreshes run every 30 seconds while visible, overlap 24 blocks for recent reorgs, and retry failures. Last-known data stays visible on refresh failure, with writes disabled.
- Amounts always name their token. Stats, portfolio totals and leaderboard rankings keep IMD and WETH separate. IMD burned is the IMD balance of VerdictBurnVault. Volume is credited pool stake; paid out excludes refunds and creator fees. Fees and caps come from `collateralConfig(slot)`.
- A bet checks the market's token balance and allowance, approves the exact amount if needed, then sends `bet(id,outcome,amount,0)`. A WETH shortfall offers a separate exact-value `deposit()` transaction first. Portfolio offers partial or full `withdraw(amount)` from the wallet's WETH balance.
- All financial actions are simulated again immediately before sending. Permissionless action controls also require a successful current wallet/argument/snapshot simulation before enabling. Reward estimates are upper bounds; the chain's actual `SettlerRewarded` amount is displayed in the timeline. Oracle spend, rewards paid, returned bounty and remaining bounty are all IMD.
- Attestations are recovered from successful Intake v2 transactions and matched to the oracle event, request IDs, body hash and attestation hash. Only the latest primary request can be proposed; replacements must match the market's escalation request. Panel links use the decoded `panelJobId` UUID.
- UTC is displayed first, e.g. `Thu 15 Oct 22:00 UTC`, with the local date/time on hover. A market's URI supplies its title. Inline JSON, JSON data URIs, plain titles and public HTTPS/IPFS JSON are supported. Linked JSON reads omit credentials/referrers, stop at 64 KiB or 4 seconds, and fall back to the on-chain question on failure. Metadata cannot inject HTML. Question time uses explicit URI `targetTime` when available; otherwise the evidence end block's timestamp (or a labeled estimate for a future block).
- Creator forms are gated by on-chain access. T defaults to tomorrow, with close T−2h, evidence from close+15m to T, answers T+45m through 3 days later, refunds 2 days after that, and a 2h dispute. Evidence blocks use the measured average over the last 100,000 blocks. Estimates stay stable during review; the reset button recomputes them. Bounty defaults to `2 × price + 5 × reward`, with a 0.05 IMD reward bounded by the on-chain maximum. The review shows exact bodies/hash, token and funding before approval and creation.

## Leaderboard definitions

Traders and Agents rank net results on finalized markets: actual claimed payout, or currently due unclaimed payout, minus all stakes. Voids contribute zero net. At least three finalized markets per token in the chosen period are required. “Win rate” means holding a winning stake divided by finalized markets, even if that market's net result is negative. Markets played includes voids. The seven-day window uses settlement time and includes every stake in each qualifying market.

Agent IDs are unverified event labels; ID 0 conventionally means a person. When a wallet uses multiple IDs, its payout is apportioned to those IDs by winning stake, with integer residue assigned to the final winning ID in stable lexical order. Unique markets are counted once per ID. Creators rank by earned creator fees; creation, bet volume and fees use their own event timestamps for seven-day filtering. Settlers rank IMD rewards and count `SettlerRewarded` events across both collateral types; escalation has no reward event. Zero-amount emitted reward events count. Actions with no emitted reward event are not attributed to a settler.

ENS is reverse-resolved and forward-checked before replacing an address; lookup failures retain the address. Wallet rows link to Etherscan. Rank sharing is a normal X intent link, with no embedded X script. No leaderboard blends token values or assumes an exchange rate.

## Historical contract documentation (unchanged earlier release)

This section describes the historical root contracts, not the mainnet contracts used by the website above.

Verdict is an immutable parimutuel prediction market application for Sepolia (chain **11155111**). Creators fund oracle requests; bettors deposit IMD into outcome buckets; authenticated IdentityMD oracle answers establish a provisional outcome; a dispute window precedes settlement. The deployment set is exactly **VerdictBurnVault → VerdictOracle → VerdictMarkets**. There is no launch token, proxy, upgrade, or separate liquidity pool.

## Build and verification

```sh
forge build
forge test
forge fmt --check
```

The root `foundry.toml` pins Solidity **0.8.26**, Cancun, optimizer 200 runs, via-IR, and `bytecode_hash = "none"`. No FFI, filesystem permissions, RPC, environment variables, or network are needed by the tests. All Solidity dependencies are vendored as ordinary files: OpenZeppelin Contracts **v5.5.0** and forge-std **v1.9.7**. The verifier supplies the pinned compiler; no compiler binary is included.

The suite includes the protocol's fixed EIP-712 digest/signature vector, independently encoded struct hash, domain/selector checks, exact Sepolia constructor rehearsal, adversarial callbacks, configuration rotation, all outcome types, deadline boundaries, entry controls, transfer-fee receipt accounting, reentrancy, actual token-transfer conservation, and a three-market stateful invariant. The invariant compares on-chain balances with each market's liabilities throughout randomized calls, then settles and drains every market. Independent review and reviewer-authored regressions are in [docs/INDEPENDENT_REVIEW.md](docs/INDEPENDENT_REVIEW.md) and [test/IndependentReview.t.sol](test/IndependentReview.t.sol).

The contracts are now live on Sepolia. The website verification independently checked their deployed bytecode and ABI hashes; see [web/validation/contract-verification.json](web/validation/contract-verification.json). No wallet credentials were read and no transactions were broadcast by the website task. The original deployment procedure remains in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); earlier contract test results are in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Contracts

### VerdictBurnVault

An empty contract with no functions, owner, receive, fallback, or outgoing transfer path. ERC20 transfers to it succeed at the token contract and can never be recovered through the vault. It locks IMD without reducing the token's reported total supply. Plain ETH transfers and calls revert.

### VerdictOracle

`request(body)` is permissionless. It collects exactly the current price, approves that exact amount, calls `Intake.request` with callback `(this, 0x510379c7)`, and clears any remaining approval. Both incoming payment and Intake spending must be exact. It retains no request funds and has no sweep or arbitrary-call function.

Each returned Intake ID permanently reserves its replay key and stores `{bodyHash, intake, signer}`. A callback must come from that request's recorded Intake, carry an unexpired signature in **VerdictOracle's** EIP-712 domain, and use an oracle attestation UUID never stored before. The Intake request ID and attestation UUID are intentionally different IDs. The result contains `keccak256(abi.encode(a))` and the request body hash; the callback clears pending state, records `intakeRequestOf[attestationUUID]`, timestamps `lastDelivered`, and emits `Answered`. It does not decode outcomes or call Markets.

The canonical 15-field `OracleAttestation.Attestation` representation and consumer base are copied from the supplied protocol reference. Dynamic `answer` is hashed for EIP-712. Domain: `IdentityMD Oracle`, version `2`, current chain ID, verifying contract = VerdictOracle. Issued-at tolerance is five minutes. An inverted validity interval is rejected. Bodies must contain 1–16,384 bytes; callback answers are bounded to 16,384 bytes. A cold maximum-size answer callback through the mock Intake used **140,592 gas**, below the 150,000 target and 200,000 service stipend, with an EOA signer.

`answerOf(a)` returns the recorded body hash only for an exact attestation match. Delivery authenticates freshness once: stored results remain readable after expiry. Markets impose their own issued-at and proposal windows. No result can be edited or removed by the owner. The inherited optional `consumed` mapping is unused; `requested`, `pending`, and `results` implement Verdict's replay rules.

The owner can `proposeConfig(Config)` then `acceptConfig()` after the immutable delay, capped at 30 days. A new proposal replaces the pending proposal and restarts the delay. Config comprises Intake, asset, signer, action ID, and price; addresses/action/price must be nonzero. Ownership uses OpenZeppelin `Ownable2Step`. The configured launch delay is **zero**, so the two calls can occur immediately. Requests already paid retain their original Intake and signer through rotation. No cancellation, asset withdrawal, or callback override exists. The zero-delay owner can replace both Intake and signer immediately, and thereby control the truth of answers to future requests, including asks for markets with existing bets. Requests already paid retain their pinned authorities. Raising the price or changing the asset can also prevent future asks; bettor principal remains refundable under the timeout rules.

### VerdictMarkets

The oracle, collateral, treasury, burn sink, fee rates, and per-market cap are immutable. Constructors perform no external calls and require no deployed dependency code. Aggregate fees cannot exceed 500 bps; the cap must be nonzero.

The guardian may pause/unpause entry, add/remove creators, permanently disable the creator allowlist, propose a new guardian (who accepts), or renounce while unpaused with the allowlist disabled. It cannot move tokens, change terms, change outcomes, prevent asks/proposals/settlement/claims, or upgrade the application. Initially the allowlist is **on and empty**; the guardian must add creators or disable it. Renouncing with the allowlist still on reverts; disable it before relinquishing the guardian role.

## Market lifecycle

1. **Create.** An admitted creator calls `createMarket(p, body, escalationBody, uri, agentId)` and funds at least twice the current oracle price. Both requested and actually received bounty must cover two asks. The market stores the received bounty, terms, primary body hash, and optional escalation body hash. `MarketCreated` publishes both complete bodies, URI, creator, and agent attribution. The URI and agent ID are event metadata, not authority. A nonempty escalation body must differ from the primary body.
2. **Bet.** Anyone calls `bet(id, outcome, amount, agentId)` before `closeAt` while entry is unpaused. Credits use the actual balance increase. Pool cap includes all credited bets, excludes bounty, and applies separately to each market. Bets cannot be withdrawn, transferred, or redirected before settlement.
3. **Ask.** Anyone calls `resolve(id, body)` during `[answerFrom, answerUntil)` while there is no provisional outcome. The exact published primary body is required. A second primary ask is available at least 24 hours after the first, only if that market's first request is still pending. Deliveries purchased by other callers or markets do not block this retry. A delivered but unusable answer still blocks retry under the specified no-delivery rule. There are at most **two bounty-funded asks total**, shared between primary retries and escalation.
4. **Propose.** Anyone submits the complete delivered attestation. The first proposal must authenticate against the primary body hash and one of the market's own recorded primary Intake request IDs. Question hash, answer type, data chain, and exact block window must match. The panel must meet `minPanelSize`, and agreement must meet `minAgreed` and signed quorum; quorum must be positive and agreement cannot exceed panel size. The signed `issuedAt` must be in the inclusive interval `[answerFrom, answerUntil]`. The first proposal is accepted from `answerFrom` until strictly before `voidAfter`, including after `answerUntil` for a timely signed answer. Direct purchases through VerdictOracle cannot establish an outcome; permissionless callers must trigger the market's `resolve` instead.
5. **Dispute.** A primary proposal starts its dispute window. Before it ends and before `answerUntil`, anyone may call `escalate(id, escalationBody)` once, spending one remaining ask and extending the window to at least 24 hours from that call. A matching escalation answer can replace the primary once, only inside the current window, and must have at least twice the current panel size. It starts one fresh full dispute window. A replacement must answer the market's recorded `escalate` request, so pre-bought answers cannot consume its dispute opportunity. Its issuance must be at or after that escalation ask and at or before the extended dispute deadline. Escalation delivery/replacement may occur after `answerUntil` or `voidAfter` while the current dispute window is still open. The replacement restarts the window only once, preserving finalization even past `voidAfter`.
6. **Finalize.** At or after the current dispute deadline, any caller can finalize a provisional market with a funded winning bucket, regardless of `voidAfter`. Separately rounded creator, burn, and treasury fees are paid from the **entire pool**, and all unspent bounty returns to the creator. A missing escalation answer leaves the primary outcome in place.
7. **Claim or refund.** Winners call `claim(id)` once per address. Each receives `stake * (pool - fees) / winningPool`, rounded down; the last winning claimant receives the exact remaining payout. If no provisional outcome exists at `voidAfter`, anyone can void the market. A provisional outcome with no winning stake can be voided after its dispute window ends. Voiding charges no fees and returns unspent bounty; every bettor then uses the same `claim(id)` to receive all their credited stakes across outcomes. A funded provisional winner cannot be timeout-voided.

Dispute duration is 1 hour through 3 days inclusive. Creation requires a future close and `closeAt <= answerFrom < answerUntil < voidAfter`. `minPanelSize >= 5`, `minAgreed > 0`, nonzero question/data-chain identifiers, and an ordered block interval are required. `minAgreed` may exceed `minPanelSize`; a larger actual panel can satisfy both. No maximum lifetime or minimum gap between `answerUntil` and `voidAfter` is imposed.

### Outcome definitions

| Type | Terms | Outcome |
| --- | --- | --- |
| `0` bool | No bounds or keys | `false → 0`, `true → 1` |
| `3` uint256 | 1–7 positive, strictly increasing bounds | Bucket `i` contains `bounds[i-1] <= value < bounds[i]`; first bucket starts at zero, last has no upper bound |
| `4` address[] | 1–7 unique keys, each fitting uint160 | Compare only the first address, encoded as `bytes32(uint256(uint160(address)))`, against keys |
| `5` bytes32[] | 1–7 unique keys | Compare only the first bytes32 against keys |

Lists use the final bucket for empty lists or an unmatched first element, even if a later element matches. Arrays with duplicate keys, unordered bounds, extraneous terms, or more than eight resulting outcomes are rejected. Answers use `abi.encode(value)`; malformed ABI cannot establish an outcome.

## Accounting and trust assumptions

For each completely claimed market:

```text
payouts + refunds + fees + oracleSpend + returnedBounty
    == creditedBetDeposits + creditedCreatorBounty
```

Each intermediate market liability is the right-hand side less completed outflows. The sum of liabilities equals Markets' token balance absent direct donations. Fees round down individually; rounding residue belongs to winners. Bounty is isolated from bettor principal. A later oracle price increase can make the remaining bounty insufficient, but cannot draw from the pool or another market. Changing oracle asset away from the immutable collateral blocks new markets/asks; existing results, settlement, and refunds remain usable.

IMD must remain a transferable, non-rebasing ERC20. Receipt measurement safely credits transfer-fee deposits, but oracle purchases require an exact payment and outgoing transfers are assumed to deliver their nominal amount. A paused, blocked, malicious, or rebasing collateral token is outside that operating assumption; failed transfers revert accounting atomically. There is no administrative rescue if a dependency stops operating.

The panel and signer are trusted for factual truth, and Intake is trusted to pair its request ID with the signed attestation UUID. The on-chain verifier authenticates the exact terms; it cannot judge evidence or repair a misleading creator body. Request bodies are opaque bytes on chain: creators must produce valid strict protocol JSON, use absolute confirmed block windows, select matching definitions/question hashes, use the VerdictOracle consumer domain, and configure appropriate panels/quorums. The UI must quote/escape untrusted user text before constructing oracle JSON. Relative windows, a wrong `consumer`, conflicting callbacks/delivery targets, or malformed JSON can spend the fee without producing a usable answer.

For list markets, the 16,384-byte callback answer limit includes the ABI encoding: at most 510 address/bytes32 entries (64 bytes of array overhead plus 32 bytes per entry). Markets uses only the first entry, but the entire answer must fit this cap. Oversize signed answers revert the one-shot callback and spend the fee. Creators must bound requested list output accordingly.

Primary issuance remains restricted to `[answerFrom, answerUntil]`, and new asks stop at `answerUntil`. A primary request paid immediately before that cutoff may return too late to be usable; no latency is guaranteed. Creators and keepers must leave response time before the cutoff. Primary proposals after `answerUntil` cannot initiate a new escalation ask, even if their dispute window remains open. This revision changes issuance timing for answers to an already-paid escalation only. A signature-valid primary delivery below the market's panel/agreement minima also prevents a second primary ask; principal can be refunded at `voidAfter`, but oracle spend is never refunded.

Oracle delivery is attempted once. A refused request, missing answer, expired result, invalid signature, or failed callback is not refunded. Failed callbacks leave a pending record but no funds in VerdictOracle; market timeout refunds provide economic recovery of principal, not already-spent oracle fees. Rotating a signer does not revoke its authority over requests that already pinned it. ERC-1271 signers are supported, but their own behavior determines signature validity and callback gas usage; the supplied signer is an EOA.

Direct token donations are outside deposit accounting and cannot be recovered. Unclaimed legitimate payouts stay available indefinitely; no-dust settlement assumes all entitled bettors claim. There is no automatic keeper or keeper reward: creators or independent callers must ask, propose, settle, and claim. Caps and panel minima limit the application mechanically; they do not guarantee truthful answers.

## Files and responsibilities

- `src/`: the three applications, canonical attestation representation, and minimal interfaces.
- `test/`: success/failure, conformance, invariant, factory rehearsal, and independent review regressions. Mock tokens are test-only.
- `script/SepoliaParameters.sol`: exact static constructor argument encoding for the launch service/rehearsal; no deployment or wallet logic.
- `docs/DEPLOYMENT.md`: launch order, full parameters, initial operations, and post-launch verification.
- `docs/INDEPENDENT_REVIEW.md`: original review; superseded source hashes are identified there.
- `docs/REVISION_REVIEW.md`: review and decisions for this bounded revision.
- `.imd-responses.json`: response to every reopened finding.
- `DEPENDENCIES.md`: vendored dependency provenance and licenses.

The separate launch manifest/final review/deployment stages own publication and live deployment. The oracle owner owns future configuration and ownership transfers. The guardian owns creator admission and entry controls. Creators own body quality and parameter selection. Anyone can perform settlement operations; each bettor claims their own funds. Website work follows separately and must use the confirmed deployment handoff addresses.
