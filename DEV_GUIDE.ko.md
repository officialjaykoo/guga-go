# GUGA Go 개발 가이드

## 1) 현재 프로젝트 기준
- 프론트엔드: Vite + React
- 서버: Node.js + ws(WebSocket)
- 게임 엔진/SGF/검증 로직: `shared/` 공용 모듈
- 기본 보드: **19x13 고정**
- AI 스타일: **native 단일 경로** (레거시 스타일 제거 완료)

## 2) 빠른 시작
1. 의존성 설치
```bash
npm install
```
2. 서버+프론트 동시 실행
```bash
npm run dev:all
```

## 3) 주요 디렉터리
- `server/ai_server.js`: WebSocket 서버, 방/대국/AI 턴 처리
- `server/messageSchema.js`: 인바운드 메시지 스키마 검증
- `shared/game/engine.js`: 게임 규칙/착수/패스/기권/계가
- `shared/game/sgf.js`: SGF 저장/불러오기
- `shared/common/validation.js`: 이름 검증
- `shared/ai/katagoGtp.js`: KataGo GTP 통신
- `shared/ai/katagoParsers.js`: KataGo 분석 파싱
- `shared/ai/independentAi.js`: 독자 모델 로직
- `scripts/match/ai_match.js`: 범용 AI 매치 실행기
- `scripts/match/katago_selfplay_guga.js`: KataGo selfplay 오케스트레이션
- `scripts/match/model_selfplay_guga.js`: 데이터 준비 + 독자 모델 사이클 오케스트레이션
- `scripts/train/*`: 데이터/학습/독자 selfplay
- `scripts/ops/*`: 릴리즈/롤백/가드/대시보드/메트릭 운영 스크립트

## 4) 서버 이벤트(요약)
### Client -> Server
- `authLogin`
- `hello`, `enterLobby`, `logout`
- `createRoom`, `joinRoom`, `spectateRoom`, `leaveRoom`
- `startGame`, `startAiGame`, `startAiVsAiGame`
- `setSpectatorChat`, `chatSend`
- `gameAction` (`place`, `pass`, `resign`, `undoRequest`, `undoAccept`, `undoReject`, `scoreRequest`, `scoreAccept`, `scoreReject`)
- `loadKifu`

### Server -> Client
- `state`
- `chatEvent`
- `notice`
- `authOk`

## 5) AI 동작 원칙(현재)
- 서버 AI는 `native` 단일 스타일만 사용
- `startAiGame/startAiVsAiGame`는 내부적으로 native 경로로만 실행
- 분석(`kata-search_analyze`)은 환경변수로 ON/OFF 제어
- 독자 모델 서버 모드는 `AI_ENGINE_MODE=independent`로 전환

## 6) npm 스크립트 (현재 5개)
- `npm run dev:all`: 서버(`ai_server.js`) + 프론트(Vite) 동시 실행
- `npm run ai:selfplay:guga`: 1차 KataGo selfplay 데이터 생성(빠른 기본값)
- `npm run ai:selfplay:model`: 2차 독자 모델 사이클(데이터 준비+학습+selfplay)
- `npm run server:independent`: 독자 모델 추론 서버 모드 실행
- `npm run test`: 가드레일 테스트 실행(회귀 체크)

## 7) selfplay 권장 실행
### 1차: KataGo selfplay 데이터 생성
```bash
npm run ai:selfplay:guga -- --games 1000 --workers 2 --seed 20260304
```
- 기본: `native vs native`, `difficulty=god`, `simFast=1`, `analysis=0`, `dataset=1`

### 2차: 독자 모델 사이클
```bash
npm run ai:selfplay:model -- --cycles 5 --games 2000 --seed 20260304
```
- 내부 순서: `ai_prepare_train -> independent_train -> independent_selfplay_cycle`

## 8) 룰/엔진 기준
- 보드: 19x13
- 중립(초록) 돌 4개 시작 규칙 유지
- 초읽기: 기본 30초 3회
- 무르기: 플레이어당 최대 3회
- 계가 요청: 100수 이상 + 자기 턴

## 9) 운영 데이터 파일
- `server/data/ai_ops_config.json`: active/previous style, abTest 상태
- `server/data/ai_runtime_metrics.jsonl`: 런타임 메트릭 원본
- `server/data/ai_runtime_metrics.summary.json`: 메트릭 요약
- `server/data/ai_release_history.jsonl`: 릴리즈/롤백 이력

## 10) 현재 정리 상태
- legacy 스타일(`ganghandol`, `pure`, `n4tive`) 제거
- 스타일 라우터 파일 제거
- 미사용 candidate 경로 제거
- 문서/코드는 native-only 구조로 정렬
