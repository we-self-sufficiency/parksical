# S-13 연습 리포트·3회 연속 목표·도장/칭호

2026-11-15(KST) · #14 / F-12·F-13 · 개발 구현 범위. develop 통합·Wiki 게시·배포/Base URL·실제 SDK/실차 검증은 PR/이슈에서 별도로 확인한다.

## 범위·설정

TypeScript/NestJS/PostgreSQL/Prisma 서버가 기존 [S-12 미션 기록](missions.md)의 `mode=PRACTICE`만 사용한다. 별도 원본 업로드나 앱 로컬 판정 엔진·지도/픽셀 리플레이를 만들지 않는다. `DEV_AUTH_ENABLED=true`와 `DEV_MISSIONS_ENABLED=true`가 필요한 **비운영 SYNTHETIC 전용**이며 기본 OFF다. production/개발 인증 없는 opt-in/`REAL_MISSIONS_ENABLED=true`는 기동 차단이다. 추가 활성화 설정은 없다.

```sh
npm ci
npm run generate
npm run migrate:deploy
npm run build
npm start
```

개발 인증/차량 연결과 ACTIVE SYNTHETIC vehicle-session을 준비하고 미션 카탈로그의 stageId를 선택한다. `POST /runs`의 mode를 PRACTICE로 지정한 뒤 **원래 차량 AuthSession**으로 `/runs/{runId}/result`를 제출한다. 결과 쓰기 권한과 불변 영수증 계약은 S-12 그대로다. WEB은 결과를 생성/수정하지 못하지만 본인 연습 기록 무효 처리는 가능하다.

D-02의 실제 결과 수집·동의·보관/삭제·인정과 D-04의 MAX/운영 장소·주행 정책은 계속 PENDING이다. E1~E8 실제 SDK/차량 근거를 받았다고 표시하지 않는다. 합성 자격을 얻어도 `operationalChallengeAllowed=false`, `rankingEligible=false`, `rewardEligible=false`이며 실제 도전/랭킹·월간 무료 쿠폰 자격으로 사용하지 않는다. 도장/칭호는 **개인 합성 연습용 표시**다.

## API·인증

아래 경로 앞에는 `/api/v1`이 붙는다. Bearer 인증, 성공/실패 모두 `Cache-Control: no-store`. JSON64KiB, 엄격한 미지 필드 거절. 계정별 연습 읽기300회/쓰기100회·5분, 기존 전체 MissionRun 1,000건/계정 상한을 유지한다.

| 경로 | 동작 |
|---|---|
| GET `/practice/runs?limit=20&cursor=...` | 본인 PRACTICE 회차·최소 요약·직전 완료 회차 비교. ACTIVE 포함 |
| GET `/practice/runs/{runId}` | 같은 리포트 단건. CHALLENGE/타인/다른 설치는404 |
| GET `/practice/progress?runId=UUID` | 해당 회차와 같은 목표 그룹의 현재 연속 성공·합성 자격·추천·도장/칭호 |
| GET `/practice/awards?limit=20&cursor=...` | 본인 ACTIVE/REVOKED 도장·칭호·자격 묶음. 같은 목표 그룹당 하나 |
| POST `/practice/runs/{runId}/invalidation` | 완료 결과의 무효 표식과 자격 재계산. Idempotency-Key 필수,201 |

WEB은 본인 계정 전체, VEHICLE은 본인 **현재 인증한 설치**만 조회/무효 처리한다. ADMIN도 타인 접근을 우회하지 못한다. 세션 만료/로그아웃·연결 해제는401이며 공유 차량의 다음 사용자는 이전 사용자의 기록을 보지 못한다. 같은 소유자의 새 로그인은 무효 처리가 가능하지만 원래 미션 결과를 다시 쓰는 권한을 얻지 않는다.

목록 limit은1~50(기본20), cursor는 계정/WEB·VEHICLE/설치/limit/API 종류에 묶인다. 회차 목록은 `startedAt DESC, runId UUID DESC`, 도장 목록은 `recognition.id UUID DESC`다. 동시 업로드·지연 기록으로 다음 페이지에 새 항목이 삽입될 수 있는 현재 뷰이며 고정 스냅샷 내보내기는 아니다. 잘못된/다른 사용자·조건 cursor는400. 무효 처리 후에도 행과 cursor 앵커는 유지한다.

## 목표 버전과 순서 — A-16 개발 기본값

`practice-v1`은 **모든 선택 스테이지가 SUCCESS이고 각각3별인 COMPLETED 회차**를 목표 성공으로 본다. 미션에서 SUCCESS인 smooth2별도 이 연습 목표에서는 미달이다. 속도·짧은 시간으로 별이나 연속 자격을 추가하지 않는다.

그룹은 `userId + installationId + lotId + structureVersion + mission ruleVersion + 순서를 포함한 전체 stage snapshot + goalVersion`이다. 서로 다른 차량 설치/구조/스테이지 구성·순서/목표 버전의 성공을 섞지 않는다. `cohortKey`는 이 고정 값의 canonical SHA-256이며 사용자·차량 지원 인증 수단이 아니다.

정렬은 **시도 발생 `startedAt ASC` → 같은 시각이면 서버 UUID ASC**다. 수신 시각·HTTP 도착 순서·클라이언트 문자열 ID는 자격 순서가 아니다. 같은 시각 UUID는 결정적인 동점 기준일 뿐 물리적 선후를 증명하지 않는다.

| 기록 | 연속 성공 처리 |
|---|---|
| 완료·전 단계3별 SUCCESS | +1 |
| FAILED 또는 목표 별 미달 | 0으로 끊음 |
| ABORTED/UNVERIFIABLE | 0으로 끊음. 안전 중단을 실패/점수 벌점으로 바꾸지 않음 |
| ACTIVE·결과 미수신 | 미확정 장벽으로 끊음. 나중에 결과가 오면 다시 계산 |
| INVALIDATED | 삭제/건너뛰지 않고 장벽으로 끊음 |
| 같은 완료/생성 재전송 | 새 회차를 만들지 않음 |
| 과거 회차의 지연 생성/완료 | 발생 순서에 삽입하여 전체 같은 그룹 재계산 |

`[성공, 성공, 실패, 성공, 성공, 성공]`은 6회차에서 처음 자격을 얻는다. 유효한3연속 구간이 하나라도 있으면 자격이 유지되며, 그 뒤의 실패만으로 이미 달성한 구간을 취소하지 않는다. 과거 지연/무효 기록으로 **모든 유효3연속 구간이 사라지면 회수**한다. 최초로 달성한 구간의3번째 회차가 `qualifyingRunId`다. `currentStreak`은 마지막 기록까지의 연속 길이이므로 자격 true이면서0일 수 있다.

한 그룹/목표 버전마다 도장 `THREE_PERFECT_PRACTICES`, 칭호 `PRACTICE_READY`, 자격을 **동일 recognition ID의 한 묶음**으로 저장한다. 회수 후 다시 달성하면 같은 ID가 ACTIVE가 된다. 현재 상태는 progress/awards로 조회하고 과거 제출 영수증을 현재 자격으로 해석하지 않는다.

추천은 `STAGE_COUNT_TEST_POLICY`라는 **합성 연습 구성 제안**이다. 자격 미달은 현재 단계 수 반복, 자격 달성 시 최대3개까지 스테이지 수 +1 검토를 제안한다(이미3개면 유지). 실제 주차장 난이도/운전 실력 인증이나 새 도전 허가가 아니며 새 구성의 catalog·capability·로컬 허용 여부를 다시 확인해야 한다. 자동으로 다음 시도를 시작하지 않는다.

새 목표/칭호 규칙은 새 goalVersion과 migration/registry를 추가해야 한다. 기존 버전 상수를 덮어쓰거나 과거 membership을 갱신하지 않는다. 미지원 목표 버전은422, 잘못된 DB goalVersion 갱신도 거절한다. 임의 버전 변경 API는 없다.

## 리포트·미확인 값

[리포트 예제](examples/practice-report.json), [목록 예제](examples/practice-page.json), [진행도 예제](examples/practice-progress.json), [도장 목록 예제](examples/practice-awards.json)는 실제 합성 HTTP 테스트 응답이다. 예제의 UUID/시간은 테스트용이며 실제 발급값으로 바꾼다.

- `elapsedMs`: 앱 단조 시간 기반 총 시도 시간. 중단 결과에도 보고한 시간은 보존하되 완료 회차 간 비교만 제공한다.
- `gearTransitionCount`: 각 스테이지의 선택 기어 **유효 관측 사이 값이 바뀐 횟수** 합계. 최초 관측은 전환이 아니며 결측/재시작 구간을 이어 붙이지 않는다. 값이 있으면 gear 품질은 AVAILABLE이고 전환 횟수는 validSampleCount−1 이하여야 하며 모순된 요청은422 INVALID_GEAR_TRANSITION_COUNT다. S-13에서 `StageMetrics`에 선택적인0~10,000 정수/null을 추가했다. 원본 기어 배열·새 SDK API 이름을 요구하지 않는다. `reverseSegmentCount`로 기어 전환을 역산하지 않는다.
- `abruptSteeringCount`: 기존 로컬 미션 요약값 합계. 조향 품질이 없는 reverse/ramp 회차에서0으로 꾸미지 않는다.
- 횟수는 전 단계가 완료되었고 해당 필드와 AVAILABLE 신호가 모두 있을 때만 합계다. 누락/null/부분 중단/품질 저하는 `null`이며 오래된 S-12 기록도 소급해 숫자를 만들어 넣지 않는다.
- 비교 대상은 같은 그룹의 **직전 무효가 아닌 COMPLETED 회차**(실패 완료 포함)다. 변화량은 현재−직전 값, 어느 쪽이 미확인이면null이다. 무효/미완료 회차의 비교 변화량도null. 시간 변화는 관측 비교이며 빠름 보상이 아니다.
- 결과는 `APP_REPORTED_SYNTHETIC`, 물리는 UNVERIFIED다. `rawTrajectoryAvailable=false`, `mapReplayAvailable=false`. 지도 리포트는 별도 D-02 정책·앱 측 추가 데이터/정확성 검증이 필요하다.

## 무효 처리·재시도

```json
{"expectedVersion":1,"reason":"CORRECTION"}
```

`expectedVersion`은 **PracticeRecord의1→2** 버전으로 MissionRun의 생성1/결과2 버전과 다르다. reason은 `CORRECTION` 또는 `USER_REQUEST`이며 자유문자/개인정보를 받지 않는다. [요청](examples/practice-invalidate.json)과 [영수증](examples/practice-invalidated.json)을 참고한다.

완료 결과만 무효 처리한다(ACTIVE422). 불변 MissionRun/최종 결과를 수정/삭제하지 않고 별도 무효 표식을 한 번 남긴다. 같은 reason을 새 키로 보내도 원래 무효 시각/영수증을 재전송하고 `Idempotency-Replayed:true`를 붙인다. 같은 키에 다른 body/경로는409 IDEMPOTENCY_CONFLICT, 이미 무효인 기록의 reason 변경은409 PRACTICE_ALREADY_INVALIDATED다. 복구/내용 수정 API는 없으며 수정 시 새 시도를 만들어야 한다. 무효 기록은 연속 성공의 장벽으로 남는다.

생성·결과 저장·무효 처리·자격 계산·영수증은 같은 사용자 advisory transaction lock을 공유한다. 결과 저장/무효 표식/도장 상태/재전송 영수증 중 하나가 실패하면 전부 롤백한다. 응답 유실 시 동일 키/동일 body로 재시도한다. GET progress/awards는 이전 버전 서버/기존 기록의 누락·오래된 파생 projection을 같은 잠금 안에서 재구성할 수 있다. 결과 원본과 회차 순서는 바꾸지 않는다. 목록/리포트도 같은 잠금으로 일관되게 읽으며 기존1,000건 상한 안에서 계산한다.

| 상태 | 대표 코드·대응 |
|---|---|
|400|INVALID_REQUEST/INVALID_IDEMPOTENCY_KEY/INVALID_PRACTICE_CURSOR 또는 기존 cursor 파서 코드. 입력/조건 수정|
|401|UNAUTHENTICATED. 새 인증 뒤 본인 권한 재확인|
|403|MISSIONS_POLICY_DISABLED. 비운영 opt-in/설정 확인|
|404|RESOURCE_NOT_FOUND. 타인/설치/CHALLENGE 존재를 구분해 노출하지 않음|
|409|IDEMPOTENCY_CONFLICT/PRACTICE_ALREADY_INVALIDATED. 본인 기록을 다시 조회하고 payload 변경 재시도 금지|
|422|PRACTICE_RESULT_REQUIRED/PRACTICE_GOAL_UNSUPPORTED. 미완료/지원 버전 확인|
|413/429|JSON 크기/빈도 제한. 429 Retry-After 준수|
|503|PRACTICE_MIGRATION_REQUIRED 또는 DB 장애. migration/의존 상태 확인 후 같은 요청 재시도|

## migration·호환성·검증

`20261115020000_practice_reports`는 PracticeRecord/PracticeRecognition/PracticeMutation을 추가한다. 기존 PRACTICE에 practice-v1 membership만 backfill하며 기존 결과/룰·스테이지·영수증/누락 횟수는 고치지 않는다. DB INSERT trigger가 이전 S-12 서버가 만든 새 PRACTICE도 등록한다. 기존 S-12 결과 payload와 재전송 해시는 유효하며, 새 선택 필드를 기존 재전송 body에 추가하면 당연히 다른 요청으로 충돌하므로 원래 body를 재사용한다.

OpenAPI0.11.0은5연산을 추가하고 MissionStageMetrics에 선택적 gearTransitionCount를 확장한다. 나머지 기존54연산 계약은 유지한다. 새 클라이언트는 S-13 서버 배포 후 선택 필드를 보내야 하며 S-12 서버는 미지 필드를400으로 거절한다. 기존 차량 contractVersion1.0, 이벤트2종·주차 위치·QR 계약/설정은 바꾸지 않는다.

검증은 `npm run verify`, 실제 PostgreSQL의 `npm run test:integration`, `python scripts/check_contract.py`를 사용한다. 공통 [6개 합성 연속 사례](../fixtures/practice/streak-scenarios.json), 발생/동시 시각 순서·지연/무효·목표 버전 격리, 회차 비교/미확인 값, 소유권/설치·모드 분리, 동시 재전송·트랜잭션 롤백·지연 projection 재구성·재기동·이전 스키마 업그레이드 테스트를 포함한다. 운영 실제 SDK/실차 검증과 구분한다.

develop 통합 후 Wiki Home의 준비 현황/기록과 별도 Practice 가이드를 게시하고 Missions/MAX 문서에서 연결한다. 통합 전에는 Wiki를 연동 완료로 표시하거나 #14 Wiki 완료 체크를 하지 않는다.

S-14 통합 계약은 OpenAPI0.12.0이며 기존 연습5연산/목표·결과 스키마는 그대로다. [합성 예약](reservations.md)은 별도 기본OFF 기능으로 예약을 연습 성공/실제 도전 자격으로 승격하지 않는다.
