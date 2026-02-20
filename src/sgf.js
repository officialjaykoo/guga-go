import { createInitialState, passTurn, placeStone } from "./gameEngine.js";

const DEFAULT_COLUMNS = 19;
const DEFAULT_ROWS = 13;
const COORD_CHARS = "abcdefghijklmnopqrstuvwxyz";

const stripBom = (text) => String(text || "").replace(/^\uFEFF/, "");

const charToIndex = (value) => {
  if (!value) return -1;
  const lower = value.toLowerCase();
  return COORD_CHARS.indexOf(lower);
};

const indexToChar = (idx) => COORD_CHARS[idx] || "";

const parseSize = (value) => {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.includes(":")) {
    const [w, h] = text.split(":");
    const columns = Number(w);
    const rows = Number(h);
    if (Number.isFinite(columns) && Number.isFinite(rows)) {
      return { columns, rows };
    }
    return null;
  }
  const size = Number(text);
  if (Number.isFinite(size)) {
    return { columns: size, rows: size };
  }
  return null;
};

const normalizeRuleset = (value, fallback = "korean") => {
  const text = String(value || "").toLowerCase();
  if (text.includes("korean")) return "korean";
  if (text.includes("japanese")) return "japanese";
  if (text.includes("chinese")) return "chinese";
  return fallback;
};

const rulesetToSgf = (ruleset) => {
  if (ruleset === "korean") return "Korean";
  if (ruleset === "japanese") return "Japanese";
  if (ruleset === "chinese") return "Chinese";
  return "Japanese";
};

const readSgfValue = (text, start) => {
  let idx = start;
  let value = "";
  let escaping = false;
  while (idx < text.length) {
    const ch = text[idx];
    if (escaping) {
      if (ch === "\n" || ch === "\r") {
        idx += 1;
        escaping = false;
        continue;
      }
      value += ch;
      idx += 1;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      idx += 1;
      continue;
    }
    if (ch === "]") {
      return { value, next: idx + 1 };
    }
    value += ch;
    idx += 1;
  }
  return { value, next: idx };
};

const parseNodes = (sgfText) => {
  const text = stripBom(sgfText);
  const nodes = [];
  let depth = 0;
  let idx = 0;
  let current = null;

  const pushNode = () => {
    if (current) {
      nodes.push(current);
      current = null;
    }
  };

  while (idx < text.length) {
    const ch = text[idx];
    if (ch === "(") {
      if (!current) {
        pushNode();
      }
      depth += 1;
      idx += 1;
      continue;
    }
    if (ch === ")") {
      pushNode();
      depth = Math.max(0, depth - 1);
      idx += 1;
      continue;
    }
    if (depth !== 1) {
      idx += 1;
      continue;
    }
    if (ch === ";") {
      pushNode();
      current = {};
      idx += 1;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let name = "";
      while (idx < text.length && /[A-Za-z]/.test(text[idx])) {
        name += text[idx];
        idx += 1;
      }
      if (!name) {
        idx += 1;
        continue;
      }
      const values = [];
      while (text[idx] === "[") {
        const parsed = readSgfValue(text, idx + 1);
        values.push(parsed.value);
        idx = parsed.next;
      }
      if (!current) current = {};
      if (current[name]) {
        current[name] = current[name].concat(values);
      } else {
        current[name] = values;
      }
      continue;
    }
    idx += 1;
  }
  pushNode();
  return nodes;
};

export const parseSgf = (sgfText) => {
  const nodes = parseNodes(sgfText);
  const root = nodes[0] || {};
  const size = parseSize(root.SZ?.[0]);
  const komiRaw = root.KM?.[0];
  const komi = Number.isFinite(Number(komiRaw)) ? Number(komiRaw) : null;
  const rules = root.RU?.[0] || "";
  const playerBlack = root.PB?.[0] || "";
  const playerWhite = root.PW?.[0] || "";
  const result = root.RE?.[0] || "";
  const setup = {
    black: Array.isArray(root.AB) ? root.AB.slice() : [],
    white: Array.isArray(root.AW) ? root.AW.slice() : [],
  };
  const moves = [];

  nodes.forEach((node, idx) => {
    if (idx === 0) return;
    if (node.B && node.B.length) {
      moves.push({ color: "black", value: node.B[0] ?? "" });
      return;
    }
    if (node.W && node.W.length) {
      moves.push({ color: "white", value: node.W[0] ?? "" });
    }
  });

  return {
    size,
    komi,
    rules,
    playerBlack,
    playerWhite,
    result,
    setup,
    moves,
  };
};

const valueToPoint = (value, columns, rows) => {
  if (!value || value.length < 2) {
    return { pass: true };
  }
  const xIdx = charToIndex(value[0]);
  const yIdx = charToIndex(value[1]);
  if (xIdx < 0 || yIdx < 0) return null;
  const x = xIdx + 1;
  const y = rows - yIdx;
  if (x < 1 || x > columns || y < 1 || y > rows) return null;
  return { x, y };
};

const pointToValue = (x, y, columns, rows) => {
  const xIdx = x - 1;
  const yIdx = rows - y;
  if (xIdx < 0 || yIdx < 0) return "";
  if (xIdx >= COORD_CHARS.length || yIdx >= COORD_CHARS.length) return "";
  if (xIdx >= columns || yIdx >= rows) return "";
  return `${indexToChar(xIdx)}${indexToChar(yIdx)}`;
};

const getBoardHash = (stones) => {
  const parts = (stones || [])
    .map((stone) => `${stone.x},${stone.y},${stone.color}`)
    .sort();
  return parts.join("|");
};

export const buildHistoryFromSgf = (parsed, options = {}) => {
  const columns = options.columns || DEFAULT_COLUMNS;
  const rows = options.rows || DEFAULT_ROWS;
  if (parsed?.size) {
    if (
      parsed.size.columns !== columns ||
      parsed.size.rows !== rows
    ) {
      return {
        ok: false,
        error: "size_mismatch",
        expected: { columns, rows },
        found: parsed.size,
      };
    }
  }

  const ruleset = normalizeRuleset(parsed?.rules, options.fallbackRuleset);
  const komi = Number.isFinite(parsed?.komi)
    ? parsed.komi
    : Number.isFinite(options.fallbackKomi)
    ? options.fallbackKomi
    : 0;

  let state = createInitialState(ruleset, komi);
  const setupStones = [];
  let moveNumber = 1;
  const used = new Set();

  const pushSetup = (value, color) => {
    const point = valueToPoint(value, columns, rows);
    if (!point || point.pass) return;
    const key = `${point.x},${point.y}`;
    if (used.has(key)) return;
    used.add(key);
    setupStones.push({
      x: point.x,
      y: point.y,
      color,
      player: color,
      moveNumber,
    });
    moveNumber += 1;
  };

  (parsed?.setup?.black || []).forEach((value) => pushSetup(value, "black"));
  (parsed?.setup?.white || []).forEach((value) => pushSetup(value, "white"));

  if (setupStones.length) {
    state = {
      ...state,
      stones: setupStones,
      boardHashes: [getBoardHash(setupStones)],
    };
  }

  const history = [state];
  let current = state;

  for (const move of parsed?.moves || []) {
    const player = move.color === "white" ? "white" : "black";
    const point = valueToPoint(move.value, columns, rows);
    if (!point) {
      return { ok: false, error: "invalid_move" };
    }
    let next = null;
    const seeded = { ...current, turn: player };
    if (point.pass) {
      next = passTurn(seeded);
    } else {
      next = placeStone(seeded, point.x, point.y);
    }
    if (next === seeded) {
      return { ok: false, error: "illegal_move" };
    }
    history.push(next);
    current = next;
  }

  return {
    ok: true,
    history,
    ruleset,
    komi,
  };
};

export const buildSgfFromHistory = ({
  history,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  ruleset = "korean",
  komi = 0,
  playerBlack = "",
  playerWhite = "",
  result = "",
}) => {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }
  const root = history[0] || {};
  const setupStones = Array.isArray(root.stones) ? root.stones : [];
  const ab = [];
  const aw = [];
  setupStones.forEach((stone) => {
    const value = pointToValue(stone.x, stone.y, columns, rows);
    if (!value) return;
    if (stone.color === "black") {
      ab.push(value);
    } else if (stone.color === "white" || stone.color === "green") {
      aw.push(value);
    }
  });

  const parts = [];
  parts.push("(");
  parts.push(";FF[4]GM[1]CA[UTF-8]");
  parts.push(`SZ[${columns}:${rows}]`);
  parts.push(`RU[${rulesetToSgf(ruleset)}]`);
  if (Number.isFinite(komi)) {
    parts.push(`KM[${komi}]`);
  }
  if (playerBlack) parts.push(`PB[${playerBlack}]`);
  if (playerWhite) parts.push(`PW[${playerWhite}]`);
  if (result) parts.push(`RE[${result}]`);
  if (ab.length) {
    parts.push(`AB${ab.map((v) => `[${v}]`).join("")}`);
  }
  if (aw.length) {
    parts.push(`AW${aw.map((v) => `[${v}]`).join("")}`);
  }

  history.slice(1).forEach((state) => {
    const move = state?.lastMove;
    if (!move) return;
    if (move.type === "stone") {
      const color = move.player === "white" ? "W" : "B";
      const value = pointToValue(move.x, move.y, columns, rows);
      if (!value) return;
      parts.push(`;${color}[${value}]`);
      return;
    }
    if (move.type === "pass") {
      const color = move.player === "white" ? "W" : "B";
      parts.push(`;${color}[]`);
      return;
    }
    if (move.type === "resign") {
      const winner = move.player === "black" ? "W" : "B";
      parts.push(`RE[${winner}+R]`);
    }
  });

  parts.push(")");
  return parts.join("");
};
