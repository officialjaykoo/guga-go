import test from "node:test";
import assert from "node:assert/strict";
import { validateInboundMessage } from "../server/messageSchema.js";

test("validateInboundMessage accepts authLogin guest", () => {
  const result = validateInboundMessage({
    type: "authLogin",
    provider: "guest",
    guestId: "1K_GUEST1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.message.provider, "guest");
});

test("validateInboundMessage rejects unsupported type", () => {
  const result = validateInboundMessage({
    type: "unknownType",
  });
  assert.equal(result.ok, false);
});

