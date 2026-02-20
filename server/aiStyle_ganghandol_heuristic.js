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
  AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT,
  AI_GANGHANDOL_MIN_VISIT_RATIO,
  AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD,
  AI_GANGHANDOL_WINRATE_DROP_MAX,
  GANGHANDOL_PASS_ENABLED,
  GANGHANDOL_PASS_SCORELEAD_MAX,
  GANGHANDOL_PASS_WINRATE_DROP_MAX,
  GANGHANDOL_PASS_MIN_VISIT_RATIO,
  GANGHANDOL_OVERRIDE_ENABLED,
  GANGHANDOL_OVERRIDE_HEURISTIC_MIN,
  GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX,
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
  GANGHANDOL_BLACK_CORNER_SIDE_MULT,
  GANGHANDOL_BLACK_HEURISTIC_MULT,
  GANGHANDOL_WHITE_CORNER_SIDE_MULT,
  GANGHANDOL_WHITE_HEURISTIC_MULT,
  AI_RECT_AXIS_BONUS,
  AI_SCORELEAD_TANH_SCALE,
  AI_SIDE_BONUS,
} from "./aiStyle_ganghandol_heuristic_config.js";

export const AI_STYLE_NAME = "GanghanDol";
const GANGHANDOL_TUNING_DEBUG =
  process.env.GANGHANDOL_TUNING_DEBUG === "1" ||
  process.env.GANGHANDOL_TUNING_DEBUG === "true";

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
    map.set(`${stone.x},${stone.y}`, stone);
  });
  return map;
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
      if (stone.color === "green") {
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

const getRectAxisBias = (x, y, columns, rows) => {
  if (columns === rows) return 0;
  const centerX = (columns + 1) / 2;
  const centerY = (rows + 1) / 2;
  const dx = Math.abs(x - centerX);
  const dy = Math.abs(y - centerY);
  if (columns > rows) {
    return (dx - dy) * AI_RECT_AXIS_BONUS;
  }
  return (dy - dx) * AI_RECT_AXIS_BONUS;
};

const getGreenBias = (stones, x, y) => {
  const greens = stones?.filter((stone) => stone?.color === "green") || [];
  if (!greens.length) return 0;
  let best = 0;
  greens.forEach((stone) => {
    const dist = Math.abs(x - stone.x) + Math.abs(y - stone.y);
    let bonus = 0;
    if (dist === 1) {
      bonus = AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_ADJ;
    } else if (dist === 2) {
      bonus = AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_GAP1;
    } else if (dist === 3) {
      bonus = AI_GREEN_CANDIDATE_BONUS * AI_GREEN_BONUS_GAP2;
    } else {
      return;
    }
    if (bonus > best) best = bonus;
  });
  return best;
};

const hasGreenStones = (stones) =>
  (stones || []).some((stone) => stone?.color === "green");

const getGreenAdjGapAdjust = (state, x, y, columns, rows, aiColor) => {
  const stoneMap = buildStoneMap(state?.stones || []);
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
    if (stone.player === aiColor) {
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

const getGreenSituationAdjust = (state, x, y, columns, rows, aiColor) => {
  const stoneMap = buildStoneMap(state?.stones || []);
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
    if (stone.player === aiColor) {
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
    const libs = getGroupLiberties(stoneMap, stone, aiColor, columns, rows);
    if (libs <= 2) emergency = true;
  });
  if (emergency && greenAdj >= 1) {
    adjust += AI_GREEN_EMERGENCY_BONUS;
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

export const pickCandidateMove = (state, candidates, options = {}) => {
  if (!candidates?.length) return null;
  const columns = options.columns;
  const rows = options.rows;
  const aiColor = options.aiColor || state?.turn;
  if (!columns || !rows || !aiColor) return null;
  const analysis = options.analysis;
  const debugEnabled = GANGHANDOL_TUNING_DEBUG;
  const debugCounts = debugEnabled
    ? { total: candidates.length, winrateDrop: 0, lowVisit: 0, ownershipLock: 0 }
    : null;
  const tuning = getColorTuning(aiColor);
  const adjustWeight = getHeuristicAdjustWeight(
    state,
    columns,
    rows,
    tuning.heuristicMult
  );
  let bestWinrate = null;
  let maxVisits = null;
  let overrideBest = null;
  for (const move of candidates) {
    if (Number.isFinite(move?.winrate)) {
      bestWinrate =
        bestWinrate === null ? move.winrate : Math.max(bestWinrate, move.winrate);
    }
    if (Number.isFinite(move?.visits)) {
      maxVisits =
        maxVisits === null ? move.visits : Math.max(maxVisits, move.visits);
    }
  }
  let best = null;
  for (const move of candidates) {
    const isPass = move?.pass === true;
    if (
      Number.isFinite(bestWinrate) &&
      Number.isFinite(move?.winrate) &&
      bestWinrate - move.winrate >
        (isPass ? GANGHANDOL_PASS_WINRATE_DROP_MAX : AI_GANGHANDOL_WINRATE_DROP_MAX)
    ) {
      if (debugCounts) debugCounts.winrateDrop += 1;
      continue;
    }
    if (isPass) {
      if (!GANGHANDOL_PASS_ENABLED) {
        continue;
      }
      if (
        Number.isFinite(move?.scoreLead) &&
        Math.abs(move.scoreLead) > GANGHANDOL_PASS_SCORELEAD_MAX
      ) {
        continue;
      }
      if (
        Number.isFinite(maxVisits) &&
        Number.isFinite(move?.visits) &&
        maxVisits > 0 &&
        move.visits < maxVisits * GANGHANDOL_PASS_MIN_VISIT_RATIO
      ) {
        if (debugCounts) debugCounts.lowVisit += 1;
        continue;
      }
      const baseLead = Number.isFinite(move.scoreLead) ? move.scoreLead : 0;
      const lead = aiColor === "black" ? baseLead : -baseLead;
      const score = compressScore(lead, AI_SCORELEAD_TANH_SCALE);
      if (!best || score > best.score) {
        best = { ...move, score };
      }
      continue;
    }
    const baseLead = Number.isFinite(move.scoreLead) ? move.scoreLead : 0;
    const lead = aiColor === "black" ? baseLead : -baseLead;
    const adjust =
      getGreenBias(state?.stones || [], move.x, move.y) +
      getRectAxisBias(move.x, move.y, columns, rows) +
      getGreenAdjGapAdjust(state, move.x, move.y, columns, rows, aiColor) +
      getGreenSituationAdjust(state, move.x, move.y, columns, rows, aiColor) +
      getCornerSideBonus(move.x, move.y, columns, rows, tuning.cornerSideMult);
    let heuristicMult = 1;
    if (
      Number.isFinite(maxVisits) &&
      Number.isFinite(move?.visits) &&
      maxVisits > 0 &&
      move.visits < maxVisits * AI_GANGHANDOL_MIN_VISIT_RATIO
    ) {
      heuristicMult *= AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT;
      if (debugCounts) debugCounts.lowVisit += 1;
    }
    const ownership = analysis?.ownership;
    if (Array.isArray(ownership) && ownership.length === columns * rows) {
      const idx = (move.y - 1) * columns + (move.x - 1);
      if (
        idx >= 0 &&
        idx < ownership.length &&
        Math.abs(ownership[idx]) >= AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD
      ) {
        heuristicMult = 0;
        if (debugCounts) debugCounts.ownershipLock += 1;
      }
    }
    const heuristicScore = adjust * adjustWeight * heuristicMult;
    const score =
      compressScore(lead, AI_SCORELEAD_TANH_SCALE) +
      compressScore(heuristicScore, AI_HEURISTIC_TANH_SCALE);
    if (!best || score > best.score) {
      best = { ...move, score };
    }
    if (GANGHANDOL_OVERRIDE_ENABLED && heuristicMult > 0) {
      const winrateDrop =
        Number.isFinite(bestWinrate) && Number.isFinite(move?.winrate)
          ? bestWinrate - move.winrate
          : null;
      if (
        Number.isFinite(heuristicScore) &&
        heuristicScore >= GANGHANDOL_OVERRIDE_HEURISTIC_MIN &&
        (winrateDrop === null || winrateDrop <= GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX)
      ) {
        if (!overrideBest || heuristicScore > overrideBest.heuristicScore) {
          overrideBest = { ...move, heuristicScore };
        }
      }
    }
  }
  if (debugCounts) {
    const moveCount = state?.stones?.length || 0;
    const selected = best
      ? best.pass
        ? "pass"
        : `${best.x},${best.y}`
      : "none";
    console.log(
      `[GanghanDol][filters] move=${moveCount} total=${debugCounts.total} drop=${debugCounts.winrateDrop} lowVisit=${debugCounts.lowVisit} ownershipLock=${debugCounts.ownershipLock} selected=${selected}`
    );
  }
  if (overrideBest) return { x: overrideBest.x, y: overrideBest.y };
  if (!best) return null;
  if (best.pass) return { pass: true };
  return { x: best.x, y: best.y };
};

export const pickOpeningMove = () => null;
export const pickStyleOverrideMove = () => null;
export const pickStyleFallbackMove = () => null;

