import fs from "node:fs";
import path from "node:path";

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

const toBool = (value, fallback) => {
  if (value === undefined) return fallback;
  return !(value === "0" || value === "false");
};

const stableHash = (text) => {
  let hash = 2166136261;
  const input = String(text || "");
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const walkFiles = (root) => {
  const list = [];
  if (!fs.existsSync(root)) return list;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else list.push(full);
    }
  }
  return list;
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

const splitByGame = (rows, ratios) => {
  const train = [];
  const val = [];
  const test = [];
  const trainCut = ratios.train;
  const valCut = ratios.train + ratios.val;
  for (const row of rows) {
    const k = `${row.experimentId}:${row.gameId}`;
    const r = (stableHash(k) % 10000) / 10000;
    if (r < trainCut) train.push(row);
    else if (r < valCut) val.push(row);
    else test.push(row);
  }
  return { train, val, test };
};

const shardRows = (rows, shardSize) => {
  const out = [];
  for (let i = 0; i < rows.length; i += shardSize) {
    out.push(rows.slice(i, i + shardSize));
  }
  return out;
};

const buildLabeledRows = ({ gameRows, moveRows, maxWinrateDrop, allowPass, minMoves, maxMoves }) => {
  const gameMap = new Map();
  gameRows.forEach((g) => {
    gameMap.set(`${g.experimentId}:${g.gameId}`, g);
  });

  const labeled = [];
  const dropped = {
    missingGame: 0,
    invalidMove: 0,
    invalidPolicy: 0,
    invalidOutcome: 0,
    moveRange: 0,
    winrateDrop: 0,
  };

  for (const m of moveRows) {
    const key = `${m.experimentId}:${m.gameId}`;
    const g = gameMap.get(key);
    if (!g) {
      dropped.missingGame += 1;
      continue;
    }

    const sample = m.sample || {};
    const selectedMove = sample.selectedMove;
    const turn = sample.turn;
    if (!selectedMove || !turn) {
      dropped.invalidMove += 1;
      continue;
    }

    const isPass = selectedMove === "pass";
    if (!allowPass && isPass) {
      dropped.invalidPolicy += 1;
      continue;
    }

    const winner = g?.outcome?.winnerColor;
    if (winner !== "black" && winner !== "white") {
      dropped.invalidOutcome += 1;
      continue;
    }

    const totalMoves = Number(g?.outcome?.moves);
    if (!Number.isFinite(totalMoves) || totalMoves < minMoves || totalMoves > maxMoves) {
      dropped.moveRange += 1;
      continue;
    }

    const winrateDrop = Number(sample.winrateDrop);
    if (Number.isFinite(winrateDrop) && winrateDrop > maxWinrateDrop) {
      dropped.winrateDrop += 1;
      continue;
    }

    const valueTarget = winner === turn ? 1 : 0;
    const policyTarget = isPass ? { pass: true } : selectedMove;

    labeled.push({
      schemaVersion: "guga-train-v1",
      experimentId: m.experimentId,
      gameId: m.gameId,
      move: Number(sample.move),
      turn,
      policyTarget,
      valueTarget,
      features: {
        rank: Number.isFinite(Number(sample.rank)) ? Number(sample.rank) : null,
        winrate: Number.isFinite(Number(sample.winrate)) ? Number(sample.winrate) : null,
        winrateDrop: Number.isFinite(Number(sample.winrateDrop)) ? Number(sample.winrateDrop) : null,
        scoreLeadForTurn: Number.isFinite(Number(sample.scoreLeadForTurn))
          ? Number(sample.scoreLeadForTurn)
          : null,
        visits: Number.isFinite(Number(sample.visits)) ? Number(sample.visits) : null,
        heuristicScore: Number.isFinite(Number(sample.heuristicScore))
          ? Number(sample.heuristicScore)
          : null,
        adjustWeight: Number.isFinite(Number(sample.adjustWeight))
          ? Number(sample.adjustWeight)
          : null,
        greenTotal: Number.isFinite(Number(sample.greenTotal)) ? Number(sample.greenTotal) : null,
        overrideUsed: Boolean(sample.overrideUsed),
        topCandidate: sample.topCandidate || null,
      },
      context: {
        ruleset: g?.setup?.ruleset || null,
        komi: Number.isFinite(Number(g?.setup?.komi)) ? Number(g.setup.komi) : null,
        difficulty: g?.setup?.difficulty || null,
        blackKey: g?.setup?.blackKey || null,
        whiteKey: g?.setup?.whiteKey || null,
        gameMoves: totalMoves,
      },
    });
  }

  return { labeled, dropped };
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const matchesDir = path.resolve(process.cwd(), args.matches || "matches");
  const outDir = path.resolve(process.cwd(), args.out || "train_data/guga_train_v1");
  const shardSize = Number(args.shardSize) || 50000;
  const maxWinrateDrop = Number.isFinite(Number(args.maxWinrateDrop))
    ? Number(args.maxWinrateDrop)
    : 0.08;
  const allowPass = toBool(args.allowPass, true);
  const minMoves = Number(args.minMoves) || 40;
  const maxMoves = Number(args.maxMoves) || 350;
  const trainRatio = Number.isFinite(Number(args.trainRatio)) ? Number(args.trainRatio) : 0.9;
  const valRatio = Number.isFinite(Number(args.valRatio)) ? Number(args.valRatio) : 0.08;
  const testRatio = Number.isFinite(Number(args.testRatio)) ? Number(args.testRatio) : 0.02;

  const files = walkFiles(matchesDir);
  const gameFiles = files.filter((f) => /dataset_(?!moves_).*\.jsonl$/i.test(path.basename(f)));
  const moveFiles = files.filter((f) => /dataset_moves_.*\.jsonl$/i.test(path.basename(f)));

  if (!gameFiles.length || !moveFiles.length) {
    console.error("dataset files not found. run ai_match first.");
    process.exit(1);
  }

  const gameRows = gameFiles.flatMap((f) => readJsonl(f));
  const moveRows = moveFiles.flatMap((f) => readJsonl(f));

  const { labeled, dropped } = buildLabeledRows({
    gameRows,
    moveRows,
    maxWinrateDrop,
    allowPass,
    minMoves,
    maxMoves,
  });

  const ratios = { train: trainRatio, val: valRatio, test: testRatio };
  const total = ratios.train + ratios.val + ratios.test;
  if (Math.abs(total - 1) > 0.001) {
    console.error("train/val/test ratio must sum to 1");
    process.exit(2);
  }

  const split = splitByGame(labeled, ratios);

  writeJsonl(path.join(outDir, "all.labeled.jsonl"), labeled);
  writeJsonl(path.join(outDir, "train.jsonl"), split.train);
  writeJsonl(path.join(outDir, "val.jsonl"), split.val);
  writeJsonl(path.join(outDir, "test.jsonl"), split.test);

  const shardOut = path.join(outDir, "shards");
  const writeShards = (name, rows) => {
    const chunks = shardRows(rows, shardSize);
    chunks.forEach((chunk, idx) => {
      const file = path.join(shardOut, `${name}_${String(idx + 1).padStart(4, "0")}.jsonl`);
      writeJsonl(file, chunk);
    });
    return chunks.length;
  };

  const trainShards = writeShards("train", split.train);
  const valShards = writeShards("val", split.val);
  const testShards = writeShards("test", split.test);

  const manifest = {
    generatedAt: new Date().toISOString(),
    schemaVersion: "guga-train-v1",
    source: {
      matchesDir,
      gameFiles: gameFiles.length,
      moveFiles: moveFiles.length,
      rawGameRows: gameRows.length,
      rawMoveRows: moveRows.length,
    },
    filter: {
      maxWinrateDrop,
      allowPass,
      minMoves,
      maxMoves,
      dropped,
    },
    split: {
      ratios,
      labeledRows: labeled.length,
      trainRows: split.train.length,
      valRows: split.val.length,
      testRows: split.test.length,
      shardSize,
      trainShards,
      valShards,
      testShards,
    },
    files: {
      all: "all.labeled.jsonl",
      train: "train.jsonl",
      val: "val.jsonl",
      test: "test.jsonl",
      shards: "shards/*.jsonl",
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  console.log(`prepared train dataset: ${outDir}`);
  console.log(
    `rows train/val/test = ${split.train.length}/${split.val.length}/${split.test.length}`
  );
};

run();

