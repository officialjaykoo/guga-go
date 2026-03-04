const buildStoneMap = (stones) => {
  const map = new Map();
  (stones || []).forEach((stone) => {
    map.set(`${stone.x},${stone.y}`, stone.color);
  });
  return map;
};

const collectNeutralEmptyPoints = () => {
  // Green stones act as walls; they do not neutralize nearby territory.
  return new Set();
};

export const normalizeOwnershipForRules = (
  ownership,
  { columns, rows, stones, threshold = 0.05 }
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

export const parseKataGoAnalyzeText = (lines, { columns, rows }) => {
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

export const extractAnalysisFromLines = (
  lines,
  { columns, rows, stones, threshold = 0.05 }
) => {
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
        const normalized = normalizeOwnershipForRules(ownership, {
          columns,
          rows,
          stones,
          threshold,
        });
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
  const parsed = parseKataGoAnalyzeText(lines, { columns, rows });
  if (!parsed.ownership && !Number.isFinite(parsed.scoreLead)) {
    return null;
  }
  if (parsed.ownership) {
    const normalized = normalizeOwnershipForRules(parsed.ownership, {
      columns,
      rows,
      stones,
      threshold,
    });
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
