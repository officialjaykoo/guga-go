환경설정 (GUGA Go)

이 문서는 docs_src/ENV_GUIDE.ko.md에서 자동 생성됩니다.
수정 후 `npm run docs:generate`를 실행하세요.


이 문서는 docs_src/ENV_GUIDE.ko.md에서 자동 생성됩니다.


필수 (서버 + AI)
- KATAGO_PATH: KataGo 실행 파일 경로
- KATAGO_CONFIG: KataGo 설정 파일 경로
- KATAGO_MODEL: KataGo 모델 파일 경로
- KATAGO_ALLOW_RECT=1: 직사각형 보드 허용 (19x13 필수)

권장
- KOMI: 서버 + KataGo 덤 (기본 0)
- KATAGO_ANALYSIS=1: 분석 오버레이 활성화 (기본 비활성)
- KATAGO_GREEN_AS: 중립돌(초록)을 KataGo에서 흑/백으로 매핑 (기본 black)
- PORT: WebSocket 서버 포트 (기본 5174)
- AI_STYLE_MODE (기본 native): 사람 vs AI 기본 스타일
- AI_STYLE_BLACK (기본 native) / AI_STYLE_WHITE (기본 ganghandol): AI vs AI 기본 스타일

현재 경로 예시
- KATAGO_PATH: C:\katago-v1.16.4-eigen-windows-x64\katago.exe
- KATAGO_CONFIG: C:\guga-go\katago_gtp_guga.cfg
- KATAGO_MODEL: C:\katago-v1.16.4-eigen-windows-x64\kata1-b6c96-s175395328-d26788732.txt.gz


