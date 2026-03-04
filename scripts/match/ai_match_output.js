// -----------------------------------------------------------------------------
// Result / Dataset Output Helpers
// -----------------------------------------------------------------------------
const durationToSeconds = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const m = Number(match[1]);
  const s = Number(match[2]);
  if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
  return m * 60 + s;
};

const toFiniteOrNull = (value) =>
  Number.isFinite(Number(value)) ? Number(value) : null;

export const parseResultSummary = (result) => {
  if (!result || result === "Void") {
    return { winner: null, margin: null, method: null };
  }
  const normalized = String(result).trim();
  if (normalized.endsWith("+R")) {
    const winner = normalized.startsWith("B") ? "black" : "white";
    return { winner, margin: null, method: "resign" };
  }
  const match = normalized.match(/^([BW])\+([0-9.]+)/i);
  if (match) {
    const winner = match[1].toUpperCase() === "B" ? "black" : "white";
    return { winner, margin: Number(match[2]), method: "score" };
  }
  return { winner: null, margin: null, method: null };
};

export const getResultWinnerColor = (result) => {
  const normalized = String(result || "").trim().toUpperCase();
  if (normalized.startsWith("B+")) return "black";
  if (normalized.startsWith("W+")) return "white";
  return null;
};

export const buildDatasetRow = ({
  experimentId,
  game,
  row,
  ruleset,
  komi,
  difficulty,
  seed,
}) => {
  const summary = parseResultSummary(row.result);
  const winnerColor = getResultWinnerColor(row.result);
  const report = game?.report || {};
  const ownership = report?.ownershipStats || {};
  return {
    schemaVersion: "guga-p1-dataset-v1",
    experimentId,
    gameId: row.game,
    timestamp: new Date().toISOString(),
    setup: {
      ruleset,
      komi,
      difficulty,
      seed,
      blackKey: row.blackKey,
      whiteKey: row.whiteKey,
      blackLabel: row.black,
      whiteLabel: row.white,
    },
    outcome: {
      result: row.result,
      winnerColor,
      winnerText: summary?.winner || null,
      margin: toFiniteOrNull(summary?.margin),
      method: summary?.method || null,
      moves: toFiniteOrNull(row.moves),
      durationSec: durationToSeconds(row.duration),
    },
    features: {
      ownershipBlackPct: toFiniteOrNull(ownership?.blackOwnedPct),
      ownershipWhitePct: toFiniteOrNull(ownership?.whiteOwnedPct),
      ownershipNeutralPct: toFiniteOrNull(ownership?.neutralPct),
    },
  };
};

const buildMoveSamplesFromHistory = (history) => {
  if (!Array.isArray(history) || history.length < 2) return [];
  const samples = [];
  for (let i = 1; i < history.length; i += 1) {
    const state = history[i];
    const last = state?.lastMove;
    if (!last) continue;
    const turn = last.player === "white" ? "white" : "black";
    let selectedMove = null;
    if (last.type === "pass") selectedMove = "pass";
    else if (
      last.type === "stone" &&
      Number.isFinite(last.x) &&
      Number.isFinite(last.y)
    ) {
      selectedMove = { x: Number(last.x), y: Number(last.y) };
    } else {
      continue;
    }
    samples.push({
      move: i,
      turn,
      selectedMove,
      rank: null,
      winrate: null,
      winrateDrop: null,
      scoreLeadForTurn: null,
      visits: null,
      heuristicScore: null,
      adjustWeight: null,
      greenTotal: null,
      overrideUsed: false,
      topCandidate: null,
    });
  }
  return samples;
};

export const buildMoveDatasetRows = ({
  experimentId,
  row,
  ruleset,
  komi,
  difficulty,
  seed,
  game,
}) => {
  const samplesFromReport = Array.isArray(game?.report?.moveSamples)
    ? game.report.moveSamples
    : [];
  const samples =
    samplesFromReport.length > 0
      ? samplesFromReport
      : buildMoveSamplesFromHistory(game?.history || []);
  return samples.map((sample) => ({
    schemaVersion: "guga-p1-move-v1",
    experimentId,
    gameId: row.game,
    setup: {
      ruleset,
      komi,
      difficulty,
      seed,
      blackKey: row.blackKey,
      whiteKey: row.whiteKey,
    },
    sample,
  }));
};

export const buildReportDataForSave = ({ report, sgfName }) => {
  const meta = report?.meta ?? {};
  const summary = report?.gameSummary ?? null;
  const ownershipStats = report?.ownershipStats ?? null;

  const orderedMeta = {
    gameId: meta.gameId ?? null,
    black: meta.black ?? null,
    white: meta.white ?? null,
    ruleset: meta.ruleset ?? null,
    komi: meta.komi ?? null,
    board: meta.board ?? null,
    startedAt: meta.startedAt ?? null,
    finishedAt: meta.finishedAt ?? null,
    duration: meta.duration ?? null,
    tuningVersion: meta.tuningVersion ?? null,
    greenCoords: meta.greenCoords ?? null,
    internalKomi: meta.internalKomi ?? null,
    analysis: meta.analysis ?? null,
    sgf: sgfName,
  };

  const orderedSummary = summary
    ? {
        result: summary.result ?? null,
        winner: summary.winner ?? null,
        margin: summary.margin ?? null,
        method: summary.method ?? null,
        moveCount: summary.moveCount ?? null,
        duration: summary.duration ?? null,
      }
    : null;

  return {
    meta: orderedMeta,
    gameSummary: orderedSummary,
    ownershipStats,
  };
};
