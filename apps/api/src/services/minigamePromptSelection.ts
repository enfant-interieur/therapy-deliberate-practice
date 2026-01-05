export const NO_UNIQUE_PATIENT_STATEMENTS_LEFT = "NO_UNIQUE_PATIENT_STATEMENTS_LEFT";

export type PromptExhaustionMetadata = {
  remaining: number;
  required: number;
  poolSize: number;
  usedCount: number;
};

export class NoUniquePatientStatementsLeftError extends Error {
  code = NO_UNIQUE_PATIENT_STATEMENTS_LEFT;
  metadata: PromptExhaustionMetadata;

  constructor(metadata: PromptExhaustionMetadata) {
    super("No unique patient statements left.");
    this.metadata = metadata;
  }
}

export type CandidateExample = {
  id: string;
  task_id: string;
};

export const createSeededRandom = (seed: string) => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pickFromAvailable = (available: CandidateExample[], seedKey: string) => {
  const rng = createSeededRandom(seedKey);
  return available[Math.floor(rng() * available.length)];
};

export const pickUnusedExampleForPlayer = ({
  examples,
  usedExampleIds,
  seedKey
}: {
  examples: CandidateExample[];
  usedExampleIds: Set<string>;
  seedKey: string;
}) => {
  const available = examples.filter((example) => !usedExampleIds.has(example.id));
  if (!available.length) {
    throw new NoUniquePatientStatementsLeftError({
      remaining: 0,
      required: 1,
      poolSize: examples.length,
      usedCount: usedExampleIds.size
    });
  }
  return pickFromAvailable(available, seedKey);
};

export const pickUnusedExampleForPair = ({
  examples,
  usedByPlayerA,
  usedByPlayerB,
  seedKey
}: {
  examples: CandidateExample[];
  usedByPlayerA: Set<string>;
  usedByPlayerB: Set<string>;
  seedKey: string;
}) => {
  const used = new Set([...usedByPlayerA, ...usedByPlayerB]);
  const available = examples.filter((example) => !used.has(example.id));
  if (!available.length) {
    throw new NoUniquePatientStatementsLeftError({
      remaining: 0,
      required: 1,
      poolSize: examples.length,
      usedCount: used.size
    });
  }
  return pickFromAvailable(available, seedKey);
};
