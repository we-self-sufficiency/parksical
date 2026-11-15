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
- QR·휴대폰 조회: [1회 교환·재조회·만료/폐기·최소 평면도](docs/location-qr.md)
- MAX 선행 조사: [정책·신호·미션별 가능 범위와 후속 구현](docs/max-feasibility.md)
- 합성 월간 랭킹·기록 인정·공개 동의: [KST·동점·철회/삭제·S-18 합성 입력](docs/rankings.md)
- 합성 예약 슬롯·견적·점유/만료·취소: [서버 가격·정원 경쟁·샌드박스 경계](docs/reservations.md)
- 합성 연습 리포트·3회 연속 목표·도장/칭호: [비교·순서·지연·무효·합성 자격](docs/practice.md)
- 합성 미션·도전 기록: [룰/구조 고정·품질/중단·불변 결과·재전송](docs/missions.md)
- 개발 통합 브랜치: `develop`
- 합성 MAX 패스·기간 권한: [월 구독·갱신/해지·환불·과거 자격](docs/subscriptions.md)
- 합성 사전결제·제공자 검증·영수증·전액 환불: [상태/재시도·예약 연동·실청구 차단](docs/payments.md)
- 서버 작업지시서: [develop의 Agent.md](https://github.com/we-self-sufficiency/parksical-server/blob/develop/Agent.md)

차량 SDK 연동과 주행 중 화면 제어는 차량 앱이 담당하며, 이 저장소는 API와 서비스 데이터를 관리합니다.
