// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "../src/VerdictMarkets.sol";
import {VerdictOracle} from "../src/VerdictOracle.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";
import {MockIMD} from "./mocks/MockIMD.sol";

contract VerdictMarketsTest is TestBase {
    function test_fullSettlementPaysWholePoolFeesAndExactRemainder() public {
        uint256 id = create();
        betAs(id, alice, 1, 101);
        betAs(id, bob, 1, 202);
        betAs(id, carol, 0, 700);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds);
        uint256 creatorBefore = token.balanceOf(creator);
        markets.finalize(id);
        assertEq(token.balanceOf(creator) - creatorBefore, PRICE + 10);
        assertEq(token.balanceOf(address(burn)), 5);
        assertEq(token.balanceOf(treasury), 5);
        vm.prank(alice);
        assertEq(markets.claim(id), 327);
        vm.prank(bob);
        assertEq(markets.claim(id), 656); // One residual wei goes to the final winning claim.
        vm.prank(carol);
        vm.expectRevert(VerdictMarkets.NothingToClaim.selector);
        markets.claim(id);
        vm.prank(alice);
        vm.expectRevert(VerdictMarkets.NothingToClaim.selector);
        markets.claim(id);
        assertEq(token.balanceOf(address(markets)), 0);
        assertConserved(id, true);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.finalize(id);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.voidMarket(id);
    }

    function test_voidNoAnswerRefundsEveryOutcomeAndUnspentBounty() public {
        uint256 id = create();
        betAs(id, alice, 0, 13);
        betAs(id, alice, 1, 17);
        betAs(id, bob, 1, 29);
        vm.warp(markets.getMarket(id).params.answerFrom);
        markets.resolve(id, body);
        vm.warp(markets.getMarket(id).params.voidAfter - 1);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.voidMarket(id);
        vm.warp(block.timestamp + 1);
        uint256 creatorBefore = token.balanceOf(creator);
        markets.voidMarket(id);
        assertEq(token.balanceOf(creator) - creatorBefore, PRICE);
        vm.prank(alice);
        assertEq(markets.claim(id), 30);
        vm.prank(bob);
        assertEq(markets.claim(id), 29);
        assertEq(token.balanceOf(address(burn)), 0);
        assertEq(token.balanceOf(treasury), 0);
        assertEq(token.balanceOf(address(markets)), 0);
        assertConserved(id, true);
    }

    function test_emptyWinningBucketCannotVoidUntilDisputeEnds() public {
        uint256 id = create();
        betAs(id, alice, 0, 100 ether);
        primary(id, true);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.voidMarket(id);
        vm.warp(markets.getMarket(id).disputeEnds);
        vm.expectRevert(VerdictMarkets.NoWinningStake.selector);
        markets.finalize(id);
        markets.voidMarket(id);
        vm.prank(alice);
        assertEq(markets.claim(id), 100 ether);
        assertEq(token.balanceOf(address(markets)), 0);
        assertConserved(id, true);
    }

    function test_lateEscalationBeyondVoidAfterStillFinalizesWithoutAnswer() public {
        VerdictMarkets.Params memory p = params();
        p.answerUntil = p.answerFrom + 2 hours;
        p.voidAfter = p.answerUntil + 1;
        p.disputeWindow = 1 hours;
        uint256 id = createWith(p);
        betAs(id, alice, 1, 100 ether);
        betAs(id, bob, 0, 100 ether);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds - 1);
        markets.escalate(id, escalationBody);
        uint256 end = markets.getMarket(id).disputeEnds;
        assertEq(end, block.timestamp + 24 hours);
        assertGt(end, p.voidAfter);
        vm.warp(p.voidAfter);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.voidMarket(id);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.finalize(id);
        vm.warp(end);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.voidMarket(id);
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
    }

    function test_lateEscalationReplacementRestartsWindowOnceAndFinalizes() public {
        VerdictMarkets.Params memory p = params();
        p.answerUntil = p.answerFrom + 2 hours;
        p.voidAfter = p.answerUntil + 1;
        p.disputeWindow = 1 hours;
        uint256 id = createWith(p);
        betAs(id, alice, 1, 11 ether);
        betAs(id, bob, 0, 22 ether);
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds - 1);
        bytes32 requestId = markets.escalate(id, escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 10);
        vm.warp(p.voidAfter + 1);
        deliver(requestId, a); // Signed before answerUntil, delivered after voidAfter.
        markets.propose(id, a);
        VerdictMarkets.Market memory m = markets.getMarket(id);
        assertTrue(m.escalated);
        assertEq(m.outcome, 0);
        assertEq(m.disputeEnds, block.timestamp + p.disputeWindow);
        vm.expectRevert(VerdictMarkets.EscalationUnavailable.selector);
        markets.propose(id, a);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.escalate(id, escalationBody);
        vm.warp(m.disputeEnds);
        markets.finalize(id);
        vm.prank(bob);
        markets.claim(id);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_escalationAnswerCannotBeFirstProposal() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 requestId = oracle.request(escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 10);
        deliver(requestId, a);
        vm.expectRevert(VerdictMarkets.UnauthenticatedAnswer.selector);
        markets.propose(id, a);
        assertEq(uint256(markets.getMarket(id).status), uint256(VerdictMarkets.Status.Open));
    }

    function test_externalSponsorCanDeliverPrimaryAndEscalation() public {
        uint256 id = create();
        betAs(id, alice, 1, 11 ether);
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 rid = oracle.request(body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(rid, a);
        markets.propose(id, a);
        rid = oracle.request(escalationBody);
        a = attestation(id, abi.encode(true), 10);
        deliver(rid, a);
        markets.propose(id, a);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertEq(markets.getMarket(id).asks, 0);
        assertEq(markets.getMarket(id).returnedBounty, 2 * PRICE);
        assertConserved(id, true);
    }

    function test_secondPrimaryAskAfter24HoursAndMaximumTwoAsks() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        markets.resolve(id, body);
        vm.warp(block.timestamp + 24 hours - 1);
        vm.expectRevert(VerdictMarkets.RetryNotReady.selector);
        markets.resolve(id, body);
        vm.warp(block.timestamp + 1);
        bytes32 second = markets.resolve(id, body);
        assertEq(markets.getMarket(id).asks, 2);
        assertEq(markets.getMarket(id).oracleSpend, 2 * PRICE);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VerdictMarkets.AskLimit.selector);
        markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(second, a);
        markets.propose(id, a);
        vm.expectRevert(VerdictMarkets.AskLimit.selector);
        markets.escalate(id, escalationBody);
    }

    function test_primaryRetryBlockedAfterDeliveryEvenWithoutProposal() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 rid = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 5);
        deliver(rid, a);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VerdictMarkets.AnswerAlreadyDelivered.selector);
        markets.resolve(id, body);
    }

    function test_asksBeforeAnswerFromAndAtOrAfterAnswerUntilRevert() public {
        uint256 id = create();
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.resolve(id, body);
        VerdictMarkets.Params memory p = markets.getMarket(id).params;
        vm.warp(p.answerUntil);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.resolve(id, body);
        vm.warp(p.answerUntil + 1);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.resolve(id, body);
    }

    function test_escalationAskAtAnswerUntilRevertsEvenInsideDisputeWindow() public {
        VerdictMarkets.Params memory p = params();
        p.answerUntil = p.answerFrom + 1 hours;
        p.voidAfter = p.answerUntil + 1;
        uint256 id = createWith(p);
        primary(id, true);
        vm.warp(p.answerUntil);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.escalate(id, escalationBody);
    }

    function test_proposeAfterAnswerUntilWithTimelyStoredAnswer() public {
        uint256 id = create();
        VerdictMarkets.Params memory p = markets.getMarket(id).params;
        vm.warp(p.answerUntil - 1);
        bytes32 rid = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(rid, a);
        vm.warp(p.answerUntil + 1);
        markets.propose(id, a);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.voidMarket(id); // No bets: no fees, full remaining bounty returned.
        assertConserved(id, true);
    }

    function test_provisionalWindowBoundariesAreStrict() public {
        uint256 id = create();
        betAs(id, alice, 1, 1 ether);
        primary(id, true);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 10);
        bytes32 rid = oracle.request(escalationBody);
        deliver(rid, a);
        vm.warp(markets.getMarket(id).disputeEnds - 1);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.finalize(id);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.propose(id, a);
        vm.expectRevert(VerdictMarkets.OutsideWindow.selector);
        markets.escalate(id, escalationBody);
        markets.finalize(id);
    }

    function test_noEscalationBodyAndDuplicateEscalationAsk() public {
        VerdictMarkets.Params memory p = params();
        vm.prank(creator);
        uint256 id = markets.createMarket(p, body, "", "", 0);
        primary(id, true);
        vm.expectRevert(VerdictMarkets.EscalationUnavailable.selector);
        markets.escalate(id, escalationBody);
        uint256 id2 = create();
        primary(id2, true);
        markets.escalate(id2, escalationBody);
        vm.expectRevert(VerdictMarkets.EscalationUnavailable.selector);
        markets.escalate(id2, escalationBody);
    }

    function test_wrongBodiesAndResolveAfterProposalRevertWithoutSpend() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        vm.expectRevert(VerdictMarkets.InvalidBody.selector);
        markets.resolve(id, escalationBody);
        primary(id, true);
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.resolve(id, body);
        vm.expectRevert(VerdictMarkets.InvalidBody.selector);
        markets.escalate(id, body);
        assertEq(markets.getMarket(id).oracleSpend, PRICE);
    }

    function test_priceIncreaseCannotSpendBettorsCollateral() public {
        uint256 id = create();
        betAs(id, alice, 1, 100 ether);
        primary(id, true);
        oracle.proposeConfig(
            VerdictOracle.Config(address(intake), address(token), vm.addr(SIGNER_KEY), ACTION, 100 ether)
        );
        oracle.acceptConfig();
        vm.expectRevert(VerdictMarkets.InsufficientBounty.selector);
        markets.escalate(id, escalationBody);
        assertEq(markets.getMarket(id).pool, 100 ether);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
    }

    function test_assetRotationBlocksAsksButNotRefunds() public {
        uint256 id = create();
        betAs(id, alice, 1, 10 ether);
        MockIMD other = new MockIMD();
        oracle.proposeConfig(VerdictOracle.Config(address(intake), address(other), vm.addr(SIGNER_KEY), ACTION, PRICE));
        oracle.acceptConfig();
        vm.warp(markets.getMarket(id).params.answerFrom);
        vm.expectRevert(VerdictMarkets.OracleAssetMismatch.selector);
        markets.resolve(id, body);
        vm.warp(markets.getMarket(id).params.voidAfter);
        markets.voidMarket(id);
        vm.prank(alice);
        markets.claim(id);
        assertConserved(id, true);
    }

    function test_zeroAndUnknownClaimsAndUnfinishedClaimsRevert() public {
        vm.expectRevert(VerdictMarkets.UnknownMarket.selector);
        markets.getMarket(1);
        uint256 id = create();
        vm.expectRevert(VerdictMarkets.WrongState.selector);
        markets.claim(id);
        vm.warp(markets.getMarket(id).params.voidAfter);
        markets.voidMarket(id);
        vm.expectRevert(VerdictMarkets.NothingToClaim.selector);
        markets.claim(id);
        assertConserved(id, true);
    }

    function test_tokenReentrancyBlockedOnDepositAndClaim() public {
        uint256 id = create();
        token.setHook(address(markets), abi.encodeCall(markets.bet, (id, 1, 1, 0)));
        betAs(id, alice, 1, 1000);
        assertFalse(token.hookSuccess());
        primary(id, true);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        token.setHook(address(markets), abi.encodeCall(markets.claim, (id)));
        vm.prank(alice);
        markets.claim(id);
        assertFalse(token.hookSuccess());
        assertConserved(id, true);
    }

    function testFuzz_terminalConservation(uint96 a, uint96 b, uint96 c, uint8 path, bool reverse) public {
        uint256 x = bound(uint256(a), 1, 100 ether);
        uint256 y = bound(uint256(b), 1, 100 ether);
        uint256 z = bound(uint256(c), 1, 100 ether);
        uint256 id = create();
        betAs(id, alice, 1, x);
        betAs(id, bob, 1, y);
        betAs(id, carol, 0, z);
        if (path % 3 == 0) {
            vm.warp(markets.getMarket(id).params.voidAfter);
            markets.voidMarket(id);
            vm.prank(carol);
            markets.claim(id);
        } else {
            primary(id, true);
            if (path % 3 == 2) markets.escalate(id, escalationBody);
            vm.warp(markets.getMarket(id).disputeEnds);
            markets.finalize(id);
        }
        vm.prank(reverse ? bob : alice);
        markets.claim(id);
        vm.prank(reverse ? alice : bob);
        markets.claim(id);
        assertEq(token.balanceOf(address(markets)), 0);
        assertConserved(id, true);
    }
}
