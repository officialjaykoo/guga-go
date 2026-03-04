import { spawn } from "node:child_process";
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

// -----------------------------------------------------------------------------
// Execution Helpers
// -----------------------------------------------------------------------------
const runNode = ({ script, args = [], env = {}, prefix = "" }) =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outPrefix = prefix ? `[${prefix}] ` : "";
    proc.stdout.on("data", (buf) => {
      process.stdout.write(`${outPrefix}${String(buf)}`);
    });
    proc.stderr.on("data", (buf) => {
      process.stderr.write(`${outPrefix}${String(buf)}`);
    });

    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`process exited with code ${code}`));
    });
  });

const splitGames = (games, workers) => {
  const safeWorkers = Math.max(1, Math.min(workers, games));
  const base = Math.floor(games / safeWorkers);
  let rem = games % safeWorkers;
  const out = [];
  for (let i = 0; i < safeWorkers; i += 1) {
    const n = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    out.push(n);
  }
  return out.filter((n) => n > 0);
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = async () => {
  const args = parseArgs(process.argv.slice(2));

  const games = Math.max(1, Number(args.games) || 100);
  const workers = Math.max(1, Number(args.workers) || 2);
  const requestedSwap = Number(args.swap);
  const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : null;
  const ruleset = String(args.ruleset || "japanese");
  const komi = Number.isFinite(Number(args.komi)) ? Number(args.komi) : 0;
  const maxMoves = Number(args.maxMoves) || 350;
  const outDir = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.resolve(process.cwd(), "matches", "katago_selfplay_guga");

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const shards = splitGames(games, workers);

  const jobs = shards.map((gameCount, idx) => {
    const workerId = String(idx + 1).padStart(2, "0");
    const workerDir = path.join(outDir, `worker_${workerId}`);
    const workerSwap = Number.isFinite(requestedSwap)
      ? Math.max(0, Math.min(gameCount, requestedSwap))
      : Math.floor(gameCount / 2);
    const workerSeed = seed === null ? null : seed + idx * 10000;

    const forward = [
      "--games",
      String(gameCount),
      "--swap",
      String(workerSwap),
      "--black",
      "native",
      "--white",
      "native",
      "--ruleset",
      ruleset,
      "--komi",
      String(komi),
      "--maxMoves",
      String(maxMoves),
      "--dataset",
      "1",
      "--randomColors",
      "1",
      "--json",
      "1",
      "--out",
      workerDir,
      "--expId",
      `katago_selfplay_${stamp}_w${workerId}`,
    ];

    if (workerSeed !== null) {
      forward.push("--seed", String(workerSeed));
    }
    return { workerId, forward };
  });

  console.log(
    `katago_selfplay_guga: games=${games}, workers=${jobs.length}, god=true, search-params-from-cfg=true`
  );

  try {
    await Promise.all(
      jobs.map((job) =>
        runNode({
          script: "scripts/match/ai_match.js",
          args: job.forward,
          env: {
            KATAGO_ALLOW_RECT: process.env.KATAGO_ALLOW_RECT || "1",
          },
          prefix: `W${job.workerId}`,
        })
      )
    );
  } catch (err) {
    console.error(`[katago_selfplay_guga] failed: ${err?.message || err}`);
    process.exit(1);
  }
};

run().catch((err) => {
  console.error(`[katago_selfplay_guga] fatal: ${err?.message || err}`);
  process.exit(1);
});

