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

const normalizeSeed = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? (n >>> 0) : null;
};

const createSeededRandom = (seedValue) => {
  let state = normalizeSeed(seedValue);
  if (state === null) return Math.random;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) & 0xffffffff) / 0x100000000;
  };
};

const pick = (values, rand) => values[Math.floor(rand() * values.length)];

const readAnalysis = (outDir) => {
  const files = fs
    .readdirSync(outDir)
    .filter((name) => /^analysis_.*\.json$/i.test(name))
    .sort();
  if (!files.length) return null;
  const file = path.join(outDir, files[files.length - 1]);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const mutateNear = (space, base, rand) => {
  const out = {};
  for (const [key, values] of Object.entries(space)) {
    const sorted = [...values].sort((a, b) => a - b);
    const b = Number(base[key]);
    const idx = sorted.findIndex((v) => Number(v) === b);
    if (idx < 0) {
      out[key] = String(pick(sorted, rand));
      continue;
    }
    const delta = pick([-1, 0, 1], rand);
    const nextIdx = clamp(idx + delta, 0, sorted.length - 1);
    out[key] = String(sorted[nextIdx]);
  }
  return out;
};

const scoreTrial = (analysis, objective, weights) => {
  const gate = analysis?.gate;
  const gateLow = Number(gate?.eloCI95?.low);
  const winrate = Number(analysis?.challengerScoreRate);
  if (objective === "gate") {
    return Number.isFinite(gateLow) ? gateLow : -Infinity;
  }
  if (objective === "winrate") {
    return Number.isFinite(winrate) ? winrate : -Infinity;
  }
  const gatePart = Number.isFinite(gateLow) ? gateLow : -1e6;
  const winPart = Number.isFinite(winrate) ? (winrate - 0.5) * 400 : -1e6;
  return gatePart * weights.gate + winPart * weights.winrate;
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const trials = Number(args.trials) || 12;
  const games = Number(args.games) || 30;
  const swap = Number(args.swap) || Math.floor(games / 2);
  const gateMinGames = Number(args.gateMinGames) || Math.max(10, Math.floor(games * 0.6));
  const gateMinElo = Number.isFinite(Number(args.gateMinElo)) ? Number(args.gateMinElo) : 0;
  const baseSeed = normalizeSeed(args.seed) ?? normalizeSeed(process.env.AI_TUNE_SEED) ?? 20260304;
  const rand = createSeededRandom(baseSeed);
  const searchMode = String(args.search || "adaptive").toLowerCase();
  const exploitRate = Number.isFinite(Number(args.exploitRate))
    ? clamp(Number(args.exploitRate), 0, 1)
    : 0.6;
  const objective = String(args.objective || "hybrid").toLowerCase();
  const objectiveWeights = {
    gate: Number.isFinite(Number(args.objectiveGateWeight))
      ? Number(args.objectiveGateWeight)
      : 1,
    winrate: Number.isFinite(Number(args.objectiveWinrateWeight))
      ? Number(args.objectiveWinrateWeight)
      : 0.5,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outBase = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.resolve(process.cwd(), "matches", `ai_tune_${stamp}`);
  fs.mkdirSync(outBase, { recursive: true });

  const knobSpace = {};

  const leaderboard = [];
  let best = null;

  for (let i = 1; i <= trials; i += 1) {
    const trialSeed = baseSeed + i;
    const trialId = `trial_${String(i).padStart(2, "0")}`;
    const trialOut = path.join(outBase, trialId);
    fs.mkdirSync(trialOut, { recursive: true });

    let envOverrides = {};
    if (
      searchMode === "adaptive" &&
      best?.params &&
      rand() < exploitRate
    ) {
      envOverrides = mutateNear(knobSpace, best.params, rand);
    } else {
      for (const [key, values] of Object.entries(knobSpace)) {
        envOverrides[key] = String(pick(values, rand));
      }
    }

    const matchArgs = [
      "scripts/match/ai_match.js",
      "--games", String(games),
      "--swap", String(swap),
      "--black", "native",
      "--white", "native",
      "--gate", "1",
      "--gateMinGames", String(gateMinGames),
      "--gateMinElo", String(gateMinElo),
      "--gateFailExit", "0",
      "--earlyStop", "1",
      "--dataset", "1",
      "--json", "1",
      "--seed", String(trialSeed),
      "--expId", trialId,
      "--out", trialOut,
      "--objective", "hybrid",
      "--objectiveWinWeight", String(objectiveWeights.winrate),
      "--objectiveMarginWeight", "0",
    ];

    console.log(`[tune] ${trialId} start`);
    const proc = spawnSync(process.execPath, matchArgs, {
      cwd: process.cwd(),
      env: { ...process.env, ...envOverrides },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 20,
    });

    const analysis = readAnalysis(trialOut);
    const trialScore = scoreTrial(analysis, objective, objectiveWeights);
    const trial = {
      trialId,
      exitCode: proc.status,
      score: trialScore,
      gate: analysis?.gate || null,
      earlyStop: analysis?.earlyStop || null,
      totalGames: analysis?.totalGames || 0,
      params: envOverrides,
      objective,
      objectiveWeights,
      stdoutTail: String(proc.stdout || "").split(/\r?\n/).slice(-20),
      stderrTail: String(proc.stderr || "").split(/\r?\n/).slice(-20),
    };
    leaderboard.push(trial);

    if (!best || trial.score > best.score) {
      best = trial;
    }
    console.log(
      `[tune] ${trialId} done score=${Number.isFinite(trialScore) ? trialScore.toFixed(3) : "-inf"} games=${trial.totalGames}`
    );
  }

  leaderboard.sort((a, b) => b.score - a.score);

  const summary = {
    generatedAt: new Date().toISOString(),
    seed: baseSeed,
    trials,
    games,
    gateMinGames,
    gateMinElo,
    searchMode,
    exploitRate,
    objective,
    objectiveWeights,
    best,
    leaderboard,
  };

  const summaryPath = path.join(outBase, "tuning_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  if (best) {
    console.log(`[tune] best=${best.trialId} score=${best.score}`);
    console.log(`[tune] bestParams=${JSON.stringify(best.params)}`);
  }
  console.log(`[tune] summary=${summaryPath}`);
};

run();

