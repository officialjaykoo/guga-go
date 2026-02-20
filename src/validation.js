const allowedPattern = /^[A-Za-z0-9_가-힣]+$/;
const blacklistPattern = /[<>{}[\]\\/|'"`;:$%()^*+=!?@#~]/;

export function validateName(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return { ok: false, reason: "empty" };
  }
  if (!allowedPattern.test(trimmed)) {
    return { ok: false, reason: "format" };
  }
  if (blacklistPattern.test(trimmed)) {
    return { ok: false, reason: "blacklist" };
  }
  return { ok: true, value: trimmed };
}
