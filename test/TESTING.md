# Verdict test coverage

Run `forge build` and `forge test`. All tests use local deployments and the vendored
Foundry/OpenZeppelin dependencies. They need no RPC, fork, environment mutation, FFI,
or network. Test tokens and signer keys are fixtures, not deployment arguments.

The existing protocol conformance test pins the supplied Sepolia digest, signature,
struct hash, EIP-712 domain, and callback selector. The existing market, validation,
oracle, outcome, deployment, and review suites cover the specification's constructor
limits, permissions, timing, callback stipend, retry limits, and late escalation.
The additions below extend that coverage rather than replacing it.

| Added suite | Properties exercised |
| --- | --- |
| `VerdictOracleAdversarial.t.sol` | Every one of the 15 attestation fields is signed and committed in `answerOf`; malformed and malleable signatures cannot consume a pending request; exact expiry and clock-tolerance boundaries; four configuration generations delivered in arbitrary order, including asset/price/action/intake/signer changes and ownership handover; ERC-1271 acceptance and rejection. |
| `VerdictAtomicity.t.sol` | Failed requests restore bounty, ask count, allowances and dispute deadlines; failures at each finalize recipient roll back earlier payments; failed refunds and bounty returns remain retryable; a failed one-shot callback spends its price but permits a later market retry; a funded, eligible claimant cannot reenter a different market during finalize or claim. |
| `VerdictSettlementProperties.t.sol` | Fuzzed fee splits up to 500 bps and all winner permutations; payouts satisfy rational floor bounds and the final winner gets the remainder; explicit zero and one-wei payouts; full-precision payouts with overflowing intermediate products; generated half-open numeric buckets; malformed signed lists; settlement event amounts. |
| `VerdictLifecycleInvariant.t.sol` | Random creation, deposits, asks, invalid/valid delivery, escalation, clock advancement, pause, settlement, claims, donations and calls against terminal markets or the burn vault. |

## Stateful accounting model

The new lifecycle campaign runs 256 sequences of 64 calls, with four actors, all four
answer types, and up to twelve markets created during a sequence. It starts with
funded markets so withdrawal properties always have value to protect. Inputs include
one wei, the available pool cap, transfer fees on incoming deposits, empty winning
outcomes, and the first/last elements of list and numeric outcome definitions.

Independent ghost ledgers record **actual token balance changes** for deposits,
oracle purchases, fees, bounty returns, payouts and refunds. User stakes are recorded
from incoming transfers. After every call the campaign checks:

- Each market's deposits equal its outgoing transfers plus its remaining liability.
- The sum of all remaining liabilities plus separately tracked donations equals the
  markets contract's token balance; markets cannot subsidize one another.
- Each user/outcome stake and each outcome pool matches the independent ledger.
- The oracle holds no payment residue; intake receipts equal recorded oracle spend;
  both approval paths return to zero.
- Treasury and burn balances equal actual fees, with burn donations tracked separately.
- No market exceeds its cap or two paid asks. Terminal status and outcome remain fixed.
- Claim flags, remaining winning stake and remaining payouts agree with the ledger.

After **every sequence**, time advances beyond all deadlines, every market is settled,
and every eligible actor claims. Payouts + refunds + fees + oracle spend + returned
bounty must then equal deposits separately for every market. The only tokens allowed
to remain in `VerdictMarkets` are separately measured direct donations. These are not
market deposits and cannot conceal payout dust.

A deterministic handler test reaches primary delivery, replacement, failed delivery,
finalization, both void paths, claims while paused, and creation after older markets
expire. It checks action counters to catch accidental unreachable handler branches.
The original three-market invariant remains enabled as a separate campaign.

## Scope and interpretation

This is a local contract test suite. The mock Intake models exact payment, a single
attempted callback, swallowed callback failure and no refund. It does not validate
oracle JSON or establish live Sepolia service availability. Incoming transfer-fee
tests turn the mock fee off before oracle payments and settlement; they test credited
deposits, not a promise that an arbitrary taxed token pays recipients in full.

Random testing is bounded, not an exhaustive proof. A failing property must be checked
against the brief before being classified as an implementation defect. No production
contract or configuration changes are part of this test contribution.
