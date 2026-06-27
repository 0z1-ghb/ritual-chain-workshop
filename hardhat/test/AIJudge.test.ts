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
    const aiJudge = await connection.viem.deployContract("AIJudge");
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
  const answerAlice = "Alice's excellent solution";
  const answerBob = "Bob's mediocre attempt";

  describe("createBounty", async () => {
    it("creates a bounty with the given parameters", async () => {
      const { owner, publicClient, aiJudge } = await deploy();
      const reward = 10n ** 17n;
      const now = await currentTime(publicClient);
      const deadline = now + 3600;

      await aiJudge.write.createBounty(
        ["Spaghetti code competition", "Best use of nested loops", BigInt(deadline)],
        { value: reward },
      );

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[0].toLowerCase(), owner.account.address.toLowerCase());
      assert.equal(bounty[1], "Spaghetti code competition");
      assert.equal(bounty[2], "Best use of nested loops");
      assert.equal(bounty[3], reward);
      assert.equal(bounty[4], BigInt(deadline));
      assert.equal(bounty[5], false);
      assert.equal(bounty[6], false);
      assert.equal(bounty[7], 0n);
    });

    it("rejects zero reward", async () => {
      const { publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await assert.rejects(
        aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600)]),
        /reward required/,
      );
    });
  });

  describe("submitCommitment", async () => {
    it("accepts a commitment before deadline", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      const stored = await aiJudge.read.getCommitment([1n, alice.account.address]);
      assert.equal(stored[0], commit);
      assert.equal(stored[1], false);
    });

    it("rejects duplicate commitment", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now + 3600)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address }),
        /already committed/,
      );
    });

    it("rejects commitment after deadline", async () => {
      const { alice, publicClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(now - 1)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await assert.rejects(
        aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address }),
        /submissions closed/,
      );
    });

    it("rejects commitment for non-existent bounty", async () => {
      const { alice, aiJudge } = await deploy();
      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 999n);
      await assert.rejects(
        aiJudge.write.submitCommitment([999n, commit], { account: alice.account.address }),
        /bounty not found/,
      );
    });
  });

  describe("revealAnswer", async () => {
    it("accepts a valid reveal after deadline", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      const stored = await aiJudge.read.getCommitment([1n, alice.account.address]);
      assert.equal(stored[1], true);

      const sub = await aiJudge.read.getSubmission([1n, 0n]);
      assert.equal(sub[0].toLowerCase(), alice.account.address.toLowerCase());
      assert.equal(sub[1], answerAlice);
    });

    it("rejects reveal before deadline", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /reveal period not started/,
      );
    });

    it("rejects reveal with wrong salt", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      const wrongSalt = `0x${"cc".repeat(32)}` as `0x${string}`;
      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, wrongSalt], { account: alice.account.address }),
        /commitment mismatch/,
      );
    });

    it("rejects reveal with wrong answer", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, "wrong answer", saltA], { account: alice.account.address }),
        /commitment mismatch/,
      );
    });

    it("rejects reveal without prior commitment", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });
      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /no commitment found/,
      );
    });

    it("rejects double reveal", async () => {
      const { alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commit = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commit], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      await assert.rejects(
        aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address }),
        /already revealed/,
      );
    });
  });

  describe("full flow", async () => {
    it("supports multiple participants", async () => {
      const { alice, bob, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Multiple", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      const commitB = makeCommitment(answerBob, saltB, bob.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });

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
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });
      const commitB = makeCommitment(answerBob, saltB, bob.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitB], { account: bob.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });

      // Only Alice reveals
      await aiJudge.write.revealAnswer([1n, answerAlice, saltA], { account: alice.account.address });

      const bounty = await aiJudge.read.getBounty([1n]);
      assert.equal(bounty[7], 1n);
    });

    // judgeAll requires Ritual chain's LLM precompile — skipped on Hardhat
    // Full e2e test on Ritual testnet: create → commit → reveal → judge → finalize

    it("owner cannot judge when no revealed submissions", async () => {
      const { owner, alice, publicClient, testClient, aiJudge } = await deploy();
      const now = await currentTime(publicClient);
      const deadline = now + 3600;
      await aiJudge.write.createBounty(["Test", "Rubric", BigInt(deadline)], { value: 10n ** 17n });

      const commitA = makeCommitment(answerAlice, saltA, alice.account.address, 1n);
      await aiJudge.write.submitCommitment([1n, commitA], { account: alice.account.address });

      await testClient.setNextBlockTimestamp({ timestamp: BigInt(deadline) });

      await assert.rejects(
        aiJudge.write.judgeAll([1n, "0x"], { account: owner.account.address }),
        /no submissions/,
      );
    });
  });
});
