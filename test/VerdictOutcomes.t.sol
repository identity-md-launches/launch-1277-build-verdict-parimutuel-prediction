// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictMarkets} from "../src/VerdictMarkets.sol";
import {OracleAttestation} from "../src/OracleAttestation.sol";

contract VerdictOutcomesTest is TestBase {
    function outcome(VerdictMarkets.Params memory p, bytes memory answer) internal returns (uint8) {
        uint256 id = createWith(p);
        vm.warp(p.answerFrom);
        OracleAttestation.Attestation memory a = attestation(id, answer, 5);
        deliver(oracle.request(body), a);
        markets.propose(id, a);
        return markets.getMarket(id).outcome;
    }

    function numericParams() internal view returns (VerdictMarkets.Params memory p) {
        p = params();
        p.answerType = 3;
        p.bounds = new uint256[](2);
        p.bounds[0] = 10;
        p.bounds[1] = 20;
    }

    function listParams(uint8 answerType) internal view returns (VerdictMarkets.Params memory p) {
        p = params();
        p.answerType = answerType;
        p.keys = new bytes32[](2);
        p.keys[0] = bytes32(uint256(11));
        p.keys[1] = bytes32(uint256(22));
    }

    function test_booleanOutcomes() public {
        assertEq(outcome(params(), abi.encode(false)), 0);
        assertEq(outcome(params(), abi.encode(true)), 1);
    }

    function test_numericBucketsIncludeLowerBoundaryExcludeUpper() public {
        assertEq(outcome(numericParams(), abi.encode(uint256(0))), 0);
        assertEq(outcome(numericParams(), abi.encode(uint256(9))), 0);
        assertEq(outcome(numericParams(), abi.encode(uint256(10))), 1);
        assertEq(outcome(numericParams(), abi.encode(uint256(19))), 1);
        assertEq(outcome(numericParams(), abi.encode(uint256(20))), 2);
        assertEq(outcome(numericParams(), abi.encode(type(uint256).max)), 2);
    }

    function test_addressListUsesFirstElementOnlyAndCanonicalAddressKey() public {
        address[] memory values = new address[](2);
        values[0] = address(22);
        values[1] = address(11);
        assertEq(outcome(listParams(4), abi.encode(values)), 1);
        values[0] = address(33);
        assertEq(outcome(listParams(4), abi.encode(values)), 2);
        values[0] = address(11);
        assertEq(outcome(listParams(4), abi.encode(values)), 0);
        assertEq(outcome(listParams(4), abi.encode(new address[](0))), 2);
    }

    function test_bytes32ListUsesFirstElementOnlyAndEmptyMeansNone() public {
        bytes32[] memory values = new bytes32[](2);
        values[0] = bytes32(uint256(22));
        values[1] = bytes32(uint256(11));
        assertEq(outcome(listParams(5), abi.encode(values)), 1);
        values[0] = keccak256("not a key");
        assertEq(outcome(listParams(5), abi.encode(values)), 2);
        values[0] = bytes32(uint256(11));
        assertEq(outcome(listParams(5), abi.encode(values)), 0);
        VerdictMarkets.Params memory p = listParams(5);
        p.keys[0] = bytes32(0);
        assertEq(outcome(p, abi.encode(new bytes32[](0))), 2);
        values[0] = bytes32(0);
        p = listParams(5);
        p.keys[0] = bytes32(0);
        assertEq(outcome(p, abi.encode(values)), 0);
    }

    function test_twoToEightOutcomesAndSortedUniqueDefinitions() public {
        VerdictMarkets.Params memory p = numericParams();
        p.bounds = new uint256[](0);
        invalid(p);
        p = numericParams();
        p.bounds = new uint256[](8);
        invalid(p);
        p = numericParams();
        p.bounds[1] = 10;
        invalid(p);
        p = numericParams();
        p.bounds[1] = 9;
        invalid(p);
        p = numericParams();
        p.keys = new bytes32[](1);
        invalid(p);
        p = params();
        p.bounds = new uint256[](1);
        invalid(p);
        p = listParams(4);
        p.keys[0] = bytes32(uint256(1) << 160);
        invalid(p);
        p = listParams(5);
        p.keys[1] = p.keys[0];
        invalid(p);
        p = listParams(5);
        p.keys = new bytes32[](0);
        invalid(p);
        p = listParams(5);
        p.keys = new bytes32[](8);
        invalid(p);
        p = listParams(5);
        p.bounds = new uint256[](1);
        invalid(p);
        p = numericParams();
        p.bounds = new uint256[](7);
        for (uint256 i; i < 7; i++) {
            p.bounds[i] = i + 1;
        }
        uint256 id = createWith(p);
        assertEq(markets.getMarket(id).outcomes, 8);
        p = listParams(5);
        p.keys = new bytes32[](7);
        for (uint256 i; i < 7; i++) {
            p.keys[i] = bytes32(i);
        }
        id = createWith(p);
        assertEq(markets.getMarket(id).outcomes, 8);
    }

    function test_malformedEncodedAnswerCannotSetOutcome() public {
        uint256 id = create();
        vm.warp(markets.getMarket(id).params.answerFrom);
        OracleAttestation.Attestation memory a = attestation(id, abi.encode(uint256(2)), 5);
        deliver(oracle.request(body), a);
        vm.expectRevert();
        markets.propose(id, a);
        assertEq(uint256(markets.getMarket(id).status), uint256(VerdictMarkets.Status.Open));
    }

    function testFuzz_uintBucketDefinition(uint256 value) public {
        uint8 expected = value < 10 ? 0 : value < 20 ? 1 : 2;
        assertEq(outcome(numericParams(), abi.encode(value)), expected);
    }

    function invalid(VerdictMarkets.Params memory p) internal {
        vm.prank(creator);
        vm.expectRevert(VerdictMarkets.InvalidParams.selector);
        markets.createMarket(p, body, escalationBody, "", 0);
    }
}
