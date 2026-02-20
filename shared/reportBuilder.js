const getMinGreenDistance = (stones, x, y) => {
  let min = null;
  for (const stone of stones || []) {
    if (stone?.color !== "green") continue;
    const dist = Math.abs(stone.x - x) + Math.abs(stone.y - y);
    if (min === null || dist < min) min = dist;
  }
  return min;
};

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
    흑확정지: toPct(black),
    백확정지: toPct(white),
    미확정지: toPct(neutral),
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
  aiGanghandolWinrateDropMax,
  winrateSnapshotSampleInterval,
  winrateSnapshotDelta,
  scoreLeadSnapshotDelta,
  criticalMomentLimit,
  ownershipStatsThreshold,
  maxMoves,
  getLeadForColor,
}) => {
  const formatKstIso = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const kstMs = date.getTime() + 9 * 60 * 60 * 1000;
    const kst = new Date(kstMs);
    const iso = kst.toISOString().replace("Z", "+09:00");
    return iso;
  };
  const report = {
    메타: {
      대국ID: gameId,
      흑: blackLabel,
      백: whiteLabel,
      규칙: ruleset,
      덤: komi,
      보드: `${board.columns}x${board.rows}`,
      시작시각: formatKstIso(new Date()),
      강한돌버전: tuningVersion || null,
      초록돌좌표: greenCoords || [],
      내부덤: Number.isFinite(komiInternal) ? komiInternal : null,
      분석: {
        사용: analysisEnabled,
        최소수: analysisMinMoves,
        간격: analysisEvery,
        강제이후: analysisAlwaysAfter,
      },
    },
    대국요약: null,
    초록돌: {
      누적점수: {
        총합: 0,
        greenBias: 0,
        greenAdjGap: 0,
        greenSituation: 0,
        rectAxis: 0,
        cornerSide: 0,
        heuristicScore: 0,
      },
      선택횟수: 0,
    },
    강한돌_후보_선택_통계: {
      총수: 0,
      패스선택: 0,
      후보총수: 0,
      파싱실패로그: [],
      순위상세: {
        "1": 0,
        "2": 0,
        "3": 0,
        "4": 0,
        "5": 0,
        "6": 0,
        "7": 0,
        "8": 0,
        "9": 0,
        "10": 0,
      },
      필터: {
        승률델타: 0,
        방문수낮음: 0,
        소유권잠금: 0,
        패스필터: 0,
      },
      패널티: {
        방문수클리핑: 0,
        소유권잠금: 0,
      },
      승률델타: {
        평균: null,
        최대: null,
        합계: 0,
        수: 0,
      },
      방문수: {
        최대: null,
      },
    },
    전략지표: {
      벽차단횟수: 0,
      벽거리_집차: {
        "1": { 수: 0, 합계: 0, 평균: null },
        "2": { 수: 0, 합계: 0, 평균: null },
        "3+": { 수: 0, 합계: 0, 평균: null },
      },
      스타일오버라이드: {
        잠재수: 0,
        실행수: 0,
        평균승률손실: null,
        효율성: null,
        관철률: null,
        유효지수: null,
      },
    },
    결정적순간: [],
    승률_스냅샷: [],
    ownershipStats: null,
  };

  let lastSnapshotWinrate = null;
  let lastSnapshotScoreLead = null;
  let overrideWinrateDropSum = 0;
  let overrideWinrateDropWeightedSum = 0;
  let overrideWinrateDropWeightSum = 0;
  let overrideGreenSituationSum = 0;
  let overrideGreenSituationCount = 0;

  const updateOwnershipStats = (ownership) => {
    report.ownershipStats = buildOwnershipStats(ownership, ownershipStatsThreshold);
  };

  const recordSelection = ({ selectionReport, turn, analysis, state, historyLength }) => {
    if (!selectionReport) return;
    const stats = report.강한돌_후보_선택_통계;
    stats.총수 += 1;
    stats.후보총수 += selectionReport.totalCandidates || 0;
    stats.필터.승률델타 += selectionReport.filtered?.winrateDrop || 0;
    stats.필터.방문수낮음 += selectionReport.filtered?.lowVisit || 0;
    stats.필터.소유권잠금 += selectionReport.filtered?.ownershipLock || 0;
    stats.필터.패스필터 += selectionReport.filtered?.pass || 0;
    stats.패널티.방문수클리핑 += selectionReport.penalties?.lowVisitApplied || 0;
    stats.패널티.소유권잠금 += selectionReport.penalties?.ownershipLockApplied || 0;
    report.전략지표.스타일오버라이드.잠재수 +=
      selectionReport.potentialOverrides || 0;

    const selected = selectionReport.selected;
    if (!selected) return;

    if (selected.move === "pass") stats.패스선택 += 1;
    if (Number.isFinite(selected.winrateDrop)) {
      const prevMax = stats.승률델타.최대;
      stats.승률델타.최대 =
        prevMax === null ? selected.winrateDrop : Math.max(prevMax, selected.winrateDrop);
      stats.승률델타.합계 += selected.winrateDrop;
      stats.승률델타.수 += 1;
    }
    if (Number.isFinite(selected.visits)) {
      const prevMaxVisits = stats.방문수.최대;
      stats.방문수.최대 =
        prevMaxVisits === null
          ? selected.visits
          : Math.max(prevMaxVisits, selected.visits);
    }
    if (Number.isFinite(selected.rank)) {
      const rankKey = String(Math.min(10, Math.max(1, selected.rank)));
      if (Object.prototype.hasOwnProperty.call(stats.순위상세, rankKey)) {
        stats.순위상세[rankKey] += 1;
      }
    }

    const snapshotMove = state.moveCount ?? historyLength - 1;
    const snapshotWinrate = Number.isFinite(selected.winrate) ? selected.winrate : null;
    const snapshotScoreLeadRaw = Number.isFinite(selected.scoreLeadRaw)
      ? selected.scoreLeadRaw
      : null;
    const snapshotScoreLeadForTurn = Number.isFinite(selected.scoreLeadForTurn)
      ? selected.scoreLeadForTurn
      : Number.isFinite(selected.scoreLead)
        ? selected.scoreLead
        : null;
    const deltaWinrate =
      Number.isFinite(snapshotWinrate) && Number.isFinite(lastSnapshotWinrate)
        ? snapshotWinrate - lastSnapshotWinrate
        : null;
    const deltaScoreLead =
      Number.isFinite(snapshotScoreLeadForTurn) && Number.isFinite(lastSnapshotScoreLead)
        ? snapshotScoreLeadForTurn - lastSnapshotScoreLead
        : null;
    const shouldSample = snapshotMove % winrateSnapshotSampleInterval === 0;
    const isEvent =
      (deltaWinrate !== null && Math.abs(deltaWinrate) >= winrateSnapshotDelta) ||
      (deltaScoreLead !== null && Math.abs(deltaScoreLead) >= scoreLeadSnapshotDelta);
    if (shouldSample || isEvent) {
      report.승률_스냅샷.push([
        snapshotMove,
        snapshotWinrate,
        snapshotScoreLeadRaw,
        snapshotScoreLeadForTurn,
      ]);
      if (Number.isFinite(snapshotWinrate)) {
        lastSnapshotWinrate = snapshotWinrate;
      }
      if (Number.isFinite(snapshotScoreLeadForTurn)) {
        lastSnapshotScoreLead = snapshotScoreLeadForTurn;
      }
    }

    if (Number.isFinite(selected.greenTotal)) {
      report.초록돌.누적점수.총합 += selected.greenTotal;
    }
    if (Number.isFinite(selected.greenBias)) {
      report.초록돌.누적점수.greenBias += selected.greenBias;
    }
    if (Number.isFinite(selected.greenAdjGap)) {
      report.초록돌.누적점수.greenAdjGap += selected.greenAdjGap;
    }
    if (Number.isFinite(selected.greenSituation)) {
      report.초록돌.누적점수.greenSituation += selected.greenSituation;
    }
    if (Number.isFinite(selected.rectAxis)) {
      report.초록돌.누적점수.rectAxis += selected.rectAxis;
    }
    if (Number.isFinite(selected.cornerSide)) {
      report.초록돌.누적점수.cornerSide += selected.cornerSide;
    }
    if (Number.isFinite(selected.heuristicScore)) {
      report.초록돌.누적점수.heuristicScore += selected.heuristicScore;
    }
    report.초록돌.선택횟수 += 1;

    const isWallCut =
      Number.isFinite(selected.greenSituation) &&
      selected.greenSituation > 0 &&
      Number.isFinite(selected.greenBias) &&
      selected.greenBias > 0 &&
      Number.isFinite(selected.greenAdjGap) &&
      selected.greenAdjGap >= 0;
    if (isWallCut) {
      report.전략지표.벽차단횟수 += 1;
    }

    if (selectionReport.overrideUsed) {
      report.전략지표.스타일오버라이드.실행수 += 1;
      if (Number.isFinite(selected.winrateDrop)) {
        overrideWinrateDropSum += selected.winrateDrop;
        const moveIndex = snapshotMove ?? 0;
        const progress = Math.max(0, Math.min(1, moveIndex / Math.max(1, maxMoves)));
        const weight = 0.5 + 0.5 * progress;
        overrideWinrateDropWeightedSum += selected.winrateDrop * weight;
        overrideWinrateDropWeightSum += weight;
      }
      if (Number.isFinite(selected.greenSituation)) {
        const normalized = Math.max(0, Math.min(1, selected.greenSituation / 1.0));
        overrideGreenSituationSum += normalized;
        overrideGreenSituationCount += 1;
      }
    }

    if (analysis && selected?.move && selected.move !== "pass") {
      const baseLead = Number.isFinite(analysis.scoreLead)
        ? getLeadForColor(analysis.scoreLead, turn)
        : null;
      const impact =
        Number.isFinite(baseLead) && Number.isFinite(selected.scoreLead)
          ? selected.scoreLead - baseLead
          : null;
      const dist = getMinGreenDistance(state.stones, selected.move.x, selected.move.y);
      if (dist !== null && Number.isFinite(impact)) {
        const bucket = dist <= 1 ? "1" : dist === 2 ? "2" : "3+";
        const bucketData = report.전략지표.벽거리_집차[bucket];
        bucketData.수 += 1;
        bucketData.합계 += impact;
        bucketData.평균 = bucketData.수
          ? Number((bucketData.합계 / bucketData.수).toFixed(3))
          : null;
      }
    }

    const rank = Number.isFinite(selected.rank) ? selected.rank : null;
    const winrateDrop = Number.isFinite(selected.winrateDrop) ? selected.winrateDrop : null;
    if (
      rank !== null &&
      rank >= 4 &&
      Number.isFinite(selected.greenTotal) &&
      selected.greenTotal > 0 &&
      (winrateDrop === null || winrateDrop <= aiGanghandolWinrateDropMax) &&
      report.결정적순간.length < criticalMomentLimit
    ) {
      report.결정적순간.push({
        수: state.moveCount ?? historyLength - 1,
        플레이어: turn === "black" ? "흑" : "백",
        선택: selected.move,
        순위: rank,
        승률: selected.winrate,
        승률델타: winrateDrop,
        집차: selected.scoreLeadForTurn ?? selected.scoreLead,
        집차Raw: selected.scoreLeadRaw ?? null,
        집차ForTurn: selected.scoreLeadForTurn ?? selected.scoreLead ?? null,
        보정치: selected.adjustWeight,
        초록총합: selected.greenTotal,
        카타고1순위: selectionReport.topCandidate?.move || null,
        카타고1순위_승률: selectionReport.topCandidate?.winrate ?? null,
      });
    }
  };

  const finalizeReport = ({
    result,
    summary,
    duration,
    finishedIso,
    moveCount,
    greenCoords,
  }) => {
    const deltaAverage =
      report.강한돌_후보_선택_통계.승률델타.수 > 0
        ? report.강한돌_후보_선택_통계.승률델타.합계 /
          report.강한돌_후보_선택_통계.승률델타.수
        : null;
    report.강한돌_후보_선택_통계.승률델타.평균 =
      Number.isFinite(deltaAverage) ? deltaAverage : null;

    if (report.전략지표?.스타일오버라이드) {
      const style = report.전략지표.스타일오버라이드;
      if (style.실행수 > 0) {
        const avgDrop =
          overrideWinrateDropWeightSum > 0
            ? overrideWinrateDropWeightedSum / overrideWinrateDropWeightSum
            : overrideWinrateDropSum / style.실행수;
        style.평균승률손실 = Number.isFinite(avgDrop)
          ? Number(avgDrop.toFixed(4))
          : null;
        const efficiency = 1 - avgDrop / aiGanghandolWinrateDropMax;
        style.효율성 = Number.isFinite(efficiency)
          ? Math.max(0, Math.min(1, Number(efficiency.toFixed(4))))
          : null;
      } else {
        style.평균승률손실 = null;
        style.효율성 = null;
      }
      style.관철률 =
        style.잠재수 > 0 ? Number((style.실행수 / style.잠재수).toFixed(4)) : null;
      const avgGreenSituation =
        overrideGreenSituationCount > 0
          ? overrideGreenSituationSum / overrideGreenSituationCount
          : null;
      if (Number.isFinite(avgGreenSituation) && Number.isFinite(style.효율성)) {
        style.유효지수 = Number(
          Math.max(0, Math.min(1, avgGreenSituation * style.효율성)).toFixed(4)
        );
      } else {
        style.유효지수 = null;
      }
    }

    report.대국요약 = {
      결과: result,
      승자: summary.winner,
      집차: summary.margin,
      판정: summary.method,
      수: moveCount,
      소요시간: duration,
    };
    report.메타.종료시각 = formatKstIso(finishedIso);
    if (Array.isArray(greenCoords)) {
      report.메타.초록돌좌표 = greenCoords;
    }
    report.메타.소요시간 = duration;
  };

  return {
    report,
    updateOwnershipStats,
    recordSelection,
    finalizeReport,
  };
};

