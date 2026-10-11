// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only asset: never part of the deployment set.
contract MockIMD is ERC20 {
    uint16 public transferFeeBps;
    address public hookTarget;
    bytes public hookData;
    bool public hookSuccess;
    bool private inHook;

    constructor() ERC20("Test IMD", "IMD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFee(uint16 bps) external {
        transferFeeBps = bps;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0) && transferFeeBps != 0) {
            uint256 fee = amount * transferFeeBps / 10_000;
            super._update(from, address(0), fee);
            amount -= fee;
        }
        super._update(from, to, amount);
        if (hookTarget != address(0) && !inHook && from != address(0)) {
            inHook = true;
            (hookSuccess,) = hookTarget.call(hookData);
            inHook = false;
        }
    }
}
