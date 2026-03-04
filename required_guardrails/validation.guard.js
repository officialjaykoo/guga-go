import test from "node:test";
import assert from "node:assert/strict";
import { validateName } from "../shared/common/validation.js";

test("validateName accepts korean and alnum underscore", () => {
  assert.equal(validateName("\uAD6C\uAC00\uACE0123").ok, true);
  assert.equal(validateName("guest_1").ok, true);
});

test("validateName rejects special characters", () => {
  assert.equal(validateName("<bad>").ok, false);
  assert.equal(validateName("has space").ok, false);
});
