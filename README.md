# parksical-server

P지컬 차량 앱과 통신하는 서비스 백엔드입니다.

- 기술: TypeScript, NestJS, PostgreSQL, Prisma
- 실행·검증: [개발 안내](docs/server-development.md), [백업·복구](docs/operations.md)
- 인증·차량 연결: [개발 인증과 운영 미정 범위](docs/authentication.md)
- 이벤트 수신·재전송: [계약과 합성 시나리오](docs/vehicle-ingestion.md)
- 주차장·구조 관리: [가상 주차장 1곳과 관리 API](docs/parking-lots.md)
- 개발 통합 브랜치: `develop`
- 서버 작업지시서: [develop의 Agent.md](https://github.com/we-self-sufficiency/parksical-server/blob/develop/Agent.md)

차량 SDK 연동과 주행 중 화면 제어는 차량 앱이 담당하며, 이 저장소는 API와 서비스 데이터를 관리합니다.

