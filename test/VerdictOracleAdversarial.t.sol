// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TestBase} from "./TestBase.sol";
import {VerdictOracle} from "src/VerdictOracle.sol";
import {OracleAttestation} from "src/OracleAttestation.sol";
import {MockIntake} from "./mocks/MockIntake.sol";
import {MockIMD} from "./mocks/MockIMD.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract VerdictTestSigner {
    address public immutable key;
    bool public enabled = true;

    constructor(address key_) {
        key = key_;
    }

    function setEnabled(bool value) external {
        enabled = value;
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return enabled && ECDSA.recover(digest, signature) == key ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract VerdictOracleAdversarialTest is TestBase {
    function answer() internal returns (OracleAttestation.Attestation memory a) {
        a = OracleAttestation.Attestation({
            requestId: keccak256(abi.encode("adversarial answer", ++attNonce)),
            chainId: 1,
            questionHash: QUESTION,
            answerType: 0,
            answer: abi.encode(false),
            figure: 12345,
            fromBlock: 100,
            toBlock: 200,
            blockHash: keccak256("block"),
            panelJobId: keccak256("panel"),
            panelSize: 5,
            quorum: 4,
            agreed: 5,
            issuedAt: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 hours)
        });
    }

    // Each field changes independently; this catches a missing signed field even if
    // the implementation's digest and the test's signing helper share that omission.
    function mutate(OracleAttestation.Attestation memory original, uint256 field)
        internal
        pure
        returns (OracleAttestation.Attestation memory a)
    {
        a = abi.decode(abi.encode(original), (OracleAttestation.Attestation));
        if (field == 0) a.requestId = keccak256("different request");
        else if (field == 1) a.chainId++;
        else if (field == 2) a.questionHash = keccak256("different question");
        else if (field == 3) a.answerType = 3;
        else if (field == 4) a.answer = abi.encode(true);
        else if (field == 5) a.figure++;
        else if (field == 6) a.fromBlock++;
        else if (field == 7) a.toBlock++;
        else if (field == 8) a.blockHash = keccak256("different block");
        else if (field == 9) a.panelJobId = keccak256("different panel");
        else if (field == 10) a.panelSize++;
        else if (field == 11) a.quorum++;
        else if (field == 12) a.agreed--;
        else if (field == 13) a.issuedAt++;
        else a.expiresAt++;
    }

    function test_everyAttestationFieldIsBoundBySignatureAndStoredHash() public {
        bytes32 id = oracle.request(body);
        OracleAttestation.Attestation memory original = answer();
        bytes memory signature = sign(original);
        for (uint256 field; field < 15; ++field) {
            OracleAttestation.Attestation memory changed = mutate(original, field);
            assertFalse(intake.callRaw(address(oracle), id, changed, signature), "unsigned field accepted");
            assertEq(oracle.answerOf(changed), bytes32(0));
            (bytes32 attHash, bytes32 storedBody) = oracle.results(changed.requestId);
            assertEq(attHash, bytes32(0));
            assertEq(storedBody, bytes32(0));
            (bytes32 pendingBody, address pendingIntake, address pendingSigner) = oracle.pending(id);
            assertEq(pendingBody, keccak256(body));
            assertEq(pendingIntake, address(intake));
            assertEq(pendingSigner, vm.addr(SIGNER_KEY));
            assertEq(oracle.lastDelivered(keccak256(body)), 0);
        }
        deliver(id, original);
        for (uint256 field; field < 15; ++field) {
            assertEq(oracle.answerOf(mutate(original, field)), bytes32(0), "stored hash ignores a field");
        }
        assertEq(oracle.answerOf(original), keccak256(body));
    }

    function test_nonCanonicalAndTruncatedSignaturesCannotConsumePendingRequest() public {
        bytes32 id = oracle.request(body);
        OracleAttestation.Attestation memory a = answer();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, oracle.attestationDigest(a));
        uint256 curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        assertFalse(intake.callRaw(address(oracle), id, a, ""));
        assertFalse(intake.callRaw(address(oracle), id, a, abi.encodePacked(r, s)));
        assertFalse(intake.callRaw(address(oracle), id, a, abi.encodePacked(r, s, uint8(29))));
        assertFalse(intake.callRaw(address(oracle), id, a, abi.encodePacked(r, s, v, uint8(0))));
        assertFalse(
            intake.callRaw(
                address(oracle),
                id,
                a,
                abi.encodePacked(r, bytes32(curveOrder - uint256(s)), v == 27 ? uint8(28) : uint8(27))
            )
        );
        assertEq(oracle.answerOf(a), bytes32(0));
        assertEq(oracle.lastDelivered(keccak256(body)), 0);
        deliver(id, a);
    }

    function test_expiryAndClockToleranceAreInclusiveAtExactBoundary() public {
        bytes32 first = oracle.request(body);
        OracleAttestation.Attestation memory a = answer();
        a.issuedAt = uint64(block.timestamp - 60);
        a.expiresAt = uint64(block.timestamp);
        deliver(first, a);
        bytes32 second = oracle.request(escalationBody);
        a = answer();
        a.issuedAt = uint64(block.timestamp + 300);
        deliver(second, a);
        assertEq(oracle.answerOf(a), keccak256(escalationBody));
    }

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_rotationsKeepFourInflightSnapshotsInAnyDeliveryOrder(uint256 order) public {
        MockIntake nextIntake = new MockIntake();
        MockIMD nextToken = new MockIMD();
        nextToken.mint(address(this), 100 ether);
        nextToken.approve(address(oracle), type(uint256).max);
        bytes32[4] memory ids;
        bytes[4] memory bodies;
        address[4] memory intakes;
        uint256[4] memory keys;
        OracleAttestation.Attestation[4] memory answers;
        for (uint256 i; i < 4; ++i) {
            keys[i] = SIGNER_KEY + i;
            intakes[i] = i % 2 == 0 ? address(intake) : address(nextIntake);
            address asset = i < 2 ? address(token) : address(nextToken);
            bytes32 action = bytes32(uint256(ACTION) + i);
            oracle.proposeConfig(VerdictOracle.Config(intakes[i], asset, vm.addr(keys[i]), action, PRICE + i));
            oracle.acceptConfig();
            bodies[i] = abi.encode("rotation body", i);
            ids[i] = oracle.request(bodies[i]);
            answers[i] = answer();
            (bytes32 hash, address recordedIntake, address recordedSigner) = oracle.pending(ids[i]);
            assertEq(hash, keccak256(bodies[i]));
            assertEq(recordedIntake, intakes[i]);
            assertEq(recordedSigner, vm.addr(keys[i]));
            assertEq(MockIntake(intakes[i]).lastAction(), action);
        }
        oracle.transferOwnership(alice);
        vm.prank(alice);
        oracle.acceptOwnership();

        uint256[4] memory permutation = [uint256(0), 1, 2, 3];
        for (uint256 remaining = 4; remaining > 0; --remaining) {
            uint256 position = order % remaining;
            order /= remaining;
            uint256 i = permutation[position];
            permutation[position] = permutation[remaining - 1];
            bytes memory sig = signDigest(keys[i], oracle.attestationDigest(answers[i]));
            MockIntake wrong = intakes[i] == address(intake) ? nextIntake : intake;
            assertFalse(wrong.callRaw(address(oracle), ids[i], answers[i], sig));
            vm.cool(address(oracle));
            (bool ok, uint256 gasUsed) = MockIntake(intakes[i]).deliver(ids[i], answers[i], sig, 150_000);
            assertTrue(ok, "rotation stranded an earlier paid request");
            assertLt(gasUsed, 150_000);
            assertEq(oracle.answerOf(answers[i]), keccak256(bodies[i]));
            assertFalse(MockIntake(intakes[i]).callRaw(address(oracle), ids[i], answers[i], sig));
        }
        assertEq(token.balanceOf(address(oracle)), 0);
        assertEq(nextToken.balanceOf(address(oracle)), 0);
        assertEq(token.balanceOf(address(intake)), PRICE);
        assertEq(token.balanceOf(address(nextIntake)), PRICE + 1);
        assertEq(nextToken.balanceOf(address(intake)), PRICE + 2);
        assertEq(nextToken.balanceOf(address(nextIntake)), PRICE + 3);
        assertEq(token.allowance(address(oracle), address(intake)), 0);
        assertEq(token.allowance(address(oracle), address(nextIntake)), 0);
        assertEq(nextToken.allowance(address(oracle), address(intake)), 0);
        assertEq(nextToken.allowance(address(oracle), address(nextIntake)), 0);
    }

    function test_contractSignerIsPinnedAndRevokedSignatureStoresNothing() public {
        VerdictTestSigner registry = new VerdictTestSigner(vm.addr(SIGNER_KEY));
        oracle.proposeConfig(VerdictOracle.Config(address(intake), address(token), address(registry), ACTION, PRICE));
        oracle.acceptConfig();
        bytes32 id = oracle.request(body);
        OracleAttestation.Attestation memory a = answer();
        bytes memory sig = sign(a);
        registry.setEnabled(false);
        assertFalse(intake.callRaw(address(oracle), id, a, sig));
        assertEq(oracle.answerOf(a), bytes32(0));
        registry.setEnabled(true);
        oracle.proposeConfig(VerdictOracle.Config(address(intake), address(token), vm.addr(999), ACTION, PRICE));
        oracle.acceptConfig();
        deliver(id, a);
        assertEq(oracle.answerOf(a), keccak256(body));
    }

    function test_pendingOwnerCannotAcceptConfigurationAndFormerOwnerLosesAccess() public {
        VerdictOracle.Config memory c =
            VerdictOracle.Config(address(intake), address(token), vm.addr(999), ACTION, PRICE + 1);
        oracle.proposeConfig(c);
        oracle.transferOwnership(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        oracle.acceptConfig();
        vm.prank(alice);
        oracle.acceptOwnership();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.acceptConfig();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        oracle.proposeConfig(c);
        vm.prank(alice);
        oracle.acceptConfig();
        assertEq(oracle.price(), PRICE + 1);
    }
}
