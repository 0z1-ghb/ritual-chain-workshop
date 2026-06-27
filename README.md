## Ritual Chain Workshop AI Judge Bounty with Commit Reveal

Modified the AI judge bounty contract to use a commit reveal mechanism so submissions stay hidden until judging.

### Lifecycle

1. **Create Bounty**: owner creates a bounty with title, rubric, reward (ETH), submission deadline, and reveal deadline.
2. **Commit Phase** (before submission deadline): participants submit `keccak256(abi.encode(answer, salt, msg.sender, bountyId))` via `submitCommitment()`. No plaintext is stored on-chain.
3. **Reveal Phase** (after submission deadline, before reveal deadline): participants call `revealAnswer()` with their original answer and salt. The contract verifies the hash matches the commitment, then pushes the plaintext into the `submissions` array.
4. **Judge** (after reveal deadline): owner calls `judgeAll()`, which submits only revealed submissions to the Ritual LLM precompile for AI evaluation.
5. **Finalize**: owner picks a winner index. The reward is sent to that submitter.

### Architecture

| File | Purpose |
|------|---------|
| `hardhat/contracts/AIJudge.sol` | Main contract with commit reveal logic (two deadlines, custom errors, virtual `_runLlm`) |
| `hardhat/contracts/TestAIJudge.sol` | Test harness that mocks `_runLlm` for testing judgeAll locally |
| `hardhat/contracts/utils/PrecompileConsumer.sol` | Inherited base (Ritual LLM precompile wrapper) |
| `hardhat/test/AIJudge.test.ts` | 25 tests covering all commit reveal flows, including mock judge, copy-cat prevention, and full lifecycle |
| `hardhat/ignition/modules/AIJudge.ts` | Hardhat Ignition deploy module |
| `web/src/abi/AIJudge.ts` | Frontend ABI (regenerated from compiled contract) |
| `web/src/components/SubmitAnswer.tsx` | Two phase UI: commit (before submission deadline) and reveal (before reveal deadline) |
| `web/src/components/CreateBountyForm.tsx` | Bounty creation form with separate submission and reveal deadline inputs |
| `web/src/components/SubmissionsList.tsx` | Shows revealed submissions and current user's commitment status |
| `web/src/lib/bounty.ts` | Bounty types with `BountyStatus` (open, reveal, judged, finalized) and `canCommit`/`canReveal` helpers |

### Test

```bash
cd hardhat
npx hardhat test
```

### Deploy

```bash
cd hardhat
# Set your private key as an environment variable (Hardhat 3 does not auto-load .env)
$env:DEPLOYER_PRIVATE_KEY="0x..."
npx hardhat ignition deploy ignition/modules/AIJudge.ts --network ritual
```

### Deployed Contract (Ritual Chain)

| | |
|---|---|
| **Contract Address** | `0x2d5A626Bc35025672F629b0D4455140d4Ed9c0f6` |
| **Deploy Tx Hash** | `0x88facca4426128c617cff540f2036d81d8689933d5c503bf688b4dc0dbeb711b` |
| **Block** | 38,323,330 |

### Reflection

**Why does commit reveal solve the front running problem?**
The plaintext answer is never stored on-chain before the submission deadline. An observer sees only a hash, from which they cannot derive the answer. After the submission deadline, when answers are revealed during the reveal window, it is too late to copy because the submission window is closed. The separate reveal deadline ensures judging cannot begin until all reveals are in, while preventing the reveal phase from staying open indefinitely. This prevents last minute copying and ensures original work is rewarded.

**What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?**
In a bounty system, public information should include the bounty title, rubric, reward amount, submission and reveal deadlines, commitment hashes to prove participation, and the final winner, as these provide transparency and trust. Hidden until after the submission deadline should be the plaintext answers and their salts, protected by the commit reveal mechanism to prevent copying or last minute improvements. On chain storage should only hold commitment hashes during the submission phase, with plaintext answers appearing only during the reveal phase. The AI should handle evaluation, ranking submissions against the rubric and providing scores with reasoning, since it can process large amounts of text quickly and consistently. The human bounty owner should make the final decision on the winner, define the rubric, and set the bounty terms, because judgment calls about relevance, creativity, and context require human understanding. AI recommendations serve as advisory input rather than final authority. This separation ensures fairness through cryptographic guarantees while preserving human oversight for subjective decisions.

### Resources

- [Ritual Chain docs](https://docs.ritual.net)
- [Hardhat v3](https://hardhat.org)
