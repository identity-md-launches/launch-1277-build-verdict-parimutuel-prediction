# Sepolia deployment handoff

## Status and fixed launch

The applications have been built, locally tested, independently reviewed by a separate automated reviewer, and rehearsed through a CREATE2 factory on chain ID 11155111 with no code at the external dependency addresses. No live transactions or GitHub publication were performed by this worker. No live contract addresses are claimed. The network launch service performs the separate manifest, final independent review, publication, bytecode deployment, and confirmed-address handoff.

Do not deploy to another network. The contracts themselves contain no hardcoded chain restriction: the oracle domain uses `block.chainid`, and the launch policy must enforce **Sepolia only**. The rehearsal factory explicitly rejects other chains. No additional application token, proxy, liquidity pool, initializer transaction, or linked library is required.

The repository intentionally does not supply `launch.json`: the separate manifest stage owns that artifact. Constructor bytes are also encoded in `script/SepoliaParameters.sol`. All external values below come from the approved task, not inferred network tables.

## Deployment order and constructor parameters

1. **VerdictBurnVault()** — no arguments.
2. **VerdictOracle(address intake, address asset, address signer, bytes32 actionId, uint256 price, address owner, uint256 configDelay)**:

| Parameter | Value |
| --- | --- |
| intake | `0x1397434cd35e8a9c8ac312a61d3a285eb31dea56` |
| asset | `0x44a1cd38474fb1748400e7deb5f8d786cce3f89a` |
| signer | `0x5598aa9146215bc13eb26f2c692ad1461fd32982` |
| actionId | `0x6f7261636c652e72657175657374406f7261636c652d31000000000000000000` |
| price | `500000000000000000` (0.5 IMD at 18 decimals) |
| owner | `0x397dacb1ee8e9a8ce5196988958f56bde0a0a312` |
| configDelay | `0` |

The action is the right-padded UTF-8 value `oracle.request@oracle-1`, not its keccak hash. The supplied v1 Intake is deliberate; Verdict uses `request`, without the v2 failure callback extension.

3. **VerdictMarkets(address oracle, address collateral, address treasury, address burnSink, address guardian, uint16 creatorFeeBps, uint16 burnFeeBps, uint16 treasuryFeeBps, uint256 maxPoolPerMarket)**:

| Parameter | Value |
| --- | --- |
| oracle | Address of the VerdictOracle deployed in step 2 (`$contract:VerdictOracle`) |
| collateral | `0x44a1cd38474fb1748400e7deb5f8d786cce3f89a` |
| treasury | `0x397dacb1ee8e9a8ce5196988958f56bde0a0a312` |
| burnSink | Address of the VerdictBurnVault deployed in step 1 (`$contract:VerdictBurnVault`) |
| guardian | `0x397dacb1ee8e9a8ce5196988958f56bde0a0a312` |
| creatorFeeBps | `100` (1%) |
| burnFeeBps | `50` (0.5%) |
| treasuryFeeBps | `50` (0.5%) |
| maxPoolPerMarket | `500000000000000000000` (500 IMD at 18 decimals) |

The provided owner fills every `$owner` reference. The factory and transaction sender receive no application authority. Constructor validation never calls the Intake, oracle, collateral, or signer, and is compatible with the empty-chain deployment floor. All constructors are nonpayable.

## Verification by the launch operator

Run the root `forge build`, `forge test`, and `forge fmt --check` with the pinned compiler and settings. Review the independent report and final manifest together, including all privileged and recipient arguments. Confirm the live RPC chain ID is 11155111, the supplied Intake and IMD have code, IMD identity/decimals match, `Intake.priceOf(actionId, IMD)` still equals the configured price, and the operator's oracle service still signs for the supplied signer and this consumer domain. A read-only public RPC preflight attempted during development returned HTTP 403; no current live dependency result is asserted here.

The deployment service should deploy the built bytecodes in the stated order with zero native value, record transaction hashes, confirm receipts and runtime bytes, then verify source using exactly the repository build settings. Verify all constructor getters and the initial roles against the tables. Record the confirmed address set in the launch handoff consumed by the separate website job. Do not insert example/test addresses into live configuration.

## After launch

- **Guardian (`$owner`):** call `setCreatorAllowed(creator, true)` for each admitted creator, or call `disableAllowlist()` to make creation permanently permissionless. The initial allowlist is on and empty. `pause()`/`unpause()` affect only market creation and betting. `transferGuardian(next)` requires `next` to call `acceptGuardian()`. Renunciation requires unpaused entry; disable the allowlist first if permissionless creation is intended after renouncing.
- **Oracle owner (`$owner`):** monitor Intake availability, action/version, price, collateral asset, and signer changes through the IdentityMD operator. Submit all five values in `proposeConfig(Config)` and then `acceptConfig()` after the configured delay. This launch delay is zero. No post-deployment initialization is needed. `transferOwnership(next)` requires the next owner to call `acceptOwnership()`. Old requests continue to trust their recorded Intake and signer.
- **Creators:** acquire IMD, approve the exact intended bounty to VerdictMarkets, and publish valid primary/escalation JSON. Use already-confirmed absolute data block intervals and the protocol's canonical question hash. The two bodies must describe the same market terms; escalation should request a panel at least twice the initial actual panel size. The oracle service's supported panel sizes, request schema, and question hashing must be checked when constructing each body. Budget enough response/dispute time; the contracts do not validate JSON or promise delivery.
- **Bettors:** approve their bet amount, inspect immutable market terms and full body events, bet before close, then call `claim(id)` once after finalization or voiding. Claims remain available indefinitely. The last winning claim receives division residue.
- **Permissionless callers/keepers:** retrieve the exact published bytes, call `resolve` during its request window, retrieve the complete signed attestation from oracle delivery, call `propose`, optionally escalate, and call `finalize`/`voidMarket` when eligible. A provisional market's dispute deadline takes precedence over the timeout deadline. Fees and remaining bounty move during settlement; individual claims are separate.

Owner configuration changes can stop new oracle purchases if a new price exceeds old bounties or the new asset differs from Markets' immutable collateral. These changes cannot alter already-stored results or seize bettor funds. No sweep, discretionary refunds, proxy upgrade, or alternate settlement authority exists. The market timeout handles missing primary answers; a missing escalation answer preserves the primary outcome.
