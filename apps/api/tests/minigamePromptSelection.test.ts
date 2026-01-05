import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NoUniquePatientStatementsLeftError,
  pickUnusedExampleForPair,
  pickUnusedExampleForPlayer
} from "../src/services/minigamePromptSelection";

const examples = [
  { id: "ex-1", task_id: "task-1" },
  { id: "ex-2", task_id: "task-1" },
  { id: "ex-3", task_id: "task-1" }
];

test("pickUnusedExampleForPlayer avoids repeats and is deterministic", () => {
  const used = new Set<string>();
  const picks = new Set<string>();
  for (let i = 0; i < 3; i += 1) {
    const example = pickUnusedExampleForPlayer({
      examples,
      usedExampleIds: used,
      seedKey: `seed:player-a:${i}`
    });
    assert.ok(!used.has(example.id));
    used.add(example.id);
    picks.add(example.id);
  }
  assert.equal(picks.size, 3);

  const deterministic = pickUnusedExampleForPlayer({
    examples,
    usedExampleIds: new Set(),
    seedKey: "seed:player-a:0"
  });
  const deterministicAgain = pickUnusedExampleForPlayer({
    examples,
    usedExampleIds: new Set(),
    seedKey: "seed:player-a:0"
  });
  assert.equal(deterministic.id, deterministicAgain.id);
});

test("pickUnusedExampleForPlayer throws when exhausted", () => {
  const used = new Set(examples.map((example) => example.id));
  assert.throws(
    () =>
      pickUnusedExampleForPlayer({
        examples,
        usedExampleIds: used,
        seedKey: "seed:player-a:0"
      }),
    (error) => {
      assert.ok(error instanceof NoUniquePatientStatementsLeftError);
      return true;
    }
  );
});

test("pickUnusedExampleForPair avoids repeats per player", () => {
  const usedByA = new Set<string>();
  const usedByB = new Set<string>();

  const first = pickUnusedExampleForPair({
    examples,
    usedByPlayerA: usedByA,
    usedByPlayerB: usedByB,
    seedKey: "seed:pair:0"
  });
  usedByA.add(first.id);
  usedByB.add(first.id);

  const second = pickUnusedExampleForPair({
    examples,
    usedByPlayerA: usedByA,
    usedByPlayerB: usedByB,
    seedKey: "seed:pair:1"
  });
  assert.notEqual(second.id, first.id);
});
