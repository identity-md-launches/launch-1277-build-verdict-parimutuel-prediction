# Verdict bounded revision review

Date: 2026-10-11. This revision responds to the reopened independent findings; it preserves the previously accepted contracts outside the identified causes. Machine command execution worked normally. No broadcast, wallet access, publication, or live deployment occurred.

## Reproduction and repairs

The two supplied proof files were copied unchanged into `test/scratch/`. All three proof tests initially failed: two with "next call did not revert as expected" for answer shopping, one with `InvalidAttestation` for a late escalation answer. After the targeted repairs, the same proofs pass.

- Oracle records the authenticated attestation UUID → Intake ID relationship. Markets records its own paid primary/retry and escalation IDs. Proposal requires both matching body hash and matching market-owned ask; escalation replacement requires its own paid escalation. Sponsors can still trigger permissionless market asks, but direct oracle purchases cannot establish outcomes.
- Escalation issuance is accepted from its paid ask timestamp through the current extended dispute deadline. This permits the answer the extension was intended to accommodate. A replacement restarts the window once; finalization remains reachable after `voidAfter`.
- Retry uses this market's first pending request, preventing a same-body delivery for another market or buyer from blocking it.
- Guardian renunciation requires the allowlist to be permanently disabled as well as entry unpaused.
- Numeric bounds must start above zero, ensuring the first offered bucket is reachable.

Existing field/panel/ABI validation tests now obtain their answers through market-owned asks, rather than direct purchases. Snapshots preserve the original pending ask while independently exercising each rejected field and panel input. The accounting invariant now uses per-request pending state and real escalation issuance time, without backdating it to `answerUntil`.

## Scope decisions and remaining limitations

Every finding is answered in `.imd-responses.json`. Five advisory scenarios reproduced before edits. The guardian freeze and zero numeric bound were repaired. The zero config delay and callback answer cap are retained with explicit operational documentation.

The unusable-delivery retry report is disputed as a behavioral redesign: the brief specifies a retry only when no answer was delivered, not when no usable answer was delivered. A correctly authenticated answer below panel/agreement minima still blocks this market's retry. This cannot overdraw deposits; after timeout, bets refund and unspent bounty returns, while oracle spend is not refundable. The global same-body interference portion is repaired.

The escalation timing proof is repaired. Its broader primary-timing observations remain subject to the brief's explicit primary issuance range `[answerFrom, answerUntil]`: a primary request bought immediately before the cutoff may arrive too late, and a first proposal after the cutoff cannot initiate another escalation ask. No artificial oracle latency guarantee or additional ask cutoff was invented. Creators and keepers must leave enough response time and propose early enough for escalation. These limits have explicit tests and are stated in README and deployment operations.

With the fixed launch `configDelay=0`, the owner can immediately replace Intake and signer and thereby author answers to future asks, including markets with existing bets. Already-paid requests retain the captured Intake and signer. This is requested authority, not a bypass. The answer limit is 16,384 ABI-encoded bytes (at most 510 list entries). Oversize one-shot callbacks fail and spend the fee.

## Independent revision review

A separate automated reviewer inspected the changed application paths without modifying them and authored five independent adversarial regressions, now delivered in `test/RevisionIndependentReview.t.sol`. All five passed. The review found no new concrete exploitable regression in the bounded changes. It checked cross-market identical-body isolation, independent deliveries not blocking a market's own retry, escalation issuance before its paid ask rejection, and the preserved unusable-delivery/late-primary limitations. This is an independent automated code review, not a human audit or a guarantee of safety.

The reviewer confirmed that request linkage is set only by a successful authenticated callback, ask bookkeeping cannot be observed during unfinished guarded calls, and escalation permits only one finite restart. The implementation compares the initially unused second-request slot only if the market actually made two asks.

Reviewed SHA-256 source hashes:

| Source | SHA-256 |
| --- | --- |
| `src/VerdictMarkets.sol` | `cadf1b756e15dd0263ce16b3123657f70573f086ca79f5a48d061fb8bf94a947` |
| `src/VerdictOracle.sol` | `ef26800f8d6a096a87796dbe2e2745d27523ed1e0ce131f98c4513738f06a792` |
| `src/interfaces/IVerdictOracle.sol` | `462091dd90fdd771d2c43464867c307175c5f1fc7e94edc835db4302beba5265` |

The previous report in `INDEPENDENT_REVIEW.md` is historical and its no-unresolved-finding conclusion has been superseded. Current execution results are in `VERIFICATION.md`; deployment parameters and external responsibilities are unchanged.
