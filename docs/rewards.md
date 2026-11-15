# S-18 KST 월간 정산·제한 쿠폰·알림

[이슈 #19](https://github.com/we-self-sufficiency/parksical-server/issues/19) · F-14 · [랭킹](rankings.md) · [구독](subscriptions.md) · [결제](payments.md) · [OpenAPI](openapi.json) · [A-21/D-05](DECISIONS.md).

비운영 SYNTHETIC 테스트 구현이다. 실제 보상 후보는 항상 빈 배열이며 operationalAllowed/rewardEligible/redeemableInProduction=false다. 쿠폰은 금전 가치가 없고 실제 주차·비용 지급·블루링크 전송을 약속하지 않는다. D-02/D-04/D-05의 기록 인정·장소·비용·상용 조건은 미확정이다.

## 실행·인증

`npm run migrate:deploy`, `npm run generate`, `npm run build` 후 개발 서버에서만 선택 활성화한다. DEV_REWARDS_ENABLED 기본false이며 개발 인증·DEV_RANKINGS_ENABLED·DEV_SUBSCRIPTIONS_ENABLED·DEV_PAYMENTS_ENABLED와 명시 REWARD_NOTIFICATION_PROVIDER=SANDBOX가 필요하다. production과 REAL_REWARDS_ENABLED/REAL_COUPONS_ENABLED/REAL_NOTIFICATIONS_ENABLED=true는 시작 시 거절한다. 기본 Compose/시드에는 보상 실행이 없다.

관리자 실행 경로는 현재 ADMIN 역할의 WEB bearer만 허용한다. 일반 사용자·차량 관리자 세션은403, 인증 누락/만료는401이다. 본인 쿠폰·알림은 현재 WEB/VEHICLE bearer/연결을 재검사하며 ADMIN도 타인 자원을 볼 수 없다(404). 모든 응답 no-store, JSON64KiB, 관리100회·개인 쓰기100/읽기300회·계정/5분이다. 토큰·원천 manifest·개인 위치·제공자 원문을 응답/로그에 노출하지 않는다. 쿠폰 경로의 외부 X-Request-Id는 서버 UUID로 교체한다.

| 메서드·경로 (/api/v1 앞에 추가) | 요청·결과 |
|---|---|
| POST /admin/reward-settlements | sourceMonth YYYY-MM, policyVersion=rewards-sandbox-v1 → 정산 요약 |
| GET /admin/reward-settlements/{settlementId} | 상태·cutoff/자격 시각·입력 hash·선택/미처리/발급/제외 건수 |
| POST /admin/reward-settlements/{settlementId}/process | limit1..20 → 한 배치 처리 후 요약 |
| POST /admin/reward-notifications/dispatch | limit1..20 → 지급과 독립된 알림 처리 건수 |
| GET /coupons/me | 본인 쿠폰 페이지 |
| GET /coupons/{couponId} | 본인 상태·장소·원천/지급 월·한도·만료·현재 사용 가능 여부 |
| POST /coupons/{couponId}/holds | paymentOrderId → 5분 이내 점유 영수증 |
| POST /coupons/{couponId}/claims/{claimId}/consume | reason=USER_REQUEST → 불변 합성 사용 증빙 |
| POST /coupons/{couponId}/claims/{claimId}/release | reason=USER_REQUEST → 점유 해제 후 쿠폰 |
| POST /coupons/{couponId}/cancel | reason=USER_REQUEST → 취소 후 쿠폰 |
| GET /reward-notifications/me | 본인 알림 상태·횟수·다음 시도/전달 시각, realDelivered=false |

POST는 모두 필수 Idempotency-Key(1..64 ASCII 영숫자/_.-)를 받는다. 동일 계정·키·명령/본문은 원래 응답과 Idempotency-Replayed=true, 다른 본문/명령은409다. 정상 POST201/GET200, 페이지 limit1..50/기본20·계정/페이지 크기에 묶인 cursor다. 허용한 필드 외 입력·query는400, 기능OFF403, 없는 자원404, 상태 충돌409, 정책/한도 위반422, 개발 입력 한도503이다. 예제는 [manifest](examples/manifest.json)의 S-18 사례를 따른다.

## 월 경계·확정·선택

매월1일00:00 KST에는 이전 월 정산을 prepare한다. 예를 들어 sourceMonth=2026-10의 시작은2026-09-30T15:00Z, 끝은2026-10-31T15:00Z다. 기존 S-15의 지연 수신 마감은 끝+72h(2026-11-03T15:00Z)이며 **월 경계와 같지 않다**. 월 경계에는 WAITING_CUTOFF를 저장하고 cutoff 전 process는 지급하지 않는다. cutoff 이후 새 key로 prepare/process하면 READY로 원천 스냅샷·hash·선택 이유를 원자 동결한다. 미래/진행 중 월은422다. 이 관리 API가 권한 있는 월간 작업 실행 경로이며 자동 운영 cron/실제 발급 스케줄은 활성화하지 않았다.

가역 테스트 정책 rewards-sandbox-v1: 인정된 SYNTHETIC CHALLENGE의 주차장/cohort별 확정1위·최소별3개·원천 월 마지막1ms의 검증된 합성 pass를 요구한다. 동점 공동1위를 포함하고 같은 계정은 lot UUID/cohort/run 오름차순의 서로 다른 장소 최대2곳, slot1/2를 선택한다. 이 자격 시각은 S-17의 미확정 상용 정산 시점을 승인한 뜻이 아니다. PRACTICE·미인정/지연/무효/삭제 원천은 제외하며 실제 지급은 모든 합성/시뮬레이션 기록에 대해0건이다.

스냅샷 동결 뒤 무효/삭제는 하위 순위나 세 번째 장소를 승격시키지 않는다. 선택된 원천이 발급 전에 무효화되거나 장소가 비활성/비합성/비제휴면 SKIPPED, 발급 뒤에는 사용 불가다. 후보 최대2000·월당 장소20/장소별 cohort10의 개발 한도를 넘으면503으로 전체 배치를 롤백한다. 공개 닉네임/동의 철회는 비공개 정산 입력을 공개하지 않으며 실제 보관/완전 삭제는 D-02 별도 결정이다.

원천 월/계정/slot 및 원천 월/계정/lot 고유 제약, 월 잠금, 트랜잭션, PENDING→ISSUED/SKIPPED의 불변 grant가 중복 지급을 막는다. 취소·사용·만료해도 원천 월의2장 한도는 돌아오지 않는다. 발급 월은 실행 시각의 KST 월로 따로 저장한다. 한 배치는 쿠폰+알림 outbox+grant를 함께 commit하고 실패하면 함께 롤백한다. COMPLETED 재실행은 추가 지급하지 않는다.

## 점유·결제·취소

쿠폰당 동일한 제휴 SYNTHETIC 주차장에서 견적 전체 금액≤5000KRW·전체 시간≤120분, 발급부터30일 이내의 단1회 테스트 사용을 허용한다. 실제 비용 부담자는 없으며 costBearer=SYNTHETIC_NO_MONETARY_VALUE다. 부분 할인·잔액·양도·현금 전환·무제한 무료 주차·구독료 결제는 없다. S-16의 CREATED 일반 사전결제/예약 주문과 서버 가격·시간·현재 장소/정책을 재검사한다. 서비스 시작 이후 사용은 불가하다.

AVAILABLE→HELD→USED, 해제/점유 만료는 AVAILABLE 또는 EXPIRED, 취소는 CANCELLED다. 점유 만료는 min(현재+5분,주문 만료,쿠폰 만료)이며 다음 조회/점유 시 정리한다. 계정 공통 결제 잠금·쿠폰 활성 claim 부분 고유 인덱스가 두 주문/두 인스턴스의 이중 사용을 막는다. 점유 중 PG 결제는409 COUPON_HOLD_ACTIVE다. 점유 해제 뒤에는 쿠폰을 새 주문에 다시 점유할 수 있으며 이전 주문은 사용자가 명시 PG 결제할 수 있다. 주문당 claim은 한 개여서 해제한 주문에 재점유하려면 새 주문을 만든다.

consume은 claim CONSUMED·쿠폰 USED·주문 COUPON_SETTLED·증빙·예약 SANDBOX_CONFIRMED를 같은 트랜잭션에서 저장한다. provider=INTERNAL_COUPON_LEDGER, settlementMethod=SYNTHETIC_COUPON, cashAmountKrw=0이며 PaymentAttempt/PG 승인·현금 청구를 만들지 않는다. 결제 영수증의 transactionId는 claim UUID로 내부 원장 식별자이며 PG 승인번호가 아니다. 쿠폰 오류가 현금 청구로 자동 전환되지 않는다. 주문 GET/receipt/reconcile로 실제 현재 상태를 재확인한다. 같은 사용 요청의 증빙은 취소 이후에도 최초 사용 이력으로 재생한다.

서비스 시작 전 사용 취소/결제 취소는 claim VOIDED·주문 COUPON_VOIDED·쿠폰 CANCELLED·예약 해제이며 쿠폰 복원/재지급이나 현금 환불을 만들지 않는다. 예약 직접 취소 후 결제 reconcile도 이 원장 보상을 수행한다. 사용 후 과거 증빙은 보존하며 서명된 PG 성공 이벤트라도 쿠폰 주문에 덮어쓰지 않는다(409 PAYMENT_METHOD_CONFLICT). 만료/취소·사용 경합은 같은 계정 잠금으로 직렬화한다.

## 알림·재시작·복구

발급 트랜잭션은 알림 PENDING을 저장한다. SANDBOX_MAILBOX는 영속 대체 제공자이며 실제 블루링크 기능/권한·외부 전송을 가정하지 않고 realDelivered=false다. dispatch는 최대20건·30초 lease·총3시도, 실패 후60초/300초 지연, 최종 FAILED를 저장한다. 제공자 호출은 DB 트랜잭션 밖에서 수행하고 성공 ack는 해당 lease에만 반영한다. notificationId가 안정된 제공자 중복 제거 키여서 외부 성공 후 ack 전에 중단돼도 재시도가 중복 전달하지 않는다. 실제 제공자를 추가할 때도 같은 중복 제거 계약이 필요하다.

알림 실패/lease 만료는 쿠폰 지급 성공을 되돌리거나 재발급하지 않는다. 프로세스 중단 후 새 key의 process/dispatch로 남은 작업을 이어간다. 동일 key는 원래 선택 작업/완료 응답을 재생하므로 다음 배치/재시도 시각에는 새 key를 쓴다. 3번째 lease 만료는 FAILED로 종결하며 수동 상태 초기화/무한 재시도는 허용하지 않는다. DB에는 허용된 오류 코드만 저장한다.

## 호환성·검증 경계

OpenAPI0.16.0은11연산과 쿠폰 전용 결제 상태/선택 증빙 필드를 추가한다. 기능OFF의 기존 일반/예약/구독 응답과 차량 contractVersion1.0은 유지한다. 신규 앱은 COUPON_SETTLED/COUPON_VOIDED·INTERNAL_COUPON_LEDGER·현금0 증빙을 처리한 뒤 선택 활성화해야 한다. DB 연결은 UTC를 명시해 KST 호스트에서도 월 경계 시각이 이동하지 않도록 한다.

migration20261115070000_rewards의7테이블·S-16 주문 상태 제약을 원자 추가하며 기존 데이터는 초기화하지 않는다. 원천 랭킹 스냅샷·구독/결제 이력·정산 manifest/hash·grant·쿠폰/claim·알림/대체 제공자·명령 영수증을 함께 백업한다. 복원 뒤 결제/쿠폰 실제 상태를 확인하고 새 명령으로 복구한다. 로컬 단위·실제 PostgreSQL 경합/실패 롤백·두 API pool·독립 재시작·계약 검증은 개발 증거다. 배포·실제 SDK/실차·실제 PG/블루링크·정책 승인은 별도 미완료다.

2026-11-15(KST) 로컬 검증: 고정 Node24.22.1·Prisma generate/lint/typecheck/build, 단위73건·새 DB의 실제 PostgreSQL 통합17건을 통과했다. 기존 데이터/주문을 보존한 S-12→S-18 업그레이드, KST DB 호스트의 UTC 저장/월말 pass, 3곳 공동1위의 최대2장·무효/낮은 점수/비구독/연습/지연 제외, 두 pool 경합/배치·사용 영수증 강제 실패 롤백, API 독립 프로세스 재시작/알림 lease 복구를 포함한다. OpenAPI105연산/188스키마/172예제/113응답 사례/121거절 입력, 실제 합성 HTTP55응답/9스키마, 이전94연산/172스키마 불변과 문서242링크를 확인했다. Prisma schema diff 없음, 실제 DB 재시작의 live200/ready503→200·pg_dump/restore도 통과했다. Docker Compose/원격 CI 결과는 PR의 정확한 최종 head 실행에서 별도로 확인한다.
