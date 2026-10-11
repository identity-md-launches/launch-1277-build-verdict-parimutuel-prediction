// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "../src/VerdictMarkets.sol";
import {VerdictOracle} from "../src/VerdictOracle.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";
import {MockIntake} from "./mocks/MockIntake.sol";

contract IndependentReviewTest is TestBase {
    function testReviewAgreementMinimumCanExceedMinimumPanel() public {
        VerdictMarkets.Params memory p = params();
        p.minPanelSize = 5;
        p.minAgreed = 7;
        uint256 id = createWith(p);
        betAs(id, alice, 1, 101);
        vm.warp(p.answerFrom);
        bytes32 requestId = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 7);
        deliver(requestId, a);
        markets.propose(id, a);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
    }

    function testFuzzReviewActualTransfersConserveInAnyClaimOrder(uint96 x, uint96 y, uint96 z, uint8 seed) public {
        uint256 aStake = bound(x, 1, 100 ether);
        uint256 bStake = bound(y, 1, 100 ether);
        uint256 cStake = bound(z, 1, 100 ether);
        uint256 id = create();
        betAs(id, alice, 1, aStake);
        betAs(id, bob, 1, bStake);
        betAs(id, carol, 1, cStake);
        betAs(id, creator, 0, 1 ether + uint256(seed));
        uint256 beforeCreator = token.balanceOf(creator);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        VerdictMarkets.Market memory m = markets.getMarket(id);
        uint256 actualFeesAndBounty =
            token.balanceOf(creator) - beforeCreator + token.balanceOf(treasury) + token.balanceOf(address(burn));
        assertEq(actualFeesAndBounty, m.fees + m.returnedBounty);
        address[3] memory bettors = [alice, bob, carol];
        uint256 claimedTokens;
        for (uint256 i; i < 3; ++i) {
            address bettor = bettors[(i + uint256(seed)) % 3];
            uint256 beforeBalance = token.balanceOf(bettor);
            vm.prank(bettor);
            uint256 payout = markets.claim(id);
            assertEq(token.balanceOf(bettor) - beforeBalance, payout);
            claimedTokens += payout;
        }
        assertEq(actualFeesAndBounty + claimedTokens + intake.totalSpent(), m.pool + m.params.bounty);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function testReviewMaximumAnswerColdCallback() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 requestId = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, new bytes(16_384), 5);
        bytes memory signature = sign(a);
        vm.cool(address(oracle));
        vm.cool(vm.addr(SIGNER_KEY));
        (bool ok, uint256 gasUsed) = intake.deliver(requestId, a, signature, 149_999);
        assertTrue(ok);
        assertLt(gasUsed, 150_000);
        emit log_named_uint("maximum answer cold callback gas", gasUsed);
        assertEq(oracle.answerOf(a), keccak256(body));
    }

    function testReviewRotationPreservesOldCallerAndKey() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 requestId = markets.resolve(id, body);
        MockIntake replacement = new MockIntake();
        oracle.proposeConfig(VerdictOracle.Config(address(replacement), address(token), vm.addr(98765), ACTION, PRICE));
        oracle.acceptConfig();
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 5);
        assertFalse(replacement.callRaw(address(oracle), requestId, a, sign(a)));
        deliver(requestId, a);
        markets.propose(id, a);
        assertEq(markets.getMarket(id).outcome, 0);
    }

    function testReviewEscalationCannotVoidAfterDeadline() public {
        VerdictMarkets.Params memory p = params();
        p.disputeWindow = 1 hours;
        p.answerUntil = p.answerFrom + 1 hours;
        p.voidAfter = p.answerUntil + 1;
        uint256 id = createWith(p);
        betAs(id, alice, 1, 11);
        betAs(id, bob, 0, 7);
        primary(id, true);
        vm.warp(p.answerUntil - 1);
        markets.escalate(id, escalationBody);
        vm.warp(p.voidAfter + 1);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.voidMarket(id);
        vm.warp(markets.getMarket(id).disputeEnds);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.voidMarket(id);
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function testReviewLateReplacementPastVoidRemainsFinalizable() public {
        VerdictMarkets.Params memory p = params();
        p.disputeWindow = 1 hours;
        p.answerUntil = p.answerFrom + 1 hours;
        p.voidAfter = p.answerUntil + 1;
        uint256 id = createWith(p);
        betAs(id, alice, 1, 11);
        betAs(id, bob, 0, 7);
        primary(id, true);
        vm.warp(p.answerUntil - 1);
        bytes32 requestId = markets.escalate(id, escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 10);
        vm.warp(p.voidAfter + 1);
        deliver(requestId, a);
        markets.propose(id, a);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(bob);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function testReviewNoWinnerIsVoidableAfterWindowPastVoidAfter() public {
        uint256 id = create();
        betAs(id, alice, 0, 83);
        betAs(id, bob, 0, 17);
        primary(id, true);
        vm.warp(markets.getMarket(id).params.voidAfter + 10 days);
        vm.expectRevert(VerdictMarkets.NoWinningStake.selector);
        markets.finalize(id);
        markets.voidMarket(id);
        vm.prank(alice);
        markets.claim(id);
        vm.prank(bob);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function testReviewMixedMarketsCannotCrossSubsidizeClaims() public {
        uint256 first = create();
        uint256 second = create();
        betAs(first, alice, 1, 13);
        betAs(first, bob, 1, 17);
        betAs(first, carol, 0, 19);
        betAs(second, alice, 0, 100);
        betAs(second, carol, 1, 125);
        primary(first, true);
        vm.warp(markets.getMarket(first).disputeEnds);
        markets.finalize(first);
        vm.prank(bob);
        markets.claim(first);
        vm.prank(alice);
        markets.claim(first);
        assertConserved(first, true);
        assertEq(token.balanceOf(address(markets)), markets.getMarket(second).pool + 2 * PRICE);
        vm.warp(markets.getMarket(second).params.voidAfter);
        markets.voidMarket(second);
        vm.prank(carol);
        markets.claim(second);
        vm.prank(alice);
        markets.claim(second);
        assertConserved(second, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function testReviewSameAttestationCannotOverwriteDifferentRequest() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 first = oracle.request(body);
        bytes32 second = oracle.request(escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(first, a);
        (bool ok,) = intake.deliver(second, a, sign(a), 150_000);
        assertFalse(ok);
        assertEq(oracle.answerOf(a), keccak256(body));
        (bytes32 bodyHash, address recordedIntake,) = oracle.pending(second);
        assertEq(bodyHash, keccak256(escalationBody));
        assertEq(recordedIntake, address(intake));
    }

    function testReviewEscalationCannotBeFirstProposalEvenWithLargePanel() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 requestId = oracle.request(escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 20);
        deliver(requestId, a);
        vm.expectRevert(VerdictMarkets.UnauthenticatedAnswer.selector);
        markets.propose(id, a);
        assertEq(uint8(markets.getMarket(id).status), uint8(VerdictMarkets.Status.Open));
    }

    function testReviewFailedTokenTransferRollsBackClaim() public {
        uint256 id = create();
        betAs(id, alice, 1, 53);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.mockCallRevert(
            address(token), abi.encodeWithSelector(token.transfer.selector, alice, uint256(53)), "token paused"
        );
        vm.prank(alice);
        vm.expectRevert();
        markets.claim(id);
        assertFalse(markets.claimed(id, alice));
        assertEq(markets.getMarket(id).remainingPayout, 53);
        vm.clearMockedCalls();
        vm.prank(alice);
        assertEq(markets.claim(id), 53);
        assertConserved(id, true);
    }

    function testReviewDonationDoesNotAlterPayoutOrAccounting() public {
        uint256 id = create();
        betAs(id, alice, 1, 17);
        token.transfer(address(markets), 1 ether);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(alice);
        assertEq(markets.claim(id), 17);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 1 ether);
    }
}
