// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "../src/VerdictMarkets.sol";
import {VerdictOracle} from "../src/VerdictOracle.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";

contract RevisionRegressionTest is TestBase {
    function test_unusableDeliveryBlocksRetry() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 rid = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        a.agreed = 3;
        deliver(rid, a);
        vm.expectRevert(VerdictMarkets.InvalidAttestation.selector);
        markets.propose(id, a);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VerdictMarkets.AnswerAlreadyDelivered.selector);
        markets.resolve(id, body);
    }

    function test_renounceRequiresAllowlistDisabledEvenWhenEmpty() public {
        markets.setCreatorAllowed(creator, false);
        vm.expectRevert(VerdictMarkets.MustDisableAllowlist.selector);
        markets.renounceGuardian();
        assertEq(markets.guardian(), address(this));
        markets.disableAllowlist();
        markets.renounceGuardian();
        assertEq(markets.guardian(), address(0));
        VerdictMarkets.Params memory p = params();
        vm.prank(creator);
        markets.createMarket(p, body, escalationBody, "", 0);
    }

    function test_zeroBoundRejectedWithoutTakingBounty() public {
        VerdictMarkets.Params memory p = params();
        p.answerType = 3;
        p.bounds = new uint256[](2);
        p.bounds[1] = 10;
        uint256 beforeBalance = token.balanceOf(creator);
        vm.prank(creator);
        vm.expectRevert(VerdictMarkets.InvalidParams.selector);
        markets.createMarket(p, body, escalationBody, "", 0);
        assertEq(token.balanceOf(creator), beforeBalance);
        assertEq(markets.marketCount(), 0);
        p.bounds[0] = 1;
        uint256 id = createWith(p);
        betAs(id, alice, 0, 1 ether);
        vm.warp(p.answerFrom);
        bytes32 rid = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(uint256(0)), 5);
        deliver(rid, a);
        markets.propose(id, a);
        assertEq(markets.getMarket(id).outcome, 0);
    }

    function test_zeroDelayAcceptsConfigInSameBlock() public {
        address newSigner = vm.addr(9876);
        oracle.proposeConfig(VerdictOracle.Config(address(intake), address(token), newSigner, ACTION, PRICE));
        oracle.acceptConfig();
        assertEq(oracle.signer(), newSigner);
    }

    function test_oversizeAnswerRefused() public {
        uint256 id = create();
        bytes32 rid = oracle.request(body);
        OracleAttestation.Attestation memory a = attestation(id, new bytes(16_416), 5);
        a.answerType = 5;
        (bool ok,) = intake.deliver(rid, a, sign(a), 200_000);
        assertFalse(ok);
        assertEq(oracle.answerOf(a), bytes32(0));
        (, address pendingIntake,) = oracle.pending(rid);
        assertEq(pendingIntake, address(intake));
    }

    function test_otherMarketAnswerCannotSetOutcomeOrBlockRetry() public {
        uint256 first = create();
        uint256 second = create();
        vm.warp(markets.getMarket(first).params.answerFrom);
        bytes32 firstRid = markets.resolve(first, body);
        bytes32 secondRid = markets.resolve(second, body);
        OracleAttestation.Attestation memory a = attestation(second, abi.encode(true), 5);
        deliver(secondRid, a);
        assertEq(oracle.intakeRequestOf(a.requestId), secondRid);
        vm.expectRevert(VerdictMarkets.UnauthenticatedAnswer.selector);
        markets.propose(first, a);
        vm.warp(block.timestamp + 24 hours);
        markets.resolve(first, body);
        assertEq(markets.getMarket(first).asks, 2);
        a = attestation(first, abi.encode(false), 5);
        deliver(firstRid, a); // A late first response still belongs to this market.
        markets.propose(first, a);
        assertEq(markets.getMarket(first).outcome, 0);
    }

    function test_lateEscalationIssuedAfterAnswerUntilSettlesCorrectedOutcome() public {
        uint256 id = create();
        betAs(id, alice, 1, 100 ether);
        betAs(id, bob, 0, 100 ether);
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 rid = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(rid, a);
        uint256 until = markets.getMarket(id).params.answerUntil;
        vm.warp(until - 10 minutes);
        markets.propose(id, a);
        rid = markets.escalate(id, escalationBody);
        vm.warp(until + 5 minutes);
        a = attestation(id, abi.encode(false), 10);
        deliver(rid, a);
        markets.propose(id, a);
        assertEq(markets.getMarket(id).outcome, 0);
        vm.warp(markets.getMarket(id).disputeEnds);
        markets.finalize(id);
        vm.prank(bob);
        assertEq(markets.claim(id), 196 ether);
        assertConserved(id, true);
        assertEq(token.balanceOf(address(markets)), 0);
    }

    function test_escalationCannotUseAnswerIssuedBeforeItsAsk() public {
        uint256 id = create();
        primary(id, true);
        vm.warp(block.timestamp + 1 minutes);
        bytes32 rid = markets.escalate(id, escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 10);
        a.issuedAt = uint64(markets.getMarket(id).escalationAskedAt - 1);
        deliver(rid, a);
        vm.expectRevert(VerdictMarkets.InvalidAttestation.selector);
        markets.propose(id, a);
    }
}
