# Local verification record

Date: 2026-10-11. Compiler: Solidity 0.8.26, using the committed root Foundry configuration. Foundry: 1.8.5. These are local execution results; they do not replace the network's independent acceptance checks or demonstrate deployment.

## Required checks

| Command | Result |
| --- | --- |
| `forge build` | Passed |
| `forge test` | 94 passed, 0 failed, 0 skipped; 10 suites |
| `forge fmt --check` | Passed |

Suite breakdown: 6 protocol conformance tests, 17 oracle tests, 20 market lifecycle/accounting tests, 15 market validation/governance tests, 7 outcome tests, 3 deployment/vault tests, 12 independently authored review regressions, 8 revision regressions, 5 independent revision regressions, and 1 stateful invariant.

The stateful invariant ran 128 sequences of 64 calls (**8,192 calls**, no unexpected reverts). Each sequence checks real token balances against all three markets' accounting and is followed by terminal settlement and all eligible claims. Three parameterized fuzz tests each ran 512 cases, covering bucket definitions, terminal accounting, and physical token-transfer conservation under varying claim order.

The mock Intake executes the real callback with a strict gas stipend and records attempted delivery even on failure. With cold consumer storage and an EOA signer, callback measurements were **126,024 gas** for a boolean answer and **140,592 gas** for a 16,384-byte answer. The independent maximum-size test used a 149,999-gas stipend. These measurements include the mock's CALL overhead, not the entire transaction cost or calldata intrinsic gas.

## Clean offline replay

A fresh temporary copy contained only `src/`, `test/` (excluding `scratch/`), `script/`, `lib/`, `foundry.toml`, and `remappings.txt`. It contained no `.imd/`, git metadata, scratch files, original build cache, or original artifacts. Its process environment contained only PATH. The installed pinned compiler was available to the toolchain.

```sh
forge build --offline
forge test --offline --threads 4
forge fmt --check
```

All three commands returned exit code 0. The fresh build compiled from ordinary source/dependency files with no prior artifacts; all 94 tests passed. No project dependency download, RPC, environment-derived test input, FFI, or filesystem permission was required. `offline` is a verification command flag, not a committed configuration setting.

## Deployment compatibility and review

The exact Sepolia constructor arguments deploy in the required order through the local CREATE2 factory with empty external dependency addresses. Application runtime sizes are 16 bytes (VerdictBurnVault), 7,720 bytes (VerdictOracle), and 15,639 bytes (VerdictMarkets). All are below EIP-170; initcode is below EIP-3860; the runtime opcode walk found no CALLCODE, DELEGATECALL, or SELFDESTRUCT outside PUSH data. No external library link references are needed.

The three changed application/interface source hashes in `REVISION_REVIEW.md` were checked against the final sources and matched. The independent revision reviewer found no new concrete exploitable regression. The old `INDEPENDENT_REVIEW.md` is marked historical because the reopened findings superseded its conclusion. Both reviews were by separate automated agents, not human audits.

The two supplied unchanged proof files first produced three failing tests on the starting source. All three pass on the revision. Five advisory scenarios were reproduced separately. Delivered regressions cover the repairs and preserved explicit limitations, including unusable primary delivery blocking retry and primary issuance after `answerUntil` being rejected. Responses to all seven reports are in `.imd-responses.json`.

Foundry emitted lint warnings for timestamp comparisons, strict balance checks, bounded casts/loops, test casts, and guarded external-call/event ordering. They are not compiler or test failures; the relevant timing, payment exactness, input bounds, and reentrancy paths have explicit tests. Slither and Mythril were not run.

No live transaction, oracle purchase, explorer verification, or GitHub publication was performed. The attempted read-only public Sepolia RPC preflight returned HTTP 403. Live dependency confirmation and deployment belong to the launch handoff in `DEPLOYMENT.md`.
