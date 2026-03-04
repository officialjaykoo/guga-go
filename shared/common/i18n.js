const ko = {
  login_title: "구가바둑",
  login_placeholder: "아이디",
  guest_rank_label: "급수",
  guest_rank_suffix: "급",
  guest_id_label: "게스트 아이디",
  guest_enter: "게스트 입장",
  enter: "입장",
  lobby: "로비",
  room: "방",
  players: "대국자",
  waiting_list: "대기자",
  none: "없음",
  rooms_empty: "아직 방이 없습니다. 방을 만들어 시작하세요.",
  room_name: "방 제목",
  room_name_required: "방 제목이 필요합니다.",
  room_name_dup: "이미 존재하는 방 제목입니다.",
  name_invalid: "영문/한글/숫자/밑줄만 가능, 공백·특수문자 불가",
  enter_room: "입장",
  full: "인원 초과",
  create_room: "방 만들기",
  rooms_title: "방 목록",
  ruleset_label: "룰",
  ruleset_korean: "한국룰",
  ruleset_chinese: "중국룰",
  ruleset_korean_desc: "한국룰(집 + 사석)",
  ruleset_chinese_desc: "중국룰(집 + 착수)",
  ruleset_japanese: "일본룰",
  ruleset_japanese_desc: "일본룰(집 + 사석)",
  rules_page: "룰",
  rules_loading: "규칙 문서를 불러오는 중...",
  rules_load_failed: "규칙 문서를 불러오지 못했습니다.",
  kifu_save: "기보 저장",
  kifu_load: "기보 불러오기",
  kifu_save_done: "기보 저장 완료",
  kifu_save_failed: "기보 저장 실패",
  kifu_load_done: "기보 불러오기 완료",
  kifu_load_failed: "기보 불러오기 실패",
  kifu_load_owner_only: "방장만 불러오기 가능",
  kifu_load_size: "기보 크기 불일치:",
  kifu_empty: "기보가 없습니다",
  kifu_review: "기보 보기",
  kifu_step_back_3: "<< 3수 뒤로",
  kifu_step_back_1: "< 1수 뒤로",
  kifu_step_forward_1: "> 1수 앞으로",
  kifu_step_forward_3: ">> 3수 앞으로",
  kifu_auto_play_start: "=> 1초 자동재생",
  kifu_auto_play_stop: "자동재생 정지",
  spectate: "관전",
  spectators: "관전자",
  spectator_chat_on: "관전 채팅: 허용",
  spectator_chat_off: "관전 채팅: 차단",
  chat_spectator_blocked: "관전자 채팅이 차단되었습니다.",
  game_title: "대국",
  current_room: "방",
  status_waiting: "대기중",
  status_playing: "대국중",
  start_game: "대국 시작",
  start_ai: "AI 대국 시작",
  start_ai_vs_ai: "AI끼리 대국 시작",
  ai_intro: "입문",
  ai_low: "하수",
  ai_mid: "중수",
  ai_high: "고수",
  ai_master: "국수",
  ai_god: "신",
  ai_label: "AI",
  ai_vs_ai_label: "AIvsAI",
  ai_versus: "vs",
  ai_difficulty_server: "server",
  ai_default_black: "AI-B",
  ai_default_white: "AI-W",
  ai_lead_prefix: "AI 우세",
  black: "흑",
  white: "백",
  captures: "사석",
  pass: "패스",
  undo: "무르기",
  undo_request_label: "무르기 요청",
  score: "계가",
  score_request_label: "계가 요청",
  resign: "항복",
  dead_mark: "사석 표시",
  dead_mark_end: "사석 표시 종료",
  dead_auto: "자동 사석",
  dead_reset: "사석 초기화",
  dead_confirm: "확인",
  dead_cancel: "취소",
  dead_mode: "사석 표시 모드",
  dead_hint: "돌을 눌러 사석 표시/해제 후 확인을 눌러 확정합니다.",
  score_title_black: "흑 점수",
  score_title_white: "백 점수",
  territory: "집",
  stones: "착수",
  komi: "덤",
  total: "합계",
  game_log: "기보",
  chat: "채팅",
  chat_empty: "아직 메시지가 없습니다.",
  chat_placeholder: "메시지를 입력하세요",
  chat_send: "전송",
  chat_waiting_only: "대기자만 채팅할 수 있습니다.",
  chat_players_only: "대국자만 채팅할 수 있습니다.",
  leave_room: "방 나가기",
  logout: "로그아웃",
  close: "닫기",
  yes: "예",
  no: "아니오",
  undo_request_notice: "무르기 요청",
  undo_waiting: "상대 응답을 기다리는 중입니다.",
  score_request_notice: "계가 요청",
  score_waiting: "상대 응답을 기다리는 중입니다.",
  game_notice: "알림",
  room_not_found: "방을 찾을 수 없습니다.",
  byo_title: "초읽기",
  byo_rule: "30초 3회 초과 시 패배",
  end: "종료",
  win: "승",
  surrender: "항복",
  language_label: "언어",
  language_ko: "한국어",
  language_en: "English",
  language_ja: "日本語",
  language_zh: "简体中文",
  language_zh_tw: "繁體中文",
  language_planned_suffix: "(준비중)",
};

const en = {
  login_title: "GUGA Go",
  login_placeholder: "User ID",
  guest_rank_label: "Rank",
  guest_rank_suffix: "k",
  guest_id_label: "Guest ID",
  guest_enter: "Enter as Guest",
  enter: "Enter",
  lobby: "Lobby",
  room: "Room",
  players: "Players",
  waiting_list: "Waiting Players",
  none: "None",
  rooms_empty: "No rooms yet. Create one to get started.",
  room_name: "Room Name",
  room_name_required: "Room name is required.",
  room_name_dup: "Room name already exists.",
  name_invalid:
    "Use letters/numbers/underscore only; no spaces or special characters.",
  enter_room: "Join",
  full: "Full",
  create_room: "Create Room",
  rooms_title: "Rooms",
  ruleset_label: "Rules",
  ruleset_korean: "Korean",
  ruleset_chinese: "Chinese",
  ruleset_korean_desc: "Korean (Territory + Captures)",
  ruleset_chinese_desc: "Chinese (Territory + Stones)",
  ruleset_japanese: "Japanese",
  ruleset_japanese_desc: "Japanese (Territory + Captures)",
  rules_page: "Rules",
  rules_loading: "Loading rules document...",
  rules_load_failed: "Failed to load the rules document.",
  kifu_save: "Save Kifu",
  kifu_load: "Load Kifu",
  kifu_save_done: "Kifu saved.",
  kifu_save_failed: "Kifu save failed.",
  kifu_load_done: "Kifu loaded.",
  kifu_load_failed: "Kifu load failed.",
  kifu_load_owner_only: "Only the room owner can load kifu.",
  kifu_load_size: "Kifu size mismatch:",
  kifu_empty: "No kifu to save.",
  kifu_review: "Kifu Review",
  kifu_step_back_3: "<< Back 3",
  kifu_step_back_1: "< Back 1",
  kifu_step_forward_1: "> Forward 1",
  kifu_step_forward_3: ">> Forward 3",
  kifu_auto_play_start: "=> Auto Play (1s)",
  kifu_auto_play_stop: "Stop Auto Play",
  spectate: "Spectate",
  spectators: "Spectators",
  spectator_chat_on: "Spectator Chat: On",
  spectator_chat_off: "Spectator Chat: Off",
  chat_spectator_blocked: "Spectator chat is disabled.",
  game_title: "Match",
  current_room: "Room",
  status_waiting: "Waiting",
  status_playing: "In Game",
  start_game: "Start Game",
  start_ai: "Start vs AI",
  start_ai_vs_ai: "Start AI vs AI",
  ai_intro: "Intro",
  ai_low: "Low",
  ai_mid: "Mid",
  ai_high: "High",
  ai_master: "Master",
  ai_god: "God",
  ai_label: "AI",
  ai_vs_ai_label: "AIvsAI",
  ai_versus: "vs",
  ai_difficulty_server: "server",
  ai_default_black: "AI-B",
  ai_default_white: "AI-W",
  ai_lead_prefix: "AI Lead",
  black: "Black",
  white: "White",
  captures: "Captures",
  pass: "Pass",
  undo: "Undo",
  undo_request_label: "Undo Request",
  score: "Score",
  score_request_label: "Score Request",
  resign: "Resign",
  dead_mark: "Mark Dead",
  dead_mark_end: "Finish Marking",
  dead_auto: "Auto Mark Dead",
  dead_reset: "Clear Marks",
  dead_confirm: "Confirm",
  dead_cancel: "Cancel",
  dead_mode: "Dead Stone Mode",
  dead_hint: "Click stones to mark/unmark, then confirm.",
  score_title_black: "Black Score",
  score_title_white: "White Score",
  territory: "Territory",
  stones: "Stones",
  komi: "Komi",
  total: "Total",
  game_log: "Kifu",
  chat: "Chat",
  chat_empty: "No messages yet.",
  chat_placeholder: "Type a message",
  chat_send: "Send",
  chat_waiting_only: "Only waiting players can chat.",
  chat_players_only: "Only players can chat.",
  leave_room: "Leave Room",
  logout: "Log out",
  close: "Close",
  yes: "Yes",
  no: "No",
  undo_request_notice: "requested an undo.",
  undo_waiting: "Waiting for opponent response to undo request.",
  score_request_notice: "requested scoring.",
  score_waiting: "Waiting for opponent response to scoring request.",
  game_notice: "Game Notices",
  room_not_found: "Room not found.",
  byo_title: "Byo-yomi",
  byo_rule: "Lose after 3 timeouts of 30s",
  end: "Result",
  win: "Win",
  surrender: "Resign",
  language_label: "Language",
  language_ko: "Korean",
  language_en: "English",
  language_ja: "Japanese",
  language_zh: "Chinese (Simplified)",
  language_zh_tw: "Chinese (Traditional)",
  language_planned_suffix: "(Planned)",
};

const ja = {};
const zh = {};
const zhTw = {};

const translations = {
  ko,
  en,
  ja,
  zh,
  "zh-TW": zhTw,
};

export const DEFAULT_LANG = "ko";
export const LANG_OPTIONS = [
  { code: "ko", labelKey: "language_ko", enabled: true },
  { code: "en", labelKey: "language_en", enabled: true },
  { code: "ja", labelKey: "language_ja", enabled: false },
  { code: "zh", labelKey: "language_zh", enabled: false },
  { code: "zh-TW", labelKey: "language_zh_tw", enabled: false },
];

const LANGUAGE_STORAGE_KEY = "guga-lang";
const ENABLED_LANGUAGE_CODES = new Set(
  LANG_OPTIONS.filter((entry) => entry.enabled).map((entry) => entry.code)
);
const ALL_LANGUAGE_CODES = new Set(LANG_OPTIONS.map((entry) => entry.code));

export function normalizeLang(value, { allowPlanned = false } = {}) {
  const key = String(value || "").trim();
  if (!key) return DEFAULT_LANG;
  if (!ALL_LANGUAGE_CODES.has(key)) return DEFAULT_LANG;
  if (allowPlanned) return key;
  return ENABLED_LANGUAGE_CODES.has(key) ? key : DEFAULT_LANG;
}

export function getSystemLang() {
  if (typeof navigator === "undefined") {
    return DEFAULT_LANG;
  }
  const lang = String(navigator.language || "").toLowerCase();
  if (lang.startsWith("en")) return "en";
  return DEFAULT_LANG;
}

export function loadLangPreference() {
  if (typeof window === "undefined") {
    return DEFAULT_LANG;
  }
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return normalizeLang(stored);
  } catch {
    return DEFAULT_LANG;
  }
}

export function saveLangPreference(lang) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLang(lang));
  } catch {
    // ignore storage failures
  }
}

export function tFactory(lang) {
  const normalized = normalizeLang(lang, { allowPlanned: true });
  const dict = translations[normalized] || {};
  return (key) => dict[key] || ko[key] || en[key] || key;
}
