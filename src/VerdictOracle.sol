// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {OracleAttestation, OracleAttestationConsumer} from "./OracleAttestation.sol";
import {IIntake} from "./interfaces/IIntake.sol";

/// @notice Purchases and authenticates IMD answers; never decides a market in the callback.
contract VerdictOracle is OracleAttestationConsumer, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Pending {
        bytes32 bodyHash;
        address intake;
        address signer;
    }

    struct Result {
        bytes32 attHash;
        bytes32 bodyHash;
    }

    struct Config {
        address intake;
        address asset;
        address signer;
        bytes32 actionId;
        uint256 price;
    }

    error InvalidConfig();
    error InvalidBody();
    error UnknownRequest();
    error WrongIntake();
    error DuplicateRequest();
    error DuplicateAnswer();
    error InexactPayment();
    error ConfigNotReady();
    error InvalidAttestation();

    event Requested(bytes32 indexed intakeRequestId, bytes32 indexed bodyHash, address indexed requester);
    event Answered(
        bytes32 indexed requestId, bytes32 indexed intakeRequestId, bytes32 indexed bodyHash, bytes32 attHash
    );
    event ConfigProposed(Config config, uint256 acceptAfter);
    event ConfigAccepted(Config config);

    uint256 public constant MAX_BODY_BYTES = 16_384;
    uint256 public constant MAX_ANSWER_BYTES = 16_384;
    uint256 public immutable configDelay;
    address public intake;
    address public asset;
    bytes32 public actionId;
    uint256 public price;
    Config public proposedConfig;
    uint256 public acceptAfter;
    bool public configPending;

    mapping(bytes32 => Pending) public pending;
    mapping(bytes32 => Result) public results;
    mapping(bytes32 => uint256) public lastDelivered;
    mapping(bytes32 => bool) public requested;

    constructor(
        address intake_,
        address asset_,
        address signer_,
        bytes32 actionId_,
        uint256 price_,
        address owner_,
        uint256 configDelay_
    ) OracleAttestationConsumer(signer_) Ownable(owner_) {
        if (configDelay_ > 30 days) revert InvalidConfig();
        configDelay = configDelay_;
        Config memory c = Config(intake_, asset_, signer_, actionId_, price_);
        _validateConfig(c);
        intake = intake_;
        asset = asset_;
        actionId = actionId_;
        price = price_;
        emit ConfigAccepted(c);
    }

    function signer() external view returns (address) {
        return oracleSigner;
    }

    function request(bytes calldata body) external nonReentrant returns (bytes32 intakeRequestId) {
        if (body.length == 0 || body.length > MAX_BODY_BYTES) revert InvalidBody();
        address requestIntake = intake;
        address requestSigner = oracleSigner;
        IERC20 token = IERC20(asset);
        uint256 cost = price;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), cost);
        if (token.balanceOf(address(this)) != beforeBalance + cost) revert InexactPayment();
        token.forceApprove(requestIntake, cost);
        intakeRequestId = IIntake(requestIntake)
            .request(
                actionId, body, IIntake.Callback(address(this), this.onOracleResult.selector), address(token), cost
            );
        token.forceApprove(requestIntake, 0);
        if (token.balanceOf(address(this)) != beforeBalance) revert InexactPayment();
        if (requested[intakeRequestId]) revert DuplicateRequest();
        requested[intakeRequestId] = true;
        bytes32 bodyHash = keccak256(body);
        pending[intakeRequestId] = Pending(bodyHash, requestIntake, requestSigner);
        emit Requested(intakeRequestId, bodyHash, msg.sender);
    }

    function onOracleResult(bytes32 intakeRequestId, OracleAttestation.Attestation calldata a, bytes calldata signature)
        external
        nonReentrant
    {
        Pending memory p = pending[intakeRequestId];
        if (p.intake == address(0)) revert UnknownRequest();
        if (msg.sender != p.intake) revert WrongIntake();
        if (results[a.requestId].attHash != bytes32(0)) revert DuplicateAnswer();
        if (a.answer.length > MAX_ANSWER_BYTES || a.expiresAt < a.issuedAt) revert InvalidAttestation();
        if (block.timestamp > a.expiresAt) revert AttestationExpired(a.expiresAt);
        if (a.issuedAt > block.timestamp + ISSUED_AT_TOLERANCE) revert AttestationNotYetValid(a.issuedAt);
        // Use the signer captured when the request was paid, not the current configuration.
        if (!SignatureChecker.isValidSignatureNowCalldata(p.signer, attestationDigest(a), signature)) {
            revert BadSignature();
        }
        delete pending[intakeRequestId];
        bytes32 attHash = keccak256(abi.encode(a));
        results[a.requestId] = Result(attHash, p.bodyHash);
        lastDelivered[p.bodyHash] = block.timestamp;
        emit Answered(a.requestId, intakeRequestId, p.bodyHash, attHash);
    }

    /// @notice Answers remain readable after expiry: freshness was checked at delivery.
    function answerOf(OracleAttestation.Attestation calldata a) external view returns (bytes32) {
        Result memory result = results[a.requestId];
        return result.attHash == keccak256(abi.encode(a)) ? result.bodyHash : bytes32(0);
    }

    function proposeConfig(Config calldata c) external onlyOwner nonReentrant {
        _validateConfig(c);
        proposedConfig = c;
        acceptAfter = block.timestamp + configDelay;
        configPending = true;
        emit ConfigProposed(c, acceptAfter);
    }

    function acceptConfig() external onlyOwner nonReentrant {
        if (!configPending || block.timestamp < acceptAfter) revert ConfigNotReady();
        Config memory c = proposedConfig;
        delete proposedConfig;
        delete acceptAfter;
        configPending = false;
        intake = c.intake;
        asset = c.asset;
        actionId = c.actionId;
        price = c.price;
        _setOracleSigner(c.signer);
        emit ConfigAccepted(c);
    }

    function _validateConfig(Config memory c) private pure {
        if (
            c.intake == address(0) || c.asset == address(0) || c.signer == address(0) || c.actionId == bytes32(0)
                || c.price == 0
        ) revert InvalidConfig();
    }
}
