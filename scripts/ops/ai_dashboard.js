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

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const analysisPath = path.resolve(process.cwd(), args.analysis || "server/data/ai_runtime_metrics.summary.json");
  const gatePath = args.gate ? path.resolve(process.cwd(), args.gate) : null;
  const outPath = path.resolve(process.cwd(), args.out || "server/data/ai_dashboard.md");

  const metrics = readJson(analysisPath, null);
  const gate = gatePath ? readJson(gatePath, null) : null;

  const lines = [];
  lines.push("# AI Ops Dashboard");
  lines.push("");
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push(`- metricsSource: ${analysisPath}`);
  if (gatePath) lines.push(`- gateSource: ${gatePath}`);
  lines.push("");

  if (gate?.gate) {
    const g = gate.gate;
    lines.push("## Latest Gate");
    lines.push("");
    lines.push(`- ok: ${Boolean(g.ok)}`);
    lines.push(`- games: ${g.games ?? "n/a"}`);
    lines.push(`- eloLow: ${g.eloCI95?.low ?? "n/a"}`);
    lines.push(`- eloHigh: ${g.eloCI95?.high ?? "n/a"}`);
    lines.push(`- reason: ${g.reason ?? "n/a"}`);
    lines.push("");
  }

  lines.push("## Runtime Groups");
  lines.push("");
  lines.push("| key | games | styleWinRate | blackWinRate | whiteWinRate | avgMoves | avgDurationMs |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const g of metrics?.groups || []) {
    lines.push(
      `| ${g.key} | ${g.games} | ${g.styleWinRate ?? "-"} | ${g.blackWinRate ?? "-"} | ${g.whiteWinRate ?? "-"} | ${g.avgMoves ?? "-"} | ${g.avgDurationMs ?? "-"} |`
    );
  }
  lines.push("");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  console.log(`dashboard written: ${outPath}`);
};

run();

