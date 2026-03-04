const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toStringOrEmpty = (value) => (typeof value === "string" ? value : "");
const clampString = (value, max = 2048) => toStringOrEmpty(value).slice(0, max);
const toBoolOrUndefined = (value) =>
  typeof value === "undefined" ? undefined : Boolean(value);

const normalizeAction = (action) => {
  if (!isObject(action)) return {};
  const type = clampString(action.type, 64);
  const next = { type };
  if (type === "place") {
    next.x = action.x;
    next.y = action.y;
  }
  return next;
};

export const validateInboundMessage = (rawMessage) => {
  if (!isObject(rawMessage)) {
    return { ok: false, error: "invalid message object" };
  }
  const type = clampString(rawMessage.type, 64);
  if (!type) {
    return { ok: false, error: "missing type" };
  }

  const base = {
    type,
    userId: clampString(rawMessage.userId, 128),
  };

  if (type === "authLogin") {
    const provider = clampString(rawMessage.provider, 32).toLowerCase();
    return {
      ok: true,
      message: {
        ...base,
        provider,
        guestId: clampString(rawMessage.guestId, 128),
        idToken: clampString(rawMessage.idToken, 4096),
      },
    };
  }

  if (type === "hello" || type === "logout") {
    return { ok: true, message: base };
  }

  if (
    type === "enterLobby" ||
    type === "joinRoom" ||
    type === "spectateRoom" ||
    type === "leaveRoom" ||
    type === "startGame" ||
    type === "startAiGame" ||
    type === "startAiVsAiGame" ||
    type === "setSpectatorChat" ||
    type === "loadKifu"
  ) {
    return {
      ok: true,
      message: {
        ...base,
        roomName: clampString(rawMessage.roomName, 120),
        title: clampString(rawMessage.title, 128),
        ruleset: clampString(rawMessage.ruleset, 32),
        difficulty: clampString(rawMessage.difficulty, 32),
        styleMode: clampString(rawMessage.styleMode, 32),
        blackStyleMode: clampString(rawMessage.blackStyleMode, 32),
        whiteStyleMode: clampString(rawMessage.whiteStyleMode, 32),
        aiColor: clampString(rawMessage.aiColor, 16),
        randomizeColors: toBoolOrUndefined(rawMessage.randomizeColors),
        enabled: toBoolOrUndefined(rawMessage.enabled),
        history: rawMessage.history,
        review: rawMessage.review,
        komi: rawMessage.komi,
      },
    };
  }

  if (type === "gameAction") {
    return {
      ok: true,
      message: {
        ...base,
        roomName: clampString(rawMessage.roomName, 120),
        action: normalizeAction(rawMessage.action),
      },
    };
  }

  if (type === "chatSend") {
    return {
      ok: true,
      message: {
        ...base,
        scope: clampString(rawMessage.scope, 16),
        roomId: clampString(rawMessage.roomId, 120),
        text: clampString(rawMessage.text, 4096),
      },
    };
  }

  return { ok: false, error: "unsupported type" };
};

