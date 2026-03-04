import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, placeStone } from "../shared/game/engine.js";

test("placeStone rejects out-of-bounds coordinates", () => {
  const state = createInitialState();
  const next = placeStone(state, 0, 5);
  assert.equal(next, state);
});

test("placeStone accepts valid in-bounds coordinates", () => {
  const state = createInitialState();
  const next = placeStone(state, 1, 1);
  assert.notEqual(next, state);
  assert.equal(next.stones.length, 1);
  assert.deepEqual(next.lastMove, { type: "stone", player: "black", x: 1, y: 1 });
});


