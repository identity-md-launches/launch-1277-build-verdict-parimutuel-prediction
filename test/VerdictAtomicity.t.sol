// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "src/VerdictMarkets.sol";
import {VerdictOracle} from "src/VerdictOracle.sol";
import {OracleAttestation} from "src/OracleAttestation.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract VerdictReentryProbe {
    address public target;
    bytes public payload;
    bool public succeeded;
    bytes public reason;
    uint256 public attempts;

    function configure(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function attempt() external {
        ++attempts;
        (succeeded, reason) = target.call(payload);
    }
}

contract VerdictAtomicityTest is TestBase {
    function marketHash(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode(markets.getMarket(id)));
    }

    function fundedPrimary() internal returns (uint256 id) {
        id = create();
        betAs(id, alice, 1, 101 ether + 3);
        betAs(id, bob, 0, 103 ether + 7);
        primary(id, true);
    }

    function test_failedPrimaryPaymentRestoresBountyAskCountTimestampAndAllowances() public {
        uint256 id = create();
        betAs(id, alice, 0, 25 ether);
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 beforeState = marketHash(id);
        uint256 held = token.balanceOf(address(markets));
        intake.setSkipPull(true);
        vm.expectRevert(VerdictOracle.InexactPayment.selector);
        markets.resolve(id, body);
        assertEq(marketHash(id), beforeState);
        assertEq(token.balanceOf(address(markets)), held);
        assertEq(token.balanceOf(address(oracle)), 0);
        assertEq(token.balanceOf(address(intake)), 0);
        assertEq(token.allowance(address(markets), address(oracle)), 0);
        assertEq(token.allowance(address(oracle), address(intake)), 0);
        assertEq(intake.nonce(), 0);
        assertEq(intake.totalSpent(), 0);
        intake.setSkipPull(false);
        markets.resolve(id, body);
        assertEq(markets.getMarket(id).asks, 1);
        assertEq(intake.totalSpent(), PRICE);
    }

    function test_failedEscalationPaymentCannotExtendOrConsumeDisputeWindow() public {
        uint256 id = fundedPrimary();
        vm.warp(markets.getMarket(id).disputeEnds - 1);
        bytes32 beforeState = marketHash(id);
        uint256 held = token.balanceOf(address(markets));
        intake.setSkipPull(true);
        vm.expectRevert(VerdictOracle.InexactPayment.selector);
        markets.escalate(id, escalationBody);
        assertEq(marketHash(id), beforeState);
        assertEq(token.balanceOf(address(markets)), held);
        assertEq(token.balanceOf(address(oracle)), 0);
        assertEq(intake.totalSpent(), PRICE);
        assertEq(token.allowance(address(markets), address(oracle)), 0);
        intake.setSkipPull(false);
        markets.escalate(id, escalationBody);
        assertTrue(markets.getMarket(id).escalationAsked);
        assertEq(markets.getMarket(id).disputeEnds, block.timestamp + 24 hours);
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_failureAtAnyFinalizeRecipientRollsBackEarlierPayments(uint8 recipientSeed, bool returnsFalse)
        public
    {
        uint256 id = fundedPrimary();
        vm.warp(markets.getMarket(id).disputeEnds);
        bytes32 beforeState = marketHash(id);
        uint256 held = token.balanceOf(address(markets));
        uint256 creatorBefore = token.balanceOf(creator);
        address[3] memory recipients = [creator, address(burn), treasury];
        address recipient = recipients[recipientSeed % 3];
        // Match the recipient but not the amount: failure must occur even if fee rounding changes.
        bytes memory callPrefix = abi.encodePacked(token.transfer.selector, abi.encode(recipient));
        if (returnsFalse) vm.mockCall(address(token), callPrefix, abi.encode(false));
        else vm.mockCallRevert(address(token), callPrefix, "transfer refused");
        vm.expectRevert();
        markets.finalize(id);
        assertEq(marketHash(id), beforeState, "failed finalize left accounting changed");
        assertEq(token.balanceOf(address(markets)), held);
        assertEq(token.balanceOf(creator), creatorBefore);
        assertEq(token.balanceOf(address(burn)), 0);
        assertEq(token.balanceOf(treasury), 0);
        vm.clearMockedCalls();
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_failedBountyReturnDoesNotVoidMarketOrPreventLaterRefund() public {
        uint256 id = create();
        betAs(id, alice, 0, 37);
        vm.warp(markets.getMarket(id).params.voidAfter);
        bytes32 beforeState = marketHash(id);
        vm.mockCall(
            address(token), abi.encodeWithSelector(token.transfer.selector, creator, 2 * PRICE), abi.encode(false)
        );
        vm.expectRevert();
        markets.voidMarket(id);
        assertEq(marketHash(id), beforeState);
        assertFalse(markets.claimed(id, alice));
        vm.clearMockedCalls();
        markets.voidMarket(id);
        vm.prank(alice);
        assertEq(markets.claim(id), 37);
        assertConserved(id, true);
    }

    function test_failedRefundCanBeRetriedAndDoesNotConsumeAnotherUsersClaim() public {
        uint256 id = create();
        betAs(id, alice, 0, 11);
        betAs(id, alice, 1, 17);
        betAs(id, bob, 1, 31);
        vm.warp(markets.getMarket(id).params.voidAfter);
        markets.voidMarket(id);
        bytes32 beforeState = marketHash(id);
        vm.mockCall(address(token), abi.encodeWithSelector(token.transfer.selector, alice, 28), abi.encode(false));
        vm.prank(alice);
        vm.expectRevert();
        markets.claim(id);
        assertEq(marketHash(id), beforeState);
        assertFalse(markets.claimed(id, alice));
        vm.prank(bob);
        assertEq(markets.claim(id), 31);
        vm.clearMockedCalls();
        vm.prank(alice);
        assertEq(markets.claim(id), 28);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_failedCallbackIsNotRefundedButMarketRetryAndSettlementRemainReachable() public {
        uint256 id = create();
        betAs(id, alice, 1, 7 ether);
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 first = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        bytes memory bad = signDigest(SIGNER_KEY + 1, oracle.attestationDigest(a));
        (bool delivered,) = intake.deliver(first, a, bad, 200_000);
        assertFalse(delivered);
        assertEq(oracle.lastDelivered(keccak256(body)), 0);
        vm.warp(block.timestamp + 24 hours);
        bytes32 retry = markets.resolve(id, body);
        a = attestation(id, abi.encode(true), 5);
        deliver(retry, a);
        markets.propose(id, a);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        assertEq(markets.getMarket(id).returnedBounty, 0);
        assertEq(intake.totalSpent(), 2 * PRICE);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_guardBlocksCrossMarketReentryFromAnOtherwiseEligibleClaimant() public {
        VerdictReentryProbe probe = new VerdictReentryProbe();
        uint256 first = create();
        uint256 second = create();
        token.mint(address(probe), 19);
        vm.prank(address(probe));
        token.approve(address(markets), 19);
        betAs(first, address(probe), 1, 19);
        betAs(second, alice, 1, 23 ether);
        primary(first, true);
        primary(second, true);
        vm.warp(markets.getMarket(first).disputeEnds);
        markets.finalize(first);
        probe.configure(address(markets), abi.encodeCall(markets.claim, (first)));
        token.setHook(address(probe), abi.encodeCall(probe.attempt, ()));

        markets.finalize(second);
        assertGt(probe.attempts(), 0);
        assertFalse(probe.succeeded());
        assertEq(probe.reason(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertFalse(markets.claimed(first, address(probe)));
        vm.prank(alice);
        markets.claim(second);
        assertFalse(probe.succeeded());
        assertEq(probe.reason(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        token.setHook(address(0), "");
        // This succeeds outside the guarded interaction, proving the inner failure
        // was not simply missing funds, a losing stake, or a wrong market state.
        probe.attempt();
        assertTrue(probe.succeeded());
        assertEq(token.balanceOf(address(probe)), 19);
        assertConserved(first, true);
        assertConserved(second, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }
}
