# S-12 합성 미션·도전 기록

2026-11-15(KST) · [#13](https://github.com/we-self-sufficiency/parksical-server/issues/13) · F-10/F-11/F-12/F-16. [S-11 조사](max-feasibility.md), [SDK 확인 질문](vehicle-contract-notes.md), [결정 A-15/D-02/D-04](DECISIONS.md)가 기준이다.

## 준비와 범위

비운영 `DEV_AUTH_ENABLED=true`와 `DEV_MISSIONS_ENABLED=true`를 명시하고 migration/build를 적용한다. 기본은 false다. production·개발 인증 없는 활성화·`REAL_MISSIONS_ENABLED=true`는 기동 시 거절한다. 서버가 차량 SDK를 호출하거나 앱의 로컬 제한/판정을 대신하지 않는다. 원본 차속/기어/조향 시계열은 받지 않는다.

OpenAPI 문서 버전은 **0.10.0**, 차량 contractVersion은 기존 **1.0**이다. 기존 인증/이벤트/주차장/위치/QR의 입력은 유지한다. S-04의 이벤트 두 종류는 바꾸지 않고 미션 결과는 아래 개별 자원 API에만 저장한다. source는 SYNTHETIC만 허용한다. 실제 앱/실차 지원, 운영 게임 HUD/백그라운드·장소 허가·개인 운전 수집/보관·랭킹/금전 자격은 승인되지 않았다.

가상 한 곳·32면 시드를 준비한다([주차장 가이드](parking-lots.md)). `challengeAllowed=false`는 그대로이며 합성 도전 개발이 실제 장소 도전 허가로 표시되지 않는다. 별도 실제 방문·리뷰 방문·위치·도장·랭킹·쿠폰을 생성하지 않는다. 연습 리포트/도장은 #14, 예약은 #15, 랭킹은 #16이다.

## API와 자격

아래 앞에는 `/api/v1`이 붙는다. 성공·오류 모두 `Cache-Control: no-store`다. body 미지 필드·원본 map·숫자 문자열·null 대신 누락 등은 엄격히 거절한다. 일반 JSON64KiB 제한을 유지한다.

| 메서드·경로 | 자격 / 응답 |
|---|---|
| GET /missions?lotId=UUID&structureVersion=1 | WEB/VEHICLE, 고정 구조의 카탈로그·룰·구간·지원 조건,200. 선택 ruleVersion=missions-v1 |
| POST /runs | VEHICLE,201 불변 생성 영수증 |
| GET /runs?limit=20&cursor=... | WEB 본인 전체 / VEHICLE 본인 설치 기록,200. limit1~50 |
| GET /runs/{runId} | 같은 조회 자격,200 저장된 룰/구조/스테이지·지원 snapshot·현재 결과/상태 |
| POST /runs/{runId}/result | 원래 VEHICLE AuthSession+설치+사용자,201 불변 최종 영수증 |

쓰기에는 ASCII 영숫자/점/밑줄/하이픈1~64자의 Idempotency-Key가 필요하다. 읽기300/쓰기100회·5분은 계정별 개발 제한이며429 Retry-After300을 제공한다. 계정당 도전1000건 상한이다. 무인증401, 타인/다른 설치 기록404이며 ADMIN도 타인의 개인 결과를 조회하지 못한다. WEB은 본인 기록을 읽지만 차량 결과를 제출하지 못한다.

## 카탈로그·룰과 고정 구간

카탈로그는 요청한 합성 구조와 현재 구조 모두 active일 때 제공한다. 룰은 코드의 버전별 registry이며, 새 규칙은 새 version으로 추가한다. 도전 생성 때 룰 전체·선택 스테이지와 순서·기어/차속 등 capability snapshot·lot/구조 version을 DB에 고정한다. 도전 행과 최종 결과/영수증의 UPDATE는 DB trigger로 거절한다. 이후 배포의 기본 룰이나 구조 버전이 바뀌어도 과거 기록의 룰을 다시 계산하지 않는다.

| 미션 | 합성 스테이지 | 필수 S-04 capability | 정상 구간의 개발 점수 |
|---|---|---|---|
| NO_STOP_RAMP | ID순 첫 경사로의 시작 층/구역·rampId | speed,gear | stopCount=0이고 전체 구간 이동이면3, 정지 시0/ABORTED(STOPPED), 실패로 분류하지 않음 |
| ONE_SHOT_REVERSE | ID순 첫 active GENERAL 주차면·층/구역/parkingSpaceId | speed,gear | reverseSegmentCount=1이면3, 그 외0/FAILED. 구간 진입/종료·이동 후 정지/P단/목적 구간을 앱이 확인했다는 parkingConfirmed 필요 |
| SMOOTH_STEERING | ID순 첫 구역·층/zoneId | speed,gear,steeringAngle | max(0,3-abruptSteeringCount),1~3은SUCCESS,0은FAILED |
| PILLAR_FOREST | 비활성 | 장애물/접촉 명세 미확인 | OBSTACLE_EVIDENCE_UNCONFIRMED |
| TIME_ATTACK | 비활성 | 시간 보너스 제외 제안 | SPEED_INCENTIVE_EXCLUDED |

필요한 구조 요소가 없으면 SEGMENT_NOT_CONFIGURED로 비활성이다. 결과의 별은 스테이지0~3, 완주 합계0~9이며 서버가 선언된 값과 계산값을 비교한다. 실패는 정합성이 있는 완료의 일부일 수 있지만 안전 중단·판정 불가는 별0이고 전체 도전 별도0이다. 빠른 시간·높은 속도 보너스는 없다. 이 점수는 **A-15의 가역적인 합성 검증 기준**이며 제품/실차 점수의 확정이 아니다.

## 생성과 복구

1. 기존 개발 인증으로 차량 설치를 연결한다([SDK Quickstart Wiki](https://github.com/we-self-sufficiency/parksical-server/wiki/SDK-Quickstart)).
2. S-04에서 `reportedSource=SYNTHETIC`인 ACTIVE 전송 세션을 만든다. 요청할 도전에 필요한 capability는 SUPPORTED이고 checkedAt은 startedAt과 ±5분 이내여야 한다. 이것은 자기 신고 검사이며 실제 권한/SDK/장치 인증이 아니다.
3. 카탈로그에서 enabled synthetic stageId를1~3개 선택하고 중복 없이 순서를 고정한다. 설치·사용자·AuthSession이 전송 세션과 같아야 한다.
4. POST /runs에 전송하고 runId를 보관한다. startedAt은 UTC Z/최대ms이며72시간 이전·미래5분 초과는 거절한다.

합성 생성 예시(시간·세션은 현재 테스트 값으로 바꾼다):

```json
{"contractVersion":"1.0","clientRunId":"demo-001","vehicleSessionId":"44444444-4444-4444-8444-444444444444","lotId":"66666666-6666-4666-8666-666666666666","structureVersion":1,"ruleVersion":"missions-v1","source":"SYNTHETIC","mode":"CHALLENGE","startedAt":"2026-11-15T00:00:00.000Z","stageIds":["ONE_SHOT_REVERSE:basement1-s03"]}
```

이 stageId는 현재 가상 시드 예시이며 앱은 카탈로그 반환값을 사용한다. 응답은 `{runId,version:1,state:"ACTIVE",source:"SYNTHETIC",ruleVersion,structureVersion,receivedAt}`다. mode는 CHALLENGE/PRACTICE이지만 실제 연습 자격/보상을 뜻하지 않는다.

GET /runs/{id}의 result=null이면 ACTIVE/version1, 최종 결과가 있으면 그 outcome/version2다. 앱 재시작 후 조회해 마지막 저장 상태를 복원할 수 있지만 로컬 미션 판정을 이어 붙일 허가는 아니다. 로컬 재시작/신호 공백은 UNVERIFIABLE로 마무리하고 새 시도로만 시작한다. access refresh는 같은 AuthSession이어서 재전송 가능하다. 로그아웃/설치 해제/사용자 변경은 기존 자격을 폐기하며 새 AuthSession은 과거 시도를 완료하거나 옛 쓰기 영수증을 재생할 수 없다. 같은 소유자의 WEB 또는 같은 설치 VEHICLE은 읽기 자격에 따라 이력을 볼 수 있다.

## 결과와 품질 계약

POST result는 `expectedVersion:1`, stable clientResultId, SYNTHETIC, 최종 outcome/reason/stars, UTC finishedAt, 단조 증가 시계 기반 elapsedMs, 선택한 순서의 stage 결과를 받는다. [합성 요청](examples/run-result.json), [실제 HTTP 형식의 영수증](examples/run-receipt.json), [전체 사례 fixture](../fixtures/missions/result-scenarios.json)를 따른다. 이 예제들은 모두 합성이다.

각 스테이지는 stageId·startOffsetMs/endOffsetMs, outcome/reason/stars, uxState, segmentEntered/Exited, parkingConfirmed, metrics와 quality 배열을 갖는다. 시작/종료 offset은 도전 시작 이후 ms, 끝>시작·서로 비중첩·도전 elapsedMs 이하이며 선택 순서의 prefix만 허용한다. COMPLETED에는 모든 스테이지의 SUCCESS/FAILED가 필요하고 ABORTED/UNVERIFIABLE 뒤에 스테이지를 추가하지 않는다. P단 하나/수동 완료 버튼을 구간 입증으로 삼지 않는다.

metrics는 movingDurationMs·maxSpeedKph(음수 없는 **절대** 차속 최대·소수3자리)·dangerEventCount와 미션별 count1개, 나머지 미션별 값은null이다. 이동 시간은 구간 이하이고 완주에는 양수 이동/차속이 필요하다. ONE_SHOT에는 구간 전체보다 짧은 이동 시간과 parkingConfirmed=true가 필요하다. 위험 이벤트 수는 의미/중복 제거가 확인된 **합성** 이벤트 수이며 Telltales 통지 수가 아니다. stop/reverse/abrupt count의 로컬 산출과 실차 정의는 후속 앱 확인 대상이다.

모든 스테이지는 speed/gear/segment/riskEvents 품질을 요구하고 smooth는 steeringAngle도 요구한다. segment/riskEvents는 합성 구간/위험 증거용 서비스 이름이며 S-04/SDK의 새 신호나 메서드가 아니다. quality는 정확히 필요한 신호를 한 번씩 포함한다.

| 품질 | 의미 / 검증 |
|---|---|
| AVAILABLE | coveredMs=스테이지 기간, validSampleCount≥1, maxGapMs≤1000. speed/steeringAngle은 maxGapMs>0, 최소2개 및 ceil(기간/maxGapMs)+1개 필요 |
| UNSUPPORTED/PERMISSION_DENIED/ERROR/MISSING/STALE/UNKNOWN | validSampleCount=0,coveredMs=0,maxGapMs=null. 누락을0차속·정상으로 대입하지 않음 |

위1000ms/표본/측정 범위는 고정된 **합성 룰**이며 SDK 주기·주행 안전 보장·실차에 공통으로 적용할 stale 기준이 아니다. SDK E1~E8 실측을 받으면 별도 룰 버전/호환성으로 검토한다. 반대로 이 요약의 정합성을 통과해도 관측이 실제였다는 증명은 아니다.

## 중단·완료의 일관성

유효한 요약 기준의 결정 우선순위는 UX RESTRICTED → 유효 speed>10 → 유효 danger>0 → UX UNKNOWN → 필수 품질/metrics 부족 → APP_RESTARTED → USER_CANCELLED → 구간 종료 offset>2시간 → 경사로 정지 → 완료 근거/점수다. 여러 원인이 동시에 신고되면 이 순서로 결과를 비교한다. 실제 위험 이벤트 발생 순서를 입증하는 것은 아니다.

- RESTRICTED: ABORTED/UX_RESTRICTED, 절대 차속>10: ABORTED/SPEED_LIMIT, 위험>0: ABORTED/DANGER_EVENT. 1초/두 번째 경고를 기다리는 서버 제어는 없다.
- UNKNOWN: UNVERIFIABLE/UX_UNKNOWN, 신호 부족/오래됨/측정 공백: UNVERIFIABLE/SIGNAL_QUALITY, 재시작: UNVERIFIABLE/APP_RESTARTED.
- NO_STOP_RAMP에서 정지하면 ABORTED/STOPPED로 구분하며 FAILED/실패 횟수로 분류하지 않는다. 재촉/안전상 정지 회피를 유도하지 않고 연속성 세부 정책은 #14에서 중단과 실패를 분리한다.
- 유효 구간의 취소: ABORTED/USER_CANCELLED. 정상 완료는 FINISHED이며 미션별 점수를 비교한다.
- 마지막 완료 구간 뒤 elapsedMs가2시간을 넘으면 ABORTED/TIME_LIMIT로 무보상 종료할 수 있다. 스테이지 없는 초기 취소/UX 제한/재시작/품질 미확인도 명시적 무보상 결과로 보관할 수 있다.

도전 전체 COMPLETED는 모든 스테이지 SUCCESS/FAILED와 합산 stars를 요구한다. ABORTED/UNVERIFIABLE는 마지막 스테이지와 같은 outcome/reason, 전체 stars0이다(명시적 초기 종료/timeout 예외 위 참조). UNKNOWN/결측은 성공으로 승격되지 않는다. startedAt~finishedAt UTC 차이와 elapsedMs의 차이는5초 이내, finishedAt은 startedAt 이후·과거72시간/미래5분 이내다. 2시간은 단조 증가 도전 제한이고72시간은 지연 결과 업로드 창이다. 서버는 미완료 ACTIVE를 background job으로 자동 성공/실패 확정하지 않는다. 앱이 로컬 종료와 결과 큐를 관리한다.

## 중복·불변성·정합성의 한계

사용자+설치+clientRunId는 도전의 유일성 경계다. 같은 생성 내용은 새 키로도 원래201 영수증만 반환하고 현재 상태를 ACTIVE로 되돌리지 않는다. 내용이 다르면409 RUN_CONFLICT다. 쓰기 키는 사용자+설치+키에 route/body hash를 결합하며 다른 요청에 재사용하면409 IDEMPOTENCY_CONFLICT다.

최종 결과는 runId당1건이다. 동일 clientResultId와 같은 body는 다른 키로도 원래201 영수증과 Idempotency-Replayed:true를 반환한다. 다른 내용/ID는409 RUN_ALREADY_FINAL이다. 인증과 원래 AuthSession 소유권을 재검사한 뒤 재생한다. 계정 잠금/DB 고유 제약과 같은 트랜잭션으로 도전/최종 결과와 영수증을 저장한다. 응답 유실/프로세스 재시작 뒤에도 동일 재생, 중간 저장 실패는 전부 rollback한다.

응답은 report(클라이언트 요약)와 assessment(서버 정합성 검사)를 분리한다. consistencyStatus=CHECKED, physicalVerification=UNVERIFIED, recognitionStatus=SYNTHETIC_NOT_ELIGIBLE, operationalBlockers=[D-02,D-04], rankingEligible=false/rewardEligible=false다. 신호 불충분은 별도 UNVERIFIABLE와 reason/quality로 드러난다. 실제 현장 진입·SDK 권한·원시 신호 무변조·무접촉·실차 공정성은 원본 없는 범위 검사로 증명하지 못한다. 민감 본문/개인 ID·원본·토큰은 로그에 넣지 않는다.

D-02 실제 수집·동의·보관/완전 삭제가 미정이므로 운영 삭제/보관 정책을 이번 합성 기능으로 확정하지 않는다. HTTP 삭제나 무한 개인 데이터 수집을 추가하지 않으며 개발 fixture는 별도 개발 DB를 사용한다.

## 오류·검증·다음 작업

400 DTO/query/키/스키마,401 자격 폐기,403 비활성/WEB 쓰기,404 타인/다른 설치/잘못된 전송 세션,409 키/생성/최종 결과 충돌·계정 상한,422 미지원 룰/미션/구조/지원 신호·결과/기간/품질 불일치,413 크기,429 빈도,503 의존성 오류다. 429/503은 Retry-After와 backoff를 따르고 오류 원문·입력을 로그/응답에 반사하지 않는다.

단위 검증은 shared fixture의 성공/실패/과속·위험·UX 중단/신호 품질/재시작과 별·시간·구간·순서 변조를 포함한다. 실제 PostgreSQL 통합은 HTTP 입력/소유권/기본 비활성·고유 제약/동시 최종 제출·영수증 강제 실패 rollback·불변 trigger·구조 변경·페이지 cursor·Nest 재생성/별도 compiled API 프로세스의 영속 조회와 응답 재생·연결 해제/로그 제외를 확인한다. 전체 `npm run verify`, DB 통합, 계약 checker와 PR CI가 완료됐는지는 PR의 실제 결과를 따른다. 합성 테스트를 실차 시험/앱 심사/배포 증거로 대체하지 않는다.

#14는 이 결과를 원천으로 연습 순서/3연속·중단/무효 처리·도장/칭호를 구현한다. 같은 run/result를 중복 적립하지 않아야 하며 지금 도장/자격은 발급되지 않는다. develop 통합 직후 Wiki Home과 Missions 가이드를 갱신해 설정·인증·예제·오류/재시도·호환성·준비 범위/운영 미정 조건을 반영한다.
