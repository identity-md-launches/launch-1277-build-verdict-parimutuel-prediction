# Verdict

Verdict is an immutable parimutuel prediction market application for Sepolia (chain **11155111**). Creators fund oracle requests; bettors deposit IMD into outcome buckets; authenticated IdentityMD oracle answers establish a provisional outcome; a dispute window precedes settlement. The deployment set is exactly **VerdictBurnVault → VerdictOracle → VerdictMarkets**. There is no launch token, proxy, upgrade, or separate liquidity pool.

## Build and verification

```sh
forge build
forge test
forge fmt --check
```

The root `foundry.toml` pins Solidity **0.8.26**, Cancun, optimizer 200 runs, via-IR, and `bytecode_hash = "none"`. No FFI, filesystem permissions, RPC, environment variables, or network are needed by the tests. All Solidity dependencies are vendored as ordinary files: OpenZeppelin Contracts **v5.5.0** and forge-std **v1.9.7**. The verifier supplies the pinned compiler; no compiler binary is included.

The suite includes the protocol's fixed EIP-712 digest/signature vector, independently encoded struct hash, domain/selector checks, exact Sepolia constructor rehearsal, adversarial callbacks, configuration rotation, all outcome types, deadline boundaries, entry controls, transfer-fee receipt accounting, reentrancy, actual token-transfer conservation, and a three-market stateful invariant. The invariant compares on-chain balances with each market's liabilities throughout randomized calls, then settles and drains every market. Independent review and reviewer-authored regressions are in [docs/INDEPENDENT_REVIEW.md](docs/INDEPENDENT_REVIEW.md) and [test/IndependentReview.t.sol](test/IndependentReview.t.sol).

This repository is a deployment handoff, not evidence of a live deployment. No wallet credentials were read, transactions broadcast, or deployment addresses invented. The launch service performs the manifest, final review, deployment, and address recording after acceptance. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Final local results, including a fresh offline build and 81 passing tests, are recorded in [docs/VERIFICATION.md](docs/VERIFICATION.md).

## Contracts

### VerdictBurnVault

An empty contract with no functions, owner, receive, fallback, or outgoing transfer path. ERC20 transfers to it succeed at the token contract and can never be recovered through the vault. It locks IMD without reducing the token's reported total supply. Plain ETH transfers and calls revert.

### VerdictOracle

`request(body)` is permissionless. It collects exactly the current price, approves that exact amount, calls `Intake.request` with callback `(this, 0x510379c7)`, and clears any remaining approval. Both incoming payment and Intake spending must be exact. It retains no request funds and has no sweep or arbitrary-call function.

Each returned Intake ID permanently reserves its replay key and stores `{bodyHash, intake, signer}`. A callback must come from that request's recorded Intake, carry an unexpired signature in **VerdictOracle's** EIP-712 domain, and use an oracle attestation UUID never stored before. The Intake request ID and attestation UUID are intentionally different IDs. The result contains `keccak256(abi.encode(a))` and the request body hash; the callback clears pending state, timestamps `lastDelivered`, and emits `Answered`. It does not decode outcomes or call Markets.

The canonical 15-field `OracleAttestation.Attestation` representation and consumer base are copied from the supplied protocol reference. Dynamic `answer` is hashed for EIP-712. Domain: `IdentityMD Oracle`, version `2`, current chain ID, verifying contract = VerdictOracle. Issued-at tolerance is five minutes. An inverted validity interval is rejected. Bodies must contain 1–16,384 bytes; callback answers are bounded to 16,384 bytes. A cold maximum-size answer callback through the mock Intake used **118,403 gas**, below the 150,000 target and 200,000 service stipend, with an EOA signer.

`answerOf(a)` returns the recorded body hash only for an exact attestation match. Delivery authenticates freshness once: stored results remain readable after expiry. Markets impose their own issued-at and proposal windows. No result can be edited or removed by the owner. The inherited optional `consumed` mapping is unused; `requested`, `pending`, and `results` implement Verdict's replay rules.

The owner can `proposeConfig(Config)` then `acceptConfig()` after the immutable delay, capped at 30 days. A new proposal replaces the pending proposal and restarts the delay. Config comprises Intake, asset, signer, action ID, and price; addresses/action/price must be nonzero. Ownership uses OpenZeppelin `Ownable2Step`. The configured launch delay is **zero**, so the two calls can occur immediately. Requests already paid retain their original Intake and signer through rotation. No cancellation, asset withdrawal, callback override, or outcome power exists.

### VerdictMarkets

The oracle, collateral, treasury, burn sink, fee rates, and per-market cap are immutable. Constructors perform no external calls and require no deployed dependency code. Aggregate fees cannot exceed 500 bps; the cap must be nonzero.

The guardian may pause/unpause entry, add/remove creators, permanently disable the creator allowlist, propose a new guardian (who accepts), or renounce while unpaused. It cannot move tokens, change terms, change outcomes, prevent asks/proposals/settlement/claims, or upgrade the application. Initially the allowlist is **on and empty**; the guardian must add creators or disable it. Renouncing with the allowlist still on permanently freezes its current members.

## Market lifecycle

1. **Create.** An admitted creator calls `createMarket(p, body, escalationBody, uri, agentId)` and funds at least twice the current oracle price. Both requested and actually received bounty must cover two asks. The market stores the received bounty, terms, primary body hash, and optional escalation body hash. `MarketCreated` publishes both complete bodies, URI, creator, and agent attribution. The URI and agent ID are event metadata, not authority. A nonempty escalation body must differ from the primary body.
2. **Bet.** Anyone calls `bet(id, outcome, amount, agentId)` before `closeAt` while entry is unpaused. Credits use the actual balance increase. Pool cap includes all credited bets, excludes bounty, and applies separately to each market. Bets cannot be withdrawn, transferred, or redirected before settlement.
3. **Ask.** Anyone calls `resolve(id, body)` during `[answerFrom, answerUntil)` while there is no provisional outcome. The exact published primary body is required. A second primary ask is available at least 24 hours after the first, only if no answer for that body was delivered at or after the first ask. There are at most **two bounty-funded asks total**, shared between primary retries and escalation.
4. **Propose.** Anyone submits the complete delivered attestation. The first proposal must authenticate against the primary body hash. Question hash, answer type, data chain, and exact block window must match. The panel must meet `minPanelSize`, and agreement must meet `minAgreed` and signed quorum; quorum must be positive and agreement cannot exceed panel size. The signed `issuedAt` must be in the inclusive interval `[answerFrom, answerUntil]`. The first proposal is accepted from `answerFrom` until strictly before `voidAfter`, including after `answerUntil` for a timely signed answer. No paid ask is required if someone sponsored the exact body directly through VerdictOracle.
5. **Dispute.** A primary proposal starts its dispute window. Before it ends and before `answerUntil`, anyone may call `escalate(id, escalationBody)` once, spending one remaining ask and extending the window to at least 24 hours from that call. A matching escalation answer can replace the primary once, only inside the current window, and must have at least twice the current panel size. It starts one fresh full dispute window. Directly sponsored escalation answers are also accepted; they cannot be the first proposal. Escalation delivery/replacement may occur after `answerUntil` or `voidAfter` if its signed issuance is timely and the current dispute window is still open.
6. **Finalize.** At or after the current dispute deadline, any caller can finalize a provisional market with a funded winning bucket, regardless of `voidAfter`. Separately rounded creator, burn, and treasury fees are paid from the **entire pool**, and all unspent bounty returns to the creator. A missing escalation answer leaves the primary outcome in place.
7. **Claim or refund.** Winners call `claim(id)` once per address. Each receives `stake * (pool - fees) / winningPool`, rounded down; the last winning claimant receives the exact remaining payout. If no provisional outcome exists at `voidAfter`, anyone can void the market. A provisional outcome with no winning stake can be voided after its dispute window ends. Voiding charges no fees and returns unspent bounty; every bettor then uses the same `claim(id)` to receive all their credited stakes across outcomes. A funded provisional winner cannot be timeout-voided.

Dispute duration is 1 hour through 3 days inclusive. Creation requires a future close and `closeAt <= answerFrom < answerUntil < voidAfter`. `minPanelSize >= 5`, `minAgreed > 0`, nonzero question/data-chain identifiers, and an ordered block interval are required. `minAgreed` may exceed `minPanelSize`; a larger actual panel can satisfy both. No maximum lifetime or minimum gap between `answerUntil` and `voidAfter` is imposed.

### Outcome definitions

| Type | Terms | Outcome |
| --- | --- | --- |
| `0` bool | No bounds or keys | `false → 0`, `true → 1` |
| `3` uint256 | 1–7 strictly increasing bounds | Bucket `i` contains `bounds[i-1] <= value < bounds[i]`; first/last ends are unbounded |
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

Oracle delivery is attempted once. A refused request, missing answer, expired result, invalid signature, or failed callback is not refunded. Failed callbacks leave a pending record but no funds in VerdictOracle; market timeout refunds provide economic recovery of principal, not already-spent oracle fees. Rotating a signer does not revoke its authority over requests that already pinned it. ERC-1271 signers are supported, but their own behavior determines signature validity and callback gas usage; the supplied signer is an EOA.

Direct token donations are outside deposit accounting and cannot be recovered. Unclaimed legitimate payouts stay available indefinitely; no-dust settlement assumes all entitled bettors claim. There is no automatic keeper or keeper reward: creators or independent callers must ask, propose, settle, and claim. Caps and panel minima limit the application mechanically; they do not guarantee truthful answers.

## Files and responsibilities

- `src/`: the three applications, canonical attestation representation, and minimal interfaces.
- `test/`: success/failure, conformance, invariant, factory rehearsal, and independent review regressions. Mock tokens are test-only.
- `script/SepoliaParameters.sol`: exact static constructor argument encoding for the launch service/rehearsal; no deployment or wallet logic.
- `docs/DEPLOYMENT.md`: launch order, full parameters, initial operations, and post-launch verification.
- `docs/INDEPENDENT_REVIEW.md`: independent automated review with reviewed source hashes and limits.
- `DEPENDENCIES.md`: vendored dependency provenance and licenses.

The separate launch manifest/final review/deployment stages own publication and live deployment. The oracle owner owns future configuration and ownership transfers. The guardian owns creator admission and entry controls. Creators own body quality and parameter selection. Anyone can perform settlement operations; each bettor claims their own funds. Website work follows separately and must use the confirmed deployment handoff addresses.
