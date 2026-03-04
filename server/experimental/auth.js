import { validateName } from "../../shared/common/validation.js";

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo";

const normalizeGooglePicture = (picture) =>
  typeof picture === "string" && picture.trim() ? picture.trim() : "";
const toSafeUserToken = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
const buildGoogleUserId = ({ sub, email, name }) => {
  const emailHead = String(email || "").split("@")[0] || "";
  const base =
    toSafeUserToken(name) || toSafeUserToken(emailHead) || `GOOGLE_${String(sub).slice(-8)}`;
  const suffix = String(sub || "").slice(-6).toUpperCase();
  return toSafeUserToken(`${base}_${suffix}`) || `GOOGLE_${suffix || "USER"}`;
};

export async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(
      `${GOOGLE_TOKEN_INFO_URL}?id_token=${encodeURIComponent(token)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const sub = String(data?.sub || "").trim();
    const email = String(data?.email || "").trim();
    const name = String(data?.name || email || "").trim();
    const aud = String(data?.aud || "").trim();
    const expectedAud = String(process.env.GOOGLE_CLIENT_ID || "").trim();
    if (!sub) return null;
    if (expectedAud && aud && aud !== expectedAud) return null;
    return {
      id: `google:${sub}`,
      userId: buildGoogleUserId({ sub, email, name }),
      name: name || "google_user",
      email,
      avatarUrl: normalizeGooglePicture(data?.picture),
      provider: "google",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeGuest(userId) {
  const result = validateName(userId);
  if (!result.ok) return null;
  return {
    id: `guest:${result.value}`,
    userId: result.value,
    name: result.value,
    provider: "guest",
  };
}


