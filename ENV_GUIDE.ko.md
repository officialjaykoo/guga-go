환경설정 (GUGA Go)


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
- AI 스타일: 현재 native 단일 경로 (AI_STYLE_BLACK/WHITE 레거시 미사용)

현재 경로 예시 (저사양)
- KATAGO_PATH: C:\katago-v1.16.4-eigen-windows-x64\katago.exe
- KATAGO_CONFIG: C:\guga-go\katago_gtp_guga.cfg
- KATAGO_MODEL: C:\katago-v1.16.4-eigen-windows-x64\kata1-b6c96-s175395328-d26788732.txt.gz

현재 PC 경로 예시 (CUDA)
- KATAGO_PATH: C:\katago-v1.16.4-cuda12.1-cudnn8.9.7-windows-x64\katago.exe
- KATAGO_CONFIG: C:\guga-go\katago_gtp_guga_3060ti_cuda.cfg
- KATAGO_MODEL: C:\katago-v1.16.4-cuda12.1-cudnn8.9.7-windows-x64\models\kata1-b28c512nbt-s12192929536-d5655876072.bin.gz

개발자 PC 환경 (현재)
- OS: Microsoft Windows 10 Home (10.0.19045, 64-bit)
- CPU: Intel(R) Core(TM) i7-6700K CPU @ 4.00GHz (4C/8T)
- GPU: NVIDIA GeForce RTX 3060 Ti (Driver 32.0.15.9174)
- RAM: 16 GB (17131708416 bytes)
- Node.js: v24.13.1
- npm: 11.8.0



