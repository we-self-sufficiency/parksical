# S-04 차량 앱 메타데이터 수신

이슈 #5. 구현은 `/api/v1/vehicle-sessions` 생성·현재 상태 조회와 `/{sessionId}/events`의 capability/종료 이벤트 수신이다. 원본 주행 신호·위치·미션 결과를 수집/반영하지 않는다. 실제 운영 로그인(D-01), 개인 운전 요약 수집·보관(D-02)은 여전히 미정이다.

## 인증과 세션

- S-03에서 휴대폰 승인과 차량 deviceCode 교환을 완료한 VEHICLE bearer가 필요하다. WEB/ADMIN WEB 로그인만으로는 수신 API를 호출할 수 없다.
- AuthSession은 인증 자격의 세션이고 VehicleSession은 메타데이터 전송 세션이다. 서로 다른 ID다. 먼저 차량 토큰을 얻고 POST로 VehicleSession의 id를 발급받아 이벤트 경로에 사용한다.
- body의 installationId는 인증 자격에 묶인 서버 발급 설치 ID와 일치해야 한다. userId를 받지 않는다.
- 각 VehicleSession은 사용자·설치·원래 AuthSession에 고정된다. access/refresh 회전은 같은 AuthSession이므로 계속 사용할 수 있다. 로그아웃 후 재로그인·다른 계정·다른 인증 세션은 과거 전송 세션을 자동 승계하지 않는다.
- 읽기/재전송도 현재 인증과 연결 권한을 먼저 검사한다. 연결 해제/계정 전환 뒤 과거 receipt를 재생해 이전 계정 자료를 가져올 수 없다. 차량 앱의 로컬 큐도 계정/인증 세션별로 분리하고 폐기해야 한다.
- 전송 세션·이벤트 FK는 Restrict로 두어 인증 row를 물리 삭제할 때 기록을 조용히 함께 지우지 않는다. 운영 보관/삭제 절차는 D-02에서 확정한다.

## 입력과 경계

필드와 JSON 예제는 [OpenAPI](openapi.json), [examples](examples/manifest.json)를 따른다. 입력 DTO는 object만 받고 array/추가 필드/미정 이벤트 종류를 거절한다. 시각은 UTC의 `YYYY-MM-DDTHH:mm:ss[.SSS]Z`, 최대 ms 정밀도다. ISO 압축 표기·offset·불가능한 날짜는 거절한다. sequence는 1~2,147,483,647 정수다.

reportedSource는 SYNTHETIC/APP_REPORTED이며 생략 시 APP_REPORTED다. 이 값은 요청자가 신고한 출처이지 SDK/실차 인증이 아니다. 합성 fixture는 SYNTHETIC으로 보관한다. source를 전송 세션 도중 바꾸지 않는다.

현재 수신 종류는 CAPABILITIES_REPORTED와 SESSION_CLOSED뿐이다. 기어·차속 등 필드명은 지원 정보의 서비스 DTO이며 신호 값이 아니다. 상태는 SUPPORTED/UNSUPPORTED/PERMISSION_DENIED/ERROR/UNKNOWN과 checkedAt이다. 값의 미지원/권한 오류를 0·false로 바꾸지 않는다.

주차 위치 생성·수정은 후속 위치 API, 미션 결과는 후속 runs API가 정본이다. 이벤트 입력에 위치/원본 시계열/임의 map/미정 결과를 추가해 가짜 성공을 반환하지 않는다.

## 영속 중복 처리

1. 생성 POST는 Idempotency-Key를 요구하고 원래 AuthSession+key가 DB에서 유일하다. 사용자·설치는 인증 세션으로 고정되며 재로그인에는 별도 scope를 적용한다.
2. 이벤트는 header key와 body eventId가 같아야 한다. (VehicleSession,eventId), (VehicleSession,sequence)는 각각 DB 고유 제약으로 보호한다.
3. JSON object key 순서/공백은 비교에서 제외한다. 알려진 timestamp는 ms UTC로 정규화하고 기본 reportedSource도 반영한 SHA-256 request hash를 저장한다. 배열 순서/실제 문자열 값은 임의 동등 처리하지 않는다.
4. 동일 key+동일 body는 원래 201 body를 재생하고 Idempotency-Replayed: true를 추가한다. 다른 body는 IDEMPOTENCY_CONFLICT, 다른 eventId의 같은 sequence는 SEQUENCE_CONFLICT다.
5. 인증/소유권 → 기존 성공 조회 → 새 입력의 버전·종료·시각 검사 순서다. 원래 성공의 재전송은 세션 종료나 72시간 경과 뒤에도 가능하지만, 폐기된 인증으로는 불가능하다. 잘못된 DTO/header 형식은 성공 조회 전에 거절한다.
6. receipt와 상태 변경을 같은 트랜잭션에 기록한다. 같은 installation의 S-03 연결 변경·refresh와 같은 PostgreSQL advisory transaction lock을 사용해 계정 전환과 수신이 섞이지 않게 한다. 서버 메모리에만 중복 정보를 두지 않는다.
7. 트랜잭션 실패·커밋 전 오류는 성공으로 저장하지 않는다. 응답 유실은 같은 key/body로 재전송한다. 빈도 초과/일시 장애는 backoff하고 key를 바꾸지 않는다.

생성 재생은 최초 ACTIVE snapshot을 그대로 반환한다. 이후 상태가 CLOSED여도 원래 생성 응답은 변하지 않는다. 현재 상태가 필요하면 GET `/vehicle-sessions/{id}`를 사용한다. receipt의 lastAppliedSequence도 당시의 값이며 새 상태의 최대 sequence로 덮어쓰지 않는다.

## 지연·순서·종료

- 신규 이벤트의 occurredAt이 서버 수락 시각보다 72시간 이상 오래된 경우(경계 초과) EVENT_TOO_OLD, 5분 이상 미래인 경우(경계 초과) CLOCK_SKEW다. checkedAt의 미래 오차도 5분 이내여야 한다. 값은 클라이언트 주장이다.
- capability 이벤트는 마지막 적용 sequence보다 크고 occurredAt도 뒤로 가지 않을 때만 APPLIED다. 나머지는 STORED_OUT_OF_ORDER로 영수증과 함께 저장하고 현재 snapshot을 변경하지 않는다.
- 순서가 맞아도 개별 checkedAt이 기존보다 오래되면 해당 capability를 덮어쓰지 않는다. 오래된 SUPPORTED를 현재 값/실차 상태의 증거로 취급하지 않는다. APPLIED는 메타데이터 처리 상태이며 안전 판정/현재 주행 상태 보장이 아니다.
- 유효한 SESSION_CLOSED는 아직 사용되지 않은 낮은 sequence로 늦게 도착해도 보수적으로 닫는다. lastAppliedSequence/시각을 뒤로 낮추지 않는다. 이미 사용된 sequence와 충돌하면 거절한다.
- 종료 후 신규 이벤트는 SESSION_CLOSED다. 종료 전 성공/종료 자체의 정상 중복은 재생된다. 세션은 다시 열지 않고 새 전송 세션을 만든다.
- 상태 변경과 관계없이 미지원/unknown/누락을 정상 신호 값으로 보충하지 않는다. 서버에 전송이 늦어져도 차량 앱의 안전·로컬 저장/판정은 독립 동작해야 한다.

인증 폐기는 S-03 guard에서 401로 차단한다. 현재 인증은 유효하지만 이전 인증의 전송 세션이나 타인 세션을 지정하면 404다. 형식/필드 오류는 400, 지원하지 않는 계약 버전/시각은 422, 상태/중복 충돌은 409다. 요청당 JSON 64KiB를 유지하며 생성은 인증 세션당 5분 60회, 이벤트는 1,000회로 제한한다. 정상 재전송도 요청 제한의 대상이며 429의 Retry-After를 따른다.

## 합성 시나리오 클라이언트

[fixtures/vehicle/offline-replay.json](../fixtures/vehicle/offline-replay.json)은 seq2→seq1→중복→종료→기존 중복→신규 거절을 재현한다. 기존 개발 로그인/휴대폰 승인으로 발급한 VEHICLE 토큰과 설치 ID를 shell에 주입한다. 원문 자격을 Git/명령 로그에 남기지 않는다.

```sh
# PARKSICAL_API_BASE_URL: 기본 http://127.0.0.1:3000/api/v1
# PARKSICAL_VEHICLE_ACCESS_TOKEN: S-03 차량 토큰
# PARKSICAL_INSTALLATION_ID: 그 토큰에 묶인 설치 ID
node scripts/send-vehicle-scenario.mjs
```

클라이언트는 요청/응답의 secret을 출력하지 않고 단계·상태·재생 여부만 출력한다. 매 실행은 새 합성 세션이다. 실제 SDK를 수집하거나 실차 위치/부정행위를 검증하는 클라이언트가 아니다.

## 검증 증거와 남은 확인

실제 PG 통합은 생성/이벤트 동시 중복, key/sequence 충돌, 시간/순서 역전, 오래된 checkedAt, 지원 상태, 잘못된 DTO, WEB/타인/이전 계정 차단, 종료 후 재생을 확인한다. 별도의 compiled API 프로세스에서 이벤트를 저장하고 그 프로세스를 종료한 뒤 새 프로세스가 같은 DB receipt를 재생하는 테스트도 포함한다. 시계를 73시간 진행시킨 경우에도 기존 성공 재생과 새 오래된 입력 거절을 구분한다.

현재 증거는 합성 fixture·실제 서버/DB 계약 검증이다. 실제 차량 앱/SDK 연결 검증은 수행하지 않았다. 앱 담당자는 [vehicle-contract-notes.md](vehicle-contract-notes.md)에 API/권한/단위·지원 상태·앱/SDK 버전·차종/에뮬레이터·확인 시각·오류/정상 결과를 별도로 남겨야 한다. D-02의 원본/개인 결과 수집은 이 PR로 활성화하지 않는다.
