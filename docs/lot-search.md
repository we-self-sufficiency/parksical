# S-06 주변 주차장 검색·상세 API

이슈 #8, F-01/F-02/F-05. S-05의 가상 한 곳과 S-07의 동일 난이도 계산기를 WEB/VEHICLE 인증 조회에 연결한다. 현재 브랜치의 구현·테스트 범위이며 develop 머지/배포/실제 SDK 연결 완료를 뜻하지 않는다. 별도의 외부 데이터·지오코딩 제공자는 붙이지 않는다. 지속 시드는 기존 **한 곳·32면**을 유지하며 다중 검색 fixture는 테스트 DB에서만 생성·제거한다.

## 요청·인증

`GET /api/v1/lots`, `GET /api/v1/lots/{lotId}` 모두 유효한 WEB 또는 VEHICLE bearer를 요구한다. 일반 USER도 조회할 수 있다. 관리 API는 계속 ADMIN+WEB이다. [인증 준비](authentication.md)와 [가상 시드](parking-lots.md)를 먼저 준비한다. 미배포 Base URL/실제 로그인은 별도다. 서버 시작 시 시드를 자동 생성하지 않는다.

```text
/api/v1/lots?latitude=0&longitude=0&radiusM=3000&asOfYear=2026
/api/v1/lots?latitude=0&longitude=0&south=-0.01&north=0.01&west=-0.01&east=0.01&sort=EASIEST&vehicleLengthMm=5100&vehicleWidthMm=1900&asOfYear=2026
/api/v1/lots/66666666-6666-4666-8666-666666666666?asOfYear=2026
```

Authorization: Bearer <accessToken>을 붙인다. GET에는 Idempotency-Key가 필요 없다. 명세의 api.example.invalid와 합성 좌표 (0,0)은 실제 서버 주소/방문 목적지가 아니다.

| Query | 범위/동작 |
|---|---|
| latitude, longitude | 필수 WGS84 거리 기준점. 각각 -90~90, -180~180 |
| radiusM | 반경 1~20000m 정수, 기본 3000. 지도 범위와 동시 사용 불가 |
| south,north,west,east | 네 값을 모두 전달하면 지도 범위 모드. south<north, west<east, 축 차이 각각 1도 이하, 대각선 40km 이하. 날짜변경선 횡단 지도 범위는 400 |
| ownership | PUBLIC/PRIVATE/UNKNOWN. 미전달 시 모두 |
| partnered | 정확한 문자열 true/false. 합성 제휴 표시는 실제 제휴가 아님 |
| discountCode | [A-Z0-9_] 1~32자. 등록된 할인 조건 code 필터이며 이용자 할인 자격 판정이 아님 |
| sort | DISTANCE(기본), EASIEST |
| limit,cursor | 1~50(기본20), 응답 nextCursor를 그대로 다음 요청에 전달 |
| vehicleLengthMm, vehicleWidthMm, vehicleStatus | [S-07](difficulty.md)와 동일한 크기 쌍/지원 상태 검증과 기준 차체 fallback |
| asOfYear,ruleVersion | 동일 기준 연도(기본 서버 UTC 연도)·difficulty-v1. 재현/페이지 요청에 같은 값 유지 |

좌표는 부호 있는 십진수·소수 최대7자리, 정수는 십진 숫자 문자열만 받는다. 지수/hex/공백/중복 배열·미정 query는 400이다. 지도 모드에서도 latitude/longitude는 거리 정렬 기준점으로 필수이며 기준점이 지도 안에 있을 필요는 없다. 상세에는 S-07 query만 허용하고 선택 lotVersion을 지원한다. 검색은 현재 버전만 대상으로 하므로 lotVersion을 보내면 400이다. 목적지 이름 q/외부 장소 검색은 지원하지 않는다. 제공자 없음/실패를 빈 성공 지오코딩으로 대체하지 않는다.

## 거리·정렬·페이지 일관성

Haversine 구면 직선거리(m), 반경 6,371,008.8m를 사용한다. 실제 도로/주행/보행 거리나 진입 가능 경로가 아니다. 거리 원값으로 필터·정렬하며 distanceM을 정수로 미리 반올림하지 않는다. 반경 모드의 사전 경계는 날짜변경선 횡단과 극점을 처리한 뒤 SQL의 정확한 구면 거리로 다시 제한한다. 지도 범위는 경계 포함이다.

DISTANCE는 distanceM→UUID 오름차순이다. EASIEST는 S-07 unroundedScore 오름차순→distanceM→UUID이며 자료 부족 null은 맨 뒤다. 표시 별점으로 정렬하지 않는다. 동일 차량 보정이 각 주차장에 적용되므로 차체 기준을 바꿔도 순위가 같을 수 있으며 클리핑 동률은 거리/UUID로 결정한다. 목록의 vehicle.basis/inputStatus가 기본 기준과 요청 차량 크기를 구분한다.

한 RepeatableRead 읽기 트랜잭션에서 현재 active·SYNTHETIC revision만 조회한다. 공간/유형/할인 필터 후 현재 후보가 **1000곳을 초과하면 422 SEARCH_TOO_BROAD**로 거절한다. 일부만 반환해 잘못된 정렬을 만들지 않는다. 반경/지도 범위/필터를 좁힌 뒤 요청한다. limit은 후보 한도가 아니라 응답 페이지 크기다.

cursor는 버전 있는 주차장 후보 목록과 정렬에 영향을 주는 query·차체·기준 연도·페이지 크기를 묶은 불투명 값이다. 접근 권한/스냅샷 보관용 토큰이 아니며 위치·차체 원문을 포함하지 않는다. 다음 요청은 같은 query에 cursor만 추가한다. 조건이 바뀐 cursor는 400 INVALID_SEARCH_CURSOR, 후보의 추가/제거/현재 버전 변경은 409 SEARCH_CHANGED다. 409에서는 cursor를 버리고 첫 페이지부터 다시 검색한다. 요청마다 현재 자료를 읽으며 장시간 DB 스냅샷을 보관하지 않는다. 한 번에 내려온 페이지 안에서는 자료와 난이도가 일관된다. 같은 버전의 원문을 직접 수정하는 운영은 허용하지 않고 관리 API로 새 revision을 만든다.

## 응답·구조·미확인 상태

목록은 id/code/version, 이름·주소·WGS84 좌표, 공영/민영·주차 방식·제휴, 준공연도, 운영시간·요금·태그·등록 할인 조건, 출처/갱신 시각·구조 상태, 거리, 난이도 요약·차체 기준·결측 coverage, 내비 좌표와 MAX 상태를 제공한다. 구조/기둥/사진/원문 권리 문구·과거 자료 전체를 목록으로 읽거나 반환하지 않는다. SQL은 목록에 필요한 JSON 하위 필드만 투영한다. [PostgreSQL JSON 연산](https://www.postgresql.org/docs/current/functions-json.html)을 사용하며 query 값은 Prisma.sql 매개변수로 바인딩한다.

상세는 snapshot 전체(층·구역·입구·경사로·주차면·기둥·통로/진입 공간, 사진과 권리/출처 등), currentVersion과 요청 version, S-07의 전체 난이도 응답, 내비 좌표를 제공한다. 기본 현재 버전, lotVersion으로 과거 active 버전을 조회할 수 있으나 현재 주차장이 비활성이라면 과거 버전으로 우회하지 못한다. 구조 미매핑 배열 생략과 [], null의 기존 의미는 유지한다. COMPLETE는 실측/차종 수용/안전 인증이 아니다. 상세의 난이도는 동일 query의 `/lots/{lotId}/difficulty`와 같다.

선택 관리 필드 discounts는 [{code,label,conditions}] 최대20개·code 중복 금지다. 미전달/null은 미확인, []는 안내된 할인 없음이다. 조회 최상위 discounts는 미확인을 null로 정규화하며 기존 snapshot에 새 필드를 강제로 추가하지 않는다. 모든 할인/요금/제휴는 현재 합성값이다. 실결제 견적·예약·사용자 할인 eligibility를 제공하지 않는다.

모든 현재 자료는 SYNTHETIC이다. navigation은 WGS84 좌표를 제공하되 **usable=false, reason=SYNTHETIC_COORDINATE**로 실제 NaviHelper 목적지 설정에 사용하지 않도록 한다. 서버가 내비를 실행하지 않는다. challenge는 available=false/status=NOT_CONFIGURED다. 별점이나 관리자 challengeAllowed만으로 운영 장소·시간·미션·차량 조건을 충족했다고 표시하지 않는다. 실제 점유/빈자리 수 필드는 제공하지 않는다.

전체 JSON: [query](examples/lot-search-query.json), [검색 페이지](examples/lot-search-page.json), [상세·32면 구조](examples/lot-detail.json). [OpenAPI](openapi.json) 문서 버전은 0.7.0이며 차량 이벤트 contractVersion 1.0은 유지된다.

## 오류·재시도·개인정보

- 400: 잘못된 좌표/범위·필드·크기 쌍/지원 상태·페이지·cursor. 입력 수정 후 재요청한다.
- 401: 미인증·만료·폐기. 인증 갱신/재연결 절차를 따른다.
- 404: 없거나 비활성인 주차장/버전. 목록에 과거 active 버전을 대신 노출하지 않는다.
- 409 SEARCH_CHANGED: 결과 집합/버전 변경. cursor를 버리고 재검색한다.
- 422 SEARCH_TOO_BROAD / DIFFICULTY_RULE_UNSUPPORTED / LOT_SOURCE_UNSUPPORTED / INVALID_DIFFICULTY_INPUT: 범위/룰/자료 조건을 수정한다. 실제 자료 경로는 비활성이다.
- 429: 목록+상세 공통 인증 세션당 5분300회. Retry-After를 따른다. 기존 난이도 읽기의 별도 제한은 유지한다.

성공·인증/검증 오류 모두 Cache-Control: no-store다. 원문 URL/query·검색 위치·차체 크기·토큰을 로그나 DB 이력에 저장하지 않는다. 네트워크 실패는 제한된 backoff로 재시도한다. 개인 주차 위치/주행 자료 수집으로 범위를 확대하지 않는다.

## 변경·검증·Wiki 계획

이전 `/lots`와 상세는 OpenAPI 설계 전용이며 실제 제공되지 않았다. 이번 구현에서는 latitude/longitude·partnered·vehicleLengthMm/vehicleWidthMm·EASIEST 및 인증 필수 계약으로 구체화했다. 과거 설계의 lat/lng·partner·lengthMm/widthMm·DIFFICULTY와 무인증 호출을 구현된 계약으로 간주하지 않는다. 기존 구현된 인증·차량 이벤트·관리·S-07 난이도 API는 유지한다. discounts는 관리 DTO의 선택 필드이며 기존 요청·시드는 계속 유효하다.

migration은 LotRevision에 기본 빈 배열 discountCodes와 source/active/latitude/longitude B-tree·discountCodes GIN을 추가한다. 기존 데이터/불변 revision을 삭제/교체하지 않는다. 기존 버전에는 discounts가 없어 빈 배열이 맞으며 새 revision의 할인 조건에서만 색인을 만든다. 기동 전 migrate deploy를 적용한다. JSON 전체 구조 색인을 추가하지 않는다. 반경을 좁히는 복합 색인은 [PostgreSQL 복합 색인](https://www.postgresql.org/docs/current/indexes-multicolumn.html)의 선택도에 따라 점검하며 도시 단위/실데이터 규모의 PostGIS 도입은 필요 시 별도다.

검증은 단위 거리/극점·날짜변경선/범위·엄격 DTO·동률/null·페이지, 실제 PostgreSQL의 필터·거리/차량 기준 정렬·인증/폐기·상세/과거/비활성·기존 난이도 동일성·로그 제외·후보 초과와 3000개 추가 fixture에서 실제 후보 SQL의 EXPLAIN을 포함한다. 실측 정확도·실제 도로거리·SDK/배포 검증으로 보고하지 않는다.

PR #27 develop 통합 뒤 Wiki Home과 [Lot Search](https://github.com/we-self-sufficiency/parksical-server/wiki/Lot-Search)에 API/예제·검증 상태를 반영하고 기존 주차장/난이도 안내를 맞췄다. S-08 리뷰 opt-in·집계 metadata의 Wiki 반영은 해당 PR 머지 후 수행한다. D-01/D-02/D-03/D-04/D-06의 운영 결정은 그대로 남는다.

S-08에서 난이도 요약/상세의 reviewAggregation을 추가했다. 기본 비활성은 기존 계산을 유지하고 명시적 합성 리뷰 opt-in·원자 집계/표본/버전 변경은 [reviews.md](reviews.md)를 따른다. 후보의 리뷰 집계 버전 변경도 SEARCH_CHANGED를 일으킨다.
