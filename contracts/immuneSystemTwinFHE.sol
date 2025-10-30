pragma solidity ^0.8.24;
import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ImmuneSystemTwinFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    struct Batch {
        uint256 id;
        uint256 totalEncryptedDataPoints;
        bool closed;
    }
    uint256 public currentBatchId;
    mapping(uint256 => Batch) public batches;

    struct EncryptedImmuneData {
        euint32 antigenAffinity;
        euint32 antibodyCount;
        euint32 tCellEffectiveness;
    }
    mapping(uint256 => EncryptedImmuneData[]) public batchEncryptedData;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId, uint256 totalEncryptedDataPoints);
    event DataSubmitted(address indexed provider, uint256 indexed batchId, uint256 dataCount);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256[] results);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error InvalidBatchId();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown() {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown() {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused != paused) {
            paused = _paused;
            if (_paused) {
                emit ContractPaused(msg.sender);
            } else {
                emit ContractUnpaused(msg.sender);
            }
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batches[currentBatchId] = Batch({id: currentBatchId, totalEncryptedDataPoints: 0, closed: false});
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner whenNotPaused {
        if (batchId == 0 || batchId > currentBatchId || batches[batchId].closed) revert InvalidBatchId();
        Batch storage batch = batches[batchId];
        batch.closed = true;
        emit BatchClosed(batchId, batch.totalEncryptedDataPoints);
    }

    function submitEncryptedData(
        euint32 antigenAffinity,
        euint32 antibodyCount,
        euint32 tCellEffectiveness
    ) external onlyProvider whenNotPaused checkSubmissionCooldown {
        _initIfNeeded(antigenAffinity);
        _initIfNeeded(antibodyCount);
        _initIfNeeded(tCellEffectiveness);

        if (batches[currentBatchId].closed) revert BatchClosedOrInvalid();

        batchEncryptedData[currentBatchId].push(EncryptedImmuneData(antigenAffinity, antibodyCount, tCellEffectiveness));
        batches[currentBatchId].totalEncryptedDataPoints++;

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit DataSubmitted(msg.sender, currentBatchId, 1);
    }

    function requestBatchAnalysis(uint256 batchId) external onlyOwner whenNotPaused checkDecryptionCooldown {
        if (batchId == 0 || batchId > currentBatchId || !batches[batchId].closed) revert InvalidBatchId();
        if (batches[batchId].totalEncryptedDataPoints == 0) revert InvalidBatchId(); // No data to analyze

        euint32 memory totalAntigenAffinity = FHE.asEuint32(0);
        euint32 memory totalAntibodyCount = FHE.asEuint32(0);
        euint32 memory totalTCellEffectiveness = FHE.asEuint32(0);

        uint256 dataCount = batchEncryptedData[batchId].length;
        for (uint256 i = 0; i < dataCount; ++i) {
            EncryptedImmuneData storage data = batchEncryptedData[batchId][i];
            totalAntigenAffinity = totalAntigenAffinity.fheAdd(data.antigenAffinity);
            totalAntibodyCount = totalAntibodyCount.fheAdd(data.antibodyCount);
            totalTCellEffectiveness = totalTCellEffectiveness.fheAdd(data.tCellEffectiveness);
        }

        bytes32[] memory cts = new bytes32[](3);
        cts[0] = totalAntigenAffinity.toBytes32();
        cts[1] = totalAntibodyCount.toBytes32();
        cts[2] = totalTCellEffectiveness.toBytes32();

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay protection ensures this callback is processed only once for a given requestId.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        Batch storage batch = batches[ctx.batchId];

        // Security: Rebuild ciphertexts from current contract storage in the exact same order
        // and re-calculate the hash to ensure the state of the contract hasn't changed since the request.
        // This prevents decryption of stale or manipulated data.
        euint32 memory currentTotalAntigenAffinity = FHE.asEuint32(0);
        euint32 memory currentTotalAntibodyCount = FHE.asEuint32(0);
        euint32 memory currentTotalTCellEffectiveness = FHE.asEuint32(0);

        uint256 dataCount = batchEncryptedData[ctx.batchId].length;
        for (uint256 i = 0; i < dataCount; ++i) {
            EncryptedImmuneData storage data = batchEncryptedData[ctx.batchId][i];
            currentTotalAntigenAffinity = currentTotalAntigenAffinity.fheAdd(data.antigenAffinity);
            currentTotalAntibodyCount = currentTotalAntibodyCount.fheAdd(data.antibodyCount);
            currentTotalTCellEffectiveness = currentTotalTCellEffectiveness.fheAdd(data.tCellEffectiveness);
        }
        bytes32[] memory currentCts = new bytes32[](3);
        currentCts[0] = currentTotalAntigenAffinity.toBytes32();
        currentCts[1] = currentTotalAntibodyCount.toBytes32();
        currentCts[2] = currentTotalTCellEffectiveness.toBytes32();

        bytes32 currentStateHash = _hashCiphertexts(currentCts);
        if (currentStateHash != ctx.stateHash) revert StateMismatch();

        // Security: Verify the proof of correct decryption from the FHEVM network.
        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert InvalidProof();

        uint256[] memory results = new uint256[](3);
        assembly {
            results[0] := mload(add(cleartexts, 0x20))
            results[1] := mload(add(cleartexts, 0x40))
            results[2] := mload(add(cleartexts, 0x60))
        }

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, ctx.batchId, results);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal {
        if (!x.isInitialized()) revert NotInitialized();
    }

    function _initIfNeeded(ebool x) internal {
        if (!x.isInitialized()) revert NotInitialized();
    }
}