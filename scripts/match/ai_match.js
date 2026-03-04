import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  GtpClient,
  gtpToCoord,
  sendWithRetry as sendWithRetryBase,
  setupKatagoPosition,
} from "../../shared/ai/katagoGtp.js";
import {
  createInitialState,
  passTurn,
  placeStone,
  resign,
  scoreNow,
} from "../../shared/game/engine.js";
import { buildSgfFromHistory } from "../../shared/game/sgf.js";
import {
  buildDatasetRow,
  buildMoveDatasetRows,
} from "./ai_match_output.js";

// -----------------------------------------------------------------------------
// Static Config
// -----------------------------------------------------------------------------

const BOARD = { columns: 19, rows: 13 };

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const getLogLevel = (value) =>
  Object.prototype.hasOwnProperty.call(LOG_LEVELS, value)
    ? LOG_LEVELS[value]
    : LOG_LEVELS.warn;
const MATCH_LOG_LEVEL = getLogLevel(
  String(process.env.MATCH_LOG_LEVEL || "info").toLowerCase()
);
const logInfo = (...args) => {
  if (MATCH_LOG_LEVEL >= LOG_LEVELS.info) {
    console.log(...args);
  }
};

const KATAGO_PATH = process.env.KATAGO_PATH;
const KATAGO_CONFIG = process.env.KATAGO_CONFIG;
const KATAGO_MODEL = process.env.KATAGO_MODEL;
const KATAGO_ENABLED = Boolean(KATAGO_PATH && KATAGO_CONFIG && KATAGO_MODEL);
const KATAGO_ALLOW_RECT = process.env.KATAGO_ALLOW_RECT !== "0";
const KATAGO_GREEN_AS = (process.env.KATAGO_GREEN_AS || "black").toLowerCase();
const KATAGO_INTERNAL_KOMI = Number(process.env.KATAGO_INTERNAL_KOMI);
const KATAGO_MOVE_TIMEOUT_MS = 12000;
const KATAGO_STARTUP_DELAY_MS = 8000;
const KATAGO_MAX_TIMEOUTS = 10;
const KATAGO_RETRY_TIMEOUT_MULT = 2;
const KATAGO_SETUP_TIMEOUT_MS = 5000;
const normalizeSeed = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? n >>> 0 : null;
};

const createSeededRandom = (seedValue) => {
  let state = normalizeSeed(seedValue);
  if (state === null) return null;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) & 0xffffffff) / 0x100000000;
  };
};

const getGitCommit = () => {
  try {
    return execSync("git rev-parse HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

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

const sendWithRetry = (client, command, timeoutMs) =>
  sendWithRetryBase(client, command, timeoutMs, KATAGO_RETRY_TIMEOUT_MULT);
const setupKatagoPositionSafe = (client, history, ruleset, komiInternal) =>
  setupKatagoPosition(client, history, ruleset, komiInternal, {
    board: BOARD,
    allowRect: KATAGO_ALLOW_RECT,
    rulesCommand: KATAGO_RULES_COMMAND,
    setupTimeoutMs: KATAGO_SETUP_TIMEOUT_MS,
    greenAs: KATAGO_GREEN_AS,
    sendCommand: (command, timeoutMs) => sendWithRetry(client, command, timeoutMs),
  });
const KATAGO_RULES_COMMAND = String(
  process.env.KATAGO_RULES_COMMAND || "auto"
)
  .trim()
  .toLowerCase();


const NATIVE_STYLE_LABEL = "N4TIVE";
// -----------------------------------------------------------------------------
// KataGo Helpers
// -----------------------------------------------------------------------------
const katagoGenMove = async (
  client,
  history,
  ruleset,
  color,
  komiInternal
) => {
  const ok = await setupKatagoPositionSafe(client, history, ruleset, komiInternal);
  if (!ok) return null;
  const response = await sendWithRetry(
    client,
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
};

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

const formatResult = (score) => {
  if (!score) return "Void";
  if (score.winner) {
    return score.winner === "black" ? "B+R" : "W+R";
  }
  const black = score.black;
  const white = score.white;
  if (!Number.isFinite(black) || !Number.isFinite(white)) {
    return "Void";
  }
  const diff = Math.abs(black - white);
  const winner = black > white ? "B" : "W";
  return `${winner}+${diff.toFixed(1)}`;
};

// -----------------------------------------------------------------------------
// Match Scoring / Summary Helpers
// -----------------------------------------------------------------------------
const toScoreForSide = (winnerColor, sideColor) => {
  if (!winnerColor) return 0.5;
  return winnerColor === sideColor ? 1 : 0;
};

const buildCoordSet = (stones, color) => {
  const set = new Set();
  (stones || []).forEach((stone) => {
    if (stone.color !== color) return;
    set.add(`${stone.x},${stone.y}`);
  });
  return set;
};

const coordsFromSet = (set) =>
  [...set].map((value) => {
    const [x, y] = value.split(",").map(Number);
    return { x, y };
  });

const diffCoordSets = (prevSet, nextSet) => {
  const added = [];
  const removed = [];
  nextSet.forEach((value) => {
    if (!prevSet.has(value)) added.push(value);
  });
  prevSet.forEach((value) => {
    if (!nextSet.has(value)) removed.push(value);
  });
  return {
    added: coordsFromSet(new Set(added)),
    removed: coordsFromSet(new Set(removed)),
  };
};

const normalizeStyleKey = (value) => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (!key || key === "native") return "native";
  throw new Error(`Unknown AI style version: ${key}`);
};

const resolveStyleList = (value) => {
  if (!value) return ["native"];
  const normalized = String(value)
    .split(",")
    .map((item) => normalizeStyleKey(item))
    .filter(Boolean);
  if (normalized.length === 0) return ["native"];
  return [...new Set(normalized)];
};

const padNumber = (value, width) => String(value).padStart(width, "0");

const formatWinnerLabel = (result, blackLabel, whiteLabel) => {
  if (!result || result === "Void") return { text: "VOID", label: null };
  const normalized = String(result).trim();
  if (normalized.endsWith("+R")) {
    const winner = normalized.startsWith("B") ? "BLACK" : "WHITE";
    const label = winner === "BLACK" ? blackLabel : whiteLabel;
    return { text: "RESIGN", label: `${winner}(${label})` };
  }
  const match = normalized.match(/^([BW])\+([0-9.]+)/i);
  if (match) {
    const winner = match[1].toUpperCase() === "B" ? "BLACK" : "WHITE";
    const label = winner === "BLACK" ? blackLabel : whiteLabel;
    return { text: `+${match[2]}`, label: `${winner}(${label})` };
  }
  return { text: normalized, label: null };
};

const getWinnerColorFromResult = (result) => {
  const text = String(result || "").trim().toUpperCase();
  if (text.startsWith("B+")) return "black";
  if (text.startsWith("W+")) return "white";
  return null;
};

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${padNumber(minutes, 2)}:${padNumber(seconds, 2)}`;
};

// -----------------------------------------------------------------------------
// Match Core
// -----------------------------------------------------------------------------
const sanitizeLabel = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase();

const formatStyleSlug = (label, fallback) => {
  const safe = String(label || fallback || "").trim();
  if (safe.toUpperCase() === "N4TIVE") return "N4TIVE";
  return sanitizeLabel(safe);
};

const getNextGameIndex = (outDir) => {
  try {
    const files = fs.readdirSync(outDir);
    let max = 0;
    files.forEach((name) => {
      const match = name.match(/^game_(\d+)_/i);
      if (!match) return;
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > max) {
        max = num;
      }
    });
    return max + 1;
  } catch {
    return 1;
  }
};

const tryPlace = (state, move) => {
  if (!move) return null;
  if (move === "pass") return passTurn(state);
  if (move === "resign") return resign(state, state.turn);
  if (move.x && move.y) {
    const placed = placeStone(state, move.x, move.y);
    if (placed !== state) {
      return placed;
    }
  }
  return null;
};

const playSingleGame = async ({
  client,
  blackVersion,
  whiteVersion,
  blackLabel,
  whiteLabel,
  gameId,
  ruleset,
  komi,
  komiInternal,
  maxMoves,
}) => {
  const startedAt = Date.now();
  let state = createInitialState(ruleset, komi);
  let history = [state];

  while (!state.over && history.length - 1 < maxMoves) {
    const kataMove = await katagoGenMove(
      client,
      history,
      ruleset,
      state.turn,
      komiInternal
    );

    if (kataMove === "pass" || kataMove === "resign") {
      const applied = tryPlace(state, kataMove);
      if (applied) {
        state = applied;
        history.push(state);
        continue;
      }
    }

    if (kataMove && kataMove.x && kataMove.y) {
      const kataPlaced = tryPlace(state, kataMove);
      if (kataPlaced) {
        state = kataPlaced;
        history.push(state);
        continue;
      }
    }

    client.positionMoves = null;

    const passed = passTurn(state);
    state = passed;
    history.push(state);
  }

  if (!state.over) {
    const scored = scoreNow(state);
    state = scored;
    history.push(state);
  }
  const finalGreenCoords = coordsFromSet(buildCoordSet(state.stones, "green"));

  const result = formatResult(state.score);
  const durationMs = Date.now() - startedAt;
  const duration = formatDuration(durationMs);
  return {
    history,
    result,
    moveCount: history.length - 1,
    blackVersion,
    whiteVersion,
    gameId,
    duration,
    durationMs,
  };
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games) || 10;
  const swap = Number(args.swap) || Math.floor(games / 2);
  const blackList = resolveStyleList(args.black);
  const whiteList = resolveStyleList(args.white);
  const randomColors =
    args.randomColors === undefined ? false : args.randomColors !== "0";
  const maxMoves = Number(args.maxMoves) || 350;
  const difficulty = "god";
  const ruleset = String(args.ruleset || "japanese");
  const komi = Number.isFinite(Number(args.komi))
    ? Number(args.komi)
    : 0;
  const komiInternal = getInternalKomi(komi);
  const datasetEnabled = args.dataset === undefined ? true : args.dataset !== "0";
  const writeSgf = args.writeSgf === undefined ? false : args.writeSgf !== "0";

  if (!KATAGO_ENABLED) {
    console.error(
      "KataGo is not configured. Set KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL first."
    );
    process.exit(1);
  }
  if (BOARD.columns !== BOARD.rows && !KATAGO_ALLOW_RECT) {
    console.error("KATAGO_ALLOW_RECT=1 is required for rectangular boards.");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const experimentId = String(args.expId || `exp_${stamp}`);
  const seed =
    normalizeSeed(args.seed) ??
    normalizeSeed(process.env.AI_MATCH_SEED) ??
    null;
  const seededRandom = createSeededRandom(seed);
  const originalMathRandom = Math.random;
  if (seededRandom) {
    Math.random = seededRandom;
  }
  const outDir = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.resolve(process.cwd(), "matches", `ai_match_${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const startIndex = getNextGameIndex(outDir);
  const endIndex = startIndex + games - 1;
  const idWidth = Math.max(2, String(endIndex).length);

  const client = new GtpClient({
    command: KATAGO_PATH,
    args: ["gtp", "-config", KATAGO_CONFIG, "-model", KATAGO_MODEL],
    name: "katago",
    startupDelayMs: KATAGO_STARTUP_DELAY_MS,
    maxTimeouts: KATAGO_MAX_TIMEOUTS,
    deferStderr: true,
    onUnknownCommand: ({ command, lower }) => {
      if (!lower.includes("unknown command")) return { handled: false };
      if (
        command.startsWith("kata-genmove_analyze") ||
        command.startsWith("kata-search_analyze")
      ) {
        return { handled: true, response: { ok: false, lines: [] } };
      }
      if (
        command.startsWith("rules") ||
        command.startsWith("komi") ||
        command.startsWith("clear_board") ||
        command.startsWith("boardsize")
      ) {
        console.warn(`[katago] ignoring unknown command: ${command}`);
        return { handled: true, response: { ok: false, lines: [] } };
      }
      console.warn(`[katago] unknown command not handled: ${command}`);
      return { handled: false };
    },
  });
  client.start();
  try {
    await client.send("list_commands", 800);
  } catch (err) {
    client.enableStderr();
    const reason = String(err?.message || err).replace(/\s+$/, "");
    const reasonLine = /[.!?]$/.test(reason) ? reason : `${reason}.`;
    throw new Error(
      `KataGo startup check failed: ${reasonLine} ` +
        "Verify KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL and required runtime DLLs."
    );
  }
  client.enableStderr();

  const results = [];
  const datasetRows = [];
  const moveDatasetRows = [];
  try {
    const manifest = {
      experimentId,
      generatedAt: new Date().toISOString(),
      seed,
      match: {
        games,
        swap,
        randomColors,
        maxMoves,
        difficulty,
        ruleset,
        komi,
        komiInternal,
        blackList,
        whiteList,
        datasetEnabled,
        writeSgf,
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        gitCommit: getGitCommit(),
        katagoPath: KATAGO_PATH || null,
        katagoConfig: KATAGO_CONFIG || null,
        katagoModel: KATAGO_MODEL || null,
      },
    };
    fs.writeFileSync(
      path.join(outDir, `experiment_${experimentId}.manifest.json`),
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    for (let i = 0; i < games; i += 1) {
    const pickFrom = (list) =>
      list ? list[Math.floor(Math.random() * list.length)] : null;
    let blackVersion = pickFrom(blackList) || "native";
    let whiteVersion = pickFrom(whiteList) || "native";

    if (swap > 0 && (blackList || whiteList)) {
      const swapIndex = Math.floor(i / swap);
      if (swapIndex % 2 === 1) {
        const tmp = blackVersion;
        blackVersion = whiteVersion;
        whiteVersion = tmp;
      }
    }

    if (randomColors) {
      if (Math.random() < 0.5) {
        const tmp = blackVersion;
        blackVersion = whiteVersion;
        whiteVersion = tmp;
      }
    }
    const gameNumber = startIndex + i;
    const gameId = padNumber(gameNumber, idWidth);
    const blackLabel = NATIVE_STYLE_LABEL;
    const whiteLabel = NATIVE_STYLE_LABEL;
    logInfo(`Game ${gameNumber} >>  BLACK=${blackLabel} , WHITE=${whiteLabel}`);
    const game = await playSingleGame({
      client,
      blackVersion,
      whiteVersion,
      blackLabel,
      whiteLabel,
      gameId,
      ruleset,
      komi,
      komiInternal,
      maxMoves,
    });
    let sgfName = "";
    const blackSlug = formatStyleSlug(blackLabel, game.blackVersion);
    const whiteSlug = formatStyleSlug(whiteLabel, game.whiteVersion);
    if (writeSgf) {
      const sgf = buildSgfFromHistory({
        history: game.history,
        columns: BOARD.columns,
        rows: BOARD.rows,
        ruleset,
        komi,
        playerBlack: `AI_${blackLabel}`,
        playerWhite: `AI_${whiteLabel}`,
        result: game.result,
      });
      sgfName = `game_${gameId}_B${blackSlug}_W${whiteSlug}.sgf`;
      fs.writeFileSync(path.join(outDir, sgfName), sgf, "utf8");
    }
    const row = {
      game: gameId,
      black: blackLabel,
      white: whiteLabel,
      blackKey: game.blackVersion,
      whiteKey: game.whiteVersion,
      result: game.result,
      moves: game.moveCount,
      duration: game.duration,
      sgf: sgfName,
    };
    results.push(row);
    if (datasetEnabled) {
      datasetRows.push(
        buildDatasetRow({
          experimentId,
          game,
          row,
          ruleset,
          komi,
          difficulty,
          seed,
        })
      );
      moveDatasetRows.push(
        ...buildMoveDatasetRows({
          experimentId,
          row,
          ruleset,
          komi,
          difficulty,
          seed,
          game,
        })
      );
    }
    const winnerLine = formatWinnerLabel(
      game.result,
      blackLabel,
      whiteLabel
    );
    if (winnerLine.label) {
      logInfo(
        `Game ${gameNumber} >>  ${winnerLine.label} ${winnerLine.text}  (${game.moveCount} moves , ${game.duration})`
      );
    } else {
      logInfo(
        `Game ${gameNumber} >>  ${winnerLine.text}  (${game.moveCount} moves , ${game.duration})`
      );
    }
    }
  } finally {
    Math.random = originalMathRandom;
  }

  client.stop();

  const styleTotals = {};
  results.forEach((row) => {
    const winner = getWinnerColorFromResult(row.result);
    const blackKey = row.blackKey;
    const whiteKey = row.whiteKey;
    if (!styleTotals[blackKey]) {
      styleTotals[blackKey] = { games: 0, points: 0 };
    }
    if (!styleTotals[whiteKey]) {
      styleTotals[whiteKey] = { games: 0, points: 0 };
    }
    styleTotals[blackKey].games += 1;
    styleTotals[whiteKey].games += 1;
    styleTotals[blackKey].points += toScoreForSide(winner, "black");
    styleTotals[whiteKey].points += toScoreForSide(winner, "white");
  });
  const styleSummary = Object.entries(styleTotals)
    .map(([key, value]) => {
      const scoreRate = value.games > 0 ? value.points / value.games : 0;
      return {
        key,
        games: value.games,
        points: Number(value.points.toFixed(3)),
        scoreRate: Number(scoreRate.toFixed(4)),
      };
    })
    .sort((a, b) => b.scoreRate - a.scoreRate);

  const playedEndIndex = startIndex + Math.max(0, results.length - 1);
  const rangeName = `game${padNumber(startIndex, idWidth)}-game${padNumber(
    playedEndIndex,
    idWidth
  )}`;
  if (datasetEnabled && datasetRows.length) {
    const datasetPath = path.join(outDir, `dataset_${rangeName}.jsonl`);
    const jsonl = datasetRows.map((entry) => JSON.stringify(entry)).join("\n");
    fs.writeFileSync(datasetPath, `${jsonl}\n`, "utf8");
  }
  if (datasetEnabled && moveDatasetRows.length) {
    const datasetPath = path.join(outDir, `dataset_moves_${rangeName}.jsonl`);
    const jsonl = moveDatasetRows
      .map((entry) => JSON.stringify(entry))
      .join("\n");
    fs.writeFileSync(datasetPath, `${jsonl}\n`, "utf8");
  }
  const analysisSummary = {
    generatedAt: new Date().toISOString(),
    range: rangeName,
    plannedGames: games,
    totalGames: results.length,
    styleSummary,
  };
  fs.writeFileSync(
    path.join(outDir, `analysis_${rangeName}.json`),
    JSON.stringify(analysisSummary, null, 2),
    "utf8"
  );

  logInfo(`\nSaved to: ${outDir}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
















