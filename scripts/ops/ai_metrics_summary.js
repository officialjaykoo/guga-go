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

const parseJsonl = (file) => {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(String(line).replace(/^\uFEFF/, ""));
    } catch {
      return null;
    }
  }).filter(Boolean);
};

const toKeyText = (value) => String(value || "").trim().toLowerCase();

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const input = path.resolve(
    process.cwd(),
    args.input || "server/data/ai_runtime_metrics.jsonl"
  );
  const out = path.resolve(
    process.cwd(),
    args.out || "server/data/ai_runtime_metrics.summary.json"
  );

  const rows = parseJsonl(input);
  const byKey = new Map();

  const getKey = (row) => {
    const vsAi = row?.ai?.vsAi ? "vsAi" : "vsHuman";
    const diff = row?.ai?.difficulty || "unknown";
    const style = row?.ai?.styleMode || `${row?.ai?.blackStyle || "?"}/${row?.ai?.whiteStyle || "?"}`;
    return `${vsAi}|${diff}|${style}`;
  };

  rows.forEach((row) => {
    const key = getKey(row);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        games: 0,
        winsBlack: 0,
        winsWhite: 0,
        styleGames: 0,
        styleWins: 0,
        draws: 0,
        durationMsSum: 0,
        durationMsCount: 0,
        movesSum: 0,
      });
    }
    const agg = byKey.get(key);
    agg.games += 1;
    const winner = toKeyText(row?.result?.winner);
    if (winner === "black") agg.winsBlack += 1;
    else if (winner === "white") agg.winsWhite += 1;
    else agg.draws += 1;

    if (row?.ai?.vsAi) {
      const blackStyle = toKeyText(row?.ai?.blackStyle);
      const whiteStyle = toKeyText(row?.ai?.whiteStyle);
      if (winner === "black" || winner === "white") {
        if (blackStyle) {
          agg.styleGames += 1;
          if (winner === "black") agg.styleWins += 1;
        }
        if (whiteStyle) {
          agg.styleGames += 1;
          if (winner === "white") agg.styleWins += 1;
        }
      }
    } else {
      const styleMode = toKeyText(row?.ai?.styleMode);
      const aiColor = toKeyText(row?.ai?.color);
      if (
        styleMode &&
        (winner === "black" || winner === "white") &&
        (aiColor === "black" || aiColor === "white")
      ) {
        agg.styleGames += 1;
        if (winner === aiColor) agg.styleWins += 1;
      }
    }
    if (Number.isFinite(row?.result?.durationMs)) {
      agg.durationMsSum += row.result.durationMs;
      agg.durationMsCount += 1;
    }
    if (Number.isFinite(row?.result?.moveCount)) {
      agg.movesSum += row.result.moveCount;
    }
  });

  const summaryRows = [...byKey.values()].map((it) => ({
    ...it,
    avgDurationMs: it.durationMsCount > 0 ? Math.round(it.durationMsSum / it.durationMsCount) : null,
    avgMoves: it.games > 0 ? Number((it.movesSum / it.games).toFixed(2)) : null,
    blackWinRate: it.games > 0 ? Number((it.winsBlack / it.games).toFixed(4)) : null,
    whiteWinRate: it.games > 0 ? Number((it.winsWhite / it.games).toFixed(4)) : null,
    styleWinRate: it.styleGames > 0 ? Number((it.styleWins / it.styleGames).toFixed(4)) : null,
  })).sort((a, b) => b.games - a.games);

  const payload = {
    generatedAt: new Date().toISOString(),
    input,
    totalRows: rows.length,
    groups: summaryRows,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2), "utf8");
  console.log(`metrics summary written: ${out}`);
};

run();

