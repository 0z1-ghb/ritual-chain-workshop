"use client";

import { useAccount, useReadContract } from "wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { shortenAddress } from "@/lib/format";
import type { JudgeResult } from "@/lib/aiReview";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";

export function SubmissionsList({
  bountyId,
  count,
  judge,
  finalWinner,
}: {
  bountyId: bigint;
  count: number;
  judge?: JudgeResult | null;
  finalWinner?: number;
}) {
  const { address } = useAccount();
  const { data: commitment } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getCommitment",
    args: [bountyId, address ?? "0x0"],
    query: { enabled: !!address },
  });

  const indices = Array.from({ length: count }, (_, i) => i);

  return (
    <Card>
      <CardHeader
        title="Submissions"
        subtitle={`${count} revealed answer(s). Unrevealed commitments stay hidden.`}
        action={<Badge tone="zinc">{count} revealed</Badge>}
      />
      <CardBody className="space-y-3">
        {address && commitment && (
          <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-xs">
            Your commitment:{" "}
            <span className="font-mono text-amber-400">{commitment[0]?.slice(0, 18)}…</span>
            {" — "}
            {commitment[1] ? (
              <span className="text-green-400">Revealed ✓</span>
            ) : (
              <span className="text-zinc-400">Not yet revealed</span>
            )}
          </div>
        )}

        {count === 0 ? (
          <p className="text-sm text-zinc-500">No revealed submissions yet.</p>
        ) : (
          indices.map((i) => (
            <SubmissionRow
              key={i}
              bountyId={bountyId}
              index={i}
              ranking={judge?.ranking?.find((r) => r.index === i)}
              recommended={judge?.winnerIndex === i}
              isWinner={finalWinner === i}
            />
          ))
        )}
      </CardBody>
    </Card>
  );
}

function SubmissionRow({
  bountyId,
  index,
  ranking,
  recommended,
  isWinner,
}: {
  bountyId: bigint;
  index: number;
  ranking?: { index: number; score: number; reason: string };
  recommended?: boolean;
  isWinner?: boolean;
}) {
  const { data, isLoading } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi,
    functionName: "getSubmission",
    args: [bountyId, BigInt(index)],
    query: { enabled: true },
  });

  const submitter = data?.[0];
  const answer = data?.[1];

  return (
    <div
      className={`rounded-xl border p-3 ${
        isWinner
          ? "border-emerald-500/40 bg-emerald-500/5"
          : recommended
            ? "border-indigo-500/40 bg-indigo-500/5"
            : "border-white/10 bg-black/20"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">#{index}</span>
          <span className="font-mono text-sm text-zinc-300">
            {submitter ? shortenAddress(submitter) : isLoading ? "loading…" : "-"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {ranking ? <Badge tone="zinc">score {ranking.score}</Badge> : null}
          {isWinner ? (
            <Badge tone="green">Winner</Badge>
          ) : recommended ? (
            <Badge tone="indigo">AI pick</Badge>
          ) : null}
        </div>
      </div>

      <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">
        {answer ?? (isLoading ? "" : "-")}
      </p>

      {ranking?.reason ? (
        <p className="mt-2 border-t border-white/5 pt-2 text-xs text-zinc-400">
          <span className="text-zinc-500">AI: </span>
          {ranking.reason}
        </p>
      ) : null}
    </div>
  );
}
