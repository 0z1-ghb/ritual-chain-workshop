// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PrecompileConsumer} from "./utils/PrecompileConsumer.sol";

interface IRitualWallet {
    function deposit(uint256 lockDuration) external payable;
    function depositFor(address user, uint256 lockDuration) external payable;
    function withdraw(uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
    function lockUntil(address) external view returns (uint256);
}

contract AIJudge is PrecompileConsumer {
    uint256 public constant MAX_SUBMISSIONS = 10;
    uint256 public constant MAX_ANSWER_LENGTH = 2_000;

    uint256 public nextBountyId = 1;

    IRitualWallet wallet = IRitualWallet(0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948);

    error BountyNotFound();
    error NotOwner();
    error RewardRequired();
    error BadDeadlines();
    error SubmissionsClosed();
    error AlreadyJudged();
    error AlreadyFinalized();
    error AlreadyCommitted();
    error RevealNotOpen();
    error RevealClosed();
    error NoCommitment();
    error AlreadyRevealed();
    error AnswerTooLong();
    error CommitmentMismatch();
    error TooManySubmissions();
    error NoRevealedAnswers();
    error NotJudgedYet();
    error InvalidWinnerIndex();
    error PaymentFailed();

    struct Submission {
        address submitter;
        string answer;
    }

    struct Commitment {
        bytes32 commitmentHash;
        bool revealed;
    }

    struct Bounty {
        address owner;
        string title;
        string rubric;
        uint256 reward;
        uint256 submissionDeadline;
        uint256 revealDeadline;
        bool judged;
        bool finalized;
        bytes aiReview;
        uint256 winnerIndex;
        Submission[] submissions;
    }

    struct ConvoHistory {
        string storageType;
        string path;
        string secretsName;
    }

    mapping(uint256 => Bounty) public bounties;
    mapping(uint256 => mapping(address => Commitment)) public commitments;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        string title,
        uint256 reward,
        uint256 submissionDeadline,
        uint256 revealDeadline
    );

    event CommitmentSubmitted(
        uint256 indexed bountyId,
        address indexed submitter,
        bytes32 commitment
    );

    event AnswerRevealed(
        uint256 indexed bountyId,
        uint256 indexed submissionIndex,
        address indexed submitter
    );

    event AllAnswersJudged(uint256 indexed bountyId, bytes aiReview);

    event WinnerFinalized(
        uint256 indexed bountyId,
        uint256 indexed winnerIndex,
        address indexed winner,
        uint256 reward
    );

    modifier onlyOwner(uint256 bountyId) {
        if (msg.sender != bounties[bountyId].owner) revert NotOwner();
        _;
    }

    modifier bountyExists(uint256 bountyId) {
        if (bounties[bountyId].owner == address(0)) revert BountyNotFound();
        _;
    }

    function createBounty(
        string calldata title,
        string calldata rubric,
        uint256 submissionDeadline,
        uint256 revealDeadline
    ) external payable returns (uint256 bountyId) {
        if (msg.value == 0) revert RewardRequired();
        if (submissionDeadline >= revealDeadline) revert BadDeadlines();

        bountyId = nextBountyId++;

        Bounty storage bounty = bounties[bountyId];
        bounty.owner = msg.sender;
        bounty.title = title;
        bounty.rubric = rubric;
        bounty.reward = msg.value;
        bounty.submissionDeadline = submissionDeadline;
        bounty.revealDeadline = revealDeadline;
        bounty.winnerIndex = type(uint256).max;

        emit BountyCreated(bountyId, msg.sender, title, msg.value, submissionDeadline, revealDeadline);
    }

    function submitCommitment(
        uint256 bountyId,
        bytes32 commitment
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (block.timestamp >= bounty.submissionDeadline) revert SubmissionsClosed();
        if (bounty.judged) revert AlreadyJudged();
        if (bounty.finalized) revert AlreadyFinalized();
        if (commitments[bountyId][msg.sender].commitmentHash != bytes32(0)) revert AlreadyCommitted();

        commitments[bountyId][msg.sender] = Commitment(commitment, false);

        emit CommitmentSubmitted(bountyId, msg.sender, commitment);
    }

    function revealAnswer(
        uint256 bountyId,
        string calldata answer,
        bytes32 salt
    ) external bountyExists(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (block.timestamp < bounty.submissionDeadline) revert RevealNotOpen();
        if (block.timestamp >= bounty.revealDeadline) revert RevealClosed();
        if (bounty.judged) revert AlreadyJudged();
        if (bounty.finalized) revert AlreadyFinalized();
        if (bounty.submissions.length >= MAX_SUBMISSIONS) revert TooManySubmissions();

        Commitment storage commitment = commitments[bountyId][msg.sender];
        if (commitment.commitmentHash == bytes32(0)) revert NoCommitment();
        if (commitment.revealed) revert AlreadyRevealed();
        if (bytes(answer).length > MAX_ANSWER_LENGTH) revert AnswerTooLong();

        bytes32 expectedHash = keccak256(abi.encode(answer, salt, msg.sender, bountyId));
        if (commitment.commitmentHash != expectedHash) revert CommitmentMismatch();

        commitment.revealed = true;

        bounty.submissions.push(Submission({submitter: msg.sender, answer: answer}));

        emit AnswerRevealed(bountyId, bounty.submissions.length - 1, msg.sender);
    }

    /// @notice Override in test harness to mock the LLM precompile
    function _runLlm(bytes calldata llmInput) internal virtual returns (bytes memory) {
        return _executePrecompile(LLM_INFERENCE_PRECOMPILE, llmInput);
    }

    function judgeAll(
        uint256 bountyId,
        bytes calldata llmInput
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (block.timestamp < bounty.revealDeadline) revert RevealClosed();
        if (bounty.judged) revert AlreadyJudged();
        if (bounty.finalized) revert AlreadyFinalized();
        if (bounty.submissions.length == 0) revert NoRevealedAnswers();

        bytes memory output = _runLlm(llmInput);

        (
            bool hasError,
            bytes memory completionData,
            ,
            string memory errorMessage,

        ) = abi.decode(output, (bool, bytes, bytes, string, ConvoHistory));

        require(!hasError, errorMessage);

        bounty.judged = true;
        bounty.aiReview = completionData;

        emit AllAnswersJudged(bountyId, completionData);
    }

    function finalizeWinner(
        uint256 bountyId,
        uint256 winnerIndex
    ) external bountyExists(bountyId) onlyOwner(bountyId) {
        Bounty storage bounty = bounties[bountyId];

        if (!bounty.judged) revert NotJudgedYet();
        if (bounty.finalized) revert AlreadyFinalized();
        if (winnerIndex >= bounty.submissions.length) revert InvalidWinnerIndex();

        bounty.finalized = true;
        bounty.winnerIndex = winnerIndex;

        address winner = bounty.submissions[winnerIndex].submitter;
        uint256 reward = bounty.reward;
        bounty.reward = 0;

        (bool ok, ) = payable(winner).call{value: reward}("");
        if (!ok) revert PaymentFailed();

        emit WinnerFinalized(bountyId, winnerIndex, winner, reward);
    }

    function getBounty(
        uint256 bountyId
    )
        external
        view
        bountyExists(bountyId)
        returns (
            address owner,
            string memory title,
            string memory rubric,
            uint256 reward,
            uint256 submissionDeadline,
            uint256 revealDeadline,
            bool judged,
            bool finalized,
            uint256 submissionCount,
            uint256 winnerIndex,
            bytes memory aiReview
        )
    {
        Bounty storage bounty = bounties[bountyId];

        return (
            bounty.owner,
            bounty.title,
            bounty.rubric,
            bounty.reward,
            bounty.submissionDeadline,
            bounty.revealDeadline,
            bounty.judged,
            bounty.finalized,
            bounty.submissions.length,
            bounty.winnerIndex,
            bounty.aiReview
        );
    }

    function getSubmission(
        uint256 bountyId,
        uint256 index
    )
        external
        view
        bountyExists(bountyId)
        returns (address submitter, string memory answer)
    {
        Bounty storage bounty = bounties[bountyId];

        if (index >= bounty.submissions.length) revert InvalidWinnerIndex();

        Submission storage submission = bounty.submissions[index];

        return (submission.submitter, submission.answer);
    }

    function getCommitment(
        uint256 bountyId,
        address submitter
    )
        external
        view
        returns (bytes32 commitmentHash, bool revealed)
    {
        Commitment storage c = commitments[bountyId][submitter];
        return (c.commitmentHash, c.revealed);
    }
}
