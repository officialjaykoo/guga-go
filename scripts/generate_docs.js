import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "docs_src");
const targets = ["DEV_GUIDE.ko.md", "ENV_GUIDE.ko.md"];

const readSource = (name) => {
  const sourcePath = path.join(sourceDir, name);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing docs source: ${sourcePath}`);
  }
  return fs.readFileSync(sourcePath, "utf8");
};

targets.forEach((name) => {
  const content = readSource(name);
  const outPath = path.join(root, name);
  fs.writeFileSync(outPath, content, "utf8");
  process.stdout.write(`generated ${name}\n`);
});
