import { useMemo } from "react";

type CriterionScore = {
  score: number;
};

type EvaluationScoreOptions = {
  previousScore?: number | null;
  roundScore?: number | null;
};

const sumCriterionScores = (scores?: CriterionScore[] | null) =>
  (scores ?? []).reduce((total, item) => total + (Number.isFinite(item.score) ? item.score : 0), 0);

export const useEvaluationScore = (scores?: CriterionScore[] | null, options?: EvaluationScoreOptions) => {
  return useMemo(() => {
    const computedTotal = sumCriterionScores(scores);
    const total = Number.isFinite(options?.roundScore)
      ? (options?.roundScore as number)
      : computedTotal;
    const average = scores && scores.length > 0 ? total / scores.length : 0;
    const previousScore = options?.previousScore;
    const delta = Number.isFinite(previousScore) ? total - (previousScore as number) : null;
    const tone = delta == null ? "neutral" : delta > 0 ? "positive" : delta < 0 ? "negative" : "neutral";

    return { total, average, delta, tone } as const;
  }, [scores, options?.previousScore, options?.roundScore]);
};
