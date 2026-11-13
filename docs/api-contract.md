# S-01 서버·차량 앱 계약 v0.1

상태: 구현 전 검토 계약. 연결 이슈: [#2](https://github.com/we-self-sufficiency/parksical-server/issues/2). 기준: [Agent.md](../Agent.md).

기계 판독 명세는 [openapi.json](openapi.json), 합성 예제와 사례 목록은 [examples/manifest.json](examples/manifest.json)이다. OpenAPI 버전은 3.1.1이며 계약 문서 버전 0.1.0, 요청 contractVersion은 `1.0`이다. 이 명세는 API가 이미 실행 중이라는 뜻이 아니다. D-01~D-07의 운영 정책은 [DECISIONS.md](DECISIONS.md)에서 별도로 추적한다.

## 책임과 첫 구현 범위

차량 앱은 SDK 수집·지원 확인·CarUxRestrictions·즉시 중단·로컬 추정/판정·오프라인 저장을 책임진다. 서버는 인증과 소유권, 주차장 데이터, 버전 있는 계산 설정, 최소 결과 동기화와 거래를 책임진다. 네트워크 중단을 차량 안전 제어의 실패로 연결하지 않는다.

| 순서 | 이슈 | 산출물 |
|---|---|---|
| 1 | S-02 #3 | NestJS·PostgreSQL·Prisma 실행·검증 기반 |
| 2 | S-03 #4, S-04 #5 | 계정/차량 연결·메타데이터 이벤트 |
| 3 | S-05 #6, S-07 #7, S-06 #8, S-08 #9 | 주차장·난이도·검색·리뷰 |
| 4 | S-09 #10, S-10 #11 | 위치 동기화·수정·QR 첫 연동 |
| 병행 조사 | S-11 #12 | MAX 허용 범위·SDK 신호·미션 구간 |
| 후속 | S-12~S-18 #13~#19 | 미션·연습·예약·랭킹·거래·보상 |

## URL·버전·인증

- 기본 경로는 `/api/v1`. OpenAPI의 `api.example.invalid`는 접속 대상이 아닌 D-06 대체용 주소다. `/p/{token}`은 기본 API 경로 밖의 휴대폰 웹이다.
- 공개 주차장 조회 외 API는 사용자 bearer 자격 증명을 요구한다. 토큰 형식·제공자·만료/갱신 수명은 D-01/S-03에서 확정한다. 개발 인증은 운영에서 금지한다.
- `/vehicle-sessions`와 이벤트 API에는 사용자 인증 외에도 승인된 앱 설치 연결이 필요하다. `installationId`는 앱 설치용 임의 ID이며 VIN·사용자 ID가 아니다. body에 적은 ID만으로 연결을 승인하지 않는다.
- 계정 주체는 서버 인증 컨텍스트에서 결정한다. body의 userId, source, 차량 모델명은 권한·실차 인증의 근거가 아니다. SDK capability는 앱이 보고한 상태다.
- 자원 조회·변경은 소유자를 검사한다. 인증 실패는 401, 기능/연결 권한 없음은 403, 타인/없는 개인 자원은 일관되게 404로 처리한다. 관리자 권한과 결제 webhook 인증은 별도다.
- 공유 차량은 사용자 변경/로그아웃/연결 해제로 이전 사용자의 인증·차량 연결·서버 세션을 폐기한다. 신규 사용자에게 과거 위치·기록을 자동 승계하지 않는다. 다른 계정에서 이전 clientRecordId를 보낸다고 이전 기록이 조회되지 않는다.
- `/v1`의 호환 변경은 선택 필드 추가가 기본이다. 알 수 없는 요청 필드는 거부하므로 새 필드를 보내기 전 계약 협의가 필요하다. enum/필수 필드 변경은 새 버전 또는 명시적인 전환 기간을 둔다. 클라이언트는 알 수 없는 응답 필드를 무시하며 알 수 없는 상태를 정상/0으로 해석하지 않는다.

## 단위·시각·품질

| 항목 | 전송 계약 |
|---|---|
| 차체 | mm 정수. 전장 1,000~10,000, 전폭 500~4,000은 입력 검증 한계이며 지원 차종 판정 아님 |
| 좌표 | WGS84 위도/경도 degree. lat -90~90, lng -180~180 |
| 거리 | m. 위치 이동거리 null 허용, 0~100,000 |
| 속도/조향 | 알고리즘·향후 계약의 단위는 km/h·degree. 현재 원본 시계열 수신 필드는 없음 |
| 시각 | RFC3339 UTC `Z`. 발생 시각 occurredAt과 서버 createdAt/receivedAt/updatedAt 구분 |
| 짧은 지속시간 | 앱의 단조 증가 시간에서 ms로 계산. 서버 수신 간격으로 대체하지 않음. 운전 요약 수신은 D-02/S-12에서 별도 확정 |
| 월 경계 | 서버 UTC 저장, 집계/정산 월은 Asia/Seoul |

Capability는 `SUPPORTED / UNSUPPORTED / PERMISSION_DENIED / ERROR / UNKNOWN`과 checkedAt으로 표현한다. SUPPORTED는 해당 값이 최신이라는 뜻이 아니다. 향후 개별 신호를 계약할 때 값의 `AVAILABLE / MISSING / STALE / INVALID` 품질과 sampledAt을 별도로 정의한다. 미지원 값을 0/false로 채우지 않는다. 현재 이벤트는 capability 메타데이터만 받으며 원본 신호 값은 받지 않는다.

## 자원과 정본 쓰기 경로

| 경로 | 쓰기 의미·불변 조건 |
|---|---|
| POST `/vehicle-sessions` | 인증 설치 연결에 종속된 서버 세션 생성. 응답 ID를 이벤트에 사용 |
| POST `/vehicle-sessions/{sessionId}/events` | `CAPABILITIES_REPORTED`, `SESSION_CLOSED`만 수신. 위치·미션·결제 변경을 실행하지 않음 |
| POST `/parked-locations` | 개인 위치 생성의 정본. 사용자+clientRecordId 유일성으로 로컬 기록 동기화 |
| PATCH `/parked-locations/{locationId}` | expectedVersion 기반 사용자 수정. 추정 원본은 내부 이력에 유지 |
| DELETE `/parked-locations/{locationId}` | 본인 위치 접근·QR·첨부 무효화. 세부 보관/삭제 기한은 D-02에서 결정 |
| POST `/runs` (후속) | 개인 미션 결과 저장의 정본. 이벤트 API에 같은 결과를 중복 제출하지 않음 |

공통 이벤트 API에 범용 payload map이나 원본 배열을 열지 않는다. 미션·주차 위치 DTO를 추가하려면 각각의 정본 자원 계약을 먼저 변경한다. 이벤트 영수증은 저장/적용 결과이며 차량의 안전·위치 정확성·물리적 정차 증명이 아니다.

## 중복·동시성·오프라인

개발 기본값은 아래와 같다. 가역적인 처리 규칙은 A-01/A-02에 기록하고 운영 데이터 보관 기한과 혼동하지 않는다.

1. POST와 PATCH는 Idempotency-Key를 요구한다. 범위는 인증 사용자+설치 연결(차량 API)+HTTP method+정규화된 자원 경로+key다. 요청 본문의 의미상 정규 JSON을 비교하고 키 순서/공백 차이는 무시한다. 입력·권한 검증 후 원자적으로 결과와 중복 키를 저장한다.
2. 이벤트에서는 eventId와 Idempotency-Key가 같아야 한다. (sessionId,eventId)와 (sessionId,sequence)는 각각 유일하다. 같은 키+다른 body 또는 같은 sequence+다른 이벤트는 409다.
3. 성공 재시도는 최초 HTTP 상태·본문을 그대로 반환하고 `Idempotency-Replayed: true`를 추가한다. requestId 헤더는 이번 요청 값이다. 재인증/소유권 검사는 항상 먼저 하므로 폐기된 권한으로 결과를 재조회할 수 없다. 진행 중 요청은 409 REQUEST_IN_PROGRESS, Retry-After 초 값을 제공한다.
4. 인증·형식·정책 오류/일시적 외부 장애는 성공 결과로 캐시하지 않는다. 커밋 전 실패는 같은 키 재시도 가능, 커밋 후 응답 유실은 저장된 성공 결과 재생이다. 처리 중 상태는 장애 후 복구해야 한다.
5. 개발 합성 fixture의 중복 키/삭제 표시는 만료시키지 않는다. 운영 dedup·삭제 표시 보관은 D-02 결정 전 미확정이다. 승인 없이 개인 자료의 영구 보관 정책으로 확대하지 않는다.
6. ACTIVE 세션에서 늦게 도착한 capability는 이전 72시간 이내면 저장할 수 있다. 낮은 sequence는 STORED_OUT_OF_ORDER로 응답하고 현재 capability를 덮어쓰지 않는다. 누락된 sequence를 기다리며 안전 판단하지 않는다.
7. 개발 이벤트의 72시간 초과는 422 EVENT_TOO_OLD, 서버보다 5분 넘는 미래는 422 CLOCK_SKEW다. 발생 시각은 클라이언트 주장이다. 이 시간 창은 A-02의 조정 가능한 기본값이다.
8. SESSION_CLOSED 적용 후 신규 이벤트는 409 SESSION_CLOSED, 연결 폐기는 403 SESSION_REVOKED다. 정상 중복 재생은 새 입력의 세션 상태 검사보다 먼저 하되, 인증·권한 폐기 검사보다 뒤에 한다. 세션은 재개하지 않고 새 세션을 만든다.
9. 개인 위치의 늦은 동기화는 세션 메타데이터의 72시간 창과 구분한다. 유효한 현재 사용자 인증으로 원래 occurredAt을 보낼 수 있다. 과거 기록은 이력에 남기되 현재 위치 선택 순서를 바꾸지 않는다. 최신 선택은 (occurredAt,id), 사용자 수정은 version으로 보호한다. 기록에 찍힌 시간만으로 방문 진위를 인정하지 않는다.
10. 같은 clientRecordId의 같은 생성 body는 기존 결과를 반환한다. 다른 body는 409 RECORD_CONFLICT이며 수정은 PATCH로 수행한다. 삭제 후 같은 ID의 재전송은 409 RESOURCE_DELETED로 거부한다. 삭제 후 생성하려면 새 로컬 기록 ID를 사용한다.
11. PATCH는 version이 맞을 때만 원자적 적용하고 version을 증가시킨다. 충돌은 409 VERSION_CONFLICT다. 재조회 후 사용자가 수정 내용을 합치는 방식을 앱에 제공한다. 누락 필드는 유지, 명시적 null은 미확정/메모 지움을 뜻한다.

## 검색·위치·커서

- lat/lng/radiusM은 주변 검색의 필수 값이다. 반경 100~20,000m, limit 기본 20/최대 100은 A-03의 개발 기본값이다. 거리 기준은 입구 대표 좌표의 대권 직선거리이며 주행/보행 경로 거리나 층 이동거리가 아니다.
- sort=DISTANCE(기본)는 (distanceM,id), DIFFICULTY는 (보정 score,distanceM,id)로 안정 정렬한다. lengthMm/widthMm는 둘 다 보내거나 둘 다 생략한다. 하나만 보내면 422 INCOMPLETE_CAR_SIZE다.
- 커서는 불투명하며 사용자/공개 범위·검색 필터·sort·계산 룰 버전에 바인딩한다. 다른 질의나 무효 커서는 400 INVALID_CURSOR, 룰/데이터 스냅샷이 달라 재현 불가하면 409 CURSOR_EXPIRED 후 첫 페이지부터 재조회한다. 마지막 페이지 nextCursor는 null이다.
- 개인 위치 목록은 본인 자료를 (occurredAt DESC,id DESC)로 조회한다. 커서에는 민감 원문을 넣지 않는다. 같은 스냅샷에서 중복 페이지를 만들지 않는다.
- 구조 버전이 없으면 floorId/zoneId는 null이어야 한다. 알려진 층·구역은 해당 lot/structureVersion에 속하는지 검사하고, zone만 지정하고 floor가 없는 입력은 거부한다. 구조 버전이 폐기/불명확하면 임의 다른 구조에 매핑하지 않는다.
- 난이도 score 1~5의 0.5 단위 표시와 요소·결측/표본 정책은 S-07에서 구현한다. 입력 미확인 시 BASELINE과 missingFactors를 반환하며 합성 여부를 유지한다.

## 오류·재시도·크기

오류 body는 `{error:{code,message,requestId,retryable,details:[{field,reason}]}}`다. details에는 민감 입력을 그대로 반사하지 않는다. X-Request-Id를 응답하며 서버가 생성하거나 검증한 추적 ID만 사용한다.

| 상태 | 대표 code | 앱 동작 |
|---|---|---|
| 400 | INVALID_REQUEST, INVALID_CURSOR | 입력 수정 |
| 401 | UNAUTHENTICATED | 인증 갱신/로그인, body 자동 반복 금지 |
| 403 | INSTALLATION_NOT_LINKED, SESSION_REVOKED, POLICY_NOT_ENABLED | 연결/정책 확인 |
| 404 | RESOURCE_NOT_FOUND | 삭제/소유권 경계에 맞춰 화면 정리 |
| 409 | IDEMPOTENCY_CONFLICT, SEQUENCE_CONFLICT, VERSION_CONFLICT, SESSION_CLOSED, RESOURCE_DELETED | 충돌 해결 또는 새 세션/기록 |
| 409 | REQUEST_IN_PROGRESS | 같은 키로 Retry-After 이후 재시도 |
| 422 | EVENT_TOO_OLD, CLOCK_SKEW, CONTRACT_VERSION_UNSUPPORTED, INCOMPLETE_CAR_SIZE, INVALID_REFERENCE | 시각·버전·필드 확인 |
| 413 | PAYLOAD_TOO_LARGE | 요청 축소, 원본 신호 업로드로 우회 금지 |
| 429,503 | RATE_LIMITED, DEPENDENCY_UNAVAILABLE | Retry-After 준수, 지수 backoff+jitter, 같은 키 유지 |

인증·스키마 검증·크기 제한·속도 제한을 적용한다. 초기 JSON body 제한 64KiB, 파일 업로드는 별도 계약이다. 구체적 빈도 한계는 S-02/S-04에서 실행 환경에 맞춰 설정하고 429를 제공한다. 단일 이벤트 요청만 지원하며 범용 배치 전송은 없다.

## QR와 후속 API의 미정 경계

QR 발급 경로와 24시간 expiresAt은 초안이다. D-07 전에는 POLICY_NOT_ENABLED다. 권장안은 GET /p/{token}은 교환 확인 페이지만 표시하고, 명시적 POST 교환으로 토큰을 1회 소비하여 제한된 휴대폰 세션을 발급하는 방식이다. 세션 쿠키·CSRF·만료/철회·재조회 경계는 D-07/S-10에서 확정한다. 토큰이 URL에 있으므로 로그·Referrer·캐시·미리보기 처리도 S-10에서 검증한다.

| 영역 | 예약 경로·후속 작업 | 미정 사항 |
|---|---|---|
| 인증 | `/auth/*`, `/me`, 차량 연결 승인/폐기: S-03 | 제공자 교환·갱신·연결 코드 방식 D-01. /me만 현재 OpenAPI에 정의 |
| 구조·첨부·리뷰 | `/lots/{id}` 구조 확장, `/reviews`, 위치 첨부: S-05/08/09 | 구조·이용 권한 D-03, 파일 저장 D-06 |
| 미션·기록 | `/missions`, `/runs`, 본인 리포트: S-12/13 | 구간·판정·신호 품질·수집 D-02/04 |
| 예약 | `/reservations`, 슬롯/취소: S-14 | 수용량·견적·동의·만료 D-04/05 |
| 랭킹 | `/rankings/{lotId}?month=YYYY-MM`: S-15 | 인정 수준·동점·공개 철회 D-02/04/05 |
| 거래 | `/payments`, `/subscriptions`, 제공자 webhook: S-16/17 | 실제 제공자·환불·자격 D-05 |
| 보상 | `/coupons/me`, 내부 월간 정산: S-18 | 금액/시간·지급 자격·비용 D-05 |

예약 경로는 확정 DTO가 아니다. 위 기능은 후속 PR에서 typed schema와 정상/실패 예제를 추가해야 하며 `additionalProperties: true`인 범용 body로 먼저 운영하지 않는다. 정산은 공개·무인증 API로 만들지 않는다.

## 사례 검증

examples는 전부 합성 데이터다. 정상, steeringAngle 미지원, 순서 역전, 동일 성공 재생, 같은 키 다른 body, 오래된 이벤트, 비활성 정책, 알 수 없는 버전의 기대 응답을 manifest에 연결한다. 이는 스키마 검증 자료이며 실제 수신·권한·원자성 테스트는 S-03/S-04/S-09에서 구현한다.

검증은 JSON 파싱, JSON Schema 2020-12 정의 검사, 내부 $ref 해석, 요청/응답 예제 검증, 음성 입력 거절, 경로 변수·operationId·오류/보안·사례 응답 일치를 포함한다. 검증 스크립트는 [check_contract.py](../scripts/check_contract.py)이며 `python -m pip install -r scripts/contract-validation-requirements.txt` 후 `python scripts/check_contract.py`로 실행한다. 이 Python 도구는 문서 검증용이며 서버 런타임은 TypeScript/NestJS다. NestJS lint/build/runtime 검증은 S-02 이후 적용한다.

공식 형식 근거: [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html). SDK 근거와 미확인 항목은 [차량 계약 노트](vehicle-contract-notes.md)에 분리했다.
