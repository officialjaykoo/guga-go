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
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(process.cwd(), args.config || "server/data/ai_ops_config.json");
  const analysisPath = path.resolve(process.cwd(), args.analysis || "");
  const historyPath = path.resolve(process.cwd(), args.history || "server/data/ai_release_history.jsonl");
  const step = Number(args.step) || 10;
  const maxRollout = Number(args.maxRollout) || 100;
  const minEloLow = Number.isFinite(Number(args.minEloLow)) ? Number(args.minEloLow) : 0;

  if (!analysisPath || !fs.existsSync(analysisPath)) {
    console.error("analysis file required for promotion");
    process.exit(1);
  }

  const cfg = readJson(configPath, null);
  const analysis = readJson(analysisPath, null);
  if (!cfg || !analysis) {
    console.error("missing config or analysis");
    process.exit(1);
  }

  const gate = analysis.gate || {};
  const eloLow = Number(gate?.eloCI95?.low);
  const gatePass = Boolean(gate?.ok) && Number.isFinite(eloLow) && eloLow >= minEloLow;

  const ab = cfg.abTest || { enabled: false, styleA: cfg.activeStyle, styleB: cfg.activeStyle, rolloutPercent: 0 };
  if (!ab.enabled) {
    console.log("skip: abTest disabled");
    return;
  }

  let rollout = Number(ab.rolloutPercent || 0);
  if (!gatePass) {
    rollout = clamp(rollout - step, 0, 100);
  } else {
    rollout = clamp(rollout + step, 0, maxRollout);
  }

  let nextCfg = {
    ...cfg,
    updatedAt: new Date().toISOString(),
    abTest: {
      ...ab,
      rolloutPercent: rollout,
      enabled: rollout > 0 && rollout < 100,
    },
  };

  if (rollout >= 100 && gatePass) {
    nextCfg = {
      ...nextCfg,
      previousStyle: String(cfg.activeStyle || ab.styleA || "native"),
      activeStyle: String(ab.styleB || cfg.activeStyle || "native"),
      abTest: {
        enabled: false,
        styleA: String(ab.styleB || cfg.activeStyle || "native"),
        styleB: String(ab.styleA || cfg.activeStyle || "native"),
        rolloutPercent: 0,
      },
    };
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(nextCfg, null, 2), "utf8");
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.appendFileSync(
    historyPath,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      type: "ab_promote",
      gatePass,
      eloLow,
      fromRollout: ab.rolloutPercent,
      toRollout: rollout,
      activeStyle: nextCfg.activeStyle,
      abTest: nextCfg.abTest,
      analysis: analysisPath,
    })}\n`,
    "utf8"
  );

  console.log(`ab promotion updated: ${ab.rolloutPercent}% -> ${rollout}%`);
  if (rollout >= 100 && gatePass) {
    console.log(`ab finalized: activeStyle=${nextCfg.activeStyle}`);
  }
};

run();

