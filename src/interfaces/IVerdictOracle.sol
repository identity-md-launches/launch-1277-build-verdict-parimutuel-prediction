// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OracleAttestation} from "../OracleAttestation.sol";

interface IVerdictOracle {
    function asset() external view returns (address);
    function price() external view returns (uint256);
    function request(bytes calldata body) external returns (bytes32 intakeRequestId);
    function answerOf(OracleAttestation.Attestation calldata a) external view returns (bytes32 bodyHash);
    function lastDelivered(bytes32 bodyHash) external view returns (uint256);
    function intakeRequestOf(bytes32 requestId) external view returns (bytes32);
    function hasPendingRequest(bytes32 intakeRequestId) external view returns (bool);
}
