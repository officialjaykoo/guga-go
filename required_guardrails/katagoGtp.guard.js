import test from "node:test";
import assert from "node:assert/strict";
import { coordToGtp } from "../shared/ai/katagoGtp.js";

test("coordToGtp converts valid coordinates", () => {
  assert.equal(coordToGtp(1, 1), "A1");
  assert.equal(coordToGtp(19, 13), "T13");
});

test("coordToGtp throws on invalid coordinates", () => {
  assert.throws(() => coordToGtp(0, 10));
  assert.throws(() => coordToGtp(1.5, 10));
  assert.throws(() => coordToGtp(26, 10));
  assert.throws(() => coordToGtp(3, 0));
});

