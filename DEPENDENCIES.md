# Vendored dependencies

All required dependency source files are ordinary repository files. There are no submodules, package-install hooks, runtime downloads, node_modules dependencies, or compiler binaries.

| Dependency | Fixed release | Included files | Upstream |
| --- | --- | --- | --- |
| OpenZeppelin Contracts | v5.5.0 | `lib/openzeppelin-contracts/contracts/`, `LICENSE` | https://github.com/OpenZeppelin/openzeppelin-contracts/tree/v5.5.0 |
| forge-std | v1.9.7 | `lib/forge-std/src/`, `LICENSE-APACHE`, `LICENSE-MIT` | https://github.com/foundry-rs/forge-std/tree/v1.9.7 |

OpenZeppelin v5.5.0 includes the calldata SignatureChecker API used by the canonical protocol consumer. Its archive was fetched from `https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/tar.gz/refs/tags/v5.5.0`; archive SHA-256: `95a4e1ff7a01da7d875e7872b6160337561efd7fb0a8751de76e837a10d90cbf`. Dependencies retain their upstream licenses and SPDX notices. Upstream CI, repository metadata, and examples outside these source trees are not included.

`src/OracleAttestation.sol` is copied from the task's pinned IdentityMD oracle-consumer reference (MIT SPDX), preserving the canonical struct, type string, domain, and hash implementation. `test/OracleConsumerConformance.t.sol` adapts the supplied conformance fixture to VerdictOracle and MockIntake while preserving the supplied chain, consumer address, digest, signature, signer, and attestation vector. Test-only keys and vector addresses are never deployment settings.

Application Solidity sources use the MIT license. The compiler is pinned to Solidity 0.8.26 in `foundry.toml`; the execution environment supplies it.
