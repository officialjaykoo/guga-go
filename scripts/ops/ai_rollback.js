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
  const configPath = path.resolve(
    process.cwd(),
    args.config || "server/data/ai_ops_config.json"
  );
  const historyPath = path.resolve(
    process.cwd(),
    args.history || "server/data/ai_release_history.jsonl"
  );

  const current = readJson(configPath, null);
  if (!current) {
    console.error(`ops config not found: ${configPath}`);
    process.exit(1);
  }

  const target = String(args.to || current.previousStyle || "").trim().toLowerCase();
  if (!target) {
    console.error("rollback target is empty (use --to style or ensure previousStyle exists)");
    process.exit(2);
  }

  const before = String(current.activeStyle || "native").toLowerCase();
  const next = {
    ...current,
    activeStyle: target,
    previousStyle: before,
    updatedAt: new Date().toISOString(),
    abTest: {
      enabled: false,
      styleA: target,
      styleB: before,
      rolloutPercent: 0,
    },
  };

  ensureDir(configPath);
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), "utf8");

  const event = {
    ts: new Date().toISOString(),
    type: "rollback",
    from: before,
    to: target,
    configPath,
  };
  ensureDir(historyPath);
  fs.appendFileSync(historyPath, `${JSON.stringify(event)}\n`, "utf8");

  console.log(`rolled back: ${before} -> ${target}`);
};

run();

