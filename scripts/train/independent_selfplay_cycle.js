import fs from "node:fs";
import path from "node:path";
import {
  createInitialState,
  passTurn,
  placeStone,
  scoreNow,
} from "../../shared/game/engine.js";
import {
  loadIndependentModel,
  pickIndependentMove,
  buildIndependentModelFromRows,
} from "../../shared/ai/independentAi.js";

// -----------------------------------------------------------------------------
// Argument Parsing
// -----------------------------------------------------------------------------
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

const normalizeSeed = (value, fallback = 20260304) => {
  const n = Number(value);
  return Number.isInteger(n) ? (n >>> 0) : fallback;
};

const createRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const readJsonl = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const writeJsonl = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = rows.map((r) => JSON.stringify(r)).join("\n");
  fs.writeFileSync(file, text ? `${text}\n` : "", "utf8");
};

const winnerFromState = (state) => {
  const score = state?.score;
  if (!score) return null;
  if (score.winner === "black" || score.winner === "white") return score.winner;
  const b = Number(score.black);
  const w = Number(score.white);
  if (!Number.isFinite(b) || !Number.isFinite(w) || b === w) return null;
  return b > w ? "black" : "white";
};

const runSelfplayGame = ({
  model,
  board,
  maxMoves,
  gameId,
  expId,
  ruleset,
  komi,
  rng,
}) => {
  let state = createInitialState(ruleset, komi);
  const moves = [];
  for (let i = 0; i < maxMoves && !state.over; i += 1) {
    const turn = state.turn;
    const picked = pickIndependentMove(state, {
      model,
      board,
      difficulty: "god",
      randomFn: rng,
    });
    let next =
      picked === "pass" || picked?.pass
        ? passTurn(state)
        : placeStone(state, picked.x, picked.y);
    if (next === state) next = passTurn(state);
    moves.push({
      experimentId: expId,
      gameId,
      move: i + 1,
      turn,
      policyTarget:
        picked === "pass" || picked?.pass
          ? { pass: true }
          : { x: picked.x, y: picked.y },
    });
    state = next;
  }
  if (!state.over) state = scoreNow(state);
  const winner = winnerFromState(state);
  const labeled = moves.map((m) => ({
    schemaVersion: "guga-train-v1",
    experimentId: m.experimentId,
    gameId: m.gameId,
    move: m.move,
    turn: m.turn,
    policyTarget: m.policyTarget,
    valueTarget: winner ? (winner === m.turn ? 1 : 0) : 0.5,
    context: {
      ruleset,
      komi,
      gameMoves: moves.length,
      source: "independent-selfplay",
    },
  }));
  return { state, rows: labeled, winner };
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const cycles = Number(args.cycles) || 3;
  const games = Number(args.games) || 1000;
  const maxMoves = Number(args.maxMoves) || 260;
  const replayWindowRows = Number(args.replayWindowRows) || 300000;
  const ruleset = String(args.ruleset || "korean").toLowerCase();
  const komi = Number.isFinite(Number(args.komi)) ? Number(args.komi) : 0;
  const seedBase = normalizeSeed(args.seed, 20260304);
  const outDir = path.resolve(
    process.cwd(),
    args.out || "selfplay_runs/independent_cycle"
  );
  const bootstrapPath = args.bootstrap
    ? path.resolve(process.cwd(), args.bootstrap)
    : path.resolve(process.cwd(), "train_data/guga_train_v1/train.jsonl");
  const modelPath = path.resolve(
    process.cwd(),
    args.model || "server/data/independent_model_v2.json"
  );
  const board = {
    columns: Number(args.columns) || 19,
    rows: Number(args.rows) || 13,
  };

  const bootstrapRows = fs.existsSync(bootstrapPath) ? readJsonl(bootstrapPath) : [];
  let trainRows = [...bootstrapRows];
  let model = fs.existsSync(modelPath)
    ? loadIndependentModel(modelPath)
    : buildIndependentModelFromRows({ rows: trainRows, board });

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      cycles,
      games,
      maxMoves,
      replayWindowRows,
      ruleset,
      komi,
      seedBase,
      bootstrapPath,
      modelPath,
      board,
    },
    cycles: [],
  };

  fs.mkdirSync(outDir, { recursive: true });
  for (let c = 1; c <= cycles; c += 1) {
    const expId = `independent_cycle_${String(c).padStart(2, "0")}`;
    const rng = createRng(seedBase + c * 1000);
    const cycleRows = [];
    const wins = { black: 0, white: 0, draw: 0 };

    for (let g = 1; g <= games; g += 1) {
      const gameId = `${expId}_g${String(g).padStart(5, "0")}`;
      const result = runSelfplayGame({
        model,
        board,
        maxMoves,
        gameId,
        expId,
        ruleset,
        komi,
        rng,
      });
      cycleRows.push(...result.rows);
      if (result.winner === "black") wins.black += 1;
      else if (result.winner === "white") wins.white += 1;
      else wins.draw += 1;
    }

    writeJsonl(path.join(outDir, `${expId}.jsonl`), cycleRows);
    trainRows = [...trainRows, ...cycleRows];
    if (trainRows.length > replayWindowRows) {
      trainRows = trainRows.slice(-replayWindowRows);
    }
    model = buildIndependentModelFromRows({ rows: trainRows, board });
    model.metadata = {
      ...(model.metadata || {}),
      cycle: c,
      selfplayGames: games,
      totalRows: trainRows.length,
      updatedAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, JSON.stringify(model, null, 2), "utf8");
    fs.writeFileSync(
      path.join(outDir, `${expId}.model.json`),
      JSON.stringify(model, null, 2),
      "utf8"
    );

    summary.cycles.push({
      cycle: c,
      expId,
      rows: cycleRows.length,
      wins,
      modelPath,
    });
    console.log(
      `[${expId}] rows=${cycleRows.length} wins(B/W/D)=${wins.black}/${wins.white}/${wins.draw}`
    );
  }

  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log(`independent selfplay complete: ${path.join(outDir, "summary.json")}`);
  console.log(`latest model: ${modelPath}`);
};

run();


