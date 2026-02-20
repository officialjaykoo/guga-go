import { WebSocketServer } from "ws";
import {
  GtpClient,
  gtpToCoord,
  sendWithRetry as sendWithRetryBase,
  setupKatagoPosition,
} from "../shared/katagoGtp.js";
import {
  createInitialState,
  passTurn,
  placeStone,
  resign,
  scoreNow,
} from "../src/gameEngine.js";
import * as aiStyleRouter from "./aiStyle_dispatcher.js";
import * as nativeStyle from "./aiStyle_n4tive.js";
import * as ganghandolStyle from "./aiStyle_ganghandol_heuristic.js";
import { getDifficultyParams } from "./aiDifficulty.js";

const PORT = Number(process.env.PORT) || 5174;
const BOARD = { columns: 19, rows: 13 };
const AI_LABELS = {
  intro: "입문",
  low: "하수",
  mid: "중수",
  high: "고수",
  master: "국수",
  god: "신",
};
let aiCounter = 0;

const state = {
  rooms: [],
  waitingUsers: [],
  nextRoomId: 1,
  chat: { channels: {} },
  updatedAt: Date.now(),
};

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
const KATAGO_CANDIDATE_COUNT =
  Number(process.env.KATAGO_CANDIDATE_COUNT) || 10;
const GANGHANDOL_AI_NAME = "GanghanDol";
const normalizeStyleKeyBase = (value) => {
  const key = String(value || "native").trim().toLowerCase();
  if (key === "pure") return "native";
  if (key === "n4tive") return "native";
  if (key === "native") return "native";
  return key;
};
const AI_STYLE_MODE = normalizeStyleKeyBase(
  process.env.AI_STYLE_MODE || "native"
);
const AI_STYLE_BLACK = normalizeStyleKeyBase(
  process.env.AI_STYLE_BLACK || "native"
);
const AI_STYLE_WHITE = normalizeStyleKeyBase(
  process.env.AI_STYLE_WHITE || "ganghandol"
);
const KATAGO_RULES_COMMAND = String(
  process.env.KATAGO_RULES_COMMAND || "auto"
)
  .trim()
  .toLowerCase();
const STYLE_MODULES = {
  native: nativeStyle,
  n4tive: nativeStyle,
  pure: nativeStyle,
  ganghandol: ganghandolStyle,
  default: aiStyleRouter,
};
const STYLE_DISPLAY_NAMES = {
  native: "N4TIVE",
  n4tive: "N4TIVE",
  pure: "N4TIVE",
  ganghandol: GANGHANDOL_AI_NAME,
};
const normalizeStyleKey = (value, fallback) =>
  normalizeStyleKeyBase(String(value || fallback || "").trim().toLowerCase());
const getStyleModule = (aiConfig, fallback) => {
  const key = normalizeStyleKey(aiConfig?.styleMode, fallback);
  return STYLE_MODULES[key] || STYLE_MODULES.default;
};
const getStyleKey = (aiConfig, fallback) =>
  normalizeStyleKey(aiConfig?.styleMode, fallback);
const getStyleDisplayName = (key, fallback) =>
  STYLE_DISPLAY_NAMES[key] || fallback;

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

const extractCandidateMovesFromLines = (lines, columns, rows) => {
  if (!Array.isArray(lines)) return [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const infos = parsed?.moveInfos || parsed?.analysis?.moveInfos;
      if (!Array.isArray(infos)) continue;
      const candidates = [];
      infos.forEach((info) => {
        const coord = gtpToCoord(info?.move);
        if (!coord) return;
        if (coord === "pass") {
          candidates.push({
            pass: true,
            scoreLead: Number.isFinite(info?.scoreLead) ? info.scoreLead : null,
            winrate: Number.isFinite(info?.winrate)
              ? info.winrate
              : Number.isFinite(info?.winRate)
                ? info.winRate
                : null,
            visits: Number.isFinite(info?.visits) ? info.visits : null,
            order: candidates.length,
          });
          return;
        }
        if (!coord.x || !coord.y) return;
        if (coord.x < 1 || coord.x > columns || coord.y < 1 || coord.y > rows) {
          return;
        }
        candidates.push({
          x: coord.x,
          y: coord.y,
          scoreLead: Number.isFinite(info?.scoreLead) ? info.scoreLead : null,
          winrate: Number.isFinite(info?.winrate)
            ? info.winrate
            : Number.isFinite(info?.winRate)
              ? info.winRate
              : null,
          visits: Number.isFinite(info?.visits) ? info.visits : null,
          order: candidates.length,
        });
      });
      return candidates;
    } catch {
      // ignore parse errors
    }
  }
  return [];
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

const katagoGenMoveCandidates = (
  history,
  ruleset,
  color,
  stones,
  difficulty,
  komiDisplay
) =>
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
    const candidates = extractCandidateMovesFromLines(
      response.lines,
      BOARD.columns,
      BOARD.rows
    );
    return candidates.map((entry) => ({
      ...entry,
      scoreLead: adjustScoreLead(entry.scoreLead, displayKomi, internalKomi),
    }));
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

const sendNotice = (ws, text) => {
  if (!ws || ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: "notice", text }));
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

const makeAiName = (styleKey) => {
  const styleLabel = getStyleDisplayName(
    normalizeStyleKey(styleKey, AI_STYLE_MODE),
    "AI"
  );
  return styleLabel;
};

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
  if (!KATAGO_ENABLED || !katagoAvailable) {
    console.warn("[katago] not configured");
    return null;
  }
  try {
      const aiConfig = getAiConfig(room, current.turn);
      const difficulty = aiConfig?.difficulty || room.ai?.difficulty || "god";
      const styleKey = getStyleKey(aiConfig, AI_STYLE_MODE);
      const styleModule = getStyleModule(aiConfig, AI_STYLE_MODE);
      const isPureKata = styleKey === "native";
      const isGanghanDolStyle = styleKey === "ganghandol";
      const komiDisplay = Number.isFinite(current?.komi)
        ? current.komi
        : getKomiForRuleset(current.ruleset);
      const moveCount = room?.game?.history?.length
        ? room.game.history.length - 1
        : 0;
      if (!isPureKata && !isGanghanDolStyle && styleModule?.pickOpeningMove) {
        const openingMove = styleModule.pickOpeningMove(current, {
          columns: BOARD.columns,
          rows: BOARD.rows,
          moveCount,
          analysis: room.game.analysis,
        });
        if (openingMove) {
          const placed = placeStone(current, openingMove.x, openingMove.y);
          if (placed !== current) return placed;
        }
      }
      if (isGanghanDolStyle) {
        const candidates = await katagoGenMoveCandidates(
          room.game.history,
          current.ruleset,
          current.turn,
          current.stones || [],
          difficulty,
          komiDisplay
        );
        if (candidates && candidates.length) {
          const shortlist = candidates.slice(0, KATAGO_CANDIDATE_COUNT);
          const adjusted = styleModule?.pickCandidateMove?.(current, shortlist, {
            columns: BOARD.columns,
            rows: BOARD.rows,
            aiColor: current.turn,
            analysis: room.game.analysis,
          });
          if (adjusted) {
            const placed = placeStone(current, adjusted.x, adjusted.y);
            if (placed !== current) return placed;
          }
        }
      }
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
          if (
            !isPureKata &&
            !isGanghanDolStyle &&
            styleModule?.pickStyleOverrideMove
          ) {
            const styled = styleModule.pickStyleOverrideMove(current, move, {
              columns: BOARD.columns,
              rows: BOARD.rows,
              moveCount,
              analysis: room.game.analysis,
            });
            if (styled) {
              const placed = placeStone(current, styled.x, styled.y);
              if (placed !== current) return placed;
            }
          }
          const placed = placeStone(current, move.x, move.y);
          if (placed !== current) return placed;
        }
      if (
        !isPureKata &&
        !isGanghanDolStyle &&
        styleModule?.pickStyleFallbackMove
      ) {
        const fallback = styleModule.pickStyleFallbackMove(current, {
          columns: BOARD.columns,
          rows: BOARD.rows,
          moveCount,
          analysis: room.game.analysis,
        });
        if (fallback) {
          const placed = placeStone(current, fallback.x, fallback.y);
          if (placed !== current) return placed;
        }
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

const broadcastState = (wss) => {
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

const wss = new WebSocketServer({ port: PORT });
const clients = new Map();

wss.on("connection", (ws) => {
  clients.set(ws, { userId: "" });
  ws.send(JSON.stringify({ type: "state", state, serverTime: Date.now() }));

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const type = message?.type;
    const userId = normalizeUser(message?.userId);
    const prevUserId = normalizeUser(clients.get(ws)?.userId);
    if (userId) {
      if (prevUserId && prevUserId !== userId) {
        removeUserEverywhere(prevUserId, false, { preserveAiRooms: true, reason: "userIdChange" });
      }
      clients.set(ws, { userId });
    }

    if (!type) {
      return;
    }

    if (type === "hello") {
      if (userId) {
        ensureWaiting(userId);
        broadcastState(wss);
      }
      return;
    }

    if (!userId) {
      return;
    }

    if (type === "enterLobby") {
      removeUserEverywhere(userId, true, { preserveAiRooms: true, reason: "enterLobby" });
      broadcastState(wss);
      return;
    }

    if (type === "createRoom") {
      const title = normalizeUser(message?.title) || "Room";
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "createRoom" });
      const roomName = `[${state.nextRoomId}] ${title}`;
      state.nextRoomId += 1;
      state.rooms.push({
        name: roomName,
        players: [userId],
        ruleset: message?.ruleset || "korean",
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
          },
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "startAiGame") {
      const roomName = normalizeUser(message?.roomName);
      const difficulty = normalizeUser(message?.difficulty) || "god";
      if (!roomName) return;
      if (!KATAGO_ENABLED || !katagoAvailable) {
        console.warn("[katago] startAiGame ignored: not configured");
        sendNotice(
          ws,
          "KataGo 설정이 없습니다. KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL을 먼저 설정하세요."
        );
        return;
      }
      if (BOARD.columns !== BOARD.rows && !KATAGO_ALLOW_RECT) {
        sendNotice(
          ws,
          "현재 19x13 보드는 KataGo에서 제한됩니다. KATAGO_ALLOW_RECT=1 설정이 필요합니다."
        );
        return;
      }
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) return room;
        if (room.owner !== userId) return room;
        if (room.players.length < 1) return room;
        if (room.status === "playing") return room;
        const styleMode = normalizeStyleKey(message?.styleMode, AI_STYLE_MODE);
        const aiName = makeAiName(styleMode);
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
          },
        };
      });
      broadcastState(wss);
      return;
    }

    if (type === "startAiVsAiGame") {
      const roomName = normalizeUser(message?.roomName);
      const difficulty = normalizeUser(message?.difficulty) || "god";
      if (!roomName) return;
      if (!KATAGO_ENABLED || !katagoAvailable) {
        console.warn("[katago] startAiVsAiGame ignored: not configured");
        sendNotice(
          ws,
          "KataGo 설정이 없습니다. KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL을 먼저 설정하세요."
        );
        return;
      }
      if (BOARD.columns !== BOARD.rows && !KATAGO_ALLOW_RECT) {
        sendNotice(
          ws,
          "현재 19x13 보드는 KataGo에서 제한됩니다. KATAGO_ALLOW_RECT=1 설정이 필요합니다."
        );
        return;
      }
      state.rooms = state.rooms.map((room) => {
        if (room.name !== roomName) return room;
        if (room.owner !== userId) return room;
        if (room.status === "playing") return room;
        let blackStyle = normalizeStyleKey(
          message?.blackStyleMode,
          AI_STYLE_BLACK
        );
        let whiteStyle = normalizeStyleKey(
          message?.whiteStyleMode,
          AI_STYLE_WHITE
        );
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
        const blackName = makeAiName(blackStyle);
        const whiteName = makeAiName(whiteStyle);
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
      const room = getRoom(roomName);
      if (!room || room.owner !== userId) {
        return;
      }
      const review = message?.review !== false;
      const prevAi = room.ai;
      const ruleset =
        normalizeUser(message?.ruleset) ||
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
        next = placeStone(current, action.x, action.y);
      } else if (action.type === "pass") {
        if (current.turn !== playerColor) return;
        next = passTurn(current);
        pushNotice(room, `${userId} 패스`);
      } else if (action.type === "resign") {
        next = resign(current, playerColor);
        pushNotice(room, `${userId} 기권`);
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
          pushNotice(room, `AI ${room.ai.name} 한수 무르기 수락`);
          broadcastState(wss);
          return;
        }
        room.game.pendingUndo = {
          from: userId,
          to: opponent,
          at: Date.now(),
        };
        pushNotice(room, `${userId} 한수 무르기 요청`);
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
        pushNotice(room, `${userId} 계가 요청`);
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
        pushNotice(room, `한수 무르기 수락`);
        broadcastState(wss);
        return;
      } else if (action.type === "undoReject") {
        const pending = room.game.pendingUndo;
        if (!pending || pending.to !== userId) return;
        room.game.pendingUndo = null;
        pushNotice(room, `한수 무르기 거절`);
        broadcastState(wss);
        return;
      } else if (action.type === "scoreAccept") {
        const pending = room.game.pendingScore;
        if (!pending || pending.to !== userId) return;
        room.game.pendingScore = null;
        next = scoreNow(current);
        pushNotice(room, `계가 합의`);
      } else if (action.type === "scoreReject") {
        const pending = room.game.pendingScore;
        if (!pending || pending.to !== userId) return;
        room.game.pendingScore = null;
        pushNotice(room, `계가 거절`);
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
      const text = normalizeUser(message?.text);
      if (!text) return;
      const scope = normalizeUser(message?.scope) || "lobby";
      const roomId = normalizeUser(message?.roomId) || "global";
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
      broadcastState(wss);
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
    const userId = normalizeUser(info?.userId);
    if (userId) {
      console.info(`[ws] close user=${userId}`);
      removeUserEverywhere(userId, false, { preserveAiRooms: true, reason: "ws_close" });
      broadcastState(wss);
    }
  });
});

console.log(`Lobby WebSocket server listening on ws://localhost:${PORT}`);

setTimeout(() => {
  warmupKataGo();
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
    if (remaining !== timer.remainingMs) {
      timer.remainingMs = remaining;
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
        if (!katagoAvailable) return;
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

      if (KATAGO_ANALYSIS_ENABLED && !analysisInFlight.has(room.name)) {
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

