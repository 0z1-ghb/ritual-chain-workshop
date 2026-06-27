import type { Address } from "viem";

export type Bounty = {
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  submissionDeadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  submissionCount: bigint;
  winnerIndex: bigint;
  aiReview: `0x${string}`;
};

export function parseBounty(
  raw: readonly [
    Address, string, string, bigint, bigint, bigint,
    boolean, boolean, bigint, bigint, `0x${string}`,
  ],
): Bounty {
  const [owner, title, rubric, reward, submissionDeadline, revealDeadline, judged, finalized, submissionCount, winnerIndex, aiReview] = raw;
  return { owner, title, rubric, reward, submissionDeadline, revealDeadline, judged, finalized, submissionCount, winnerIndex, aiReview };
}

export type BountyStatus = "open" | "reveal" | "judged" | "finalized";

export function getBountyStatus(b: Bounty, nowSeconds = Date.now() / 1000): BountyStatus {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  const revealPassed = Number(b.revealDeadline) <= nowSeconds;
  if (revealPassed) return "judged";
  const subPassed = Number(b.submissionDeadline) <= nowSeconds;
  return subPassed ? "reveal" : "open";
}

export const STATUS_META: Record<BountyStatus, { label: string; tone: "green" | "amber" | "indigo" | "zinc" }> = {
  open: { label: "Open for commitments", tone: "green" },
  reveal: { label: "Reveal phase", tone: "amber" },
  judged: { label: "Judged", tone: "indigo" },
  finalized: { label: "Finalized", tone: "zinc" },
};

export function canCommit(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return !b.judged && !b.finalized && Number(b.submissionDeadline) > nowSeconds;
}

export function canReveal(b: Bounty, nowSeconds = Date.now() / 1000): boolean {
  return !b.judged && !b.finalized
    && Number(b.submissionDeadline) <= nowSeconds
    && Number(b.revealDeadline) > nowSeconds;
}