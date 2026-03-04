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

const normalizeSeed = (value, fallback = 20260304) => {
  const n = Number(value);
  return Number.isInteger(n) ? (n >>> 0) : fallback;
};

// -----------------------------------------------------------------------------
// Execution Helpers
// -----------------------------------------------------------------------------
const runNode = ({ script, args = [], cwd = process.cwd(), env = {} }) => {
  const proc = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 50,
  });
  if (proc.status !== 0) {
    const message = [
      `command failed: node ${script} ${args.join(" ")}`,
      `exit=${proc.status}`,
      "--- stdout ---",
      String(proc.stdout || ""),
      "--- stderr ---",
      String(proc.stderr || ""),
    ].join("\n");
    throw new Error(message);
  }
  return proc;
};

const readJson = (file, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const findLatestFile = (rootDir, pattern) => {
  if (!fs.existsSync(rootDir)) return null;
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (pattern.test(ent.name)) {
        files.push(full);
      }
    }
  }
  if (!files.length) return null;
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0];
};

const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
};

const hasKataGoEnv = () =>
  Boolean(process.env.KATAGO_PATH && process.env.KATAGO_CONFIG && process.env.KATAGO_MODEL);

const listFilesRecursive = (rootDir) => {
  if (!fs.existsSync(rootDir)) return [];
  const files = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files;
};

const hasDatasetFiles = (matchesDir) => {
  const files = listFilesRecursive(matchesDir);
  const hasGame = files.some((f) =>
    /dataset_(?!moves_).*\.jsonl$/i.test(path.basename(f))
  );
  const hasMoves = files.some((f) =>
    /dataset_moves_.*\.jsonl$/i.test(path.basename(f))
  );
  return hasGame && hasMoves;
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const toBool = (value, fallback) => {
    if (value === undefined) return fallback;
    return !(value === "0" || value === "false");
  };
  const cycles = Number(args.cycles) || 3;
  const selfplayGames = Number(args.selfplayGames) || 1000;
  const tuneTrials = Number(args.tuneTrials) || 8;
  const tuneGames = Number(args.tuneGames) || 30;
  const gateGames = Number(args.gateGames) || 80;
  const gateMinGames = Number(args.gateMinGames) || 40;
  const gateMinElo = Number.isFinite(Number(args.gateMinElo)) ? Number(args.gateMinElo) : 0;
  const trainIndependent = toBool(args.trainIndependent, true);
  const modelColumns = Number(args.modelColumns) || 19;
  const modelRows = Number(args.modelRows) || 13;
  const seedBase = normalizeSeed(args.seed, 20260304);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outRoot = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.resolve(process.cwd(), "selfplay_runs", `run_${stamp}`);
  fs.mkdirSync(outRoot, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    config: {
      cycles,
      selfplayGames,
      tuneTrials,
      tuneGames,
      gateGames,
      gateMinGames,
      gateMinElo,
      seedBase,
    },
    cycles: [],
    finalModel: null,
  };

  let currentParams = {};

  for (let c = 1; c <= cycles; c += 1) {
    const cycleId = `cycle_${String(c).padStart(2, "0")}`;
    const cycleDir = path.join(outRoot, cycleId);
    fs.mkdirSync(cycleDir, { recursive: true });
    const cycleSeed = seedBase + c * 1000;

    const selfplayOut = path.join(cycleDir, "selfplay_matches");
    fs.mkdirSync(selfplayOut, { recursive: true });

    try {
      runNode({
        script: "scripts/match/ai_match.js",
        args: [
          "--games", String(selfplayGames),
          "--swap", String(Math.floor(selfplayGames / 2)),
          "--black", "native",
          "--white", "native",
          "--randomColors", "1",
          "--gate", "0",
          "--json", "1",
          "--dataset", "1",
          "--seed", String(cycleSeed),
          "--expId", `${cycleId}_selfplay`,
          "--out", selfplayOut,
        ],
        env: currentParams,
      });
    } catch (err) {
      if (!hasKataGoEnv()) {
        throw new Error(
          [
            `[${cycleId}] ai_match failed: KataGo env missing.`,
            "Set KATAGO_PATH, KATAGO_CONFIG, KATAGO_MODEL before running selfplay cycle.",
            String(err?.message || err),
          ].join("\n")
        );
      }
      throw new Error(
        [
          `[${cycleId}] ai_match failed.`,
          "Check KataGo binary/model/config path and runtime DLL/GPU availability.",
          String(err?.message || err),
        ].join("\n")
      );
    }

    if (!hasDatasetFiles(selfplayOut)) {
      throw new Error(
        [
          `[${cycleId}] selfplay dataset missing after ai_match.`,
          `Expected dataset_*.jsonl and dataset_moves_*.jsonl under: ${selfplayOut}`,
          "ai_prepare_train cannot continue; verify ai_match options and KataGo execution logs.",
        ].join("\n")
      );
    }

    const trainOut = path.join(cycleDir, "train_data");
    try {
      runNode({
        script: "scripts/train/ai_prepare_train.js",
        args: [
          "--matches", selfplayOut,
          "--out", trainOut,
        ],
      });
    } catch (err) {
      throw new Error(
        [
          `[${cycleId}] ai_prepare_train failed.`,
          `input matches dir: ${selfplayOut}`,
          "verify dataset files are valid JSONL and non-empty.",
          String(err?.message || err),
        ].join("\n")
      );
    }

    const trainJsonl = path.join(trainOut, "train.jsonl");
    const independentModelOut = path.join(cycleDir, "independent_model.json");
    const trainStatus = {
      enabled: trainIndependent,
      attempted: false,
      success: false,
      reason: null,
      trainJsonl,
      modelPath: null,
    };
    if (trainIndependent) {
      if (!fs.existsSync(trainJsonl) || fs.statSync(trainJsonl).size <= 0) {
        trainStatus.reason = "train.jsonl missing or empty";
      } else {
        trainStatus.attempted = true;
        runNode({
          script: "scripts/train/independent_train.js",
          args: [
            "--data", trainJsonl,
            "--out", independentModelOut,
            "--columns", String(modelColumns),
            "--rows", String(modelRows),
          ],
        });
        trainStatus.success = true;
        trainStatus.modelPath = independentModelOut;
      }
    }

    const tuneOut = path.join(cycleDir, "tune");
    runNode({
      script: "scripts/match/ai_tune.js",
      args: [
        "--trials", String(tuneTrials),
        "--games", String(tuneGames),
        "--gateMinGames", String(Math.max(10, Math.floor(tuneGames * 0.6))),
        "--gateMinElo", String(gateMinElo),
        "--search", "adaptive",
        "--objective", "hybrid",
        "--seed", String(cycleSeed + 333),
        "--out", tuneOut,
      ],
      env: currentParams,
    });

    const tuneSummaryPath = path.join(tuneOut, "tuning_summary.json");
    const tuneSummary = readJson(tuneSummaryPath, null);
    const bestParams = tuneSummary?.best?.params || {};

    const gateOut = path.join(cycleDir, "gate");
    fs.mkdirSync(gateOut, { recursive: true });
    runNode({
      script: "scripts/match/ai_match.js",
      args: [
        "--games", String(gateGames),
        "--swap", String(Math.floor(gateGames / 2)),
        "--black", "native",
        "--white", "native",
        "--gate", "1",
        "--gateMinGames", String(gateMinGames),
        "--gateMinElo", String(gateMinElo),
        "--gateFailExit", "0",
        "--json", "1",
        "--seed", String(cycleSeed + 777),
        "--expId", `${cycleId}_gate`,
        "--out", gateOut,
      ],
      env: { ...currentParams, ...bestParams },
    });

    const analysisPath = findLatestFile(gateOut, /^analysis_.*\.json$/i);
    const analysis = analysisPath ? readJson(analysisPath, null) : null;
    const gate = analysis?.gate || null;
    const passed = Boolean(gate?.ok);

    const cycleArtifact = {
      artifactType: "cycle_candidate",
      candidateId: `guga_candidate_${cycleId}`,
      createdAt: new Date().toISOString(),
      cycle: c,
      seed: cycleSeed,
      paramBundle: bestParams,
      trainedModels: {
        independent: trainStatus,
      },
      gate,
      paths: {
        selfplayOut,
        trainOut,
        tuneOut,
        gateOut,
        analysisPath,
      },
    };

    const artifactPath = path.join(cycleDir, "cycle_artifact.json");
    writeJson(artifactPath, cycleArtifact);

    summary.cycles.push({
      cycle: c,
      cycleId,
      seed: cycleSeed,
      bestParams,
      trainIndependent,
      trainStatus,
      gate,
      passed,
      artifact: artifactPath,
    });

    if (passed) {
      currentParams = { ...currentParams, ...bestParams };
      summary.finalModel = cycleArtifact;
    }
  }

  writeJson(path.join(outRoot, "selfplay_summary.json"), summary);

  if (summary.finalModel) {
    const finalParamsPath = path.join(outRoot, "model_v1.params.json");
    writeJson(finalParamsPath, summary.finalModel.paramBundle || {});
    const finalIndependent =
      summary.finalModel?.trainedModels?.independent?.success &&
      summary.finalModel?.trainedModels?.independent?.modelPath
        ? String(summary.finalModel.trainedModels.independent.modelPath)
        : null;
    if (finalIndependent && fs.existsSync(finalIndependent)) {
      const finalIndependentPath = path.join(outRoot, "model_v1.independent.json");
      fs.copyFileSync(finalIndependent, finalIndependentPath);
      console.log(`selfplay completed. final independent model: ${finalIndependentPath}`);
    }
    console.log(`selfplay completed. final params: ${finalParamsPath}`);
  } else {
    console.log("selfplay completed. no cycle passed gate; final model not promoted.");
  }

  console.log(`summary: ${path.join(outRoot, "selfplay_summary.json")}`);
};

run();

