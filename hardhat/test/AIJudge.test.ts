import { describe, it } from "node:test";
import assert from "node:assert/strict";
import hre from "hardhat";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

describe("AIJudge (commit–reveal)", async () => {
  async function deploy() {
    const connection = await hre.network.getOrCreate();
    const [owner, alice, bob] = await connection.viem.getWalletClients();
    const publicClient = await connection.viem.getPublicClient();
    const testClient = await connection.viem.getTestClient();
    const aiJudge = await connection.viem.deployContract("TestAIJudge");
    return { owner, alice, bob, publicClient, testClient, aiJudge };
  }

  async function currentTime(publicClient: any) {
    const block = await publicClient.getBlock({ blockTag: "latest" });
    return Number(block.timestamp);
  }

  function makeCommitment(answer: string, salt: `0x${string}`, submitter: `0x${string}`, bountyId: bigint) {
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, bytes32, address, uint256"),
        [answer, salt, submitter, bountyId],
      ),
    );
  }

  const saltA = `0x${"aa".repeat(32)}` as `0x${string}`;
  const saltB = `0x${"bb".repeat(32)}` as `0x${string}`;
  const saltC = `0x${"cc".repeat(32)}` as `0x${string}`;
  const answerAlice = "Alice's excellent solution";
  const answerBob = "Bob's mediocre attempt";

  describe("createBounty", async () => {
    it("creates a bounty with submission and reveal deadlines", async () => {
      const { owner, publicClient, aiJudge } = await deploy();
      const reward = 10n ** 17n;
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;

      await aiJudge.write.createBounty(
        ["Spaghetti code competition", "Best use of nested loops", BigInt(subDead), BigInt(revDead)],
        { value: reward },
      );

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[0].toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(bounty[1], "Spaghetti code competition");
      assert.equal(bounty[2], "Best use of nested loops");
      assert.equal(bounty[3], reward);
      assert.equal(bounty[4], BigInt(subDead));
      assert.equal(bounty[5], BigInt(revDead));
      assert.equal(bounty[6], false);
      assert.equal(bounty[7], false);
      assert.equal(bounty[8], 0n);
    });

    it("rejects zero reward", async () => {
      const { publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await assert.rejects(
        aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600), BigInt(now + 7200)]),
        /RewardRequired/,
      );
    });

    it("rejects reversed deadlines", async () => {
      const { publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await assert.rejects(
        aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 7200), BigInt(now + 3600)], { value: 10n ** 17n }),
        /BadDeadlines/,
      );
    });
  });

  describe("submitCommitment", async () => {
    it("accepts a commitment before submission deadline", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600), BigInt(now + 7200)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      const stored = await aiJudge.read.getCommitment([1n, alice.account.address]);
      assert.equal(stored[0], commit);
      assert.equal(stored[1], false);
    });

    it("rejects duplicate commitment", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600), BigInt(now + 7200)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address }),
        /AlreadyCommitted/,
      );
    });

    it("rejects commitment after submission deadline", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now - 1), BigInt(now + 7200)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await assert.rejects(
        aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address }),
        /SubmissionsClosed/,
      );
    });

    it("rejects commitment for non-existent bounty", async () => {
      const { alice, aiJudge } = await deploy();
      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 999n);
      await assert.rejects(
        aiJudge.write.submitCommitment([999n, commit], { account: alice.account.address }),
        /BountyNotFound/,
      );
    });
  });

  describe("revealAnswer", async () => {
    it("accepts a valid reveal after submission deadline, before reveal deadline", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      const stored = await aiJudge.read.getCommitment([1n, alice.account.address]);
      assert.equal(stored[1], true);

      const sub = await aiJudge.read.getSubmission([1n, 0n]);
      assert.equal(sub[0].toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(sub[1], answerAlice);
    });

    it("rejects reveal before submission deadline", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /RevealNotOpen/,
      );
    });

    it("rejects reveal after reveal deadline", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /RevealClosed/,
      );
    });

    it("rejects reveal with wrong salt", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      const wrongSalt = `0x${"dd".repeat(32)}` as `0x${string}`;
      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, wrongSalt], { account: alice.account.address }),
        /CommitmentMismatch/,
      );
    });

    it("rejects reveal with wrong answer", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, "wrong answer", saltA], { account: alice.account.address }),
        /CommitmentMismatch/,
      );
    });

    it("rejects reveal without prior commitment", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /NoCommitment/,
      );
    });

    it("rejects double reveal", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /AlreadyRevealed/,
      );
    });
  });

  describe("judgeAll", async () => {
    it("judges revealed submissions via virtual _runLlm", async () => {
      const { owner, alice, bob, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });
      const commitB = makeCommitment(answerBob, saltB, bob.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });
      await aiJudge.write.revealAnswer([1n, answerBob, saltB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address });

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[6], true); // judged
    });

    it("rejects judge before reveal deadline", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address }),
        /RevealClosed/,
      );
    });

    it("rejects judge when no revealed submissions", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await assert.rejects(
        aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address }),
        /NoRevealedAnswers/,
      );
    });

    it("rejects judge from non-owner", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await assert.rejects(
        aiJudge.write.judgeAll([1n, "0x"], { account: alice.account.address }),
        /NotOwner/,
      );
    });

    it("rejects double judge", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address });

      await assert.rejects(
        aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address }),
        /AlreadyJudged/,
      );
    });
  });

  describe("finalizeWinner", async () => {
    it("finalizes winner after judging", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address });

      await aiJudge.write.finalizeWinner([1n, 0n], { account: owner.account.address });

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[7], true); // finalized
    });

    it("rejects finalize before judge", async () => {
      const { owner, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600), BigInt(now + 7200)], { value: 10n ** 17n });

      await assert.rejects(
        aiJudge.write.finalizeWinner([1n, 0n], { account: owner.account.address }),
        /NotJudgedYet/,
      );
    });
  });

  describe("full flow", async () => {
    it("supports multiple participants", async () => {
      const { alice, bob, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Multiple", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      const commitB = makeCommitment(answerBob, saltB, bob.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });

      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });
      await aiJudge.write.revealAnswer([1n, answerBob, saltB], { account: bob.account.address });

      const sub0 = await aiJudge.read.getSubmission([1n, 0n]);
      assert.equal(sub0[0].toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(sub0[1], answerAlice);

      const sub1 = await aiJudge.read.getSubmission([1n, 1n]);
      assert.equal(sub1[0].toLowerCase(), bob.account.address.toLowerCase());
      assert.equal(sub1[1], answerBob);
    });

    it("only revealed submissions appear in array", async () => {
      const { alice, bob, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });
      const commitB = makeCommitment(answerBob, saltB, bob.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });

      // Only Alice reveals
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[8], 1n); // submissionCount at index 8
    });

    it("prevents copy-cat: Bob cannot reveal Alice's commitment", async () => {
      const { alice, bob, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(subDead), BigInt(revDead)], { value: 10n ** 17n });

      // Alice commits
      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      // Bob sees Alice's commitment on-chain and tries to use it
      const storedCommit = await aiJudge.read.getCommitment([1n, alice.account.address]);
      const stolenCommit = storedCommit[0];
      await aiJudge.write.submitCommitment([1n, stolenCommit], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });

      // Bob tries to reveal with his own answer but Alice's salt — will fail because msg.sender is bound
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, "Bob's stolen answer", saltA], { account: bob.account.address }),
        /CommitmentMismatch/,
      );
    });

    it("completes full lifecycle: create → commit → reveal → judge → finalize", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const subDead = now + 3600;
      const revDead = now + 7200;
      const reward = 10n ** 17n;

      await aiJudge.write.createBounty(["Full", "Rubric", BigInt(subDead), BigInt(revDead)], { value: reward });

      const aliceBalBefore = await publicClient.getBalance({ address: alice.account.address });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(subDead) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(revDead) });
      await aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address });

      await aiJudge.write.finalizeWinner([1n, 0n], { account: owner.account.address });

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[6], true);  // judged
      assert.equal(bounty[7], true);  // finalized
      assert.equal(bounty[9], 0n);    // winnerIndex

      const aliceBalAfter = await publicClient.getBalance({ address: alice.account.address });
      assert.ok(aliceBalAfter > aliceBalBefore, "Alice should have received the reward");
    });
  });
});