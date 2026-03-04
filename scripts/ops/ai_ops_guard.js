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

const readJson = (file, fallback) => {
  try {
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const readJsonl = (file) => {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(String(line).replace(/^\uFEFF/, ""));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const toStyle = (value) => String(value || "").trim().toLowerCase();

const computeStyleStatsFromRuntime = (rows, activeStyle) => {
  const active = toStyle(activeStyle);
  const agg = {
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    ignoredUnknownColor: 0,
  };

  rows.forEach((row) => {
    const winner = toStyle(row?.result?.winner);
    if (winner !== "black" && winner !== "white") {
      agg.draws += 1;
      return;
    }

    if (row?.ai?.vsAi) {
      const blackStyle = toStyle(row?.ai?.blackStyle);
      const whiteStyle = toStyle(row?.ai?.whiteStyle);

      if (blackStyle === active) {
        agg.games += 1;
        if (winner === "black") agg.wins += 1;
        else agg.losses += 1;
      }
      if (whiteStyle === active) {
        agg.games += 1;
        if (winner === "white") agg.wins += 1;
        else agg.losses += 1;
      }
      return;
    }

    const styleMode = toStyle(row?.ai?.styleMode);
    if (styleMode !== active) return;

    const aiColor = toStyle(row?.ai?.color);
    if (aiColor !== "black" && aiColor !== "white") {
      agg.ignoredUnknownColor += 1;
      return;
    }

    agg.games += 1;
    if (winner === aiColor) agg.wins += 1;
    else agg.losses += 1;
  });

  return agg;
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(
    process.cwd(),
    args.config || "server/data/ai_ops_config.json"
  );
  const metricsPath = path.resolve(
    process.cwd(),
    args.metrics || "server/data/ai_runtime_metrics.summary.json"
  );
  const runtimePath = path.resolve(
    process.cwd(),
    args.runtime || "server/data/ai_runtime_metrics.jsonl"
  );
  const historyPath = path.resolve(
    process.cwd(),
    args.history || "server/data/ai_release_history.jsonl"
  );
  const minGames = Number(args.minGames) || 20;
  const minWinrate = Number.isFinite(Number(args.minWinrate))
    ? Number(args.minWinrate)
    : 0.48;
  const dryRun = args.dryRun === true || args.dryRun === "1";

  const cfg = readJson(configPath, null);
  const summary = readJson(metricsPath, null);
  if (!cfg) {
    console.error("missing ops config");
    process.exit(1);
  }

  const active = toStyle(cfg.activeStyle || "native");
  const prev = toStyle(cfg.previousStyle || "");
  if (!prev) {
    console.log("skip: previousStyle is empty");
    return;
  }

  const runtimeRows = readJsonl(runtimePath);
  if (runtimeRows.length === 0) {
    const hasSummary = Array.isArray(summary?.groups) && summary.groups.length > 0;
    console.log(
      hasSummary
        ? "skip: runtime metrics missing; summary-only data can misjudge style color"
        : "skip: no runtime metrics"
    );
    return;
  }

  const agg = computeStyleStatsFromRuntime(runtimeRows, active);
  const winrate = agg.games > 0 ? agg.wins / agg.games : null;

  const shouldRollback =
    Number.isFinite(winrate) &&
    agg.games >= minGames &&
    winrate < minWinrate;

  if (!shouldRollback) {
    console.log(
      `guard pass: games=${agg.games} winrate=${winrate} ignoredUnknownColor=${agg.ignoredUnknownColor}`
    );
    return;
  }

  const next = {
    ...cfg,
    activeStyle: prev,
    previousStyle: active,
    updatedAt: new Date().toISOString(),
    abTest: {
      enabled: false,
      styleA: prev,
      styleB: active,
      rolloutPercent: 0,
    },
  };

  if (!dryRun) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.appendFileSync(
      historyPath,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        type: "auto_rollback",
        from: active,
        to: prev,
        reason: "runtime_guard",
        metrics: {
          games: agg.games,
          winrate,
          wins: agg.wins,
          losses: agg.losses,
          draws: agg.draws,
          ignoredUnknownColor: agg.ignoredUnknownColor,
          runtimePath,
        },
      })}\n`,
      "utf8"
    );
  }

  console.log(
    `auto rollback: ${active} -> ${prev} games=${agg.games} winrate=${winrate} ignoredUnknownColor=${agg.ignoredUnknownColor}`
  );
};

run();

