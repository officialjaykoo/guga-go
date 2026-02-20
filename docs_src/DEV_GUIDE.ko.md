GUGA Go - 개발자 가이드

이 문서는 docs_src/DEV_GUIDE.ko.md에서 자동 생성됩니다.
수정 후 `npm run docs:generate`를 실행하세요.

개요
- 프론트엔드: Vite + React
- 실시간: WebSocket 서버 (Node + ws)
- 게임 로직: 프론트/서버 공용 (src/gameEngine.js)

빠른 시작
1) 의존성 설치
   npm install
2) 서버 실행
   npm run server
3) 클라이언트 실행
   npm run dev

스크립트
- npm run dev: Vite 개발 서버
- npm run server: WebSocket 서버 (ws://localhost:5174)

프로젝트 구조
- index.html: Vite 엔트리 HTML
- package.json: 스크립트와 의존성
- ENV_GUIDE.ko.md: 환경설정 체크리스트
- server/ai_server.js: WebSocket 로비/게임 서버 (룸, 상태, 타이머, 채팅, AI)
- server/experimental/auth.js: 인증 스캐폴딩 (Google 토큰 검증 placeholder)
- server/experimental/db.js: DB 스캐폴딩 (인메모리 stub, 향후 DB 연동용)
- scripts/ai_match.js: 오프라인 AI vs AI 시뮬레이션
- src/main.jsx: React 엔트리
- src/AppUI.jsx: 앱 상태/라우팅 + WebSocket 동기화
- src/LoginUI.jsx: 게스트 로그인 UI (랭크 선택, 자동 ID)
- src/LobbyUI.jsx: 룸 목록/생성 + 로비 채팅 + 관전
- src/GameUI.jsx: 게임 UI, 보드, 컨트롤, 토스트, 관전 모드
- src/RulesPageUI.jsx: rules.ko.md 렌더링
- src/gameEngine.js: 핵심 룰/집계(프론트+서버 공용)
- src/sgf.js: SGF 파싱/빌드 + 히스토리 복원
- src/validation.js: 이름 검증(영문/숫자/언더스코어)
- src/i18n.js: 번역 사전 + tFactory
- src/components/ActionPanelView.jsx: 주요 액션 버튼 + 사석 마킹
- src/components/PlayerBarView.jsx: 플레이어 정보 + 포획 수 + 타이머
- src/components/GoBoardView.jsx: 보드 렌더링/입력 + 영토 오버레이
- src/components/GameLogView.jsx: 기보 리스트
- src/components/ChatPanelView.jsx: 채팅 UI(버블 + 자동 스크롤)
- src/css/: UI 스타일
- src/img/: UI 이미지
- src/sound/: UI 사운드

런타임 동작(중요)
- 서버 권한: server/ai_server.js가 룸/타이머/게임 상태/채팅을 권위적으로 관리
- 클라이언트: WebSocket으로 상태 수신 후 렌더링
- 채팅: 서버는 채널별 메시지 저장, 클라에서는 입장 시간 이후만 표시
- 관전자: 플레이어로 참여하지 않고 룸에 입장(게임 액션 불가)
- 관전 채팅: 방장이 on/off 토글, 서버가 강제
- 무르기: 플레이어당 게임당 최대 3회 요청(서버 추적)
- 계가: 100수 이상 + 자기 턴에서만 요청 가능
- 계가: 상대가 15초 내 응답(미응답 시 자동 수락)
- AI(전체 난이도): 서버에서 턴/타이머 처리
- AI: 평가 기반 자동 계가/기권
- AI: 서버가 계가 요청 가능; 플레이어 요청은 AI가 자동 수락
- AI 턴 타이머: 인간 턴보다 짧음
- AI vs AI 룸 유지: 소유자 연결 해제 시에도 유지
- AI vs AI 룸 삭제: leaveRoom 시에만 제거
- AI vs AI 룸 정리 로그: 서버 콘솔에 기록
- AI 네이밍: 스타일 라벨만 사용(N4TIVE/GanghanDol)

이벤트 스펙(WebSocket)
- Client -> Server: hello { type: "hello", userId }
- Client -> Server: enterLobby { type: "enterLobby", userId }
- Client -> Server: createRoom { type: "createRoom", userId, title, ruleset }
- Client -> Server: joinRoom { type: "joinRoom", userId, roomName }
- Client -> Server: spectateRoom { type: "spectateRoom", userId, roomName }
- Client -> Server: leaveRoom { type: "leaveRoom", userId, roomName }
- Client -> Server: startGame { type: "startGame", userId, roomName }
- Client -> Server: startAiGame { type: "startAiGame", userId, roomName, difficulty }
- Client -> Server: startAiVsAiGame { type: "startAiVsAiGame", userId, roomName, difficulty }
- Client -> Server: setSpectatorChat { type: "setSpectatorChat", userId, roomName, enabled }
- Client -> Server: chatSend { type: "chatSend", userId, scope, roomId, text }
- Client -> Server: logout { type: "logout", userId }
- Client -> Server: gameAction { type: "gameAction", userId, roomName, action }
- gameAction types: place { type: "place", x, y }
- gameAction types: pass { type: "pass" }
- gameAction types: resign { type: "resign" }
- gameAction types: undoRequest { type: "undoRequest" }
- gameAction types: undoAccept { type: "undoAccept" }
- gameAction types: undoReject { type: "undoReject" }
- gameAction types: scoreRequest { type: "scoreRequest" }
- gameAction types: scoreAccept { type: "scoreAccept" }
- gameAction types: scoreReject { type: "scoreReject" }
- Server -> Client: state { type: "state", state, serverTime }

데이터 흐름
클라이언트 UI(LoginUI/LobbyUI/GameUI) -> AppUI 상태
AppUI 상태 -> WebSocket send (server/ai_server.js)
WebSocket send -> 서버가 상태 업데이트
서버 업데이트 -> 브로드캐스트
브로드캐스트 -> AppUI가 상태 정규화
AppUI -> UI 렌더링

서버 AI (클라이언트+서버)
- 모든 난이도는 server/ai_server.js에서 처리
- 서버가 AI 이름 생성 및 턴 처리
- KataGo 구성 시 KataGo 사용 (JS fallback 없음)
- 자동 계가/기권 및 계가 수락은 서버에서 처리
- AI는 계가 요청 가능, AI 턴 타이머는 더 짧음
- AI vs AI는 서버에서만 진행, 소유자는 관전
- 분석 오버레이: 기본 50수 이후, 약 4초 간격
- AI 스타일 (AI_STYLE_MODE 또는 측별 오버라이드):
  - N4TIVE: KataGo 결과 그대로 사용
  - 강한돌 휴리스틱: 후보 재랭킹 전용 (필터+Ownership 잠금+방문수 클리핑+초록돌 최소 패널티)
- 기본 AI vs AI: N4TIVE vs GanghanDol, 흑/백 랜덤
- 강한돌 휴리스틱 재랭킹 훅: server/aiStyle_ganghandol_heuristic.js 의 pickCandidateMove 사용
- AI 룸 정리 로그:
- [ws] close user=...
- [ai-room] preserve room on removeUserEverywhere user=... reason=... room=...
- [ai-room] remove room on removeUserEverywhere user=... reason=leaveRoom room=...

KataGo 연동(서버 측, 기본 경로)
- 서버는 KataGo GTP 프로세스로 AI 수를 위임
- 분석 요청으로 소유권/스코어리드 오버레이 생성
- 분석 호출: kata-search_analyze {color} ownership true 사용
- 분석 결과는 room.game.analysis로 저장되어 GameUI.jsx에서 렌더링
- 현재 KataGo (2026-02-05 기준): KataGo v1.16.4 (Eigen/CPU)
- KataGo 폴더: C:\katago-v1.16.4-eigen-windows-x64
- KataGo 모델: kata1-b6c96-s175395328-d26788732.txt.gz (KataGo 폴더)
- 프로젝트 KataGo 설정: C:\guga-go\katago_gtp_guga.cfg
- GTP 로그: C:\guga-go\gtp_logs (logAllGTPCommunication=true 시 세션별 기록)
  - 환경 변수:
    - KATAGO_PATH (필수): C:\katago-v1.16.4-eigen-windows-x64\katago.exe
    - KATAGO_CONFIG (필수): C:\guga-go\katago_gtp_guga.cfg
    - KATAGO_MODEL (필수): C:\katago-v1.16.4-eigen-windows-x64\kata1-b6c96-s175395328-d26788732.txt.gz
    - KOMI (선택): 표시/판정에 사용하는 덤 (기본 0)
    - KATAGO_INTERNAL_KOMI (선택): KataGo 내부 수읽기용 덤 (기본: KOMI=0일 때 6.5, 그 외 KOMI 값)
    - KATAGO_ANALYSIS=1 (선택): 분석 오버레이 활성화(기본 비활성)
    - KATAGO_ALLOW_RECT=1 (필수): 직사각형 보드 허용(19x13)
    - KATAGO_GREEN_AS (선택): 초록돌을 흑/백으로 매핑(기본 black)
    - KATAGO_ANALYSIS_MIN_MOVES (기본 50): 분석 시작 최소 수
    - KATAGO_ANALYSIS_INTERVAL_MS (기본 4000): 분석 간 최소 간격
    - KATAGO_MOVE_TIMEOUT_MS (기본 12000): genmove 타임아웃
    - KATAGO_ANALYSIS_TIMEOUT_MS (기본 8000): 분석 타임아웃
    - AI_STYLE_MODE (기본 native): 서버 AI 스타일
    - AI_STYLE_BLACK (기본 native) / AI_STYLE_WHITE (기본 ganghandol): AI vs AI 측별 스타일
    - KATAGO_CANDIDATE_COUNT (기본 10): 후보 수
    - AI_CANDIDATE_ADJUST_WEIGHT (기본 0.2): 후보 조정 가중치(전략 가중치 최소화)
    - AI_GREEN_CANDIDATE_BONUS (기본 0.55): 초록돌 인접 보너스(최소 유지)
    - AI_GREEN_CANDIDATE_RADIUS (기본 2): 초록돌 보너스 맨해튼 반경
    - AI_RECT_AXIS_BONUS (기본 0.15): 19x13 긴 축 바이어스
- 환경설정 체크리스트: ENV_GUIDE.ko.md
- 요구사항: KataGo 미구성 시 AI 게임 시작 무시
- 직사각형 보드: KATAGO_ALLOW_RECT 활성 시 boardsize 19 13 전송
- boardsize는 세션 최초 1회 전송, 이후 대국마다 clear_board로 초기화
- 초록돌 처리: KATAGO_GREEN_AS 로 매핑, 초록돌은 벽처럼 취급(인접 영역도 단색이면 집 가능)
- 저사양 튜닝: KataGo config에서 threads, maxVisits/maxTime를 낮게 권장

성능 저하 트러블슈팅
- Eigen/CPU는 GPU(OpenCL/CUDA) 대비 약함
- 낮은 maxVisits/maxTime은 강도를 크게 낮춤
- 잦은 타임아웃은 강도 저하
- 보드/룰: 19x13 + 커스텀 룰은 19x19보다 모델 적합도가 낮음

GTP 브릿지 계약(서버 <-> KataGo)
- GTP 커맨드 시퀀스:
  - `boardsize {columns} {rows}` (직사각형 허용 시) 또는 `boardsize {size}` (세션 최초 1회)
  - `clear_board` (대국 시작 시)
  - `komi {value}`
  - `play {color} {coord|pass}` (히스토리 전개)
  - `genmove {color}` (AI 수)
  - `kata-search_analyze {color} ownership true` (분석 전용)
- 분석 전용 호출의 제안 수는 무시

비표준 룰(구가바둑)
- 보드 크기: 19 x 13
- 1~4수(패스 포함)는 중립돌(초록) 배치: 흑 중립 → 백 중립 → 흑 중립 → 백 중립
- 패스도 초반 4수에 포함되며, 이 경우 초록돌이 4개 미만일 수 있음
- 중립돌은 최대 4개이며 위치는 흑/백이 자유롭게 결정
- 초반 4수는 중립돌 배치 단계로 단수/따냄/자살 체크 없음
- 5수부터 흑/백이 정상적으로 교대로 둔다
- 중립돌은 제3의 돌이며 흑/백과 연결되지 않는다
- 중립돌은 캡쳐/사석 처리가 불가능하다
- 중립돌은 집을 만들지 못하며 자리만 차지한다
- 중립돌은 벽처럼 취급되며, 중립돌에 닿아도 흑/백 단색이면 집이 될 수 있다
- 사석 자동 제안은 참고용이다
- 사석 확정은 별도 규정이 없고, 현재 구현은 표시/참고용이다(서버 점수 계산에는 반영되지 않음)
- 덤(표시/판정): 0
- 덤(내부/KataGo): KOMI=0일 때 6.5 (기본), 또는 KATAGO_INTERNAL_KOMI로 강제
- 초읽기: 30초 3회
- 무르기: 플레이어당 최대 3회
- 계가: 100수 이상, 자기 턴에서만 요청 가능
- 계가 요청은 15초 내 응답, 미응답 시 수락으로 간주
- 분쟁 처리: 계가 거절 시 대국을 계속한다(추가 분쟁 절차 없음)
- 계가 절차: 요청 → 상대 수락 시 즉시 scoreNow로 종료, 거절 시 진행

계가시 중립돌 시나리오
1. 중립돌은 집을 만들지 못하고 항상 점유된 칸으로만 계산된다.
2. 중립돌은 캡쳐/사석 처리가 불가능하다.
3. 중립돌만으로 둘러싼 구역은 집이 아니다.
4. 중립돌은 벽처럼 취급되므로, 구역이 흑/백 단색에만 닿으면 집이 될 수 있다.

수정 위치
- 게임 룰: src/gameEngine.js
- 서버 권한/타이머: server/ai_server.js
- UI 텍스트: src/i18n.js
- 로비 UI: src/LobbyUI.jsx
- 로그인/게스트 ID 규칙: src/LoginUI.jsx
- 게임 UI/오버레이: src/GameUI.jsx
- AI 동작(카타고 연동): server/ai_server.js
- AI 스타일 라우팅: server/aiStyle_dispatcher.js
- N4TIVE 스타일: server/aiStyle_n4tive.js
- 강한돌 휴리스틱 스타일: server/aiStyle_ganghandol_heuristic.js
- 시뮬레이션: scripts/ai_match.js

시뮬레이션 (scripts/ai_match.js)
- 목적: 오프라인 N4TIVE vs GanghanDol(또는 기타) 대전
- 기본값:
  - games: 10
  - swap: games/2 (자동 스왑)
  - black/white 미지정: 기본 매칭(BLACK=N4TIVE, WHITE=GanghanDol)
  - randomColors: false (옵션 없으면 비활성)
- 실행 예시 (10판, 5/5 스왑):
  - node scripts/ai_match.js --games 10 --swap 5 --black native --white ganghandol --out matches/ai_match
- 랜덤 색상:
  - --randomColors (플래그) 사용 시 흑/백 랜덤 스왑
  - 비활성은 옵션 미사용 또는 --randomColors 0





