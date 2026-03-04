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
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  const analysisPath = path.resolve(process.cwd(), args.analysis || "");
  const webhook = args.webhook || process.env.AI_ALERT_WEBHOOK_URL;
  if (!analysisPath || !fs.existsSync(analysisPath)) {
    console.error("analysis file not found");
    process.exit(1);
  }
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  const gate = analysis?.gate;
  const ok = Boolean(gate?.ok);
  const text = ok
    ? `[AI GATE PASS] games=${gate?.games ?? 0} eloLow=${gate?.eloCI95?.low ?? "n/a"}`
    : `[AI GATE FAIL] reason=${gate?.reason ?? "unknown"} games=${gate?.games ?? 0} eloLow=${gate?.eloCI95?.low ?? "n/a"}`;

  console.log(text);

  if (!webhook) {
    if (!ok) process.exitCode = 2;
    return;
  }

  const payload = { text, gate, range: analysis?.range || null, totalGames: analysis?.totalGames || 0 };
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`webhook failed: ${res.status}`);
    process.exit(3);
  }
  if (!ok) process.exitCode = 2;
};

run().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

