// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIntake} from "../../src/interfaces/IIntake.sol";
import {OracleAttestation} from "../../src/OracleAttestation.sol";

contract MockIntake is IIntake {
    using SafeERC20 for IERC20;
    uint256 public nonce;
    bytes public lastBody;
    bytes32 public lastAction;
    uint256 public totalSpent;
    mapping(bytes32 => Callback) public callbacks;
    mapping(bytes32 => bool) public attempted;
    bool public duplicateIds;
    bool public skipPull;

    function setDuplicateIds(bool value) external {
        duplicateIds = value;
    }

    function setSkipPull(bool value) external {
        skipPull = value;
    }

    function request(bytes32 action, bytes calldata body, Callback calldata callback, address asset, uint256 amount)
        external
        payable
        returns (bytes32 id)
    {
        if (!skipPull) IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        totalSpent += amount;
        lastBody = body;
        lastAction = action;
        id = keccak256(abi.encode(address(this), duplicateIds ? 0 : ++nonce));
        callbacks[id] = callback;
    }

    /// @dev Models one attempted callback, swallowed failure, no refund, with exact stipend.
    function deliver(bytes32 id, OracleAttestation.Attestation calldata a, bytes calldata signature, uint256 stipend)
        external
        returns (bool ok, uint256 gasUsed)
    {
        require(!attempted[id], "already attempted");
        attempted[id] = true;
        Callback memory cb = callbacks[id];
        bytes memory payload = abi.encodeWithSelector(cb.selector, id, a, signature);
        uint256 beforeGas = gasleft();
        (ok,) = cb.target.call{gas: stipend}(payload);
        gasUsed = beforeGas - gasleft();
    }

    /// @dev A malicious intake can try arbitrary ids repeatedly: the consumer must reject them.
    function callRaw(address target, bytes32 id, OracleAttestation.Attestation calldata a, bytes calldata signature)
        external
        returns (bool ok)
    {
        (ok,) = target.call(abi.encodeWithSelector(bytes4(0x510379c7), id, a, signature));
    }
}
