# parksical-server

P지컬 차량 앱과 통신하는 서비스 백엔드입니다.

- 기술: TypeScript, NestJS, PostgreSQL, Prisma
- 실행·검증: [개발 안내](docs/server-development.md), [백업·복구](docs/operations.md)
- 인증·차량 연결: [개발 인증과 운영 미정 범위](docs/authentication.md)
- 이벤트 수신·재전송: [계약과 합성 시나리오](docs/vehicle-ingestion.md)
- 주차장·구조 관리: [가상 주차장 1곳과 관리 API](docs/parking-lots.md)
- 차량 크기별 난이도: [버전 고정 계산·결측 처리·조회 API](docs/difficulty.md)
- 주변 검색·상세: [범위·필터·정렬·페이지·구조 조회](docs/lot-search.md)
- 리뷰·개발 집계: [합성 방문·중복/수정/삭제·난이도 반영](docs/reviews.md)
- 개인 주차 위치: [오프라인 동기화·수정 이력·비공개 사진/메모](docs/parked-locations.md)
- 개발 통합 브랜치: `develop`
- 서버 작업지시서: [develop의 Agent.md](https://github.com/we-self-sufficiency/parksical-server/blob/develop/Agent.md)

차량 SDK 연동과 주행 중 화면 제어는 차량 앱이 담당하며, 이 저장소는 API와 서비스 데이터를 관리합니다.
