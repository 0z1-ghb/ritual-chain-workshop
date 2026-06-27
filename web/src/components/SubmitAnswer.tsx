"use client";

import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { keccak256, encodeAbiParameters, parseAbiParameters, stringToHex } from "viem";
import { writeContract } from "viem/actions";
import type { Bounty } from "@/lib/bounty";
import { canCommit, canReveal, getBountyStatus, STATUS_META } from "@/lib/bounty";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";

function saltHex(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export default function SubmitAnswer({ bounty, bountyId }: { bounty: Bounty; bountyId: bigint }) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const [savedSalt, setSavedSalt] = useState<`0x${string}` | null>(null);
  const [revealAnswer, setRevealAnswer] = useState("");
  const [revealSalt, setRevealSalt] = useState("");

  const status = getBountyStatus(bounty);
  const commitAllowed = canCommit(bounty);
  const revealAllowed = canReveal(bounty);

  const handleCommit = async () => {
    if (!walletClient || !address || !answer.trim()) return;
    setPending(true);
    try {
      const salt = saltHex();
      const hash = keccak256(
        encodeAbiParameters(
          parseAbiParameters("string, bytes32, address, uint256"),
          [answer, salt, address, bountyId],
        ),
      );
      const tx = await writeContract(walletClient, {
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, hash],
      });
      setSavedSalt(salt);
      setAnswer("");
      alert(`Committed! Save this salt to reveal later:\n${salt}\n\nTx: ${tx}`);
    } catch (e: any) {
      alert(e?.shortMessage ?? e?.message ?? "commit failed");
    } finally {
      setPending(false);
    }
  };

  const handleReveal = async () => {
    if (!walletClient || !address || !revealAnswer.trim() || !revealSalt.trim()) return;
    setPending(true);
    try {
      const salt = revealSalt.startsWith("0x") ? (revealSalt as `0x${string}`) : (`0x${revealSalt}` as `0x${string}`);
      const tx = await writeContract(walletClient, {
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, revealAnswer, salt],
      });
      setRevealAnswer("");
      setRevealSalt("");
      alert(`Answer revealed! Tx: ${tx}`);
    } catch (e: any) {
      alert(e?.shortMessage ?? e?.message ?? "reveal failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4 rounded border p-3">
      <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">
        {STATUS_META[status].label}
      </div>

      {commitAllowed && (
        <>
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={3}
            placeholder="Your confidential answer…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <button
            className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={pending || !answer.trim()}
            onClick={handleCommit}
          >
            {pending ? "Submitting…" : "Submit Commitment (Hash)"}
          </button>
          {savedSalt && (
            <p className="mt-1 text-xs text-amber-600 break-all">
              🔑 Saved salt: {savedSalt} — keep it to reveal later!
            </p>
          )}
        </>
      )}

      {revealAllowed && (
        <>
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={3}
            placeholder="Your original answer…"
            value={revealAnswer}
            onChange={(e) => setRevealAnswer(e.target.value)}
          />
          <input
            className="w-full rounded border p-2 text-sm font-mono"
            placeholder="Salt (hex) you saved during commit"
            value={revealSalt}
            onChange={(e) => setRevealSalt(e.target.value)}
          />
          <button
            className="rounded bg-amber-600 px-4 py-1.5 text-sm text-white disabled:opacity-40"
            disabled={pending || !revealAnswer.trim() || !revealSalt.trim()}
            onClick={handleReveal}
          >
            {pending ? "Revealing…" : "Reveal Answer"}
          </button>
        </>
      )}

      {!commitAllowed && !revealAllowed && (
        <p className="text-sm text-zinc-400">
          {status === "judged" || status === "finalized"
            ? "This bounty is closed for submissions."
            : "Waiting for reveal phase…"}
        </p>
      )}
    </div>
  );
}
