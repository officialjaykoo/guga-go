// GanghanDol heuristic tuning intent (keep this at top)
export const GANGHANDOL_TUNING_INTENT = {
  priority: [
    "승률 델타(Winrate drop) 제한을 1순위 안전장치로 유지한다. (스타일보다 승률 보호 우선)",
    "전략적 스타일 가중치는 제거하고, 카타고 수읽기를 최대한 그대로 따른다.",
    "초록돌(벽) 규칙과의 불일치를 보정하기 위한 최소 패널티만 유지한다.",
  ],
  successCriteria: [
    "승률 델타 필터/Ownership 잠금/방문수 기반 휴리스틱 클리핑이 항상 동작한다.",
    "전략 보정 없이도 후보 선택이 안정적으로 진행된다.",
    "초록돌 인접 자충 유발 수가 최소 패널티로 회피된다.",
  ],
  limits: [
    "덤 0(komi 0)로 인한 흑/백 유불리는 현재 기보가 부족하여 정량 분석 불가.",
    "전략 가중치(코너/사이드/초반 강화)는 사용하지 않는다.",
    "필터 임계값 완화는 후보 고갈이 관측될 때만 검토한다.",
  ],
  analysisGuidance: [
    "Ownership/analysis는 분리 불가. 노트북 한계 내에서 중·후반 위주로 분석 빈도를 늘린다.",
    "60수 이후 2수에 1번 분석으로 상향, 120수 이후 매수 분석은 유지한다.",
    "지연이 체감되면 120수 이후도 2수에 1번으로 롤백한다.",
  ],
  notes: [
    "전략 보너스는 제거되며, 규칙 보정용 패널티만 최소 유지한다.",
    "강한돌 패스권은 안전장치를 통과한 경우에만 허용한다.",
  ],
};

// GanghanDol heuristic tuning history (update this when changing values)
export const GANGHANDOL_TUNING_VERSION = "2026-02-10.1";
export const GANGHANDOL_TUNING_NOTES = [
  "2026-02-10: 전략 가중치 최소화(early/corner/side), 보정치 영향 축소.",
  "2026-02-10: 초록돌 관련 패널티는 최소 유지(자충 방지 목적).",
];
export const GANGHANDOL_BLACK_HEURISTIC_MULT =
  Number(process.env.GANGHANDOL_BLACK_HEURISTIC_MULT) || 1.0;
export const GANGHANDOL_WHITE_HEURISTIC_MULT =
  Number(process.env.GANGHANDOL_WHITE_HEURISTIC_MULT) || 1.0;
export const GANGHANDOL_BLACK_CORNER_SIDE_MULT =
  Number(process.env.GANGHANDOL_BLACK_CORNER_SIDE_MULT) || 1.0;
export const GANGHANDOL_WHITE_CORNER_SIDE_MULT =
  Number(process.env.GANGHANDOL_WHITE_CORNER_SIDE_MULT) || 1.0;

export const AI_GANGHANDOL_WINRATE_DROP_MAX =
  Number(process.env.AI_GANGHANDOL_WINRATE_DROP_MAX) || 0.02;
export const AI_GANGHANDOL_MIN_VISIT_RATIO =
  Number(process.env.AI_GANGHANDOL_MIN_VISIT_RATIO) || 0.1;
export const AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT =
  Number(process.env.AI_GANGHANDOL_LOW_VISIT_HEURISTIC_MULT) || 0.5;
export const AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD =
  Number(process.env.AI_GANGHANDOL_OWNERSHIP_LOCK_THRESHOLD) || 0.9;
export const GANGHANDOL_OVERRIDE_ENABLED =
  process.env.GANGHANDOL_OVERRIDE_ENABLED === "1" ||
  process.env.GANGHANDOL_OVERRIDE_ENABLED === "true";
export const GANGHANDOL_OVERRIDE_HEURISTIC_MIN =
  Number(process.env.GANGHANDOL_OVERRIDE_HEURISTIC_MIN) || 1.2;
export const GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX =
  Number(process.env.GANGHANDOL_OVERRIDE_WINRATE_DROP_MAX) || 0.02;
export const GANGHANDOL_PASS_ENABLED =
  process.env.GANGHANDOL_PASS_ENABLED === "1" ||
  process.env.GANGHANDOL_PASS_ENABLED === "true";
export const GANGHANDOL_PASS_SCORELEAD_MAX =
  Number(process.env.GANGHANDOL_PASS_SCORELEAD_MAX) || 2;
export const GANGHANDOL_PASS_WINRATE_DROP_MAX =
  Number(process.env.GANGHANDOL_PASS_WINRATE_DROP_MAX) || AI_GANGHANDOL_WINRATE_DROP_MAX;
export const GANGHANDOL_PASS_MIN_VISIT_RATIO =
  Number(process.env.GANGHANDOL_PASS_MIN_VISIT_RATIO) || AI_GANGHANDOL_MIN_VISIT_RATIO;

export const AI_CANDIDATE_ADJUST_WEIGHT =
  Number(process.env.AI_CANDIDATE_ADJUST_WEIGHT) || 0.2;
export const AI_GREEN_CANDIDATE_BONUS =
  Number(process.env.AI_GREEN_CANDIDATE_BONUS) || 0.55;
export const AI_GREEN_BONUS_ADJ =
  Number(process.env.AI_GREEN_BONUS_ADJ) || 1.0;
export const AI_GREEN_BONUS_GAP1 =
  Number(process.env.AI_GREEN_BONUS_GAP1) || 0.25;
export const AI_GREEN_BONUS_GAP2 =
  Number(process.env.AI_GREEN_BONUS_GAP2) || 0.0;
export const AI_GREEN_ADJ_BONUS_NEUTRAL =
  Number(process.env.AI_GREEN_ADJ_BONUS_NEUTRAL) || 0.08;
export const AI_GREEN_ADJ_BONUS_WITH_OWN =
  Number(process.env.AI_GREEN_ADJ_BONUS_WITH_OWN) || 0.12;
export const AI_GREEN_ADJ_PENALTY_WITH_OPP =
  Number(process.env.AI_GREEN_ADJ_PENALTY_WITH_OPP) || -0.15;
export const AI_GREEN_GAP1_BONUS_NEUTRAL =
  Number(process.env.AI_GREEN_GAP1_BONUS_NEUTRAL) || 0.14;
export const AI_GREEN_GAP1_BONUS_WITH_OWN =
  Number(process.env.AI_GREEN_GAP1_BONUS_WITH_OWN) || 0.18;
export const AI_GREEN_GAP1_PENALTY_WITH_OPP =
  Number(process.env.AI_GREEN_GAP1_PENALTY_WITH_OPP) || -0.08;
export const AI_GREEN_MULTI_ADJ_BONUS =
  Number(process.env.AI_GREEN_MULTI_ADJ_BONUS) || 0.05;
export const AI_GREEN_MULTI_GAP1_BONUS =
  Number(process.env.AI_GREEN_MULTI_GAP1_BONUS) || 0.03;
export const AI_GREEN_EYE_BONUS =
  Number(process.env.AI_GREEN_EYE_BONUS) || 0.8;
export const AI_GREEN_MOUTH_BONUS =
  Number(process.env.AI_GREEN_MOUTH_BONUS) || 1.2;
export const AI_GREEN_CONNECT_BONUS =
  Number(process.env.AI_GREEN_CONNECT_BONUS) || 0.9;
export const AI_GREEN_BLOCK_BONUS =
  Number(process.env.AI_GREEN_BLOCK_BONUS) || 0.9;
export const AI_GREEN_PRESSURE_BONUS =
  Number(process.env.AI_GREEN_PRESSURE_BONUS) || 0.7;
export const AI_GREEN_SQUEEZE_PENALTY =
  Number(process.env.AI_GREEN_SQUEEZE_PENALTY) || -1.0;
export const AI_GREEN_EMERGENCY_BONUS =
  Number(process.env.AI_GREEN_EMERGENCY_BONUS) || 1.2;
export const AI_GREEN_INVASION_PENALTY =
  Number(process.env.AI_GREEN_INVASION_PENALTY) || -1.0;
export const AI_SCORELEAD_TANH_SCALE =
  Number(process.env.AI_SCORELEAD_TANH_SCALE) || 15;
export const AI_HEURISTIC_TANH_SCALE =
  Number(process.env.AI_HEURISTIC_TANH_SCALE) || 4.5;
export const AI_CORNER_BONUS =
  Number(process.env.AI_CORNER_BONUS) || 0.0;
export const AI_SIDE_BONUS =
  Number(process.env.AI_SIDE_BONUS) || 0.0;
export const AI_RECT_AXIS_BONUS =
  Number(process.env.AI_RECT_AXIS_BONUS) || 0.15;
export const AI_HEURISTIC_MIN_MULT =
  Number(process.env.AI_HEURISTIC_MIN_MULT) || 0.6;
export const AI_HEURISTIC_MAX_MULT =
  Number(process.env.AI_HEURISTIC_MAX_MULT) || 1.9;
export const AI_HEURISTIC_EARLY_MULT =
  Number(process.env.AI_HEURISTIC_EARLY_MULT) || 1.0;
export const AI_HEURISTIC_END_MULT =
  Number(process.env.AI_HEURISTIC_END_MULT) || 1.27;
export const AI_HEURISTIC_CORNER_MULT =
  Number(process.env.AI_HEURISTIC_CORNER_MULT) || 1.2;
export const AI_HEURISTIC_SIDE_MULT =
  Number(process.env.AI_HEURISTIC_SIDE_MULT) || 1.1;
export const AI_HEURISTIC_SIDE_PENALTY_MULT =
  Number(process.env.AI_HEURISTIC_SIDE_PENALTY_MULT) || 0.9;
export const AI_HEURISTIC_SIDE_EMPTY_RATIO =
  Number(process.env.AI_HEURISTIC_SIDE_EMPTY_RATIO) || 0.6;
export const AI_HEURISTIC_SIDE_FULL_RATIO =
  Number(process.env.AI_HEURISTIC_SIDE_FULL_RATIO) || 0.2;
export const AI_HEURISTIC_GREEN_MULT =
  Number(process.env.AI_HEURISTIC_GREEN_MULT) || 1.05;
export const AI_HEURISTIC_RECT_MULT =
  Number(process.env.AI_HEURISTIC_RECT_MULT) || 1.1;



