import test from "node:test";
import assert from "node:assert/strict";
import { buildSgfFromHistory, parseSgf, buildHistoryFromSgf } from "../shared/game/sgf.js";

test("SGF roundtrip preserves green setup stones via UG extension", () => {
  const history = [
    {
      stones: [
        { x: 1, y: 1, color: "green", player: "black", moveNumber: 1 },
        { x: 2, y: 1, color: "black", player: "black", moveNumber: 2 },
      ],
      turn: "black",
      captures: { black: 0, white: 0 },
      passes: 0,
      over: false,
      score: null,
      lastMove: null,
      ruleset: "korean",
      komi: 0,
      moveCount: 2,
      boardHashes: [""],
    },
  ];
  const sgf = buildSgfFromHistory({ history, columns: 19, rows: 13, ruleset: "korean", komi: 0 });
  assert.equal(sgf.includes("UG["), true);
  const parsed = parseSgf(sgf);
  const restored = buildHistoryFromSgf(parsed, {
    columns: 19,
    rows: 13,
    fallbackRuleset: "korean",
    fallbackKomi: 0,
  });
  assert.equal(restored.ok, true);
  const stones = restored.history[0].stones;
  assert.equal(stones.some((s) => s.x === 1 && s.y === 1 && s.color === "green"), true);
});

test("buildHistoryFromSgf sets moveCount from setup stones", () => {
  const parsed = parseSgf("(;FF[4]GM[1]SZ[19:13]AB[aa]AW[ba]UG[ca])");
  const restored = buildHistoryFromSgf(parsed, {
    columns: 19,
    rows: 13,
    fallbackRuleset: "korean",
    fallbackKomi: 0,
  });
  assert.equal(restored.ok, true);
  assert.equal(restored.history[0].moveCount, 3);
});

test("buildHistoryFromSgf rejects invalid turn order by default", () => {
  const parsed = parseSgf("(;FF[4]GM[1]SZ[19:13];B[aa];B[ab])");
  const restored = buildHistoryFromSgf(parsed, {
    columns: 19,
    rows: 13,
    fallbackRuleset: "korean",
    fallbackKomi: 0,
  });
  assert.equal(restored.ok, false);
  assert.equal(restored.error, "invalid_turn_order");
});


