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

const ensureDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const style = String(args.style || "").trim().toLowerCase();
  if (!style) {
    console.error("--style is required (e.g. native)");
    process.exit(1);
  }

  const configPath = path.resolve(
    process.cwd(),
    args.config || "server/data/ai_ops_config.json"
  );
  const historyPath = path.resolve(
    process.cwd(),
    args.history || "server/data/ai_release_history.jsonl"
  );

  const force = args.force === "1" || args.force === true;
  const minElo = Number.isFinite(Number(args.minElo)) ? Number(args.minElo) : 0;
  const minGames = Number.isFinite(Number(args.minGames)) ? Number(args.minGames) : 20;
  const rolloutPercent = Number.isFinite(Number(args.abPercent))
    ? Math.max(0, Math.min(100, Number(args.abPercent)))
    : null;

  if (args.analysis && !force) {
    const analysis = readJson(path.resolve(process.cwd(), args.analysis), null);
    const gate = analysis?.gate;
    const games = Number(gate?.games || 0);
    const eloLow = Number(gate?.eloCI95?.low);
    if (!gate?.ok || games < minGames || !Number.isFinite(eloLow) || eloLow < minElo) {
      console.error(
        `gate failed for release: ok=${Boolean(gate?.ok)} games=${games} eloLow=${Number.isFinite(eloLow) ? eloLow : "null"}`
      );
      process.exit(2);
    }
  }

  const current = readJson(configPath, {
    activeStyle: "native",
    previousStyle: null,
    abTest: { enabled: false, styleA: "native", styleB: "native", rolloutPercent: 0 },
  });

  const previous = String(current.activeStyle || "native").toLowerCase();
  const next = {
    ...current,
    previousStyle: previous,
    activeStyle: style,
    updatedAt: new Date().toISOString(),
  };

  if (rolloutPercent !== null && rolloutPercent > 0 && rolloutPercent < 100) {
    next.abTest = {
      enabled: true,
      styleA: previous,
      styleB: style,
      rolloutPercent,
    };
  } else {
    next.abTest = {
      enabled: false,
      styleA: previous,
      styleB: style,
      rolloutPercent: rolloutPercent === 100 ? 100 : 0,
    };
  }

  ensureDir(configPath);
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");

  const event = {
    ts: new Date().toISOString(),
    type: "release",
    from: previous,
    to: style,
    configPath,
    analysis: args.analysis || null,
    gateCheck: force ? "skipped(force)" : "passed",
    abTest: next.abTest,
  };
  ensureDir(historyPath);
  fs.appendFileSync(historyPath, `${JSON.stringify(event)}\n`, "utf8");

  console.log(`released: ${previous} -> ${style}`);
  if (next.abTest?.enabled) {
    console.log(`abTest: ${next.abTest.styleA} vs ${next.abTest.styleB} rollout=${next.abTest.rolloutPercent}%`);
  }
};

run();

