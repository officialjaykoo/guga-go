import fs from "node:fs";
import path from "node:path";
import { buildIndependentModelFromRows } from "../../shared/ai/independentAi.js";

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

const readJsonl = (file) =>
  fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = path.resolve(
    process.cwd(),
    args.data || "train_data/guga_train_v1/train.jsonl"
  );
  const outPath = path.resolve(
    process.cwd(),
    args.out || "server/data/independent_model_v2.json"
  );
  const columns = Number(args.columns) || 19;
  const rows = Number(args.rows) || 13;

  if (!fs.existsSync(dataPath)) {
    console.error(`train data not found: ${dataPath}`);
    process.exit(1);
  }

  const rowsData = readJsonl(dataPath);
  if (!rowsData.length) {
    console.error(`no rows in train data: ${dataPath}`);
    process.exit(2);
  }

  const model = buildIndependentModelFromRows({
    rows: rowsData,
    board: { columns, rows },
  });
  model.metadata = {
    ...(model.metadata || {}),
    sourceData: dataPath,
    output: outPath,
    columns,
    rows,
    trainedRows: rowsData.length,
    trainedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(model, null, 2), "utf8");

  console.log(`independent model saved: ${outPath}`);
  console.log(`rows: ${rowsData.length}`);
};

run();

