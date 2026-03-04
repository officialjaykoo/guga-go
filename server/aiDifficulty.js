import fs from "node:fs";
import path from "node:path";

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readKatagoBaseFromConfig = () => {
  const configPath = process.env.KATAGO_CONFIG;
  if (!configPath) return {};
  try {
    const resolved = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);
    const text = fs.readFileSync(resolved, "utf8");
    const base = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key === "maxVisits") {
        base.maxVisits = toNumber(value);
      } else if (key === "maxTime") {
        base.maxTime = toNumber(value);
      }
    }
    return base;
  } catch {
    return {};
  }
};

const cfgBase = readKatagoBaseFromConfig();

export const AI_DIFFICULTY_BASE = {
  maxVisits:
    toNumber(process.env.KATAGO_BASE_MAX_VISITS) ?? cfgBase.maxVisits ?? 400,
  maxTime: toNumber(process.env.KATAGO_BASE_MAX_TIME) ?? cfgBase.maxTime ?? 4.0,
};

const DIFFICULTY_RATIOS = {
  intro: { maxVisits: 0.025, maxTime: 0.025 },
  low: { maxVisits: 0.075, maxTime: 0.05 },
  mid: { maxVisits: 0.2, maxTime: 0.1 },
  high: { maxVisits: 0.5, maxTime: 0.2 },
  master: { maxVisits: 1.0, maxTime: 0.35 },
  god: { maxVisits: 1.0, maxTime: 1.0 },
};

export const buildDifficultyParams = (base = AI_DIFFICULTY_BASE) => {
  const params = {};
  for (const [key, ratio] of Object.entries(DIFFICULTY_RATIOS)) {
    params[key] = {
      maxVisits: Math.max(1, Math.round(base.maxVisits * ratio.maxVisits)),
      maxTime: Math.max(0.01, Number((base.maxTime * ratio.maxTime).toFixed(3))),
    };
  }
  return params;
};

export const AI_DIFFICULTY_PARAMS = buildDifficultyParams();

export const getDifficultyParams = (difficulty) =>
  AI_DIFFICULTY_PARAMS[difficulty] || AI_DIFFICULTY_PARAMS.god;

