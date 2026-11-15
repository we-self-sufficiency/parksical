# S-15 월간 랭킹·기록 인정·공개 동의

관련: #16/S-15 · F-12/F-14 · [결정 A-18, D-02/04/05](DECISIONS.md) · [미션](missions.md) · [연습](practice.md) · [OpenAPI](openapi.json).

## 현재 범위·실행

TypeScript/NestJS/PostgreSQL/Prisma 기반의 **SYNTHETIC 개발 랭킹**이다. 실제 SDK·차량 증거가 없으므로 합성 정합성 통과를 실차 인증이나 운영 경쟁/보상으로 승격하지 않는다. 모든 응답에 source=SYNTHETIC, physicalVerification=UNVERIFIED, operationalAllowed/rankingEligible/rewardEligible=false, operationalBlockers=[D-02,D-04,D-05]를 넣는다. 실제 결제·구독·쿠폰 지급은 없다.

비운영 호스트에서 migration/generate/build 후 명시적으로 실행한다.

```bash
DEV_AUTH_ENABLED=true
DEV_AUTH_SECRET=<local-random-key-at-least-32-characters>
DEV_RANKINGS_ENABLED=true
# 새 합성 미션을 만들 때만 별도 필요
DEV_MISSIONS_ENABLED=true
```

DEV_RANKINGS_ENABLED는 기본false, production·개발 인증 없는 활성화·REAL_RANKINGS_ENABLED=true는 기동 차단이다. 기존 Compose production은 OFF를 유지한다. 미션 플래그가 꺼져도 이미 저장한 합성 랭킹 조회/철회는 가능하다. 자동 랭킹·공개 동의·확정·정산 시드는 없다. 실제 배포/Base URL·SDK/실차·E1~E8·QR D-07은 별도 미완료다.

## API·인증·연동

앞에 /api/v1을 붙인다. Bearer WEB/VEHICLE, 현재 차량 연결/사용자를 재검사한다. 랭킹 개인 조회/변경은 **본인 계정 전체**이며 원래 /runs의 VEHICLE 설치 한정 범위와 다르다. ADMIN도 타인 기록/동의를 읽거나 변경하지 못한다. 공개 보드는 이 개발 기능을 켠 인증 사용자에게만 공개된다. 로그인 없이 접근하는 공개 웹은 없다.

| 메서드·경로 | 동작 |
|---|---|
| GET /rankings/{lotId}/cohorts?month=YYYY-MM | 현재 공개 참가자가 있는 비교 그룹 탐색,200 |
| GET /rankings/{lotId}?month=YYYY-MM&cohortKey=SHA256&limit=20&cursor=... | 공개 보드,200 |
| GET /rankings/{lotId}/me?month=YYYY-MM&cohortKey=SHA256 | 본인 최고 기록/순위,200 |
| GET /me/ranking-consent | 현재 동의 버전·공개 상태,200 |
| PUT /me/ranking-consent | 명시적 동의/철회,200 |
| GET /ranking-records/{runId} | 본인 CHALLENGE 인정 수준/그룹·삭제 표식,200 |
| POST /ranking-records/{runId}/invalidation | 완료 기록 무효화,201 |
| POST /ranking-records/{runId}/deletion | 랭킹 참여 소프트 삭제,201 |

성공/오류 모두 no-store, JSON64KiB, 미지 필드 거절. 읽기300/쓰기100회·계정·5분, 변경 영수증4000건/계정이다. 쓰기는 Idempotency-Key(ASCII 영숫자/점/밑줄/하이픈1~64자) 필수다. 월은2000~2099년 YYYY-MM, limit1~50/기본20이다. 보드 계산은 최대10000 CHALLENGE/주차장/월, 그룹 최대100이다. 한도 초과는503이며 상위 일부만 계산한 순위를 반환하지 않는다. 작은 합성 개발용 전역 잠금/한도이며 대규모 운영 랭킹의 성능 보장을 뜻하지 않는다.

1. [Missions](missions.md)에서 SYNTHETIC CHALLENGE를 만들고 원래 차량 AuthSession으로 결과를 제출한다. 기존 미션 요청/응답은 바뀌지 않는다.
2. 본인 ranking-records로 month/cohortKey/recognition을 읽는다. 공개 동의가 없어도 본인 그룹을 알 수 있다. 다른 사용자의 runId를 탐색하지 않는다.
3. 기본 공개 OFF를 표시하고 별도 명시적 선택이 있을 때에만 동의 요청을 보낸다. 계정 로그인/미션 완료/예약 결제를 공개 동의로 해석하지 않는다.
4. 공개 그룹/보드와 본인 순위를 각각 조회한다. 같은 score라도 공개 여부/모집단에 따라 보드와 본인 rank가 다를 수 있다.

## 인정 수준·같은 조건·별점/동점

개발 참가 조건은 source=SYNTHETIC, mode=CHALLENGE, 단일 COMPLETED 최종 결과, 지원되는 rankings-v1/missions-v1이다. 저장된 전체 룰이 registry와 같고 전체 단계/별/시각/품질/결과의 정합성을 다시 검증하며 저장 assessment도 일치해야 한다. `CHECKED`나 별점 범위만 만족한 불완전 보고는 제외한다. 인정 수준은 SYNTHETIC_CONSISTENT이고 **운영 rankingEligible는 여전히 false**다.

PRACTICE·APP_REPORTED/시뮬레이션의 실차 주장·ACTIVE/ABORTED/UNVERIFIABLE·미지원 룰/위조 assessment·무효/삭제·마감 후 수신은 운영 경쟁·실제 보상에서 제외한다. PRACTICE는 ranking-records가404이며 [연습 자격](practice.md)과 분리한다. 원본 신호·궤적을 새로 수집하지 않는다.

cohortKey는 주차장+구조 version+ruleVersion+동결 전체 rules+순서를 포함한 전체 StagePlan+rankings-v1+vehicleCorrection=UNAVAILABLE의 canonical SHA256이다. 같은 그룹 안에서만 비교하고 서로 다른 단계수/구조/룰을 섞지 않는다. StagePlan의 구간/주차면·품질 요구도 그룹에 포함한다. 새 룰은 새 registry/버전으로 도입하며 과거 그룹/결과를 소급 덮어쓰지 않는다.

기존 MissionRun에는 검증된 차량 치수/차종이 없다. carProfile capability=SUPPORTED는 차체 데이터가 아니다. 따라서 차량 크기 가산/보정계수를 발명하지 않고 comparability=SYNTHETIC_EQUAL_INPUTS_ONLY를 표시한다. 서로 다른 실제 차량의 공정한 비교는 D-02/D-04의 증거·새 계약 전에는 활성화할 수 없다.

각 계정/그룹/월의 최고 stars 한 건을 채택한다. 동일 stars는 먼저 시작한 기록, 같은 시작 시각은 UUID 오름차순으로 대표 기록을 정한다. 공개 정렬은 stars 내림차순→startedAt 오름차순→UUID 오름차순이다. **동일 별점은 공동1위/1위/2위(dense rank)**다. 시간/UUID는 화면 순서의 기술 기준이며 실차 선후 증명이나 쿠폰 수상자 선정이 아니다. elapsedMs/속도/기어 횟수에는 가산점이 없다. 동점 보상·기준점수·구독 시점은 S-18/D-05에서 별도 확정한다.

[공개 응답](examples/ranking-board.json)은 entryId(별도 무작위 UUID), 서버 생성 닉네임, rank, score만 참가자 필드로 제공한다. userId/runId/설치·전송·인증 세션/정확한 발생 시각/시간·신호 요약은 내보내지 않는다. 그룹 정보는 공개된 합성 구조/단계 참조이고 차량 이동 데이터가 아니다. 닉네임은 P-12hex의 서버 가명이며 고유한 신원 보장/익명화가 아니다. 자유 입력 실명·전화·이메일 필드는 받지 않는다.

## 공개 동의·철회와 내부 자격의 분리

[기본 조회](examples/ranking-consent-off.json)는 version0/enabled=false/nickname=null이다. 정책 rankings-public-v1의 개발 공개 범위는 **과거/미래의 모든 합성 월·확정 원천 포함**, 공개 필드는 위의4개다. 앱은 이 범위를 설명하고 선택을 받아야 한다. 실제 계정 연결 운전 기록 수집/보관 동의 D-02는 계속 PENDING이다.

```json
{"expectedVersion":0,"policyVersion":"rankings-public-v1","enabled":true,"agreedAt":"2026-11-15T09:00:00.000Z"}
```

[동의 요청](examples/ranking-consent-write.json)의 시각은 현재 UTC로 바꾼다. 클라이언트 agreedAt은 DB 시각±5분, 서버 changedAt은 DB UTC epoch milliseconds다. [응답](examples/ranking-consent-on.json)은 version1과 서버 가명을 반환한다. 동의는 연속 버전과 시각/상태 이력을 남기고 과거 닉네임 복사본을 만들지 않는다. 동의 이력·현재 상태·기존 User.rankingPublic 표시값·영수증은 한 트랜잭션이다. 기존 rankingPublic=true만으로는 공개되지 않으며 /me의 기존 필드는 실제 현재 버전 동의를 반영한다.

[철회](examples/ranking-consent-withdraw.json)는 최신 expectedVersion, enabled=false, agreedAt=null이다. 즉시 이후 공개 보드/그룹에서 제거하고 확정된 월도 현재 동의를 재검사한다. 닉네임은 비공개 응답에서null이다. 과거 동의 key를 재전송해도 역사적 응답을 재생할 뿐 다시 활성화하지 않는다. 변경 후 항상 GET으로 현재 version/enabled를 확인한다. 재동의는 최신 버전으로 새 요청을 보내야 한다.

공개 OFF는 **공개에서 숨김**이며 내부 합성 개인 최고/월 확정 입력 삭제가 아니다. 본인 순위 모집단은 공개 참가자+본인(PUBLIC_PLUS_CALLER)뿐이다. 비공개 다른 참가자 수/순위를 노출하지 않는다. 비공개만 있는 그룹은 공개 그룹 탐색에 나오지 않는다. 빈 공개 보드는 그룹 상세/확정 snapshot ID·시각도 숨긴다. 내부 운영 자격/실제 보관·삭제 범위를 공개 opt-in에서 유추하지 않는다.

## KST 월·지연·잠정/확정·개인 삭제

발생 startedAt의 KST 월에 배정하며 구간은 [매월1일00시,다음달1일00시)이다. 예: 2026-10-31T14:59:59.999Z는10월, 15:00:00.000Z는11월이다. 완료가 다음달로 넘어가도 시작 월을 따른다. UTC 저장과 KST 달력 경계를 구분한다. [공유 경계 fixture](../fixtures/rankings/month-boundaries.json)를 참고한다.

A-18의 가역적인 **개발 마감**은 다음 KST 월 시작+72시간, 수신은 cutoff 미만이다. 도전 생성/최종 결과의 서버 receivedAt 모두 cutoff 전에 있어야 한다. 기존 미션의72시간 지연/미래5분 허용 검증도 별도 유지하므로 랭킹 cutoff가 더 긴 업로드 허가를 주지 않는다. 지연 결과를 마감 전에 받으면 잠정 최고/순위를 재계산한다. 정확한 cutoff 또는 이후는 AFTER_CUTOFF이고 새 월로 옮기지 않는다. 실제 보상 업로드 마감의 제품 확정은 D-05 후속이다.

| 상태 | 의미 |
|---|---|
| PROVISIONAL | 개발 cutoff 전, 유효 개인 최고를 현재 원천으로 계산 |
| READY_TO_FINALIZE | cutoff 도달, 수신 마감 적용·내부 확정 아직 없음 |
| FINALIZED | S-18용 내부 합성 원천/해시 한 번 저장. 실제 정산/쿠폰 완료 아님 |

GET만으로 월을 확정하지 않는다. 무효/삭제 전 잠정 보드는 다음 유효 개인 최고를 채택할 수 있다. 확정 후에는 선택된 최고 기록이 고정되므로 무효/삭제로 숨기더라도 다른 본인 시도를 대신 승격하지 않는다. 현재 공개 참가자끼리 rank를 다시 매겨 철회 사용자의 자리/수를 노출하지 않는다. 확정 당시 원천 순위와 공개 표시 순위는 같다고 가정하지 않는다.

[무효 요청](examples/ranking-invalidate.json)은 완료 CHALLENGE recordVersion1에서2로, [삭제 요청](examples/ranking-delete.json)은 정상1 또는 무효2에서 다음 버전으로 바꾼다. ACTIVE도 참여 삭제할 수 있다. 이유는 USER_REQUEST/CORRECTION만 받는다. 무효→삭제 가능, 복원/반대 순서는 불가다. [기록 조회](examples/ranking-record.json)와 [무효](examples/ranking-invalidated.json)/[삭제 영수증](examples/ranking-deleted.json)을 참고한다.

삭제 API는 **랭킹 참여의 소프트 삭제**다. 원래 MissionRun/Result/생성·결과 영수증을 바꾸거나 완전 삭제하지 않는다. 보드·본인 최고·내부 합성 입력에서 제외하고 최소 tombstone/삭제 시각과 재전송 영수증을 남긴다. 원본 미션 조회는 기존 계약을 유지한다. 전체 계정/운전 데이터 삭제·보관 기한은 D-02 확정 후 별도 작업이며 이 개발 API가 그 권리를 완전히 구현했다고 표시하지 않는다.

## S-18 내부 입력·잠금·재시도

[RankingService.finalizeSyntheticMonth](../src/rankings/ranking.service.ts)는 **내부 코드 포트**다. HTTP/admin/cron 실행·월간 자동 보상 경로를 열지 않았다. 활성화된 비운영 기능에서 cutoff 이후에만 호출하고, 동일 lot/month/cohortKey의 고유 DB snapshot과 inputHash를 한 번 만든다. 후보·그룹·룰/버전·시간창/마감이 해시에 포함된다. 다중 실행/재시작에도 같은 snapshotId/inputHash이며 원래 후보를 덮어쓰지 않는다.

반환값의 syntheticCandidates는 내부 userId/runId/별점/순위 등이 있는 **비공개 개인 데이터**이며 현재 무효/삭제를 다시 적용한다. 공개 철회만으로 내부 후보를 없애지 않는다. source=SYNTHETIC/operationalAllowed=false/rewardEligible=false와 **operationalCandidates=[]**가 반드시 유지된다. S-18은 이를 실제 쿠폰 입력으로 사용하면 안 된다. 실제 제공자·구독/차량 인정·동점/상한·cutoff 승인 이후 별도 운영 포트를 설계한다. 내부 함수/전체 후보 JSON을 HTTP 응답에 연결하지 않는다.

랭킹 조회/동의/표식/확정은 DB advisory lock synthetic-rankings-v1을 공유한다. 계정 작업은 인증 세션/설치→mission-user→개발 전역 순서다. 도전/결과 INSERT·DELETE trigger도 같은 전역 잠금을 얻어 이전 S-12/S-14 서버의 쓰기를 포함해 확정/공개 철회와 직렬화한다. 불변 결과·파생 후보·영수증을 따로 이중 적용하지 않는다. 한도 내 작은 합성 개발 기준이며 운영 규모에는 인덱스/집계 전략 재검토가 필요하다.

같은 key/body는 원래 응답, 같은 key/다른 경로·body는409다. 무효/삭제는 같은 action/body를 새 key로 보내도 최초 응답을 재생한다. 과거 응답은 현재 상태가 아니며 TTL/동의/기록을 되돌리지 않는다. 동의는 새 key라도 현재 expectedVersion을 검사한다. 동의/이력/표식/영수증 실패는 모두 롤백한다.

보드 cursor는 호출 계정·월/lot/cohort·limit·현재 공개 뷰 해시에 묶인다. 개인정보·정확한 시각을 cursor에 넣지 않는다. 공개 상태/점수/확정 상태가 바뀌면409 RANKING_VIEW_CHANGED이며 첫 페이지부터 다시 조회한다. 다른 사용자/조건·잘못된 cursor는400이다. 철회한 사용자가 나중 페이지의 과거 cursor에 남아 보이지 않는다.

## 오류·호환성·검증

400은 DTO/알 수 없는 필드/query/key/cursor,401은 미인증/연결 해제,403은 기본OFF/권한,404는 없는 lot·타인/PRACTICE 기록,409는 동의/기록 버전·멱등성/이미 제거·뷰 변경/마감 전 확정,422는 동의 시각·미완료 무효/알 수 없는 확정 그룹,413은 크기,429는 빈도,503은 DB/migration/개발 데이터 한도다. 429/503은 Retry-After/backoff를 따르고 응답 유실은 같은 body/key로 재시도한다. 새 body를 기존 키에 섞지 않는다.

migration 20261115040000_rankings는 한 DB 트랜잭션으로5테이블, 인덱스·버전/동의/불변·단조 표식 guard와 CHALLENGE membership trigger/backfill을 추가한다. 기존 미션/결과/영수증을 수정하지 않고 PRACTICE membership/예약 데이터도 유지한다. 기존 true 공개 boolean을 새 동의로 backfill하지 않는다. 이전 서버가 새 CHALLENGE를 만들면 DB trigger가 membership만 등록하며 실제 인정/동의/보상을 만들지 않는다. DB migration 후 새 서버, 이후 앱이 새 API를 선택적으로 호출한다.

OpenAPI0.13.0은8연산/9스키마를 추가하고 기존68연산/137스키마와 차량 contractVersion1.0을 유지한다. 기존 앱에 새 필수 입력을 추가하지 않는다. [예제 manifest](examples/manifest.json)는 실제 합성 HTTP 결과를 포함한다. npm run verify, 실제 PostgreSQL npm run test:integration, python scripts/check_contract.py로 KST/안정적 동점·모집단 프라이버시/철회·늦은 입력·이전 데이터 보존·원자 실패/동시성·별도 API 프로세스/DB 재시작을 검증한다. SDK/실차/배포 검증과 구분한다. develop 머지 후 Wiki Home/Rankings와 Missions/Practice/MAX 연결을 실제 게시·확인한 뒤 #16 Wiki 체크를 마친다.
