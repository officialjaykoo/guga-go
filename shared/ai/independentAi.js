import fs from "node:fs";
import { placeStone } from "../game/engine.js";

const DEFAULT_BOARD = { columns: 19, rows: 13 };
const PHASES = ["early", "mid", "late"];

const defaultWeights = {
  prior: 1.0,
  phase: 0.45,
  capture: 2.0,
  connect: 0.25,
  pressure: 0.15,
  green: 0.08,
  center: 0.2,
  noise: 0.02,
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const normalizeBoard = (board, fallback = DEFAULT_BOARD) => {
  const columns = Number(board?.columns);
  const rows = Number(board?.rows);
  if (Number.isInteger(columns) && columns > 1 && Number.isInteger(rows) && rows > 1) {
    return { columns, rows };
  }
  return { ...fallback };
};

const createEmptyPriors = () => ({
  black: {},
  white: {},
  pass: { black: -4, white: -4 },
});

const createEmptyPhasePriors = () => ({
  early: createEmptyPriors(),
  mid: createEmptyPriors(),
  late: createEmptyPriors(),
});

const getDifficultyNoise = (difficulty) => {
  const key = String(difficulty || "god").toLowerCase();
  if (key === "intro") return 0.35;
  if (key === "low") return 0.25;
  if (key === "mid") return 0.18;
  if (key === "high") return 0.12;
  if (key === "master") return 0.07;
  return 0.03;
};

const buildStoneMap = (stones) => {
  const map = new Map();
  (stones || []).forEach((stone) => {
    map.set(`${stone.x},${stone.y}`, stone);
  });
  return map;
};

const getNeighbors = (x, y, columns, rows) => {
  const out = [];
  if (x > 1) out.push([x - 1, y]);
  if (x < columns) out.push([x + 1, y]);
  if (y > 1) out.push([x, y - 1]);
  if (y < rows) out.push([x, y + 1]);
  return out;
};

const adjacencyFeatures = (map, x, y, columns, rows, player) => {
  let ownAdj = 0;
  let oppAdj = 0;
  let greenAdj = 0;
  getNeighbors(x, y, columns, rows).forEach(([nx, ny]) => {
    const stone = map.get(`${nx},${ny}`);
    if (!stone) return;
    if (stone.color === "green") {
      greenAdj += 1;
      return;
    }
    if (stone.player === player) ownAdj += 1;
    else oppAdj += 1;
  });
  return { ownAdj, oppAdj, greenAdj };
};

const centerBias = (x, y, columns, rows) => {
  const cx = (columns + 1) / 2;
  const cy = (rows + 1) / 2;
  const dx = Math.abs(x - cx) / Math.max(1, columns / 2);
  const dy = Math.abs(y - cy) / Math.max(1, rows / 2);
  return 1 - clamp((dx + dy) / 2, 0, 1);
};

const parsePolicyMove = (value) => {
  if (!value) return null;
  if (typeof value === "string") {
    if (value.toLowerCase() === "pass") return { pass: true };
    return null;
  }
  if (value?.pass) return { pass: true };
  if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
    return { x: Number(value.x), y: Number(value.y) };
  }
  return null;
};

const safeNumber = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

const phaseFromProgress = (progress) => {
  if (progress < 0.22) return "early";
  if (progress < 0.62) return "mid";
  return "late";
};

const detectPhaseFromState = (state, board) => {
  const moveCount = Number.isFinite(state?.moveCount)
    ? Number(state.moveCount)
    : Array.isArray(state?.stones)
      ? state.stones.length
      : 0;
  const area = Math.max(1, board.columns * board.rows);
  const progress = clamp(moveCount / area, 0, 1);
  return phaseFromProgress(progress);
};

const detectPhaseFromRow = (row, board) => {
  const move = safeNumber(row?.move, 0);
  const gameMoves = safeNumber(row?.context?.gameMoves, 0);
  if (gameMoves > 0) {
    return phaseFromProgress(clamp((move - 1) / gameMoves, 0, 1));
  }
  const area = Math.max(1, board.columns * board.rows);
  return phaseFromProgress(clamp(move / area, 0, 1));
};

const buildCenteredLogPrior = (countMap, totalCount) => {
  const total = Math.max(1e-9, safeNumber(totalCount, 0));
  const eps = 1e-6;
  const probs = [];
  countMap.forEach((cnt, key) => {
    const p = clamp(cnt / total, 0, 1);
    probs.push({ key, p });
  });
  if (!probs.length) return {};

  const mean = probs.reduce((acc, item) => acc + Math.log(item.p + eps), 0) / probs.length;
  const out = {};
  probs.forEach((item) => {
    out[item.key] = Number((Math.log(item.p + eps) - mean).toFixed(6));
  });
  return out;
};

const buildPassPrior = (passCount, totalCount) => {
  const eps = 1e-6;
  const p = clamp(safeNumber(passCount, 0) / Math.max(1e-9, safeNumber(totalCount, 0)), 0, 1);
  return Number(Math.log(p + eps).toFixed(6));
};

export const loadIndependentModel = (modelPath) => {
  try {
    const text = fs.readFileSync(modelPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(text);
    const weights = { ...defaultWeights, ...(parsed?.weights || {}) };
    return {
      version: parsed?.version || "independent-v2",
      board: normalizeBoard(parsed?.board, DEFAULT_BOARD),
      priors: parsed?.priors || createEmptyPriors(),
      phasePriors: parsed?.phasePriors || createEmptyPhasePriors(),
      weights,
      metadata: parsed?.metadata || null,
    };
  } catch {
    return {
      version: "independent-v2",
      board: { ...DEFAULT_BOARD },
      priors: createEmptyPriors(),
      phasePriors: createEmptyPhasePriors(),
      weights: { ...defaultWeights },
      metadata: { fallback: true },
    };
  }
};

export const pickIndependentMove = (
  state,
  {
    model,
    board = DEFAULT_BOARD,
    difficulty = "god",
    randomFn = null,
  } = {}
) => {
  if (!state) return "pass";
  const rand = typeof randomFn === "function" ? randomFn : Math.random;
  const normalizedBoard = normalizeBoard(board, normalizeBoard(model?.board, DEFAULT_BOARD));
  const columns = normalizedBoard.columns;
  const rows = normalizedBoard.rows;
  const weights = { ...defaultWeights, ...(model?.weights || {}) };
  const turn = state.turn === "white" ? "white" : "black";
  const phase = detectPhaseFromState(state, normalizedBoard);

  const priors = model?.priors?.[turn] || {};
  const phasePriors = model?.phasePriors?.[phase]?.[turn] || {};
  const passPrior = safeNumber(model?.priors?.pass?.[turn], -4);
  const passPhasePrior = safeNumber(model?.phasePriors?.[phase]?.pass?.[turn], 0);
  const noiseScale = getDifficultyNoise(difficulty);
  const stoneMap = buildStoneMap(state?.stones || []);

  let best = null;

  for (let y = 1; y <= rows; y += 1) {
    for (let x = 1; x <= columns; x += 1) {
      if (stoneMap.has(`${x},${y}`)) continue;
      const next = placeStone(state, x, y);
      if (next === state) continue;

      const captureDelta =
        safeNumber(next?.captures?.[turn], 0) - safeNumber(state?.captures?.[turn], 0);
      const adj = adjacencyFeatures(stoneMap, x, y, columns, rows, turn);
      const prior = safeNumber(priors?.[`${x},${y}`], 0);
      const phasePrior = safeNumber(phasePriors?.[`${x},${y}`], 0);
      const center = centerBias(x, y, columns, rows);
      const noise = (rand() * 2 - 1) * noiseScale;

      const score =
        weights.prior * prior +
        weights.phase * phasePrior +
        weights.capture * captureDelta +
        weights.connect * adj.ownAdj -
        weights.pressure * adj.oppAdj +
        weights.green * adj.greenAdj +
        weights.center * center +
        weights.noise * noise;

      if (!best || score > best.score) {
        best = { x, y, score };
      }
    }
  }

  if (!best) return "pass";

  const passNoise = (rand() * 2 - 1) * noiseScale;
  const passScore =
    passPrior + weights.phase * passPhasePrior + weights.noise * passNoise;
  if (passScore > best.score) return "pass";

  return { x: best.x, y: best.y };
};

export const buildIndependentModelFromRows = ({ rows, board }) => {
  const normalizedBoard = normalizeBoard(board, DEFAULT_BOARD);

  const counts = {
    black: new Map(),
    white: new Map(),
    pass: { black: 0, white: 0 },
    total: { black: 0, white: 0 },
  };

  const phaseCounts = {
    early: {
      black: new Map(),
      white: new Map(),
      pass: { black: 0, white: 0 },
      total: { black: 0, white: 0 },
    },
    mid: {
      black: new Map(),
      white: new Map(),
      pass: { black: 0, white: 0 },
      total: { black: 0, white: 0 },
    },
    late: {
      black: new Map(),
      white: new Map(),
      pass: { black: 0, white: 0 },
      total: { black: 0, white: 0 },
    },
  };

  rows.forEach((row) => {
    const turn = row?.turn === "white" ? "white" : row?.turn === "black" ? "black" : null;
    if (!turn) return;
    const move = parsePolicyMove(row?.policyTarget);
    if (!move) return;

    const valueTarget = Number(row?.valueTarget);
    const sampleWeight = Number.isFinite(valueTarget)
      ? clamp(0.5 + valueTarget, 0.25, 1.75)
      : 1;

    const phase = detectPhaseFromRow(row, normalizedBoard);

    counts.total[turn] += sampleWeight;
    phaseCounts[phase].total[turn] += sampleWeight;

    if (move.pass) {
      counts.pass[turn] += sampleWeight;
      phaseCounts[phase].pass[turn] += sampleWeight;
      return;
    }

    const key = `${move.x},${move.y}`;
    counts[turn].set(key, (counts[turn].get(key) || 0) + sampleWeight);
    phaseCounts[phase][turn].set(
      key,
      (phaseCounts[phase][turn].get(key) || 0) + sampleWeight
    );
  });

  const priors = createEmptyPriors();
  ["black", "white"].forEach((turn) => {
    priors[turn] = buildCenteredLogPrior(counts[turn], counts.total[turn]);
    priors.pass[turn] = buildPassPrior(counts.pass[turn], counts.total[turn]);
  });

  const phasePriors = createEmptyPhasePriors();
  PHASES.forEach((phase) => {
    ["black", "white"].forEach((turn) => {
      phasePriors[phase][turn] = buildCenteredLogPrior(
        phaseCounts[phase][turn],
        phaseCounts[phase].total[turn]
      );
      phasePriors[phase].pass[turn] = buildPassPrior(
        phaseCounts[phase].pass[turn],
        phaseCounts[phase].total[turn]
      );
    });
  });

  return {
    version: "independent-v2",
    board: normalizedBoard,
    priors,
    phasePriors,
    weights: { ...defaultWeights },
    metadata: {
      createdAt: new Date().toISOString(),
      rows: rows.length,
      note: "global+phase priors from labeled rows (value-weighted)",
    },
  };
};


