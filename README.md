## Ritual Chain Workshop — AI Judge Bounty with Commit–Reveal

Modified the AI judge bounty contract to use a **commit–reveal** mechanism so submissions stay hidden until judging.

### Lifecycle

1. **Create Bounty** — owner creates a bounty with title, rubric, reward (ETH), and deadline.
2. **Commit Phase** (before deadline) — participants submit `keccak256(abi.encode(answer, salt, msg.sender, bountyId))` via `submitCommitment()`. No plaintext is stored on-chain.
3. **Reveal Phase** (after deadline, before judging) — participants call `revealAnswer()` with their original answer + salt. The contract verifies the hash matches the commitment, then pushes the plaintext into the `submissions` array.
4. **Judge** — owner calls `judgeAll()`, which submits only revealed submissions to the Ritual LLM precompile for AI evaluation.
5. **Finalize** — owner picks a winner index. The reward is sent to that submitter.

### Architecture

| File | Purpose |
|------|---------|
| `hardhat/contracts/AIJudge.sol` | Main contract with commit-reveal logic |
| `hardhat/contracts/utils/PrecompileConsumer.sol` | Inherited base (Ritual LLM precompile wrapper) |
| `hardhat/test/AIJudge.test.ts` | 15 tests covering all commit–reveal flows |
| `hardhat/ignition/modules/AIJudge.ts` | Hardhat Ignition deploy module |
| `web/src/abi/AIJudge.ts` | Frontend ABI (regenerated from compiled contract) |
| `web/src/components/SubmitAnswer.tsx` | Two-phase UI: commit (before deadline) + reveal (after deadline) |
| `web/src/components/SubmissionsList.tsx` | Shows revealed submissions + current user's commitment status |
| `web/src/lib/bounty.ts` | Bounty types with `BountyStatus` (open / reveal / judged / finalized) |

### Test

```bash
cd hardhat
npx hardhat test
```

### Deploy

```bash
cd hardhat
npx hardhat ignition deploy ignition/modules/AIJudge.ts --network ritual
```

### Reflection

**Why does commit–reveal solve the front-running problem?**  
Because the plaintext answer is never stored on-chain before the deadline. An observer sees only a hash, from which they cannot derive the answer. After the deadline, when answers are revealed, it's too late to copy — the submission window is closed. This prevents last-minute copying and ensures original work is rewarded.

**What should be public, what should stay hidden, and what should be decided by AI versus by a human in a bounty system?**  
In a bounty system, public information should include the bounty title, rubric, reward amount, deadline, commitment hashes to prove participation, and the final winner, as these provide transparency and trust. Hidden until after the deadline should be the plaintext answers and their salts, protected by the commit reveal mechanism to prevent copying or last minute improvements. On chain storage should only hold commitment hashes during the submission phase, with plaintext answers appearing only after the reveal phase begins. The AI should handle evaluation, ranking submissions against the rubric and providing scores with reasoning, since it can process large amounts of text quickly and consistently. The human bounty owner should make the final decision on the winner, define the rubric, and set the bounty terms, because judgment calls about relevance, creativity, and context require human understanding. AI recommendations serve as advisory input rather than final authority. This separation ensures fairness through cryptographic guarantees while preserving human oversight for subjective decisions.

### Resources

- [Ritual Chain docs](https://docs.ritual.net)
- [Hardhat v3](https://hardhat.org)
