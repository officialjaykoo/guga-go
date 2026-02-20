export async function verifyGoogleIdToken(idToken) {
  // TODO: wire google-auth-library and verify token.
  // Return { id, name, email, avatarUrl, provider: "google" } on success.
  if (!idToken) {
    return null;
  }
  return null;
}

export function normalizeGuest(userId) {
  const trimmed = String(userId || "").trim();
  if (!trimmed) {
    return null;
  }
  return { id: `guest:${trimmed}`, name: trimmed, provider: "guest" };
}
