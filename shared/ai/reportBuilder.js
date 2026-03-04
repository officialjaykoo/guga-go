const buildOwnershipStats = (ownership, threshold) => {
  if (!Array.isArray(ownership) || ownership.length === 0) return null;
  const total = ownership.length;
  let black = 0;
  let white = 0;
  let neutral = 0;
  ownership.forEach((value) => {
    if (!Number.isFinite(value)) {
      neutral += 1;
      return;
    }
    if (value >= threshold) {
      black += 1;
    } else if (value <= -threshold) {
      white += 1;
    } else {
      neutral += 1;
    }
  });
  const toPct = (count) => (total ? Math.round((count / total) * 1000) / 10 : 0);
  return {
    blackOwnedPct: toPct(black),
    whiteOwnedPct: toPct(white),
    neutralPct: toPct(neutral),
  };
};

export const createReportBuilder = ({
  board,
  gameId,
  blackLabel,
  whiteLabel,
  ruleset,
  komi,
  komiInternal,
  analysisEnabled,
  analysisMinMoves,
  analysisEvery,
  analysisAlwaysAfter,
  tuningVersion,
  greenCoords,
  ownershipStatsThreshold,
}) => {
  const formatKstIso = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const kstMs = date.getTime() + 9 * 60 * 60 * 1000;
    return new Date(kstMs).toISOString().replace("Z", "+09:00");
  };

  const report = {
    meta: {
      gameId,
      black: blackLabel,
      white: whiteLabel,
      ruleset,
      komi,
      board: `${board.columns}x${board.rows}`,
      startedAt: formatKstIso(new Date()),
      tuningVersion: tuningVersion || null,
      greenCoords: greenCoords || [],
      internalKomi: Number.isFinite(komiInternal) ? komiInternal : null,
      analysis: {
        enabled: analysisEnabled,
        minMoves: analysisMinMoves,
        interval: analysisEvery,
        alwaysAfter: analysisAlwaysAfter,
      },
    },
    gameSummary: null,
    ownershipStats: null,
  };

  const updateOwnershipStats = (ownership) => {
    report.ownershipStats = buildOwnershipStats(ownership, ownershipStatsThreshold);
  };

  // Kept for backward compatibility with previous callers.
  const recordSelection = () => {};

  const finalizeReport = ({ result, summary, duration, finishedIso, moveCount, greenCoords: finalGreenCoords }) => {
    report.gameSummary = {
      result,
      winner: summary?.winner ?? null,
      margin: summary?.margin ?? null,
      method: summary?.method ?? null,
      moveCount,
      duration,
    };
    report.meta.finishedAt = formatKstIso(finishedIso);
    if (Array.isArray(finalGreenCoords)) {
      report.meta.greenCoords = finalGreenCoords;
    }
    report.meta.duration = duration;
  };

  return {
    report,
    updateOwnershipStats,
    recordSelection,
    finalizeReport,
  };
};
