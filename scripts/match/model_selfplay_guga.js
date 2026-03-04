import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

// -----------------------------------------------------------------------------
// Execution Helpers
// -----------------------------------------------------------------------------
const runNode = ({ script, args = [] }) => {
  const proc = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    env: { ...process.env },
  });
  if (proc.status !== 0) process.exit(proc.status ?? 1);
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));

  const matchesDir = path.resolve(
    process.cwd(),
    args.matches || "matches/katago_selfplay_guga"
  );
  const trainOut = path.resolve(
    process.cwd(),
    args.trainOut || "train_data/guga_train_v1"
  );
  const modelPath = path.resolve(
    process.cwd(),
    args.model || "server/data/independent_model_v2.json"
  );
  const outDir = path.resolve(
    process.cwd(),
    args.out || "selfplay_runs/model_selfplay_guga"
  );

  const cycles = Number(args.cycles) || 3;
  const games = Number(args.games) || 1000;
  const maxMoves = Number(args.maxMoves) || 260;
  const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : null;
  const ruleset = String(args.ruleset || "korean");
  const komi = Number.isFinite(Number(args.komi)) ? Number(args.komi) : 0;
  const replayWindowRows = Number(args.replayWindowRows) || 300000;
  const ensureModel = toBool(args.ensureModel, true);

  if (ensureModel) {
    runNode({
      script: "scripts/train/ai_prepare_train.js",
      args: ["--matches", matchesDir, "--out", trainOut],
    });
    runNode({
      script: "scripts/train/independent_train.js",
      args: [
        "--data",
        path.join(trainOut, "train.jsonl"),
        "--out",
        modelPath,
        "--columns",
        "19",
        "--rows",
        "13",
      ],
    });
  } else if (!fs.existsSync(modelPath)) {
    console.error(`model not found: ${modelPath}`);
    console.error("run with --ensureModel 1 or provide --model path");
    process.exit(1);
  }

  const forward = [
    "--cycles",
    String(cycles),
    "--games",
    String(games),
    "--maxMoves",
    String(maxMoves),
    "--ruleset",
    ruleset,
    "--komi",
    String(komi),
    "--replayWindowRows",
    String(replayWindowRows),
    "--model",
    modelPath,
    "--bootstrap",
    path.join(trainOut, "train.jsonl"),
    "--out",
    outDir,
    "--columns",
    "19",
    "--rows",
    "13",
  ];
  if (seed !== null) {
    forward.push("--seed", String(seed));
  }

  runNode({
    script: "scripts/train/independent_selfplay_cycle.js",
    args: forward,
  });
};

run();

