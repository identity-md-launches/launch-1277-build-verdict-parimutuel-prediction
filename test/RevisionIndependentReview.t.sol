// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "../src/VerdictMarkets.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";

contract RevisionIndependentReviewTest is TestBase {
    function test_independentSameBodyCannotBlockOwnRetry() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 own = markets.resolve(id, body);
        vm.prank(alice);
        bytes32 independent = oracle.request(body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(independent, a);
        assertTrue(oracle.hasPendingRequest(own));
        vm.warp(block.timestamp + 24 hours);
        markets.resolve(id, body);
        assertEq(markets.getMarket(id).asks, 2);
    }

    function test_identicalBodyOtherMarketAnswerCannotSetOutcome() public {
        uint256 first = create();
        uint256 second = create();
        vm.warp(markets.getMarket(first).params.answerFrom);
        bytes32 firstAsk = markets.resolve(first, body);
        markets.resolve(second, body);
        OracleAttestation.Attestation memory a = attestation(first, abi.encode(true), 5);
        deliver(firstAsk, a);
        vm.expectRevert(VerdictMarkets.UnauthenticatedAnswer.selector);
        markets.propose(second, a);
        markets.propose(first, a);
    }

    function test_escalationRejectsIssuanceBeforeItsOwnAsk() public {
        uint256 id = create();
        primary(id, true);
        vm.warp(block.timestamp + 1 hours);
        bytes32 escalation = markets.escalate(id, escalationBody);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(false), 10);
        a.issuedAt = uint64(block.timestamp - 1);
        deliver(escalation, a);
        vm.expectRevert(VerdictMarkets.InvalidAttestation.selector);
        markets.propose(id, a);
        assertFalse(markets.getMarket(id).escalated);
    }

    function test_documentedUnusableOwnDeliveryStillBlocksRetry() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        bytes32 own = markets.resolve(id, body);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        a.agreed = 3;
        deliver(own, a);
        vm.expectRevert(VerdictMarkets.InvalidAttestation.selector);
        markets.propose(id, a);
        vm.warp(block.timestamp + 24 hours);
        vm.expectRevert(VerdictMarkets.AnswerAlreadyDelivered.selector);
        markets.resolve(id, body);
    }

    function test_primaryLateIssuanceRemainsOutsideBriefsExplicitRange() public {
        uint256 id = create();
        VerdictMarkets.Params memory p = markets.getMarket(id).params;
        vm.warp(p.answerUntil - 1);
        bytes32 own = markets.resolve(id, body);
        vm.warp(p.answerUntil + 120);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(true), 5);
        deliver(own, a);
        vm.expectRevert(VerdictMarkets.InvalidAttestation.selector);
        markets.propose(id, a);
        vm.warp(p.voidAfter);
        markets.voidMarket(id);
        assertConserved(id, true);
    }
}
