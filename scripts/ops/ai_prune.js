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

const removeOldFiles = (dir, days, dryRun) => {
  if (!fs.existsSync(dir)) return { removed: 0, bytes: 0, scanned: 0 };
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let removed = 0;
  let bytes = 0;
  let scanned = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      scanned += 1;
      const st = fs.statSync(full);
      if (st.mtimeMs >= cutoff) continue;
      removed += 1;
      bytes += st.size;
      if (!dryRun) fs.rmSync(full, { force: true });
    }
  }
  return { removed, bytes, scanned };
};

// -----------------------------------------------------------------------------
// Main Entrypoint
// -----------------------------------------------------------------------------
const run = () => {
  const args = parseArgs(process.argv.slice(2));
  const target = path.resolve(process.cwd(), args.dir || "matches");
  const days = Number(args.days) || 14;
  const dryRun = args.dryRun === true || args.dryRun === "1";

  const res = removeOldFiles(target, days, dryRun);
  console.log(
    JSON.stringify(
      {
        target,
        days,
        dryRun,
        scanned: res.scanned,
        removed: res.removed,
        bytesFreed: res.bytes,
      },
      null,
      2
    )
  );
};

run();

