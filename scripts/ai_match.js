import fs from "node:fs";
import path from "node:path";
import {
  GtpClient,
  gtpToCoord,
  sendWithRetry as sendWithRetryBase,
  setupKatagoPosition,
} from "../shared/katagoGtp.js";
import { createReportBuilder } from "../shared/reportBuilder.js";
import {
  createInitialState,
  passTurn,
  placeStone,
  resign,
  scoreNow,
} from "../src/gameEngine.js";
import { buildSgfFromHistory } from "../src/sgf.js";
import { getDifficultyParams } from "../server/aiDifficulty.js";
import {
  AI_CANDIDATE_ADJUST_WEIGHT,
  AI_CORNER_BONUS,
  AI_GREEN_BLOCK_BONUS,
  AI_GREEN_BONUS_ADJ,
  AI_GREEN_BONUS_GAP1,
  AI_GREEN_BONUS_GAP2,
  AI_GREEN_ADJ_BONUS_NEUTRAL,
  AI_GREEN_ADJ_BONUS_WITH_OWN,
  AI_GREEN_ADJ_PENALTY_WITH_OPP,
  AI_GREEN_GAP1_BONUS_NEUTRAL,
  AI_GREEN_GAP1_BONUS_WITH_OWN,
  AI_GREEN_GAP1_PENALTY_WITH_OPP,
  AI_GREEN_MULTI_ADJ_BONUS,
  AI_GREEN_MULTI_GAP1_BONUS,
  AI_GREEN_CANDIDATE_BONUS,
  AI_GREEN_CONNECT_BONUS,
  AI_GREEN_EMERGENCY_BONUS,
  AI_GREEN_EYE_BONUS,
  AI_GREEN_INVASION_PENALTY,
  AI_GREEN_MOUTH_BONUS,
  AI_GREEN_PRESSURE_BONUS,
  AI_GREEN_SQUEEZE_PENALTY,
  AI_HEURISTIC_CORNER_MULT,
  AI_HEURISTIC_END_MULT,
  AI_HEURISTIC_EARLY_MULT,
  AI_HEURISTIC_GREEN_MULT,
  AI_HEURISTIC_MAX_MULT,
  AI_HEURISTIC_MIN_MULT,
  AI_HEURISTIC_RECT_MULT,
  AI_HEURISTIC_SIDE_EMPTY_RATIO,
  AI_HEURISTIC_SIDE_FULL_RATIO,
  AI_HEURISTIC_SIDE_MULT,
  AI_HEURISTIC_SIDE_PENALTY_MULT,
  AI_HEURISTIC_TANH_SCALE,
  AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT,
  AI_GANGHANDOL_MIN_VISIT_RATIO,
  AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD,
  AI_GANGHANDOL_WINRATE_DROP_MAX,
  GANGHANDOL_PASS_ENABLED,
  GANGHANDOL_PASS_MIN_VISIT_RATIO,
  GANGHANDOL_PASS_SCORELEAD_MAX,
  GANGHANDOL_PASS_WINRATE_DROP_MAX,
  GANGHANDOL_OVERRIDE_ENABLED,
  GANGHANDOL_OVERRIDE_HEURISTIC_MIN,
  GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX,
  GANGHANDOL_BLACK_CORNER_SIDE_MULT,
  GANGHANDOL_BLACK_HEURISTIC_MULT,
  GANGHANDOL_WHITE_CORNER_SIDE_MULT,
  GANGHANDOL_WHITE_HEURISTIC_MULT,
  AI_RECT_AXIS_BONUS,
  AI_SCORELEAD_TANH_SCALE,
  AI_SIDE_BONUS,
  GANGHANDOL_TUNING_VERSION,
} from "../server/aiStyle_ganghandol_heuristic_config.js";

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
const LOG_RAW_CANDIDATES = process.env.LOG_RAW_CANDIDATES === "1";

const KATAGO_PATH = process.env.KATAGO_PATH;
const KATAGO_CONFIG = process.env.KATAGO_CONFIG;
const KATAGO_MODEL = process.env.KATAGO_MODEL;
const KATAGO_ENABLED = Boolean(KATAGO_PATH && KATAGO_CONFIG && KATAGO_MODEL);
const KATAGO_ALLOW_RECT = process.env.KATAGO_ALLOW_RECT !== "0";
const KATAGO_GREEN_AS = (process.env.KATAGO_GREEN_AS || "black").toLowerCase();
const KATAGO_INTERNAL_KOMI = Number(process.env.KATAGO_INTERNAL_KOMI);
const KATAGO_MOVE_TIMEOUT_MS =
  Number(process.env.KATAGO_MOVE_TIMEOUT_MS) || 12000;
const KATAGO_ANALYSIS_TIMEOUT_MS =
  Number(process.env.KATAGO_ANALYSIS_TIMEOUT_MS) || 8000;
const KATAGO_ANALYSIS_MIN_MOVES =
  Number(process.env.KATAGO_ANALYSIS_MIN_MOVES) || 60;
const KATAGO_ANALYSIS_EVERY =
  Number(process.env.KATAGO_ANALYSIS_EVERY) || 2;
const KATAGO_ANALYSIS_ALWAYS_AFTER =
  Number(process.env.KATAGO_ANALYSIS_ALWAYS_AFTER) || 120;
const KATAGO_STARTUP_DELAY_MS =
  Number(process.env.KATAGO_STARTUP_DELAY_MS) || 8000;
const KATAGO_MAX_TIMEOUTS = Number(process.env.KATAGO_MAX_TIMEOUTS) || 10;
const KATAGO_RETRY_TIMEOUT_MULT =
  Number(process.env.KATAGO_RETRY_TIMEOUT_MULT) || 2;
const KATAGO_SETUP_TIMEOUT_MS =
  Number(process.env.KATAGO_SETUP_TIMEOUT_MS) || 1200;
const KATAGO_CANDIDATE_COUNT =
  Number(process.env.KATAGO_CANDIDATE_COUNT) || 10;
const AI_GREEN_CANDIDATE_RADIUS =
  Number(process.env.AI_GREEN_CANDIDATE_RADIUS) || 2;
const AI_OWNERSHIP_STATS_THRESHOLD =
  Number(process.env.AI_OWNERSHIP_STATS_THRESHOLD) || AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD;
const AI_WINRATE_SNAPSHOT_SAMPLE_INTERVAL =
  Number(process.env.AI_WINRATE_SNAPSHOT_SAMPLE_INTERVAL) || 5;
const AI_WINRATE_SNAPSHOT_DELTA =
  Number(process.env.AI_WINRATE_SNAPSHOT_DELTA) || 0.05;
const AI_SCORELEAD_SNAPSHOT_DELTA =
  Number(process.env.AI_SCORELEAD_SNAPSHOT_DELTA) || 3;
const STYLE_RESIGN_RULES = {};
const CRITICAL_MOMENT_LIMIT = 5;

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


const AI_STYLES = {
  native: {
    pickOpeningMove: () => null,
    pickStyleFallbackMove: () => null,
    pickStyleOverrideMove: () => null,
  },
  ganghandol: {
    pickOpeningMove: () => null,
    pickStyleFallbackMove: () => null,
    pickStyleOverrideMove: () => null,
  },
};

const GANGHANDOL_AI_NAME = "GanghanDol";
const AI_STYLE_LABELS = {
  native: "N4TIVE",
  ganghandol: GANGHANDOL_AI_NAME,
};
const GANGHANDOL_TUNING_DEBUG =
  process.env.GANGHANDOL_TUNING_DEBUG === "1" ||
  process.env.GANGHANDOL_TUNING_DEBUG === "true";

let analysisSupported = true;

const applyKatagoDifficulty = async (client, difficulty, overrides) => {
  const params = overrides || getDifficultyParams(difficulty);
  if (!params) return;
  if (!client.lastParams) {
    client.lastParams = new Map();
  }
  const setParam = async (name, value) => {
    if (value === undefined || value === null || value === "") return;
    const prev = client.lastParams.get(name);
    if (prev === value) return;
    try {
      await sendWithRetry(
        client,
        `kata-set-param ${name} ${value}`,
        KATAGO_SETUP_TIMEOUT_MS
      );
      client.lastParams.set(name, value);
    } catch {
      // ignore param failures
    }
  };
  await setParam("maxVisits", params.maxVisits);
  await setParam("maxTime", params.maxTime);
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
    };
  }
  return {
    ownership: null,
    scoreLead: Number.isFinite(parsed.scoreLead) ? parsed.scoreLead : null,
  };
};

const extractCandidateMovesFromLines = (
  lines,
  {
    logRawOnFailure = false,
    failureLineLimit = 20,
    failureLineCharLimit = 400,
  } = {}
) => {
  const parseInfoMoveCandidates = (rawLines) => {
    if (!Array.isArray(rawLines)) return [];
    const candidates = [];
    rawLines.forEach((line) => {
      const text = String(line ?? "").trim();
      if (!text.includes("info move")) return;
      const tokens = text.split(/\s+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i] !== "info" || tokens[i + 1] !== "move") continue;
        const chunk = [];
        for (let j = i; j < tokens.length; j += 1) {
          if (j !== i && tokens[j] === "info") break;
          chunk.push(tokens[j]);
        }
        let move = null;
        let scoreLead = null;
        let winrate = null;
        let visits = null;
        for (let k = 0; k < chunk.length; k += 1) {
          const key = chunk[k];
          const value = chunk[k + 1];
          if (!value) continue;
          if (key === "move") {
            move = value;
            continue;
          }
          if (key === "scoreLead") {
            const num = Number(value);
            if (Number.isFinite(num)) scoreLead = num;
            continue;
          }
          if (key === "winrate" || key === "winRate") {
            const num = Number(value);
            if (Number.isFinite(num)) winrate = num;
            continue;
          }
          if (key === "visits" || key === "visitCount" || key === "nVisits") {
            const num = Number(value);
            if (Number.isFinite(num)) visits = num;
          }
        }
        if (move && Number.isFinite(scoreLead)) {
          candidates.push({
            move,
            scoreLead,
            winrate,
            visits,
          });
        }
      }
    });
    return candidates;
  };
  const buildFailureLines = () => {
    if (!Array.isArray(lines)) return null;
    const sliced = lines.slice(0, failureLineLimit);
    return sliced.map((line) => {
      const text = String(line ?? "");
      if (text.length <= failureLineCharLimit) return text;
      return `${text.slice(0, failureLineCharLimit)}...`;
    });
  };
  const logRawLines = () => {
    if (!logRawOnFailure || !Array.isArray(lines)) return;
    console.warn("[katago] candidate parse failed; raw lines start");
    lines.forEach((line) => {
      console.warn(`[katago][raw] ${String(line ?? "")}`);
    });
    console.warn("[katago] candidate parse failed; raw lines end");
  };
  if (!Array.isArray(lines)) {
    logRawLines();
    return { candidates: [], failureLines: null };
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      const moveInfos =
        parsed?.moveInfos ||
        parsed?.analysis?.moveInfos ||
        parsed?.rootInfo?.moveInfos;
      if (Array.isArray(moveInfos) && moveInfos.length) {
        const candidates = moveInfos
          .map((info) => ({
            move: info.move,
            scoreLead: Number(info.scoreLead ?? info.scoreMean),
            winrate: Number(info.winrate ?? info.winRate),
            visits: Number(info.visits ?? info.visitCount ?? info.nVisits),
          }))
          .filter((entry) => entry.move && Number.isFinite(entry.scoreLead));
        return { candidates, failureLines: null };
      }
    } catch {
      continue;
    }
  }
  const textCandidates = parseInfoMoveCandidates(lines);
  if (textCandidates.length) {
    return { candidates: textCandidates, failureLines: null };
  }
  logRawLines();
  return { candidates: [], failureLines: buildFailureLines() };
};

const katagoGenMoveCandidates = async (
  client,
  history,
  ruleset,
  color,
  stones,
  komiDisplay,
  komiInternal,
  difficulty,
  overrides
) => {
  if (!analysisSupported) return null;
  const ok = await setupKatagoPositionSafe(client, history, ruleset, komiInternal);
  if (!ok) return null;
  await applyKatagoDifficulty(client, difficulty, overrides);
  const response = await sendWithRetry(
    client,
    `kata-search_analyze ${color} ownership true`,
    KATAGO_ANALYSIS_TIMEOUT_MS
  );
  const parsed = extractCandidateMovesFromLines(response.lines, {
    logRawOnFailure: LOG_RAW_CANDIDATES,
  });
  const candidates = parsed?.candidates || [];
  if (!candidates.length) {
    return { candidates: null, failureLines: parsed?.failureLines || null };
  }
  return {
    candidates: candidates
      .slice(0, KATAGO_CANDIDATE_COUNT)
      .map((entry) => {
        const moveText = String(entry.move || "").toLowerCase();
        if (moveText === "pass") {
          return {
            pass: true,
            scoreLead: adjustScoreLead(entry.scoreLead, komiDisplay, komiInternal),
            winrate: entry.winrate,
            visits: entry.visits,
          };
        }
        const coord = gtpToCoord(entry.move);
        if (!coord || !coord.x || !coord.y) return null;
        return {
          ...coord,
          scoreLead: adjustScoreLead(entry.scoreLead, komiDisplay, komiInternal),
          winrate: entry.winrate,
          visits: entry.visits,
        };
      })
      .filter(Boolean),
    failureLines: null,
  };
};

const getLeadForColor = (scoreLead, color) => {
  if (!Number.isFinite(scoreLead)) return null;
  return color === "black" ? scoreLead : -scoreLead;
};

const getRectAxisBias = (x, y) => {
  if (BOARD.columns === BOARD.rows) return 0;
  if (BOARD.columns > BOARD.rows) {
    const centerY = Math.ceil(BOARD.rows / 2);
    const dist = Math.abs(y - centerY);
    return AI_RECT_AXIS_BONUS * (1 - dist / BOARD.rows);
  }
  const centerX = Math.ceil(BOARD.columns / 2);
  const dist = Math.abs(x - centerX);
  return AI_RECT_AXIS_BONUS * (1 - dist / BOARD.columns);
};

const getGreenBias = (x, y, stones) => {
  if (!AI_GREEN_CANDIDATE_BONUS || !AI_GREEN_CANDIDATE_RADIUS) return 0;
  let bonus = 0;
  for (const stone of stones || []) {
    if (stone.color !== "green") continue;
    const dist = Math.abs(x - stone.x) + Math.abs(y - stone.y);
    if (dist === 1) bonus += AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_ADJ;
    else if (dist === 2) bonus += AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_GAP1;
    else if (dist === 3) bonus += AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_GAP2;
  }
  return bonus;
};

const hasGreenStones = (stones) =>
  (stones || []).some((stone) => stone?.color === "green");

const buildStoneIndex = (stones) => {
  const map = new Map();
  (stones || []).forEach((stone) => {
    map.set(`${stone.x},${stone.y}`, stone);
  });
  return map;
};

const getNeighbors = (x, y, columns, rows) => {
  const neighbors = [];
  if (x > 1) neighbors.push([x - 1, y]);
  if (x < columns) neighbors.push([x + 1, y]);
  if (y > 1) neighbors.push([x, y - 1]);
  if (y < rows) neighbors.push([x, y + 1]);
  return neighbors;
};

const getGroupLiberties = (stoneMap, start, player, columns, rows) => {
  const visited = new Set();
  const queue = [[start.x, start.y]];
  let liberties = 0;
  visited.add(`${start.x},${start.y}`);
  while (queue.length) {
    const [cx, cy] = queue.pop();
    const neighbors = getNeighbors(cx, cy, columns, rows);
    neighbors.forEach(([nx, ny]) => {
      const key = `${nx},${ny}`;
      const stone = stoneMap.get(key);
      if (!stone) {
        liberties += 1;
        return;
      }
      if (stone.player !== player) return;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push([nx, ny]);
      }
    });
  }
  return liberties;
};

const compressScore = (value, scale) => {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(scale) || scale <= 0) return value;
  return scale * Math.tanh(value / scale);
};

const getCornerSideBonus = (x, y, columns, rows, cornerSideMult) => {
  const onLeft = x === 1;
  const onRight = x === columns;
  const onBottom = y === 1;
  const onTop = y === rows;
  const onCorner = (onLeft || onRight) && (onTop || onBottom);
  const mult = Number.isFinite(cornerSideMult) ? cornerSideMult : 1;
  if (onCorner) return AI_CORNER_BONUS * mult;
  if (onLeft || onRight || onTop || onBottom) return AI_SIDE_BONUS * mult;
  return 0;
};
const getGreenSituationAdjust = (state, x, y, columns, rows) => {
  const stoneMap = buildStoneIndex(state?.stones || []);
  const neighbors = getNeighbors(x, y, columns, rows);
  let greenAdj = 0;
  let ownAdj = 0;
  let oppAdj = 0;
  const ownCoords = [];
  neighbors.forEach(([nx, ny]) => {
    const stone = stoneMap.get(`${nx},${ny}`);
    if (!stone) return;
    if (stone.color === "green") {
      greenAdj += 1;
      return;
    }
    if (stone.player === state.turn) {
      ownAdj += 1;
      ownCoords.push([nx, ny]);
      return;
    }
    oppAdj += 1;
  });
  if (!greenAdj) return 0;
  let adjust = 0;
  if (ownAdj >= 1) {
    adjust += AI_GREEN_EYE_BONUS;
  }
  if (ownAdj >= 2) {
    adjust += AI_GREEN_CONNECT_BONUS;
  }
  if (greenAdj >= 1 && ownAdj >= 2) {
    adjust += AI_GREEN_MOUTH_BONUS;
  }
  if (oppAdj >= 1 && ownAdj >= 1) {
    adjust += AI_GREEN_BLOCK_BONUS;
  }
  if (oppAdj >= 2 && greenAdj >= 1) {
    adjust += AI_GREEN_PRESSURE_BONUS;
  }
  if (oppAdj >= 1 && ownAdj === 0) {
    adjust += AI_GREEN_INVASION_PENALTY;
  }
  if (oppAdj >= 2 && ownAdj === 0) {
    adjust += AI_GREEN_SQUEEZE_PENALTY;
  }
  let emergency = false;
  ownCoords.forEach(([nx, ny]) => {
    const stone = stoneMap.get(`${nx},${ny}`);
    if (!stone) return;
    const libs = getGroupLiberties(stoneMap, stone, state.turn, columns, rows);
    if (libs <= 2) emergency = true;
  });
  if (emergency && greenAdj >= 1) {
    adjust += AI_GREEN_EMERGENCY_BONUS;
  }
  return adjust;
};

const getGreenAdjGapAdjust = (state, x, y, columns, rows) => {
  const stoneMap = buildStoneIndex(state?.stones || []);
  const neighbors = getNeighbors(x, y, columns, rows);
  let greenAdj = 0;
  let greenGap1 = 0;
  let ownAdj = 0;
  let oppAdj = 0;
  neighbors.forEach(([nx, ny]) => {
    const stone = stoneMap.get(`${nx},${ny}`);
    if (!stone) return;
    if (stone.color === "green") {
      greenAdj += 1;
      return;
    }
    if (stone.player === state.turn) {
      ownAdj += 1;
      return;
    }
    oppAdj += 1;
  });
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  directions.forEach(([dx, dy]) => {
    const mx = x + dx;
    const my = y + dy;
    const fx = x + dx * 2;
    const fy = y + dy * 2;
    if (mx < 1 || mx > columns || my < 1 || my > rows) return;
    if (fx < 1 || fx > columns || fy < 1 || fy > rows) return;
    const middle = stoneMap.get(`${mx},${my}`);
    if (middle) return;
    const far = stoneMap.get(`${fx},${fy}`);
    if (far?.color === "green") {
      greenGap1 += 1;
    }
  });
  if (!greenAdj && !greenGap1) return 0;
  let adjust = 0;
  if (greenAdj > 0) {
    if (oppAdj > 0) {
      adjust += AI_GREEN_ADJ_PENALTY_WITH_OPP * greenAdj;
    } else if (ownAdj > 0) {
      adjust += AI_GREEN_ADJ_BONUS_WITH_OWN * greenAdj;
    } else {
      adjust += AI_GREEN_ADJ_BONUS_NEUTRAL * greenAdj;
    }
    if (greenAdj > 1) {
      adjust += AI_GREEN_MULTI_ADJ_BONUS * (greenAdj - 1);
    }
  }
  if (greenGap1 > 0) {
    if (oppAdj > 0) {
      adjust += AI_GREEN_GAP1_PENALTY_WITH_OPP * greenGap1;
    } else if (ownAdj > 0) {
      adjust += AI_GREEN_GAP1_BONUS_WITH_OWN * greenGap1;
    } else {
      adjust += AI_GREEN_GAP1_BONUS_NEUTRAL * greenGap1;
    }
    if (greenGap1 > 1) {
      adjust += AI_GREEN_MULTI_GAP1_BONUS * (greenGap1 - 1);
    }
  }
  return adjust;
};
const countEmptyCorners = (stones, columns, rows) => {
  const occupied = new Set(
    (stones || []).map((stone) => `${stone.x},${stone.y}`)
  );
  const corners = [
    `1,1`,
    `1,${rows}`,
    `${columns},1`,
    `${columns},${rows}`,
  ];
  let empty = 0;
  corners.forEach((key) => {
    if (!occupied.has(key)) empty += 1;
  });
  return empty;
};

const getSideEmptyRatio = (stones, columns, rows) => {
  const occupied = new Set(
    (stones || []).map((stone) => `${stone.x},${stone.y}`)
  );
  let sidePoints = 0;
  let emptyPoints = 0;
  for (let y = 1; y <= rows; y += 1) {
    for (let x = 1; x <= columns; x += 1) {
      const isSide = x === 1 || x === columns || y === 1 || y === rows;
      if (!isSide) continue;
      sidePoints += 1;
      if (!occupied.has(`${x},${y}`)) emptyPoints += 1;
    }
  }
  if (!sidePoints) return 0;
  return emptyPoints / sidePoints;
};

const getHeuristicAdjustWeight = (state, columns, rows, heuristicMult) => {
  const moveCount = state?.stones?.length || 0;
  let mult = 1;
  if (moveCount <= 40) mult *= AI_HEURISTIC_EARLY_MULT;
  if (moveCount >= 121) mult *= AI_HEURISTIC_END_MULT;
  if (countEmptyCorners(state?.stones || [], columns, rows) > 0) {
    mult *= AI_HEURISTIC_CORNER_MULT;
  }
  const sideEmptyRatio = getSideEmptyRatio(state?.stones || [], columns, rows);
  if (sideEmptyRatio >= AI_HEURISTIC_SIDE_EMPTY_RATIO) {
    mult *= AI_HEURISTIC_SIDE_MULT;
  } else if (sideEmptyRatio <= AI_HEURISTIC_SIDE_FULL_RATIO) {
    mult *= AI_HEURISTIC_SIDE_PENALTY_MULT;
  }
  if (hasGreenStones(state?.stones || [])) {
    mult *= AI_HEURISTIC_GREEN_MULT;
  }
  if (columns !== rows) {
    mult *= AI_HEURISTIC_RECT_MULT;
  }
  const clamped = Math.min(
    AI_HEURISTIC_MAX_MULT,
    Math.max(AI_HEURISTIC_MIN_MULT, mult)
  );
  const colorMult = Number.isFinite(heuristicMult) ? heuristicMult : 1;
  return AI_CANDIDATE_ADJUST_WEIGHT * clamped * colorMult;
};

const getColorTuning = (aiColor) => {
  if (aiColor === "black") {
    return {
      heuristicMult: GANGHANDOL_BLACK_HEURISTIC_MULT,
      cornerSideMult: GANGHANDOL_BLACK_CORNER_SIDE_MULT,
    };
  }
  return {
    heuristicMult: GANGHANDOL_WHITE_HEURISTIC_MULT,
    cornerSideMult: GANGHANDOL_WHITE_CORNER_SIDE_MULT,
  };
};

const getCandidateKey = (move) => {
  if (!move) return null;
  if (move === "pass" || move.pass === true) return "pass";
  if (move.x && move.y) return `${move.x},${move.y}`;
  return null;
};

const getRankBucket = (rank) => {
  if (!Number.isFinite(rank)) return "그외";
  if (rank === 1) return "1순위";
  if (rank === 2) return "2순위";
  if (rank === 3) return "3순위";
  if (rank <= 5) return "4-5순위";
  if (rank <= 10) return "6-10순위";
  return "그외";
};

const getSelectedRank = (candidates, selectedMove) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const targetKey = getCandidateKey(selectedMove);
  if (!targetKey) return null;
  const ranked = candidates
    .map((entry, index) => ({
      key: getCandidateKey(entry),
      winrate: Number.isFinite(entry.winrate) ? entry.winrate : -Infinity,
      visits: Number.isFinite(entry.visits) ? entry.visits : -Infinity,
      index,
    }))
    .filter((entry) => entry.key);
  ranked.sort((a, b) => {
    if (a.winrate !== b.winrate) return b.winrate - a.winrate;
    if (a.visits !== b.visits) return b.visits - a.visits;
    return a.index - b.index;
  });
  const rankIndex = ranked.findIndex((entry) => entry.key === targetKey);
  return rankIndex >= 0 ? rankIndex + 1 : null;
};

const pickKatagoCandidateMove = (state, candidates, analysis) => {
  if (!candidates?.length) return { move: null, report: null };
  const debugEnabled = GANGHANDOL_TUNING_DEBUG;
  const debugCounts = debugEnabled
    ? { total: candidates.length, winrateDrop: 0, lowVisit: 0, ownershipLock: 0 }
    : null;
  const bestWinrate = candidates
    .map((entry) => entry.winrate)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), -Infinity);
  const hasBestWinrate = Number.isFinite(bestWinrate);
  const topCandidate = candidates
    .map((entry, index) => ({
      move: entry.pass ? "pass" : { x: entry.x, y: entry.y },
      winrate: Number.isFinite(entry.winrate) ? entry.winrate : null,
      visits: Number.isFinite(entry.visits) ? entry.visits : -Infinity,
      index,
    }))
    .filter((entry) => entry.move)
    .sort((a, b) => {
      if (a.winrate !== b.winrate) return (b.winrate ?? -Infinity) - (a.winrate ?? -Infinity);
      if (a.visits !== b.visits) return b.visits - a.visits;
      return a.index - b.index;
    })[0];
  const maxVisits = candidates
    .map((entry) => entry.visits)
    .filter(Number.isFinite)
    .reduce((max, value) => Math.max(max, value), 0);
  const tuning = getColorTuning(state.turn);
  let best = null;
  let overrideBest = null;
  const ownership =
    analysis?.ownership && analysis.ownership.length === BOARD.columns * BOARD.rows
      ? analysis.ownership
      : null;
    const report = {
      totalCandidates: candidates.length,
      candidates: candidates.length,
      bestWinrate: hasBestWinrate ? bestWinrate : null,
      maxVisits,
      topCandidate: topCandidate || null,
      potentialOverrides: 0,
      filtered: {
        winrateDrop: 0,
        passLead: 0,
        passVisit: 0,
        lowVisit: 0,
        ownershipLock: 0,
      },
      penalties: {
        lowVisitScaled: 0,
        ownershipLockApplied: 0,
      },
      selected: null,
      overrideSelected: null,
      overrideUsed: false,
    };
  const decorateSelectedSummary = (summary, selectedMove) => {
    if (!summary) return summary;
    const rank = getSelectedRank(candidates, selectedMove);
    return {
      ...summary,
      rank,
      rankBucket: getRankBucket(rank),
    };
  };
  for (const move of candidates) {
    const isPass = move.pass === true;
    const winrateDrop =
      hasBestWinrate && Number.isFinite(move.winrate)
        ? bestWinrate - move.winrate
        : null;
    if (
      hasBestWinrate &&
      Number.isFinite(move.winrate) &&
      winrateDrop >
        (isPass ? GANGHANDOL_PASS_WINRATE_DROP_MAX : AI_GANGHANDOL_WINRATE_DROP_MAX)
    ) {
      if (debugCounts) debugCounts.winrateDrop += 1;
      report.filtered.winrateDrop += 1;
      continue;
    }
    const lead = getLeadForColor(move.scoreLead, state.turn);
    if (!Number.isFinite(lead)) continue;
    if (isPass) {
      if (!GANGHANDOL_PASS_ENABLED) continue;
      if (Math.abs(lead) > GANGHANDOL_PASS_SCORELEAD_MAX) {
        report.filtered.passLead += 1;
        continue;
      }
      if (
        Number.isFinite(maxVisits) &&
        maxVisits > 0 &&
        (!Number.isFinite(move.visits) ||
          move.visits < maxVisits * GANGHANDOL_PASS_MIN_VISIT_RATIO)
      ) {
        if (debugCounts) debugCounts.lowVisit += 1;
        report.filtered.passVisit += 1;
        continue;
      }
    }
    let heuristicMult = 1;
    if (
      Number.isFinite(maxVisits) &&
      maxVisits > 0 &&
      Number.isFinite(move.visits) &&
      move.visits < maxVisits * AI_GANGHANDOL_MIN_VISIT_RATIO
    ) {
      heuristicMult *= AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT;
      if (debugCounts) debugCounts.lowVisit += 1;
      report.filtered.lowVisit += 1;
      report.penalties.lowVisitScaled += 1;
    }
    if (ownership && !isPass) {
      const index =
        (move.y - 1) * BOARD.columns + (move.x - 1);
      const ownValue = ownership[index];
      if (
        Number.isFinite(ownValue) &&
        Math.abs(ownValue) >= AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD
      ) {
        heuristicMult = 0;
        if (debugCounts) debugCounts.ownershipLock += 1;
        report.filtered.ownershipLock += 1;
        report.penalties.ownershipLockApplied += 1;
      }
    }
    const adjustWeight = isPass
      ? 0
      : getHeuristicAdjustWeight(
          state,
          BOARD.columns,
          BOARD.rows,
          tuning.heuristicMult * heuristicMult
        );
    const greenBias = isPass ? 0 : getGreenBias(move.x, move.y, state.stones);
    const greenAdjGap = isPass
      ? 0
      : getGreenAdjGapAdjust(state, move.x, move.y, BOARD.columns, BOARD.rows);
    const greenSituation = isPass
      ? 0
      : getGreenSituationAdjust(
          state,
          move.x,
          move.y,
          BOARD.columns,
          BOARD.rows
        );
    const rectAxis = isPass ? 0 : getRectAxisBias(move.x, move.y);
    const cornerSide = isPass
      ? 0
      : getCornerSideBonus(
          move.x,
          move.y,
          BOARD.columns,
          BOARD.rows,
          tuning.cornerSideMult
        );
    const greenTotal = greenBias + greenAdjGap + greenSituation;
    const totalAdjust = greenTotal + rectAxis + cornerSide;
      const heuristicScore = totalAdjust * adjustWeight;
    const score =
      compressScore(lead, AI_SCORELEAD_TANH_SCALE) +
      compressScore(heuristicScore, AI_HEURISTIC_TANH_SCALE);
    const candidateSummary = {
      move: isPass ? "pass" : { x: move.x, y: move.y },
      winrate: Number.isFinite(move.winrate) ? move.winrate : null,
      winrateDrop,
      scoreLead: lead,
      scoreLeadRaw: move.scoreLead,
      scoreLeadForTurn: lead,
      visits: Number.isFinite(move.visits) ? move.visits : null,
      adjustWeight,
      heuristicScore,
      greenTotal,
        greenBias,
        greenAdjGap,
        greenSituation,
        rectAxis,
        cornerSide,
        heuristicMult,
        score,
      };
      if (
        !isPass &&
        Number.isFinite(heuristicScore) &&
        heuristicScore >= GANGHANDOL_OVERRIDE_HEURISTIC_MIN &&
        (winrateDrop === null || winrateDrop <= GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX)
      ) {
        report.potentialOverrides += 1;
      }
      if (!best || score > best.score) {
        best = { ...move, score, summary: candidateSummary };
      }
    if (GANGHANDOL_OVERRIDE_ENABLED && heuristicMult > 0) {
      if (
        Number.isFinite(heuristicScore) &&
        heuristicScore >= GANGHANDOL_OVERRIDE_HEURISTIC_MIN &&
        (winrateDrop === null || winrateDrop <= GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX)
      ) {
        if (!overrideBest || heuristicScore > overrideBest.heuristicScore) {
          overrideBest = { ...move, heuristicScore, summary: candidateSummary };
        }
      }
    }
  }
  if (debugCounts) {
    const moveCount = state?.stones?.length || 0;
    const selected = best ? `${best.x},${best.y}` : "none";
    console.log(
      `[GanghanDol][filters] move=${moveCount} total=${debugCounts.total} drop=${debugCounts.winrateDrop} lowVisit=${debugCounts.lowVisit} ownershipLock=${debugCounts.ownershipLock} selected=${selected}`
    );
  }
    if (overrideBest) {
      const selectedMove = overrideBest.pass
        ? "pass"
        : { x: overrideBest.x, y: overrideBest.y };
      const rankedSummary = decorateSelectedSummary(
        overrideBest.summary,
        selectedMove
      );
      report.overrideSelected = rankedSummary;
      report.selected = rankedSummary;
      report.overrideUsed = true;
      return {
        move: selectedMove,
        report,
      };
    }
  if (best) {
    const selectedMove = { x: best.x, y: best.y };
    report.selected = decorateSelectedSummary(best.summary, selectedMove);
    return { move: { x: best.x, y: best.y }, report };
  }
  return { move: null, report };
};

const katagoGenMove = async (
  client,
  history,
  ruleset,
  color,
  komiInternal,
  difficulty,
  overrides
) => {
  const ok = await setupKatagoPositionSafe(client, history, ruleset, komiInternal);
  if (!ok) return null;
  await applyKatagoDifficulty(client, difficulty, overrides);
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

const katagoAnalyze = async (
  client,
  history,
  ruleset,
  color,
  stones,
  komiDisplay,
  komiInternal,
  difficulty,
  overrides
) => {
  if (!analysisSupported) return null;
  const ok = await setupKatagoPositionSafe(client, history, ruleset, komiInternal);
  if (!ok) return null;
  await applyKatagoDifficulty(client, difficulty, overrides);
  try {
    const response = await sendWithRetry(
      client,
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
      scoreLead: adjustScoreLead(analysis.scoreLead, komiDisplay, komiInternal),
    };
  } catch (err) {
    const message = String(err?.message || err || "");
    if (message.toLowerCase().includes("unknown command")) {
      analysisSupported = false;
      console.warn(
        "[katago] analysis command not supported, disabling analysis"
      );
      return null;
    }
    throw err;
  }
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

const parseResultSummary = (result) => {
  if (!result || result === "Void") {
    return { winner: null, margin: null, method: null };
  }
  const normalized = String(result).trim();
  if (normalized.endsWith("+R")) {
    const winner = normalized.startsWith("B") ? "흑" : "백";
    return { winner, margin: null, method: "불계" };
  }
  const match = normalized.match(/^([BW])\+([0-9.]+)/i);
  if (match) {
    const winner = match[1].toUpperCase() === "B" ? "흑" : "백";
    return { winner, margin: Number(match[2]), method: "집차" };
  }
  return { winner: null, margin: null, method: null };
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

const pickForVersion = (version) => {
  const entry = AI_STYLES[version];
  if (!entry) {
    throw new Error(`Unknown AI style version: ${version}`);
  }
  return entry;
};

const normalizeStyleKey = (value) => {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (key === "pure") return "native";
  if (key === "n4tive") return "native";
  if (key === "native") return "native";
  return key;
};

const resolveStyleList = (value) => {
  if (!value) return null;
  const normalized = String(value)
    .split(",")
    .map((item) => normalizeStyleKey(item))
    .filter(Boolean);
  if (normalized.length === 0) return null;
  const expanded = normalized.flatMap((item) => {
    if (item === "all") return Object.keys(AI_STYLES);
    return [item];
  });
  const unique = [...new Set(expanded)];
  unique.forEach((key) => {
    if (!AI_STYLES[key]) {
      throw new Error(`Unknown AI style version: ${key}`);
    }
  });
  return unique;
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

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${padNumber(minutes, 2)}:${padNumber(seconds, 2)}`;
};

const sanitizeLabel = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]/gi, "")
    .toLowerCase();

const formatStyleSlug = (label, fallback) => {
  const safe = String(label || fallback || "").trim();
  if (safe.toUpperCase() === "GANGHANDOL") return GANGHANDOL_AI_NAME;
  if (safe.toUpperCase() === "PURE") return "N4TIVE";
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
  difficulty,
  overrides,
  analysisEnabled,
  analysisMinMoves,
  analysisEvery,
  analysisAlwaysAfter,
  maxMoves,
}) => {
  const startedAt = Date.now();
  let state = createInitialState(ruleset, komi);
  let history = [state];
  let prevGreenSet = buildCoordSet(state.stones, "green");
  const reportBuilder = createReportBuilder({
    board: BOARD,
    gameId,
    blackLabel,
    whiteLabel,
    ruleset,
    komi,
    komiInternal,
    analysisEnabled,
    analysisMinMoves,
    analysisEvery,
    analysisAlwaysAfter,
    tuningVersion: GANGHANDOL_TUNING_VERSION,
    greenCoords: coordsFromSet(prevGreenSet),
    aiGanghandolWinrateDropMax: AI_GANGHANDOL_WINRATE_DROP_MAX,
    winrateSnapshotSampleInterval: AI_WINRATE_SNAPSHOT_SAMPLE_INTERVAL,
    winrateSnapshotDelta: AI_WINRATE_SNAPSHOT_DELTA,
    scoreLeadSnapshotDelta: AI_SCORELEAD_SNAPSHOT_DELTA,
    criticalMomentLimit: CRITICAL_MOMENT_LIMIT,
    ownershipStatsThreshold: AI_OWNERSHIP_STATS_THRESHOLD,
    maxMoves,
    getLeadForColor,
  });
  const report = reportBuilder.report;

  while (!state.over && history.length - 1 < maxMoves) {
    const moveCount = history.length - 1;
    const currentVersion = state.turn === "black" ? blackVersion : whiteVersion;
    const style = pickForVersion(currentVersion);
    const shouldAnalyze =
      analysisEnabled &&
      moveCount >= analysisMinMoves &&
      (moveCount >= analysisAlwaysAfter ||
        moveCount % analysisEvery === 0);
    const analysis = shouldAnalyze
      ? await katagoAnalyze(
          client,
          history,
          ruleset,
          state.turn,
          state.stones,
          komi,
          komiInternal,
          difficulty,
          overrides
        )
      : null;
    if (analysis?.ownership) {
      reportBuilder.updateOwnershipStats(analysis.ownership);
    }
    const resignRule = STYLE_RESIGN_RULES[currentVersion];
    if (resignRule && Number.isFinite(analysis?.scoreLead)) {
      const lead =
        analysis.scoreLead * (state.turn === "black" ? 1 : -1);
      if (
        (moveCount >= resignRule.minMoves && lead <= resignRule.lead) ||
        (moveCount >= resignRule.lateMinMoves && lead <= resignRule.lateLead)
      ) {
        const resigned = resign(state, state.turn);
        state = resigned;
        history.push(state);
        continue;
      }
    }

    const isPureKata = currentVersion === "native";
    const isGanghanDolStyle = currentVersion === "ganghandol";
    if (!isPureKata && !isGanghanDolStyle) {
      const opening = style.pickOpeningMove(state, {
        columns: BOARD.columns,
        rows: BOARD.rows,
        moveCount,
        analysis,
      });
      const openingPlaced = opening ? tryPlace(state, opening) : null;
      if (openingPlaced) {
        state = openingPlaced;
        history.push(state);
        continue;
      }
    }

    if (isGanghanDolStyle) {
      const { candidates, failureLines } = await katagoGenMoveCandidates(
        client,
        history,
        ruleset,
        state.turn,
        state.stones,
        komi,
        komiInternal,
        difficulty,
        overrides
      );
      if (failureLines?.length) {
        report.강한돌_후보_선택_통계.파싱실패로그.push({
          수: state.moveCount ?? history.length - 1,
          플레이어: state.turn === "black" ? "흑" : "백",
          lines: failureLines,
        });
      }
      const { move: adjusted, report: selectionReport } = pickKatagoCandidateMove(
        state,
        candidates,
        analysis
      );
      reportBuilder.recordSelection({
        selectionReport,
        turn: state.turn,
        analysis,
        state,
        historyLength: history.length,
      });
      const adjustedPlaced = adjusted ? tryPlace(state, adjusted) : null;
      if (adjustedPlaced) {
        state = adjustedPlaced;
        history.push(state);
        continue;
      }
    }

    const kataMove = await katagoGenMove(
      client,
      history,
      ruleset,
      state.turn,
      komiInternal,
      difficulty,
      overrides
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
      if (!isPureKata && !isGanghanDolStyle) {
        const styled = style.pickStyleOverrideMove(state, kataMove, {
          columns: BOARD.columns,
          rows: BOARD.rows,
          moveCount,
          analysis,
        });
        const styledPlaced = styled ? tryPlace(state, styled) : null;
        if (styledPlaced) {
          const overridesKata =
            !(styled?.x === kataMove?.x && styled?.y === kataMove?.y);
          if (overridesKata) {
            client.positionMoves = null;
          }
          state = styledPlaced;
          history.push(state);
          continue;
        }
      }

      const kataPlaced = tryPlace(state, kataMove);
      if (kataPlaced) {
        state = kataPlaced;
        history.push(state);
        continue;
      }
    }

    client.positionMoves = null;

    if (!isPureKata && !isGanghanDolStyle) {
      const fallback = style.pickStyleFallbackMove(state, {
        columns: BOARD.columns,
        rows: BOARD.rows,
        moveCount,
        analysis,
      });
      const fallbackPlaced = fallback ? tryPlace(state, fallback) : null;
      if (fallbackPlaced) {
        state = fallbackPlaced;
        history.push(state);
        continue;
      }
    }

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
  const finishedAt = Date.now();
  const finishedIso = new Date(finishedAt).toISOString();
  const summary = parseResultSummary(result);
  reportBuilder.finalizeReport({
    result,
    summary,
    duration,
    finishedIso,
    moveCount: history.length - 1,
    greenCoords: finalGreenCoords,
  });
  return {
    history,
    result,
    moveCount: history.length - 1,
    blackVersion,
    whiteVersion,
    gameId,
    duration,
    durationMs,
    report,
  };
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const games = Number(args.games) || 10;
  const swap = Number(args.swap) || Math.floor(games / 2);
  const blackList = resolveStyleList(args.black);
  const whiteList = resolveStyleList(args.white);
  const randomColors =
    args.randomColors === undefined ? false : args.randomColors !== "0";
  const maxMoves = Number(args.maxMoves) || 350;
  const difficulty = String(args.difficulty || "god");
  const ruleset = String(args.ruleset || "japanese");
  const komi = Number.isFinite(Number(args.komi))
    ? Number(args.komi)
    : 0;
  const komiInternal = getInternalKomi(komi);
  const analysisEnabled = args.analysis === undefined ? true : args.analysis !== "0";
  const analysisMinMoves = Number.isFinite(Number(args.analysisMin))
    ? Number(args.analysisMin)
    : KATAGO_ANALYSIS_MIN_MOVES;
  const analysisEvery = Number.isFinite(Number(args.analysisEvery))
    ? Math.max(1, Number(args.analysisEvery))
    : KATAGO_ANALYSIS_EVERY;
  const analysisAlwaysAfter = Number.isFinite(Number(args.analysisAlwaysAfter))
    ? Number(args.analysisAlwaysAfter)
    : KATAGO_ANALYSIS_ALWAYS_AFTER;
  const writeJson = args.json === undefined ? false : args.json !== "0";
  const overrideVisits = Number(args.maxVisits);
  const overrideTime = Number(args.maxTime);
  const overrides =
    Number.isFinite(overrideVisits) || Number.isFinite(overrideTime)
      ? {
          maxVisits: Number.isFinite(overrideVisits) ? overrideVisits : undefined,
          maxTime: Number.isFinite(overrideTime) ? overrideTime : undefined,
        }
      : null;

  if (!KATAGO_ENABLED) {
    console.error(
      "KataGo 설정이 없습니다. KATAGO_PATH/KATAGO_CONFIG/KATAGO_MODEL을 설정하세요."
    );
    process.exit(1);
  }
  if (BOARD.columns !== BOARD.rows && !KATAGO_ALLOW_RECT) {
    console.error("KATAGO_ALLOW_RECT=1 설정이 필요합니다.");
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
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
        analysisSupported = false;
        console.warn(
          "[katago] analysis command not supported, disabling analysis"
        );
        return { handled: true, response: { ok: false, lines: [] } };
      }
      if (
        command.startsWith("kata-set-param") ||
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
  } catch {
    // ignore warmup failures
  }
  client.enableStderr();

  const results = [];
  for (let i = 0; i < games; i += 1) {
    const pickFrom = (list) =>
      list ? list[Math.floor(Math.random() * list.length)] : null;
    let blackVersion =
      pickFrom(blackList) || (i < swap ? "native" : "ganghandol");
    let whiteVersion =
      pickFrom(whiteList) || (i < swap ? "ganghandol" : "native");

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
    const blackLabel = AI_STYLE_LABELS[blackVersion] || blackVersion;
    const whiteLabel = AI_STYLE_LABELS[whiteVersion] || whiteVersion;
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
      difficulty,
      overrides,
      analysisEnabled,
      analysisMinMoves,
      analysisEvery,
      analysisAlwaysAfter,
      maxMoves,
    });
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
    const blackSlug = formatStyleSlug(blackLabel, game.blackVersion);
    const whiteSlug = formatStyleSlug(whiteLabel, game.whiteVersion);
    const sgfName = `game_${gameId}_B${blackSlug}_W${whiteSlug}.sgf`;
    fs.writeFileSync(path.join(outDir, sgfName), sgf, "utf8");
    if (game.report) {
      const reportName = sgfName.replace(/\.sgf$/i, ".report.log");
      const meta = game.report.메타 ?? {};
      const summary = game.report.대국요약 ?? null;
      const green = game.report.초록돌 ?? null;
      const stats = game.report.강한돌_후보_선택_통계 ?? null;
      const strategy = game.report.전략지표 ?? null;
      const critical = game.report.결정적순간 ?? [];
      const snapshots = game.report.승률_스냅샷 ?? [];
      const ownershipStats = game.report.ownershipStats ?? null;

        const orderedMeta = {
          대국ID: meta.대국ID ?? null,
          흑: meta.흑 ?? null,
          백: meta.백 ?? null,
          규칙: meta.규칙 ?? null,
          덤: meta.덤 ?? null,
          보드: meta.보드 ?? null,
          시작시각: meta.시작시각 ?? null,
          종료시각: meta.종료시각 ?? null,
          소요시간: meta.소요시간 ?? null,
          강한돌버전: meta.강한돌버전 ?? null,
          초록돌좌표: meta.초록돌좌표 ?? null,
          내부덤: meta.내부덤 ?? null,
          분석: meta.분석 ?? null,
          sgf: sgfName,
        };

      const orderedSummary = summary
        ? {
            결과: summary.결과 ?? null,
            승자: summary.승자 ?? null,
            집차: summary.집차 ?? null,
            판정: summary.판정 ?? null,
            수: summary.수 ?? null,
            소요시간: summary.소요시간 ?? null,
          }
        : null;

      const orderedGreen = green
        ? {
            누적점수: green.누적점수 ?? null,
            선택횟수: green.선택횟수 ?? null,
          }
        : null;

      const orderedStats = stats
        ? {
            총수: stats.총수 ?? null,
            패스선택: stats.패스선택 ?? null,
            후보총수: stats.후보총수 ?? null,
            파싱실패로그: stats.파싱실패로그 ?? [],
            순위상세: stats.순위상세 ?? null,
            필터: stats.필터 ?? null,
            패널티: stats.패널티 ?? null,
            승률델타: stats.승률델타 ?? null,
            방문수: stats.방문수 ?? null,
          }
        : null;

        const orderedStrategy = strategy
          ? {
              벽차단횟수: strategy.벽차단횟수 ?? null,
              벽거리_집차: strategy.벽거리_집차 ?? null,
              스타일오버라이드: strategy.스타일오버라이드 ?? null,
            }
          : null;

        const reportData = {
          메타: orderedMeta,
          대국요약: orderedSummary,
          결정적순간: critical,
          전략지표: orderedStrategy,
          초록돌: orderedGreen,
          강한돌_후보_선택_통계: orderedStats,
          승률_스냅샷: snapshots,
          ownershipStats,
        };
      fs.writeFileSync(
        path.join(outDir, reportName),
        JSON.stringify(reportData, null, 2),
        "utf8"
      );
    }
    results.push({
      game: gameId,
      black: blackLabel,
      white: whiteLabel,
      blackKey: game.blackVersion,
      whiteKey: game.whiteVersion,
      result: game.result,
      moves: game.moveCount,
      duration: game.duration,
      sgf: sgfName,
    });
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

  client.stop();

  const csvLines = ["game,black,white,black_key,white_key,result,moves,duration,sgf"];
  results.forEach((row) => {
    csvLines.push(
      `${row.game},${row.black},${row.white},${row.blackKey},${row.whiteKey},${row.result},${row.moves},${row.duration},${row.sgf}`
    );
  });
  const rangeName = `game${padNumber(startIndex, idWidth)}-game${padNumber(
    endIndex,
    idWidth
  )}`;
  fs.writeFileSync(
    path.join(outDir, `results_${rangeName}.csv`),
    csvLines.join("\n"),
    "utf8"
  );
  if (writeJson) {
    fs.writeFileSync(
      path.join(outDir, `results_${rangeName}.json`),
      JSON.stringify(results, null, 2),
      "utf8"
    );
  }

  logInfo(`\nSaved to: ${outDir}`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

