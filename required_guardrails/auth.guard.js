import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGuest } from "../server/experimental/auth.js";

test("normalizeGuest returns protocol-safe userId", () => {
  const profile = normalizeGuest("9K_GUEST2");
  assert.equal(profile?.provider, "guest");
  assert.equal(profile?.userId, "9K_GUEST2");
});

test("normalizeGuest rejects invalid names", () => {
  const profile = normalizeGuest("<bad>");
  assert.equal(profile, null);
});

