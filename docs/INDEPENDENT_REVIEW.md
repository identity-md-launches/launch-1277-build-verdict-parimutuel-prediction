# Verdict independent adversarial review

Date: 2026-10-11. Reviewer: a separate automated reviewer agent, independent of the implementation author within this assignment. This is an independent code review and local adversarial test exercise, not an external human audit or a guarantee of safety. The reviewer did not modify application sources, access wallet credentials, or broadcast transactions.

## Result

No unresolved concrete security vulnerability was identified in the reviewed application sources. One low-severity specification mismatch was reproduced, repaired by the implementation author, and independently retested. The configured oracle signer, Intake service, and IMD token remain explicit trust dependencies.

## Scope and method

Reviewed all application functions in `src/VerdictBurnVault.sol`, `src/VerdictOracle.sol`, and `src/VerdictMarkets.sol`, their interfaces, the canonical `OracleAttestation.sol` library/base, the Foundry configuration, and relevant OpenZeppelin v5 code paths. Compared the protocol representation against the supplied pinned oracle reference and the factory restrictions against the supplied protected deployment test. The canonical library/base initially matched the pinned source exactly; formatting changes do not change its representation.

The review traced authority, asset movement, stored liabilities, callback authentication, replay handling, config rotation, outcome decoding, deadline boundaries, escalation replacement, and finalization/void reachability. The reviewer independently authored adverse scenarios, initially under the assignment's disposable `test/scratch/` directory, and checked both contract accounting and actual token balances. The complete independent regression suite is delivered as `test/IndependentReview.t.sol`. The application author also supplies separate functional, conformance, and invariant tests.

## Resolved finding R-01 — unnecessary agreement restriction

Severity: low, parameter compatibility. Status: repaired and retested.

The original market validation rejected `minPanelSize = 5` and `minAgreed = 7` with `InvalidParams`, even though a delivered panel of seven with seven agreed members satisfies both independent minimums. The brief does not require `minAgreed <= minPanelSize`. The rejection happened before any deposit was retained.

The author removed that comparison while keeping `minAgreed > 0`. The independent regression creates the market with those exact minima, delivers a seven-member unanimous answer, proposes and finalizes the outcome, and claims the funds with conservation intact. Attestation validation still rejects `agreed > panelSize` and requires both the configured minimum agreement and the signed quorum.

## Security properties checked

- **Custody and authority:** the burn vault has no callable function or outgoing transfer path. Markets has no owner, upgrade path, privileged payout, or outcome override. Guardian operations only govern entry and creator admission. Pausing does not gate settlement or claims; paused renunciation is rejected. Oracle ownership is two-step and changes configuration only through propose/accept, subject to its immutable delay.
- **Oracle authenticity:** pending requests pin both Intake and signer. A replacement Intake cannot deliver an older request, and the older Intake and signer still can after configuration rotation. Unknown or consumed Intake IDs and reused oracle attestation IDs cannot store a result. The consumer's EIP-712 domain and canonical callback structure were compared against the pinned protocol data. Intake is trusted to pair its request ID with the signed oracle request UUID; markets additionally pin the question, data chain, block interval, answer type, and agreement requirements.
- **Asynchronous liveness:** a late escalation extends the live dispute window beyond `voidAfter` without opening a timeout-void path for a provisional market. Both a missing escalation answer and a valid replacement arriving after `voidAfter` still permit finalization once the current dispute window ends. A winning outcome with no stake instead becomes voidable after that window. An escalation answer cannot establish the first provisional outcome.
- **Accounting:** fees are derived from the entire credited pool, while oracle purchases spend only the market's bounty. Winning claims use the fixed pool ratio and the final winning claimant receives the exact remainder. Voiding refunds every credited stake without fees. Independent tests settled one market while retaining another market's entire liabilities, then voided and drained the second market. A failed outgoing claim transfer reverted the claim flag and payout accounting, allowing a later successful claim.
- **External calls:** value-changing external entry points use `ReentrancyGuard`; outgoing claims and settlement establish accounting effects before token transfers. Bounded approvals are cleared after oracle purchases. Token receipts are measured by balance difference. Oracle payment and spending require exact transfers, preventing a short-funded purchase from silently using other market deposits.
- **Outcomes and bounds:** the four permitted answer types use ABI decoding; malformed values revert without establishing an outcome. Integer boundaries are ordered and limited to seven; list keys are unique and limited to seven. Address keys fit 160 bits. The first list element determines the result; an empty or unmatched list selects the final outcome.

## Independent execution evidence

The independent suite completed with **12 tests passed, zero failed**, including **512 fuzz runs** of actual transfer conservation with varying stake sizes and rotating winner claim order. The maximum accepted answer payload, 16,384 bytes, completed a cold callback through the mock Intake in **118,403 gas**, with a **149,999 gas stipend**. Measurement includes the mock's external call overhead. This bound was exercised with the configured form of signer, an EOA; an arbitrary ERC-1271 signer can impose its own computation cost.

The separate reviewer ran `forge build --sizes` and `forge test --match-contract IndependentReviewTest -vv` with Solidity 0.8.26. A bytecode walk skipped PUSH immediates and found no `CALLCODE`, `DELEGATECALL`, or `SELFDESTRUCT` in any application runtime, and no external library link references. Constructors do not call dependency contracts or require their code, so the application sources are compatible with the empty-chain constructor rehearsal. Current build sizes:

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| VerdictBurnVault | 16 | 40 |
| VerdictOracle | 7,588 | 9,340 |
| VerdictMarkets | 14,918 | 15,738 |

No Slither, Mythril, fork simulation, live oracle purchase, explorer verification, or deployment was performed by this reviewer. The application author's final whole-project build, test, and formatting checks are separate from these independent results.

## Operational assumptions and limits

IMD must remain transferable and behave as a conventional, non-rebasing ERC20 for outgoing payments. An unavailable or reverting token can delay transfers; the contracts cannot override the token. Configuration changes can alter oracle cost or availability, so outstanding bounties may stop covering a later price; the remaining principal still follows the normal settlement or timeout refund path. The supplied deployment delay is zero, allowing the oracle owner to propose and accept configuration immediately. Pinning in-flight requests preserves their old authorities, including any old signer's continued compromise risk.

Freshness is checked when the oracle stores an answer. A stored authenticated answer remains usable after attestation expiry, subject to the market's issued-at and proposal windows. The oracle's panel and signer determine factual truth; verification does not independently establish it. Invalid request bodies, unanswered jobs, and swallowed failed callbacks spend the fee without refunds. Creators must publish valid body definitions whose expected hash and absolute data window agree with the market parameters. Anyone may fund a matching answer directly; that external sponsorship is outside a market's two bounty-funded purchases and its deposit accounting.

Guardian renunciation while the allowlist remains enabled permanently freezes the existing creator set. Disable the allowlist first when permanent permissionless creation is intended. Direct token donations are not market deposits, do not change claim ratios, and have no recovery path. Unclaimed entitled payouts remain held for their claimants; the no-dust property applies after all entitled claims.

## Reviewed source snapshot

SHA-256 hashes identify the exact reviewed source files. Later source changes require corresponding review; formatting-only changes should be recorded with updated hashes after verification.

```text
2be013954de7710b2f0a3aa53f3d0025cfb32c02da567af84dcc55c5b36674d3  src/VerdictBurnVault.sol
282a888502d38da81b9ff1e70b3c55ffb3e51ac040521be747b37d6d25f17cf5  src/VerdictOracle.sol
fb9acaa17856130c332467aaccbffaf06519834d9cc17646b38e343539deb626  src/VerdictMarkets.sol
4180b7451636a0092943616ea418b085bc8b5b0470e31a65f7e00ab0fc3456be  src/OracleAttestation.sol
f55b1bab45fe283f586f4c981ef9e383ff0aaf5ddae681b3f0e0f958fb5b0d1d  src/interfaces/IIntake.sol
d8f47bee38ea9a96ab0e1496836e2017395e89f410f810050d8cd8c5de6bd0a2  src/interfaces/IVerdictOracle.sol
```
