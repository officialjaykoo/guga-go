import { WebSocketServer } from "ws";
import fs from "node:fs";
import path from "node:path";
import {
  GtpClient,
  gtpToCoord,
  sendWithRetry as sendWithRetryBase,
  setupKatagoPosition,
} from "../shared/ai/katagoGtp.js";
import {
  createInitialState,
  passTurn,
  placeStone,
  resign,
  scoreNow,
} from "../shared/game/engine.js";
import {
  loadIndependentModel,
  pickIndependentMove,
} from "../shared/ai/independentAi.js";
import { getDifficultyParams } from "./aiDifficulty.js";
import { validateName } from "../shared/common/validation.js";
import { initDb, upsertUser } from "./experimental/db.js";
import { normalizeGuest, verifyGoogleIdToken } from "./experimental/auth.js";
import { validateInboundMessage } from "./messageSchema.js";

// -----------------------------------------------------------------------------
// Core Configuration
// -----------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 5174;
const BOARD = { columns: 19, rows: 13 };
const AI_LABELS = {
  intro: "Beginner",
  low: "Novice",
  mid: "Intermediate",
  high: "Advanced",
  master: "Master",
  god: "God",
};
const VALID_RULESETS = new Set(["korean", "japanese", "chinese"]);
const VALID_DIFFICULTIES = new Set(Object.keys(AI_LABELS));
const MAX_CHAT_TEXT = 300;
const MAX_ROOM_TITLE = 32;
const MAX_HISTORY_LENGTH = BOARD.columns * BOARD.rows + 20;
const BROADCAST_COALESCE_MS =
  Number(process.env.BROADCAST_COALESCE_MS) || 100;
let aiCounter = 0;

// -----------------------------------------------------------------------------
// In-Memory Server State
// -----------------------------------------------------------------------------
const state = {
  rooms: [],
  waitingUsers: [],
  nextRoomId: 1,
  chat: { channels: {} },
  updatedAt: Date.now(),
};
initDb();

// -----------------------------------------------------------------------------
// Engine / KataGo Runtime Settings
// -----------------------------------------------------------------------------
const TIMER_PERIOD_MS = 30000;
const TIMER_MAX_LIVES = 3;
const AI_TURN_PERIOD_MS = Number(process.env.AI_TURN_PERIOD_MS) || 7000;
const KATAGO_PATH = process.env.KATAGO_PATH;
const KATAGO_CONFIG = process.env.KATAGO_CONFIG;
const KATAGO_MODEL = process.env.KATAGO_MODEL;
const KATAGO_ENABLED = Boolean(KATAGO_PATH && KATAGO_CONFIG && KATAGO_MODEL);
const KATAGO_INTERNAL_KOMI = Number(process.env.KATAGO_INTERNAL_KOMI);
const SERVER_KOMI = Number.isFinite(Number(process.env.KOMI))
  ? Number(process.env.KOMI)
  : 0;
const KATAGO_ANALYSIS_ENABLED =
  KATAGO_ENABLED && process.env.KATAGO_ANALYSIS === "1";
const KATAGO_ALLOW_RECT = process.env.KATAGO_ALLOW_RECT !== "0";
const KATAGO_ANALYSIS_MIN_MOVES =
  Number(process.env.KATAGO_ANALYSIS_MIN_MOVES) || 50;
const KATAGO_ANALYSIS_INTERVAL_MS =
  Number(process.env.KATAGO_ANALYSIS_INTERVAL_MS) || 4000;
const KATAGO_MOVE_TIMEOUT_MS =
  Number(process.env.KATAGO_MOVE_TIMEOUT_MS) || 6000;
const KATAGO_ANALYSIS_TIMEOUT_MS =
  Number(process.env.KATAGO_ANALYSIS_TIMEOUT_MS) || 8000;
const KATAGO_STARTUP_DELAY_MS =
  Number(process.env.KATAGO_STARTUP_DELAY_MS) || 8000;
const KATAGO_MAX_TIMEOUTS = Number(process.env.KATAGO_MAX_TIMEOUTS) || 10;
const KATAGO_RETRY_TIMEOUT_MULT =
  Number(process.env.KATAGO_RETRY_TIMEOUT_MULT) || 2;
const KATAGO_GREEN_AS = (process.env.KATAGO_GREEN_AS || "black").toLowerCase();
const AI_ENGINE_MODE = String(process.env.AI_ENGINE_MODE || "katago")
  .trim()
  .toLowerCase();
const AI_IS_INDEPENDENT = AI_ENGINE_MODE === "independent";
const AI_INDEPENDENT_MODEL_PATH = path.resolve(
  process.cwd(),
  process.env.AI_INDEPENDENT_MODEL_PATH || "server/data/independent_model_v2.json"
);
const AI_RUNTIME_METRICS_PATH = path.resolve(
  process.cwd(),
  process.env.AI_RUNTIME_METRICS_PATH || "server/data/ai_runtime_metrics.jsonl"
);
const AI_STYLE_MODE = "native";
const AI_STYLE_BLACK = "native";
const AI_STYLE_WHITE = "native";
const AI_STYLE_LABEL = "N4TIVE";
const KATAGO_RULES_COMMAND = String(
  process.env.KATAGO_RULES_COMMAND || "auto"
)
  .trim()
  .toLowerCase();
const appendRuntimeMetric = (payload) => {
  try {
    const dir = path.dirname(AI_RUNTIME_METRICS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      AI_RUNTIME_METRICS_PATH,
      `${JSON.stringify(payload)}\n`,
      "utf8"
    );
  } catch {
    // ignore metric write failures
  }
};

// -----------------------------------------------------------------------------
// KataGo Client Lifecycle
// -----------------------------------------------------------------------------
const getModelLabel = () => {
  if (!KATAGO_MODEL) return "model";
  const trimmed = String(KATAGO_MODEL).replace(/\\/g, "/");
  const base = trimmed.split("/").pop() || "model";
  return base.replace(/\.txt(\.gz)?$/i, "").replace(/\.bin(\.gz)?$/i, "");
};

const sendWithRetry = (client, command, timeoutMs) =>
  sendWithRetryBase(client, command, timeoutMs, KATAGO_RETRY_TIMEOUT_MULT);
const setupKatagoPositionSafe = (client, history, ruleset, komiInternal) =>
  setupKatagoPosition(client, history, ruleset, komiInternal, {
    board: BOARD,
    allowRect: KATAGO_ALLOW_RECT,
    rulesCommand: KATAGO_RULES_COMMAND,
    setupTimeoutMs: 800,
    greenAs: KATAGO_GREEN_AS,
    sendCommand: (command, timeoutMs) =>
      sendWithRetry(client, command, timeoutMs),
  });

let katagoClient = null;
let katagoAvailable = true;
let katagoChain = Promise.resolve();
let independentModel = null;
let independentModelMtime = 0;

const withKatagoLock = (task) => {
  const run = () => Promise.resolve().then(task);
  const result = katagoChain.then(run, run);
  katagoChain = result.catch(() => {});
  return result;
};

const getKataGoClient = () => {
  if (!KATAGO_ENABLED || !katagoAvailable) return null;
  if (!katagoClient) {
    katagoClient = new GtpClient({
      command: KATAGO_PATH,
      args: ["gtp", "-config", KATAGO_CONFIG, "-model", KATAGO_MODEL],
      name: "katago",
      startupDelayMs: KATAGO_STARTUP_DELAY_MS,
      maxTimeouts: KATAGO_MAX_TIMEOUTS,
      onExit: () => {
        katagoAvailable = false;
      },
      onTimeoutLimit: () => {
        katagoAvailable = false;
      },
    });
    katagoClient.start();
  }
  return katagoClient;
};

let katagoWarmupStarted = false;
const warmupKataGo = () => {
  if (!KATAGO_ENABLED || katagoWarmupStarted) return;
  katagoWarmupStarted = true;
  withKatagoLock(async () => {
    const client = getKataGoClient();
    if (!client) return;
    try {
      const displayKomi = getKomiForRuleset("korean");
      const internalKomi = getInternalKomi(displayKomi);
      const history = [createInitialState("korean", displayKomi)];
      const ok = await setupKatagoPositionSafe(
        client,
        history,
        "korean",
        internalKomi
      );
      if (!ok) return;
      try {
        await client.send("kata-set-param maxVisits 1", 800);
        await client.send("kata-set-param maxTime 0.01", 800);
      } catch {
        // ignore warmup param failures
      }
      await client.send("genmove black", KATAGO_MOVE_TIMEOUT_MS);
    } catch (err) {
      console.warn("[katago] warmup failed", err?.message || err);
    }
  });
};

const getKomiForRuleset = () => SERVER_KOMI;
const getInternalKomi = (displayKomi) => {
  if (Number.isFinite(KATAGO_INTERNAL_KOMI)) return KATAGO_INTERNAL_KOMI;
  if (Number.isFinite(displayKomi) && displayKomi === 0) return 6.5;
  return displayKomi;
};
const adjustScoreLead = (scoreLead, displayKomi, internalKomi) => {
  if (!Number.isFinite(scoreLead)) return scoreLead;
  const display = Number.isFinite(displayKomi) ? displayKomi : 0;
  const internal = Number.isFinite(internalKomi) ? internalKomi : display;
  return scoreLead + (internal - display);
};

const applyKatagoDifficulty = async (client, difficulty) => {
  const params = getDifficultyParams(difficulty);
  if (!params) return;
  const setParam = async (name, value) => {
    try {
      await client.send(`kata-set-param ${name} ${value}`, 800);
    } catch {
      // ignore param failures to keep gameplay running
    }
  };
  await setParam("maxVisits", params.maxVisits);
  await setParam("maxTime", params.maxTime);
};

const ownershipToTerritory = (
  ownership,
  columns,
  rows,
  stoneMap,
  neutralSet,
  threshold = 0.05
) => {
  if (!Array.isArray(ownership)) return null;
  if (ownership.length !== columns * rows) return null;
  const points = [];
  for (let idx = 0; idx < ownership.length; idx += 1) {
    const value = ownership[idx];
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value) < threshold) continue;
    const x = (idx % columns) + 1;
    const y = Math.floor(idx / columns) + 1;
    const key = `${x},${y}`;
    if (stoneMap?.has(key)) continue;
    if (neutralSet?.has(key)) continue;
    points.push({ x, y, owner: value > 0 ? "black" : "white" });
  }
  return points;
};

const getNeighbors = (x, y, columns, rows) => {
  const neighbors = [];
  if (x > 1) neighbors.push([x - 1, y]);
  if (x < columns) neighbors.push([x + 1, y]);
  if (y > 1) neighbors.push([x, y - 1]);
  if (y < rows) neighbors.push([x, y + 1]);
  return neighbors;
};

const buildStoneMap = (stones) => {
  const map = new Map();
  (stones || []).forEach((stone) => {
    map.set(`${stone.x},${stone.y}`, stone.color);
  });
  return map;
};

  const collectNeutralEmptyPoints = (stones, columns, rows, stoneMap) => {
    // Green stones act as walls; they do not neutralize nearby territory.
    return new Set();
  };

const normalizeOwnershipForRules = (
  ownership,
  columns,
  rows,
  stones,
  threshold = 0.05
) => {
  if (!Array.isArray(ownership)) return null;
  if (ownership.length !== columns * rows) return null;
  const stoneMap = buildStoneMap(stones);
  const neutralSet = collectNeutralEmptyPoints(stones, columns, rows, stoneMap);
  const adjusted = ownership.slice();
  let emptyCount = 0;
  let uncertainCount = 0;
  for (let idx = 0; idx < adjusted.length; idx += 1) {
    const x = (idx % columns) + 1;
    const y = Math.floor(idx / columns) + 1;
    const key = `${x},${y}`;
    const color = stoneMap.get(key);
    if (color) {
      if (color === "green") adjusted[idx] = 0;
      continue;
    }
    emptyCount += 1;
    if (neutralSet.has(key)) {
      adjusted[idx] = 0;
      uncertainCount += 1;
      continue;
    }
    if (Math.abs(adjusted[idx]) < threshold) {
      uncertainCount += 1;
    }
  }
  return {
    ownership: adjusted,
    stoneMap,
    neutralSet,
    emptyCount,
    uncertainCount,
    threshold,
  };
};

const parseKataGoAnalyzeText = (lines, columns, rows) => {
  const joined = lines.join(" ");
  const tokens = joined.split(/\s+/).filter(Boolean);
  let scoreLead = null;
  let ownership = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i].toLowerCase();
    if (token === "scorelead" && i + 1 < tokens.length) {
      const value = Number(tokens[i + 1]);
      if (Number.isFinite(value)) {
        scoreLead = value;
      }
    }
    if (token === "ownership") {
      const values = [];
      for (let j = i + 1; j < tokens.length; j += 1) {
        const num = Number(tokens[j]);
        if (!Number.isFinite(num)) break;
        values.push(num);
        if (values.length >= columns * rows) break;
      }
      if (values.length === columns * rows) {
        ownership = values;
      }
      break;
    }
  }
  return { scoreLead, ownership };
};

const extractAnalysisFromLines = (lines, columns, rows, stones) => {
  if (!Array.isArray(lines)) return null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const ownership =
        parsed.ownership ||
        parsed?.analysis?.ownership ||
        parsed?.rootInfo?.ownership;
      const scoreLead =
        parsed.scoreLead ||
        parsed?.analysis?.scoreLead ||
        parsed?.rootInfo?.scoreLead ||
        parsed?.rootInfo?.scoreMean;
      if (ownership) {
        const normalized = normalizeOwnershipForRules(
          ownership,
          columns,
          rows,
          stones,
          0.05
        );
        const finalOwnership = normalized?.ownership || ownership;
        return {
          ownership: finalOwnership,
          scoreLead: Number.isFinite(scoreLead) ? scoreLead : null,
          territory: ownershipToTerritory(
            finalOwnership,
            columns,
            rows,
            normalized?.stoneMap,
            normalized?.neutralSet,
            normalized?.threshold || 0.05
          ),
          emptyCount: normalized?.emptyCount || 0,
          uncertainCount: normalized?.uncertainCount || 0,
        };
      }
    } catch {
      continue;
    }
  }
  const parsed = parseKataGoAnalyzeText(lines, columns, rows);
  if (!parsed.ownership && !Number.isFinite(parsed.scoreLead)) {
    return null;
  }
  if (parsed.ownership) {
    const normalized = normalizeOwnershipForRules(
      parsed.ownership,
      columns,
      rows,
      stones,
      0.05
    );
    const finalOwnership = normalized?.ownership || parsed.ownership;
    return {
      ownership: finalOwnership,
      scoreLead: Number.isFinite(parsed.scoreLead) ? parsed.scoreLead : null,
      territory: ownershipToTerritory(
        finalOwnership,
        columns,
        rows,
        normalized?.stoneMap,
        normalized?.neutralSet,
        normalized?.threshold || 0.05
      ),
      emptyCount: normalized?.emptyCount || 0,
      uncertainCount: normalized?.uncertainCount || 0,
    };
  }
  return {
    ownership: null,
    scoreLead: Number.isFinite(parsed.scoreLead) ? parsed.scoreLead : null,
    territory: null,
    emptyCount: 0,
    uncertainCount: 0,
  };
};

const katagoGenMove = (history, ruleset, color, difficulty, komiDisplay) =>
  withKatagoLock(async () => {
    const client = getKataGoClient();
    if (!client) return null;
    const displayKomi = Number.isFinite(komiDisplay)
      ? komiDisplay
      : getKomiForRuleset(ruleset);
    const internalKomi = getInternalKomi(displayKomi);
    const ok = await setupKatagoPositionSafe(
      client,
      history,
      ruleset,
      internalKomi
    );
    if (!ok) return null;
    await applyKatagoDifficulty(client, difficulty);
    const response = await client.send(
      `genmove ${color}`,
      KATAGO_MOVE_TIMEOUT_MS
    );
    const raw = response.lines.join(" ").trim();
    const parsed = gtpToCoord(raw);
    if (parsed && parsed !== "resign" && Array.isArray(client.positionMoves)) {
      if (parsed === "pass") {
        client.positionMoves = [...client.positionMoves, { color, pass: true }];
      } else if (parsed?.x && parsed?.y) {
        client.positionMoves = [
          ...client.positionMoves,
          { color, x: parsed.x, y: parsed.y },
        ];
      }
    }
    return parsed;
  });

const katagoAnalyze = (history, ruleset, color, stones, difficulty, komiDisplay) =>
  withKatagoLock(async () => {
    const client = getKataGoClient();
    if (!client) return null;
    const displayKomi = Number.isFinite(komiDisplay)
      ? komiDisplay
      : getKomiForRuleset(ruleset);
    const internalKomi = getInternalKomi(displayKomi);
    const ok = await setupKatagoPositionSafe(
      client,
      history,
      ruleset,
      internalKomi
    );
    if (!ok) return null;
    await applyKatagoDifficulty(client, difficulty);
    const response = await client.send(
      `kata-search_analyze ${color} ownership true`,
      KATAGO_ANALYSIS_TIMEOUT_MS
    );
    const analysis = extractAnalysisFromLines(
      response.lines,
      BOARD.columns,
      BOARD.rows,
      stones
    );
    if (!analysis) return null;
    return {
      ...analysis,
      scoreLead: adjustScoreLead(analysis.scoreLead, displayKomi, internalKomi),
    };
  });

const normalizeUser = (value) => String(value || "").trim();
const normalizeText = (value, maxLen = 200) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
const normalizeRuleset = (value, fallback = "korean") => {
  const candidate = normalizeUser(value).toLowerCase();
  return VALID_RULESETS.has(candidate) ? candidate : fallback;
};
const normalizeDifficulty = (value, fallback = "god") => {
  const candidate = normalizeUser(value).toLowerCase();
  return VALID_DIFFICULTIES.has(candidate) ? candidate : fallback;
};
const parseUserId = (value) => {
  const result = validateName(value);
  return result.ok ? result.value : "";
};
const parseCoord = (value, max) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  if (numeric < 1 || numeric > max) return null;
  return numeric;
};
const getClientSessionUserId = (ws, clientsMap) =>
  parseUserId(clientsMap.get(ws)?.userId);
const buildUsedUserIdSet = (clientsMap) => {
  const used = new Set();
  state.waitingUsers.forEach((id) => used.add(id));
  state.rooms.forEach((room) => {
    room.players.forEach((id) => used.add(id));
    (room.spectators || []).forEach((id) => used.add(id));
    if (room.owner) used.add(room.owner);
  });
  clientsMap.forEach((info) => {
    const id = parseUserId(info?.userId);
    if (id) used.add(id);
  });
  return used;
};
const assignUniqueUserId = (baseId, clientsMap) => {
  const base = parseUserId(baseId);
  if (!base) return "";
  const used = buildUsedUserIdSet(clientsMap);
  if (!used.has(base)) return base;
  for (let i = 2; i <= 9999; i += 1) {
    const next = `${base}_${i}`;
    if (!used.has(next)) return next;
  }
  return "";
};
const isUserInRoom = (room, userId) => {
  if (!room || !userId) return false;
  if (room.players.includes(userId)) return true;
  if (Array.isArray(room.spectators) && room.spectators.includes(userId)) return true;
  return false;
};
const isValidHistoryPayload = (history) => {
  if (!Array.isArray(history)) return false;
  if (history.length < 1 || history.length > MAX_HISTORY_LENGTH) return false;
  return history.every((stateItem) => {
    if (!stateItem || typeof stateItem !== "object") return false;
    const stones = Array.isArray(stateItem.stones) ? stateItem.stones : [];
    if (stones.length > BOARD.columns * BOARD.rows) return false;
    return stones.every((stone) => {
      const x = parseCoord(stone?.x, BOARD.columns);
      const y = parseCoord(stone?.y, BOARD.rows);
      if (!x || !y) return false;
      const color = normalizeUser(stone?.color).toLowerCase();
      return color === "black" || color === "white" || color === "green";
    });
  });
};

const sendNotice = (ws, text) => {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "notice", text }));
  } catch {
    // ignore send failures
  }
};
const sendAuthOk = (ws, payload) => {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "authOk", ...payload }));
  } catch {
    // ignore send failures
  }
};

const clearRoomChat = (roomName) => {
  const lobbyKey = `lobby:${roomName}`;
  const gameKey = `game:${roomName}`;
  delete state.chat.channels[lobbyKey];
  delete state.chat.channels[gameKey];
};

const removeUserEverywhere = (userId, addToWaiting, opts = {}) => {
  const {
    preserveAiRooms = true,
    reason = "unknown",
  } = opts;
  const cleanedRooms = state.rooms
    .map((room) => {
      const hasSpectator = Array.isArray(room.spectators)
        ? room.spectators.includes(userId)
        : false;
      if (!room.players.includes(userId) && room.owner !== userId && !hasSpectator) {
        return room;
      }
      const nextSpectators = Array.isArray(room.spectators)
        ? room.spectators.filter((spectator) => spectator !== userId)
        : [];
      if (room.ai?.enabled) {
        if (preserveAiRooms) {
          console.info(
            `[ai-room] preserve room on removeUserEverywhere user=${userId} reason=${reason} room=${room.name}`
          );
          return { ...room, spectators: nextSpectators };
        }
        console.info(
          `[ai-room] remove room on removeUserEverywhere user=${userId} reason=${reason} room=${room.name}`
        );
        clearRoomChat(room.name);
        return null;
      }
      const nextPlayers = room.players.filter((player) => player !== userId);
      const nextRoom = {
        ...room,
        players: nextPlayers,
        spectators: nextSpectators,
        owner: room.owner === userId ? nextPlayers[0] || "" : room.owner,
        status: nextPlayers.length < 2 ? "waiting" : room.status,
        game: nextPlayers.length < 2 ? null : room.game,
      };
      if (nextPlayers.length === 0) {
        clearRoomChat(room.name);
        return null;
      }
      return nextRoom;
    })
    .filter(Boolean);

  state.rooms = cleanedRooms;
  state.waitingUsers = addToWaiting
    ? Array.from(new Set([...state.waitingUsers.filter((u) => u !== userId), userId]))
    : state.waitingUsers.filter((u) => u !== userId);
};

const ensureWaiting = (userId) => {
  if (!state.waitingUsers.includes(userId)) {
    state.waitingUsers.push(userId);
  }
};

const getRoom = (name) => state.rooms.find((room) => room.name === name);

const getPlayerColor = (room, userId) => {
  if (!room) return null;
  if (room.players[0] === userId) return "black";
  if (room.players[1] === userId) return "white";
  return null;
};

const pushNotice = (room, text) => {
  if (!room.game) return;
  if (!room.game.notifications) {
    room.game.notifications = [];
  }
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    time: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
  };
  room.game.notifications = [...room.game.notifications, entry].slice(-30);
};

const makeAiName = () => AI_STYLE_LABEL;

const isAiTurn = (room, color) => {
  if (!room.ai?.enabled) return false;
  if (room.ai.vsAi) return true;
  return room.ai.color === color;
};

const getAiConfig = (room, color) => {
  if (!room.ai?.enabled) return null;
  if (room.ai.vsAi) {
    return color === "black" ? room.ai.black : room.ai.white;
  }
  return room.ai.color === color ? room.ai : null;
};

const getLeadForAi = (analysis, aiColor) => {
  if (!analysis || !Number.isFinite(analysis.scoreLead)) return null;
  return aiColor === "black" ? analysis.scoreLead : -analysis.scoreLead;
};

const getIndependentModel = () => {
  try {
    const stat = fs.statSync(AI_INDEPENDENT_MODEL_PATH);
    if (!independentModel || stat.mtimeMs !== independentModelMtime) {
      independentModel = loadIndependentModel(AI_INDEPENDENT_MODEL_PATH);
      independentModelMtime = stat.mtimeMs;
    }
  } catch {
    if (!independentModel) {
      independentModel = loadIndependentModel(AI_INDEPENDENT_MODEL_PATH);
      independentModelMtime = 0;
    }
  }
  return independentModel;
};
const getWinnerColorFromState = (stateItem) => {
  const score = stateItem?.score;
  if (score?.winner === "black" || score?.winner === "white") {
    return score.winner;
  }
  if (Number.isFinite(score?.black) && Number.isFinite(score?.white)) {
    if (score.black > score.white) return "black";
    if (score.white > score.black) return "white";
  }
  return null;
};
const maybeLogAiGameResult = (room, now = Date.now()) => {
  if (!room?.ai?.enabled || !room?.game?.history?.length) return;
  if (room.game.resultLoggedAt) return;
  const current = room.game.history[room.game.history.length - 1];
  if (!current?.over) return;
  const payload = {
    ts: now,
    room: room.name,
    ruleset: room.ruleset || null,
    ai: {
      vsAi: Boolean(room.ai?.vsAi),
      difficulty: room.ai?.difficulty || null,
      styleMode: room.ai?.styleMode || null,
      blackStyle: room.ai?.black?.styleMode || null,
      whiteStyle: room.ai?.white?.styleMode || null,
    },
    result: {
      winner: getWinnerColorFromState(current),
      reason: current?.score?.reason || null,
      black: Number.isFinite(current?.score?.black) ? current.score.black : null,
      white: Number.isFinite(current?.score?.white) ? current.score.white : null,
      moveCount: Math.max(0, room.game.history.length - 1),
      durationMs:
        Number.isFinite(room.game.startedAt) && room.game.startedAt > 0
          ? Math.max(0, now - room.game.startedAt)
          : null,
    },
  };
  appendRuntimeMetric(payload);
  room.game.resultLoggedAt = now;
};

const shouldAiResign = (state, aiColor, analysis) => {
  const moveCount = state.stones?.length || 0;
  if (moveCount < 110) return false;
  const lead = getLeadForAi(analysis, aiColor);
  if (!Number.isFinite(lead)) return false;
  const uncertainRatio = analysis?.uncertainRatio ?? 1;
  if (lead <= -30) return true;
  if (lead <= -20 && uncertainRatio < 0.12 && moveCount >= 130) return true;
  return false;
};

const shouldAiScore = (state, aiColor, analysis) => {
  const moveCount = state.stones?.length || 0;
  if (moveCount < 100) return false;
  if (!analysis) return false;
  const uncertainRatio = analysis.uncertainRatio ?? 1;
  if (uncertainRatio <= 0.08) return true;
  if (moveCount >= 140 && uncertainRatio <= 0.15) return true;
  return false;
};

const aiMoveInFlight = new Set();
const analysisInFlight = new Set();

const applyNextState = (room, current, next) => {
  if (!next || next === current) return false;
  room.game.history = [...room.game.history, next];
  if (room.game.timer && next.turn !== current.turn) {
    room.game.timer.turnStartAt = Date.now();
    room.game.timer.remainingMs = room.game.timer.periodMs;
  }
  return true;
};

const pickRandomLegalState = (state) => {
  if (!state) return null;
  const total = BOARD.columns * BOARD.rows;
  const start = Math.floor(Math.random() * total);
  for (let i = 0; i < total; i += 1) {
    const idx = (start + i) % total;
    const x = (idx % BOARD.columns) + 1;
    const y = Math.floor(idx / BOARD.columns) + 1;
    const placed = placeStone(state, x, y);
    if (placed !== state) {
      return placed;
    }
  }
  return passTurn(state);
};

const requestAiMove = async (room, current) => {
  if (AI_IS_INDEPENDENT) {
    try {
      const aiConfig = getAiConfig(room, current.turn);
      const difficulty = aiConfig?.difficulty || room.ai?.difficulty || "god";
      const model = getIndependentModel();
      const move = pickIndependentMove(current, {
        model,
        board: BOARD,
        difficulty,
      });
      if (move === "pass" || move?.pass) return passTurn(current);
      if (move && Number.isFinite(move.x) && Number.isFinite(move.y)) {
        const placed = placeStone(current, move.x, move.y);
        if (placed !== current) return placed;
      }
      return pickRandomLegalState(current);
    } catch (err) {
      console.warn("[independent] move error", err.message);
      return pickRandomLegalState(current);
    }
  }
  if (!KATAGO_ENABLED || !katagoAvailable) {
    console.warn("[katago] not configured");
    return null;
  }
  try {
    const aiConfig = getAiConfig(room, current.turn);
    const difficulty = aiConfig?.difficulty || room.ai?.difficulty || "god";
    const komiDisplay = Number.isFinite(current?.komi)
      ? current.komi
      : getKomiForRuleset(current.ruleset);
    const move = await katagoGenMove(
      room.game.history,
      current.ruleset,
      current.turn,
      difficulty,
      komiDisplay
    );
    if (move === "pass") return passTurn(current);
    if (move === "resign") return resign(current, current.turn);
    if (move && move.x && move.y) {
      const placed = placeStone(current, move.x, move.y);
      if (placed !== current) return placed;
    }
    console.warn("[ai] no KataGo move; using random legal fallback");
    return pickRandomLegalState(current);
  } catch (err) {
    console.warn("[katago] move error", err.message);
    console.warn("[ai] move failed; using random legal fallback");
    return pickRandomLegalState(current);
  }
};

const requestAnalysis = async (room, current) => {
  if (AI_IS_INDEPENDENT) return null;
  if (!KATAGO_ENABLED || !KATAGO_ANALYSIS_ENABLED || !katagoAvailable) {
    return null;
  }
  if (BOARD.columns !== BOARD.rows && !KATAGO_ALLOW_RECT) return null;
  if ((current.stones?.length || 0) < KATAGO_ANALYSIS_MIN_MOVES) return null;
    const difficulty = room.ai?.difficulty || "god";
    const komiDisplay = Number.isFinite(current?.komi)
      ? current.komi
      : getKomiForRuleset(current.ruleset);
    const result = await katagoAnalyze(
      room.game.history,
      current.ruleset,
      current.turn,
      current.stones || [],
      difficulty,
      komiDisplay
    );
  if (!result) return null;
  const emptyCount = result.emptyCount || 0;
  const uncertainCount = result.uncertainCount || 0;
  const uncertainRatio = emptyCount ? uncertainCount / emptyCount : 1;
  return {
    source: "katago",
    territory: result.territory || null,
    scoreLead: result.scoreLead,
    emptyCount,
    uncertainCount,
    uncertainRatio,
    updatedAt: Date.now(),
    moveCount: current.stones?.length || 0,
  };
};

let broadcastTimer = null;
const flushBroadcastState = (wss) => {
  state.updatedAt = Date.now();
  const payload = JSON.stringify({
    type: "state",
    state,
    serverTime: Date.now(),
  });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
};
const broadcastState = (wss, { immediate = false } = {}) => {
  if (immediate) {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer);
      broadcastTimer = null;
    }
    flushBroadcastState(wss);
    return;
  }
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    flushBroadcastState(wss);
  }, BROADCAST_COALESCE_MS);
};
const emitChatEvent = (wss, clientsMap, scope, roomId, entry) => {
  const payload = JSON.stringify({
    type: "chatEvent",
    scope,
    roomId,
    entry,
  });
  wss.clients.forEach((clientWs) => {
    if (clientWs.readyState !== 1) return;
    if (scope === "game") {
      const room = getRoom(roomId);
      const clientUser = getClientSessionUserId(clientWs, clientsMap);
      if (!room || !isUserInRoom(room, clientUser)) return;
    }
    clientWs.send(payload);
  });
};

const wss = new WebSocketServer({ port: PORT });
const clients = new Map();

wss.on("connection", (ws) => {
  clients.set(ws, { userId: "" });
  ws.send(JSON.stringify({ type: "state", state, serverTime: Date.now() }));

  ws.on("message", async (raw) => {
    let parsed;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const inbound = validateInboundMessage(parsed);
    if (!inbound.ok) {
      sendNotice(ws, "Invalid request format.");
      return;
    }
    const message = inbound.message;

    const type = normalizeUser(message?.type);
    const claimedUserId = parseUserId(message?.userId);
    const sessionUserId = parseUserId(clients.get(ws)?.userId);

    if (!type) {
      return;
    }

    if (type === "authLogin") {
      const provider = normalizeUser(message?.provider).toLowerCase();
      let profile = null;
      if (provider === "guest") {
        profile = normalizeGuest(message?.guestId);
      } else if (provider === "google") {
        profile = await verifyGoogleIdToken(message?.idToken);
      }
      if (!profile) {
        sendNotice(ws, "Login failed: invalid authentication payload.");
        return;
      }
      const resolvedUserId = assignUniqueUserId(profile.userId || profile.name, clients);
      if (!resolvedUserId) {
        sendNotice(ws, "Login failed: could not allocate a user ID.");
        return;
      }
      clients.forEach((info, clientWs) => {
        if (clientWs === ws) return;
        if (parseUserId(info?.userId) !== resolvedUserId) return;
        clients.set(clientWs, { userId: "" });
        sendNotice(clientWs, "A new session for this account connected. Closing this session.");
      });
      clients.set(ws, { userId: resolvedUserId });
      upsertUser({
        ...profile,
        id: profile.id || `${provider}:${resolvedUserId}`,
        name: resolvedUserId,
      });
      removeUserEverywhere(resolvedUserId, true, {
        preserveAiRooms: true,
        reason: "authLogin",
      });
      sendAuthOk(ws, {
        userId: resolvedUserId,
        provider: profile.provider || provider,
      });
      broadcastState(wss, { immediate: true });
      return;
    }

    if (type === "enterLobby") {
      if (!claimedUserId) {
        sendNotice(ws, "Invalid user ID format.");
        return;
      }
      if (sessionUserId && sessionUserId !== claimedUserId) {
        sendNotice(ws, "Changing the session user is not allowed.");
        return;
      }
      clients.forEach((info, clientWs) => {
        if (clientWs === ws) return;
        if (parseUserId(info?.userId) !== claimedUserId) return;
        clients.set(clientWs, { userId: "" });
        sendNotice(clientWs, "A new session for this account connected. Closing this session.");
      });
      clients.set(ws, { userId: claimedUserId });
      const profile = normalizeGuest(claimedUserId);
      if (profile) {
        upsertUser(profile);
      }
      removeUserEverywhere(claimedUserId, true, {
        preserveAiRooms: true,
        reason: "enterLobby",
      });
      broadcastState(wss);
      return;
    }

    const userId = sessionUserId;
    if (!userId) {
      sendNotice(ws, "Enter the lobby first.");
      return;
    }
    if (claimedUserId && claimedUserId !== userId) {
      sendNotice(ws, "Session user does not match request user.");
      return;
    }

    if (type === "hello") {
      ensureWaiting(userId);
      broadcastState(wss);
      return;
    }

    if (type === "createRoom") {
      const title = normalizeText(message?.title, MAX_ROOM_TITLE) || "Room";
      const ruleset = normalizeRuleset(message?.ruleset, "korean");
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "createRoom" });
      const roomName = `[${state.nextRoomId}] ${title}`;
      state.nextRoomId += 1;
      state.rooms.push({
        name: roomName,
        players: [userId],
        ruleset,
        status: "waiting",
        owner: userId,
        spectators: [],
        spectatorChatEnabled: false,
        game: null,
      });
      broadcastState(wss);
      return;
    }

    if (type === "joinRoom") {
      const roomName = normalizeUser(message?.roomName);
      if (!roomName) return;
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "joinRoom" });
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) {
          return room;
        }
        const nextSpectators = Array.isArray(room.spectators)
          ? room.spectators.filter((spectator) => spectator !== userId)
          : [];
        if (room.status === "playing" || room.players.length >= 2) {
          return { ...room, spectators: nextSpectators };
        }
        if (room.players.includes(userId)) {
          return { ...room, spectators: nextSpectators };
        }
        return {
          ...room,
          players: [...room.players, userId],
          owner: room.owner || userId,
          spectators: nextSpectators,
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "spectateRoom") {
      const roomName = normalizeUser(message?.roomName);
      if (!roomName) return;
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "spectateRoom" });
      const room = getRoom(roomName);
      if (!room) return;
      if (room.players.includes(userId)) {
        broadcastState(wss);
        return;
      }
      const spectators = Array.isArray(room.spectators) ? room.spectators : [];
      if (!spectators.includes(userId)) {
        spectators.push(userId);
      }
      room.spectators = spectators;
      if (typeof room.spectatorChatEnabled !== "boolean") {
        room.spectatorChatEnabled = false;
      }
      broadcastState(wss);
      return;
    }

    if (type === "setSpectatorChat") {
      const roomName = normalizeUser(message?.roomName);
      if (!roomName) return;
      const room = getRoom(roomName);
      if (!room || room.owner !== userId) return;
      room.spectatorChatEnabled = Boolean(message?.enabled);
      broadcastState(wss);
      return;
    }

    if (type === "leaveRoom") {
      removeUserEverywhere(userId, true, { preserveAiRooms: false, reason: "leaveRoom" });
      broadcastState(wss);
      return;
    }

    if (type === "startGame") {
      const roomName = normalizeUser(message?.roomName);
      if (!roomName) return;
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) return room;
        if (room.owner !== userId) return room;
        if (room.players.length < 2) return room;
        return {
          ...room,
          status: "playing",
          ai: null,
          spectators: room.spectators || [],
          spectatorChatEnabled:
            typeof room.spectatorChatEnabled === "boolean"
              ? room.spectatorChatEnabled
              : false,
          game: {
              history: [
                createInitialState(
                  room.ruleset || "korean",
                  getKomiForRuleset()
                ),
              ],
              analysis: null,
              timer: {
              periodMs: TIMER_PERIOD_MS,
              maxLives: TIMER_MAX_LIVES,
              turnStartAt: Date.now(),
              remainingMs: TIMER_PERIOD_MS,
              lives: { black: TIMER_MAX_LIVES, white: TIMER_MAX_LIVES },
            },
            pendingUndo: null,
            pendingScore: null,
            undoUsed: false,
            undoRequests: { black: 0, white: 0 },
            notifications: [],
            startedAt: Date.now(),
            resultLoggedAt: null,
          },
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "startAiGame") {
      const roomName = normalizeUser(message?.roomName);
      const difficulty = normalizeDifficulty(message?.difficulty, "god");
      if (!roomName) return;
      if (!AI_IS_INDEPENDENT && (!KATAGO_ENABLED || !katagoAvailable)) {
        console.warn("[katago] startAiGame ignored: not configured");
        sendNotice(
          ws,
          "KataGo is not configured. Set KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL first."
        );
        return;
      }
      if (
        !AI_IS_INDEPENDENT &&
        BOARD.columns !== BOARD.rows &&
        !KATAGO_ALLOW_RECT
      ) {
        sendNotice(
          ws,
          "Current 19x13 board is restricted by KataGo. Set KATAGO_ALLOW_RECT=1."
        );
        return;
      }
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) return room;
        if (room.owner !== userId) return room;
        if (room.players.length < 1) return room;
        if (room.status === "playing") return room;
        const styleMode = AI_STYLE_MODE;
        const aiName = makeAiName();
        const shouldRandomize =
          message?.randomizeColors === undefined
            ? true
            : Boolean(message?.randomizeColors);
        const aiColor = shouldRandomize
          ? Math.random() < 0.5
            ? "black"
            : "white"
          : normalizeUser(message?.aiColor) === "black"
            ? "black"
            : "white";
        const players =
          aiColor === "black" ? [aiName, userId] : [userId, aiName];
          return {
            ...room,
            status: "playing",
            players,
            ai: {
              enabled: true,
              vsAi: false,
              color: aiColor,
              name: aiName,
              difficulty,
              styleMode,
              lastMoveAt: 0,
              },
              spectators: room.spectators || [],
            spectatorChatEnabled:
              typeof room.spectatorChatEnabled === "boolean"
                ? room.spectatorChatEnabled
                : false,
            game: {
              history: [
                createInitialState(
                  room.ruleset || "korean",
                  getKomiForRuleset()
                ),
              ],
              analysis: null,
              timer: {
                periodMs: TIMER_PERIOD_MS,
                maxLives: TIMER_MAX_LIVES,
              turnStartAt: Date.now(),
              remainingMs: TIMER_PERIOD_MS,
              lives: { black: TIMER_MAX_LIVES, white: TIMER_MAX_LIVES },
            },
            pendingUndo: null,
            pendingScore: null,
            undoUsed: false,
            undoRequests: { black: 0, white: 0 },
            notifications: [],
            startedAt: Date.now(),
            resultLoggedAt: null,
          },
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "startAiVsAiGame") {
      const roomName = normalizeUser(message?.roomName);
      const difficulty = normalizeDifficulty(message?.difficulty, "god");
      if (!roomName) return;
      if (!AI_IS_INDEPENDENT && (!KATAGO_ENABLED || !katagoAvailable)) {
        console.warn("[katago] startAiVsAiGame ignored: not configured");
        sendNotice(
          ws,
          "KataGo is not configured. Set KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL first."
        );
        return;
      }
      if (
        !AI_IS_INDEPENDENT &&
        BOARD.columns !== BOARD.rows &&
        !KATAGO_ALLOW_RECT
      ) {
        sendNotice(
          ws,
          "Current 19x13 board is restricted by KataGo. Set KATAGO_ALLOW_RECT=1."
        );
        return;
      }
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) return room;
        if (room.owner !== userId) return room;
        if (room.status === "playing") return room;
        let blackStyle = AI_STYLE_BLACK;
        let whiteStyle = AI_STYLE_WHITE;
        const shouldRandomize =
          message?.randomizeColors === undefined
            ? true
            : Boolean(message?.randomizeColors);
        if (shouldRandomize) {
          if (Math.random() < 0.5) {
            const tmp = blackStyle;
            blackStyle = whiteStyle;
            whiteStyle = tmp;
          }
        }
        const blackName = makeAiName();
        const whiteName = makeAiName();
          return {
            ...room,
            status: "playing",
            players: [blackName, whiteName],
            ai: {
              enabled: true,
              vsAi: true,
              difficulty,
                black: {
                  name: blackName,
                  difficulty,
                  styleMode: blackStyle,
                  lastMoveAt: 0,
                },
                white: {
                  name: whiteName,
                  difficulty,
                  styleMode: whiteStyle,
                  lastMoveAt: 0,
                },
              },
              spectators: room.spectators || [],
              spectatorChatEnabled:
              typeof room.spectatorChatEnabled === "boolean"
                ? room.spectatorChatEnabled
                : false,
            game: {
              history: [
                createInitialState(
                  room.ruleset || "korean",
                  getKomiForRuleset()
                ),
              ],
              analysis: null,
              timer: {
                periodMs: AI_TURN_PERIOD_MS,
              maxLives: TIMER_MAX_LIVES,
              turnStartAt: Date.now(),
              remainingMs: AI_TURN_PERIOD_MS,
              lives: { black: TIMER_MAX_LIVES, white: TIMER_MAX_LIVES },
            },
            pendingUndo: null,
            pendingScore: null,
            undoUsed: false,
            undoRequests: { black: 0, white: 0 },
            notifications: [],
            startedAt: Date.now(),
            resultLoggedAt: null,
          },
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "loadKifu") {
      const roomName = normalizeUser(message?.roomName);
      const history = Array.isArray(message?.history) ? message.history : null;
      if (!roomName || !history || history.length === 0) return;
      if (!isValidHistoryPayload(history)) {
        sendNotice(ws, "Invalid game record format.");
        return;
      }
      const room = getRoom(roomName);
      if (!room || room.owner !== userId) {
        return;
      }
      const review = message?.review !== false;
      const prevAi = room.ai;
      const ruleset =
        normalizeRuleset(message?.ruleset, room.ruleset || "korean") ||
        room.ruleset ||
        "korean";
      const komi = Number.isFinite(Number(message?.komi))
        ? Number(message.komi)
        : getKomiForRuleset(ruleset);
      const lastState = history[history.length - 1];
      if (lastState && typeof lastState === "object") {
        lastState.over = true;
        if (typeof lastState.score === "undefined") {
          lastState.score = null;
        }
      }
      if (history[0] && typeof history[0] === "object") {
        history[0].ruleset = ruleset;
        history[0].komi = komi;
      }
      if (prevAi?.enabled) {
        const aiNames = new Set();
        if (prevAi.vsAi) {
          if (prevAi.black?.name) aiNames.add(prevAi.black.name);
          if (prevAi.white?.name) aiNames.add(prevAi.white.name);
        } else if (prevAi.name) {
          aiNames.add(prevAi.name);
        }
        if (aiNames.size) {
          const filtered = room.players.filter((name) => !aiNames.has(name));
          room.players = filtered;
        }
      }
      if (!room.players.includes(userId)) {
        room.players = [userId, ...room.players].slice(0, 2);
      }
      room.ruleset = ruleset;
      room.status = "playing";
      room.ai = null;
      room.spectatorChatEnabled =
        typeof room.spectatorChatEnabled === "boolean"
          ? room.spectatorChatEnabled
          : false;
      room.game = {
        history,
        analysis: null,
        review,
        timer: {
          periodMs: TIMER_PERIOD_MS,
          maxLives: TIMER_MAX_LIVES,
          turnStartAt: Date.now(),
          remainingMs: TIMER_PERIOD_MS,
          lives: { black: TIMER_MAX_LIVES, white: TIMER_MAX_LIVES },
        },
        pendingUndo: null,
        pendingScore: null,
        undoUsed: false,
        undoRequests: { black: 0, white: 0 },
        notifications: [],
        startedAt: Date.now(),
        resultLoggedAt: null,
      };
      broadcastState(wss);
      return;
    }

    if (type === "gameAction") {
      const roomName = normalizeUser(message?.roomName);
      const action = message?.action || {};
      const room = getRoom(roomName);
      if (!room || room.status !== "playing" || !room.game?.history?.length) {
        return;
      }
      const playerColor = getPlayerColor(room, userId);
      if (!playerColor) {
        return;
      }
      const history = room.game.history;
      const current = history[history.length - 1];
      if (current.over) {
        return;
      }
      let next = null;

      if (action.type === "place") {
        if (current.turn !== playerColor) return;
        const x = parseCoord(action?.x, BOARD.columns);
        const y = parseCoord(action?.y, BOARD.rows);
        if (!x || !y) return;
        next = placeStone(current, x, y);
      } else if (action.type === "pass") {
        if (current.turn !== playerColor) return;
        next = passTurn(current);
        pushNotice(room, `${userId} passed`);
      } else if (action.type === "resign") {
        next = resign(current, playerColor);
        pushNotice(room, `${userId} resigned`);
      } else if (action.type === "score") {
        return;
      } else if (action.type === "undoRequest") {
        if (history.length <= 1) return;
        if (room.game.undoUsed) return;
        if (!room.game.undoRequests) {
          room.game.undoRequests = { black: 0, white: 0 };
        }
        if (room.game.undoRequests[playerColor] >= 3) return;
        if (room.game.pendingUndo) return;
        const opponent =
          room.players[0] === userId ? room.players[1] : room.players[0];
        if (!opponent) return;
        room.game.undoRequests[playerColor] += 1;
        const isAiOpponent =
          room.ai?.enabled &&
          !room.ai.vsAi &&
          opponent === room.ai.name;
        if (isAiOpponent) {
          room.game.history = history.slice(0, -1);
          room.game.pendingUndo = null;
          room.game.undoUsed = true;
          if (room.game.timer) {
            room.game.timer.turnStartAt = Date.now();
            room.game.timer.remainingMs = room.game.timer.periodMs;
          }
          pushNotice(room, `AI ${room.ai.name} accepted undo`);
          broadcastState(wss);
          return;
        }
        room.game.pendingUndo = {
          from: userId,
          to: opponent,
          at: Date.now(),
        };
        pushNotice(room, `${userId} requested undo`);
        broadcastState(wss);
        return;
      } else if (action.type === "scoreRequest" && room.ai?.enabled) {
        if (current.turn !== playerColor) return;
        if (history.length - 1 < 100) return;
        const opponent =
          room.players[0] === userId ? room.players[1] : room.players[0];
        if (!opponent) return;
        if (room.ai.vsAi) return;
        if (opponent !== room.ai.name) return;
        next = scoreNow(current);
        pushNotice(room, `AI ${room.ai.name} score`);
      } else if (action.type === "scoreRequest") {
        if (current.turn !== playerColor) return;
        if (history.length - 1 < 100) return;
        if (room.game.pendingScore) return;
        const opponent =
          room.players[0] === userId ? room.players[1] : room.players[0];
        if (!opponent) return;
        room.game.pendingScore = {
          from: userId,
          to: opponent,
          at: Date.now(),
        };
        pushNotice(room, `${userId} requested scoring`);
        broadcastState(wss);
        return;
      } else if (action.type === "undoAccept") {
        const pending = room.game.pendingUndo;
        if (!pending || pending.to !== userId) return;
        if (history.length <= 1) {
          room.game.pendingUndo = null;
          broadcastState(wss);
          return;
        }
        room.game.history = history.slice(0, -1);
        room.game.pendingUndo = null;
        room.game.undoUsed = true;
        if (room.game.timer) {
          room.game.timer.turnStartAt = Date.now();
          room.game.timer.remainingMs = room.game.timer.periodMs;
        }
        pushNotice(room, `Undo accepted`);
        broadcastState(wss);
        return;
      } else if (action.type === "undoReject") {
        const pending = room.game.pendingUndo;
        if (!pending || pending.to !== userId) return;
        room.game.pendingUndo = null;
        pushNotice(room, `Undo rejected`);
        broadcastState(wss);
        return;
      } else if (action.type === "scoreAccept") {
        const pending = room.game.pendingScore;
        if (!pending || pending.to !== userId) return;
        room.game.pendingScore = null;
        next = scoreNow(current);
        pushNotice(room, `Scoring agreed`);
      } else if (action.type === "scoreReject") {
        const pending = room.game.pendingScore;
        if (!pending || pending.to !== userId) return;
        room.game.pendingScore = null;
        pushNotice(room, `Scoring rejected`);
        broadcastState(wss);
        return;
      }

      if (!next || next === current) {
        return;
      }

      room.game.history = [...history, next];
      if (room.game.timer && next.turn !== current.turn) {
        room.game.timer.turnStartAt = Date.now();
        room.game.timer.remainingMs = room.game.timer.periodMs;
      }
      broadcastState(wss);
      return;
    }

    if (type === "chatSend") {
      const text = normalizeText(message?.text, MAX_CHAT_TEXT);
      if (!text) return;
      const rawScope = normalizeUser(message?.scope).toLowerCase();
      const scope = rawScope === "game" ? "game" : "lobby";
      const roomId = normalizeText(message?.roomId, 80) || "global";
      if (scope === "game") {
        const room = getRoom(roomId);
        if (!room) return;
        const isPlayer = room.players.includes(userId);
        const isSpectator = Array.isArray(room.spectators)
          ? room.spectators.includes(userId)
          : false;
        const allowSpectator = Boolean(room.spectatorChatEnabled);
        if (!isPlayer && !(isSpectator && allowSpectator)) {
          return;
        }
      }
      const key = `${scope}:${roomId}`;
      const list = state.chat.channels[key] || [];
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        user: userId || "guest",
        text,
        time: new Date().toLocaleTimeString("ko-KR", { hour12: false }),
        ts: Date.now(),
      };
      state.chat.channels[key] = [...list, entry].slice(-200);
      emitChatEvent(wss, clients, scope, roomId, entry);
      return;
    }

    if (type === "logout") {
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "logout" });
      broadcastState(wss);
    }
  });

  ws.on("close", () => {
    const info = clients.get(ws);
    clients.delete(ws);
    const userId = parseUserId(info?.userId);
    if (userId) {
      console.info(`[ws] close user=${userId}`);
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "ws_close" });
      broadcastState(wss);
    }
  });
});

console.log(`Lobby WebSocket server listening on ws://localhost:${PORT}`);

setTimeout(() => {
  if (!AI_IS_INDEPENDENT) warmupKataGo();
}, 100);

setInterval(() => {
  const now = Date.now();
  let changed = false;
  state.rooms.forEach((room) => {
    if (room.status !== "playing" || !room.game?.timer) {
      return;
    }
    const timer = room.game.timer;
    const history = room.game.history;
    const current = history[history.length - 1];
    if (current.over) {
      maybeLogAiGameResult(room, now);
      return;
    }
    const isAiTurnNow = room.ai?.enabled && isAiTurn(room, current.turn);
    const desiredPeriod = isAiTurnNow
      ? AI_TURN_PERIOD_MS
      : TIMER_PERIOD_MS;
    if (timer.periodMs !== desiredPeriod) {
      timer.periodMs = desiredPeriod;
      timer.turnStartAt = now;
      timer.remainingMs = desiredPeriod;
      changed = true;
    }
    const elapsed = now - timer.turnStartAt;
    const remaining = Math.max(0, timer.periodMs - elapsed);
    const remainingRounded = Math.ceil(remaining / 1000) * 1000;
    if (remainingRounded !== timer.remainingMs) {
      timer.remainingMs = remainingRounded;
      changed = true;
    }

    if (remaining === 0 && !current.over) {
      const turnPlayer = current.turn;
      const nextLives = {
        ...timer.lives,
        [turnPlayer]: Math.max(0, timer.lives[turnPlayer] - 1),
      };
      timer.lives = nextLives;
      if (nextLives[turnPlayer] === 0) {
        const next = resign(current, turnPlayer);
        room.game.history = [...history, next];
      }
      timer.turnStartAt = Date.now();
      timer.remainingMs = timer.periodMs;
      changed = true;
    }
    if (room.game?.pendingScore && !current.over) {
      const pending = room.game.pendingScore;
      if (pending?.at && now - pending.at >= 15000) {
        room.game.pendingScore = null;
        const next = scoreNow(current);
        room.game.history = [...history, next];
        pushNotice(room, `score auto accepted`);
        changed = true;
      }
    }
      if (
        room.ai?.enabled &&
        isAiTurn(room, current.turn) &&
        !current.over &&
        !room.game.pendingScore &&
        !room.game.pendingUndo
      ) {
        if (!AI_IS_INDEPENDENT && !katagoAvailable) return;
        const aiConfig = getAiConfig(room, current.turn);
        if (!aiConfig) return;
        const lastMoveAt = aiConfig.lastMoveAt || 0;
        if (now - lastMoveAt >= 300 && !aiMoveInFlight.has(room.name)) {
          if (shouldAiResign(current, current.turn, room.game.analysis)) {
            const next = resign(current, current.turn);
            room.game.history = [...history, next];
            aiConfig.lastMoveAt = Date.now();
            pushNotice(room, `AI ${aiConfig.name || current.turn} resign`);
            changed = true;
            return;
          }
          if (shouldAiScore(current, current.turn, room.game.analysis)) {
            if (room.ai.vsAi) {
              const next = scoreNow(current);
              room.game.history = [...history, next];
              aiConfig.lastMoveAt = Date.now();
              pushNotice(room, `AI ${aiConfig.name || current.turn} score`);
              changed = true;
              return;
            }
            if (!room.game.pendingScore) {
              const opponent =
                room.players[0] === aiConfig.name
                  ? room.players[1]
                  : room.players[0];
              if (opponent) {
                room.game.pendingScore = {
                  from: aiConfig.name,
                  to: opponent,
                  at: Date.now(),
                };
                aiConfig.lastMoveAt = Date.now();
                pushNotice(room, `AI ${aiConfig.name} score request`);
                changed = true;
                return;
              }
            }
          }
          aiMoveInFlight.add(room.name);
          const historyLength = room.game.history.length;
          Promise.resolve()
            .then(() => requestAiMove(room, current))
            .then((next) => {
              if (room.game.history.length !== historyLength) return;
              const latest = room.game.history[room.game.history.length - 1];
              if (latest.over) return;
              if (applyNextState(room, latest, next)) {
                aiConfig.lastMoveAt = Date.now();
                broadcastState(wss);
              }
            })
            .catch((err) => {
              console.warn("[ai] move error", err.message);
            })
            .finally(() => {
              aiMoveInFlight.delete(room.name);
            });
        }
      }

      if (
        !AI_IS_INDEPENDENT &&
        KATAGO_ANALYSIS_ENABLED &&
        !analysisInFlight.has(room.name)
      ) {
        const analysis = room.game.analysis;
        const lastAt = analysis?.updatedAt || 0;
        if (now - lastAt >= KATAGO_ANALYSIS_INTERVAL_MS) {
          analysisInFlight.add(room.name);
          const historyLength = room.game.history.length;
          Promise.resolve()
            .then(() => requestAnalysis(room, current))
            .then((nextAnalysis) => {
              if (!nextAnalysis) return;
              if (room.game.history.length < historyLength) return;
              room.game.analysis = nextAnalysis;
              broadcastState(wss);
            })
            .catch((err) => {
              console.warn("[ai] analysis error", err.message);
            })
            .finally(() => {
              analysisInFlight.delete(room.name);
            });
        }
      }
  });
  if (changed) {
    broadcastState(wss);
  }
}, 200);









