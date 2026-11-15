# S-17 MAX 패스 구독·갱신·기간 권한

[이슈 #18](https://github.com/we-self-sufficiency/parksical-server/issues/18) · F-15 · [결제](payments.md) · [OpenAPI](openapi.json) · [A-20/D-05](DECISIONS.md).

비운영 SYNTHETIC 개발 구현이다. 월4,900원은 초기 기획을 고정한 테스트 상품 버전이며 운영 판매/청구 승인이 아니다. MAX/연습/랭킹의 실제 유료 범위·해지/환불 약정·유예·자동 청구·정산 자격 판단 시점은 D-05에서 미확정이다. 아래 정책은 A-20 가역 개발 기본값이고 실제 PG·쿠폰·실차/SDK/배포는 미완료다.

## 설정·상품·인증

`npm run migrate:deploy`, `npm run generate`, `npm run build` 후 비운영 개발 서버를 실행한다. `DEV_SUBSCRIPTIONS_ENABLED=true`에는 개발 인증과 S-16의 `DEV_PAYMENTS_ENABLED=true`, 명시 SANDBOX 및 별도 webhook secret이 필요하다. 기본OFF, production·REAL_SUBSCRIPTIONS_ENABLED/REAL_PAYMENTS_ENABLED 활성화는 차단한다. 기본 Compose는 production/OFF를 유지한다. 상품/가입/결제 시드는 없고 실제 청구 worker/스케줄러는 없다.

MAX_PASS / max-pass-4900-v1 / subscriptions-v1, 4,900KRW, CALENDAR_MONTH_KST 한 버전을 제공한다. 금액·기간·상태·자격은 요청으로 받지 않는다. 가입의 priceVersion/policyVersion을 정확히 대조한다. 새 상품/가격은 새 registry·migration·계약/테스트로 추가해야 한다.

업무 API는 WEB/VEHICLE 본인 계정 bearer와 현재 세션/차량 연결을 재검사한다. ADMIN 우회가 없고 타인/없는 개인 자원은404다. 응답은 no-store, JSON64KiB, 읽기300/쓰기100회·계정/5분이다. 개인 구독·가격/원문 제공자 정보·토큰/키를 로그에 넣지 않는다. 구독 경로의 외부 X-Request-Id도 서버 UUID로 교체한다.

## API 흐름

| 메서드·경로 (/api/v1 앞에 추가) | 동작 |
|---|---|
| GET /subscriptions/products | 버전 고정 합성 상품 |
| POST /subscriptions | 가입 의도·첫 월 cycle·S-16 CREATED 주문 원자 생성,201 |
| GET /subscriptions/me | 본인 최신 구독 또는 subscription=null |
| GET /subscriptions/{subscriptionId} | 본인 현재 계산 상태/최신 cycle·주문ID |
| POST /subscriptions/{subscriptionId}/renewals | 허용 창에서 다음 월 cycle·CREATED 주문 원자 생성,201 |
| POST /subscriptions/{subscriptionId}/cancel | 다음 갱신 중단·미결제 주문 취소,201 |
| GET /subscriptions/{subscriptionId}/history | 본인 불변 관측 이력, limit1..50/기본20·계정/구독/페이지 크기 cursor |
| GET /me/entitlements | 서버 현재 시각의 합성 권한, 임의 at query 불가 |

합성 가입 요청은 [subscription-create.json](examples/subscription-create.json), 응답은 [subscription-view.json](examples/subscription-view.json)을 따른다.

```json
{"priceVersion":"max-pass-4900-v1","policyVersion":"subscriptions-v1"}
```

응답 latestCycle.paymentOrderId로 **기존 S-16** `/payments/{orderId}/attempts`에 sandboxOutcome=SUCCEEDED/FAILED를 보낸다. 가입·갱신 요청만으로 권한이 활성화되지 않는다. 서명+독립 조회로 검증된 webhook 또는 S-16 서버 결과만 기간을 연다. 상태/영수증/실패 복구·취소/전액 환불은 [payments.md](payments.md)를 따른다. 같은 제공자 주문/명령/영수증/환불을 재사용하고 별도 구독 승인 boolean API를 만들지 않는다.

모든 POST는 Idempotency-Key(1..64자 영문/숫자/_.-)가 필수다. 동일 계정/키/경로/body는 원래 응답과 Idempotency-Replayed=true, 다른 내용은409다. 같은 가입의 다른 키도 미완료 주문/잔여 유효 결제 기간이 있으면 기존 구독을 반환한다. 같은 expectedCycleIndex로 갱신을 재시도해도 다음 cycle/주문은1개다. 과거 응답은 당시 snapshot이므로 현재 GET을 다시 조회한다.

## 월 경계·갱신·실패

최초 anchorAt은 DB 서버 시각이다. 이후 경계는 **원래 anchor의 KST 달력 날짜/시각**에서 n개월을 계산한다. 해당 월에 날짜가 없으면 말일로 보정하고 원래 날짜를 다음 월에 복구한다. 예: 1/31→2/28→3/31, 윤년2/29. 고정30일이나 직전 보정일+1개월로 바꾸지 않는다. 기간은 [startsAt,endsAt)다.

갱신 준비 창은 직전 endsAt−5분 이상/endsAt+5분 미만이다. 본인 최신 cycleIndex를 expectedCycleIndex로 보내고 직전 결제가 SUCCEEDED·미환불·갱신 허용 상태여야 한다. 서버가 다음 기간·가격·주문을 정한다. 최초 및 갱신의 결제 기한은 해당 startsAt+5분 미만이다. 미결제/실패는 기간을 연장하지 않으며 **권한 유예는0**이다. 갱신 준비 창과 권한 유예를 혼동하지 않는다. 사전 승인된 다음 cycle도 startsAt 전에는 권한을 주지 않는다.

갱신 실패는 해당 시도 terminal이다. 기존 결제 기간은 끝까지 유지하고 경계에서 권한을 끈다. 실패한 cycle을 건너뛰어 무결제 기간을 만들지 않는다. 만료/실패 후 새 가입은 새 anchor/구독 episode를 만들고 이전 구독/이력은 보존한다. 새 가입 전에 이전 미결제 주문을 취소하므로 뒤늦은 승인은 보상/환불 대상이며 겹친 기간을 만들지 않는다.

자동 실제 청구·기기/카드 저장·제공자 정기결제 계약은 없다. 비운영 테스트에서 renewals로 갱신 의도와 S-16 시도를 명시 실행한다. 운영 scheduler/반복 청구는 D-05·실제 어댑터/동의/실패 복구 확정 후 별도 구현이다.

## 해지·환불·과거 자격

구독 cancel은 renewalEnabled=false로 다음 갱신을 중단한다. 이미 검증·결제한 현재/미래 cycle은 끝까지 유지하고 CANCEL_AT_PERIOD_END로 표시한다. CREATED/PENDING 주문은 같은 트랜잭션에서 CANCELLED가 되며 이후 늦은 승인은 REFUND_PENDING이고 권한을 만들지 않는다. 해지와 전액 환불은 다른 동작이다.

테스트 cycle의 전액 환불은 해당 paymentOrderId의 S-16 cancel→reconcile을 사용한다. REFUND_PENDING 시점부터 해당 cycle의 권한을 회수하고 제공자 조회가 REFUNDED를 확인한 뒤 환불 완료를 표시한다. 이미 지난 정상 이용 구간을 소급 삭제하지 않는다. 부분 환불·실제 사용 후 환불 약정은 미지원/미승인이다. 구독을 해지한 뒤에도 상태/이력/본인 결제 조회·복구는 가능하다.

paidAt은 **서버가 승인 결과를 처음 검증·커밋한 시각**, revokedAt은 취소/환불 대기를 관측·커밋한 시각이며 한 번 기록하면 바꾸지 않는다. 권한은 [max(startsAt,paidAt), min(endsAt,revokedAt))이다. 지연 webhook은 이미 지난 구간에 소급 자격을 만들지 않고, 역순/중복 이벤트는 현재 제공자 조회·불변 이력으로 기간 중복/환불 후 재활성화를 막는다. 결제 상태·기간·이력·영수증은 같은 merchant 트랜잭션이다.

S-18 내부 포트 `SubscriptionService.eligibilityAt(userId, at)`는 과거 시점의 합성 가입 자격과 근거 cycle IDs를 재현한다. 원천 월말/정산 실행 시각 등 **실제 판단 시점은 아직 선택하지 않았고** settlementTimePolicy=UNDECIDED, rewardEligible/operationalAllowed=false다. 포트에 미래 시각은 허용하지 않는다. 합성 pass 활성화가 실제 랭킹 인정·실차 증거·쿠폰 지급 권한을 만들지 않는다.

## MAX API 접근·호환성

DEV_SUBSCRIPTIONS_ENABLED=true일 때만 새 합성 pass 정책을 적용한다. 활성 pass는 새 CHALLENGE/PRACTICE run 생성, 예약 견적/새 점유, 랭킹 보드/그룹/본인 비교를 허용한다. 유효 권한이 없으면403 SYNTHETIC_PASS_REQUIRED다. 인증·기능 opt-in·장소/룰/차량/공개 동의 조건은 별도로 계속 검사한다. 권한은 매 요청의 DB 시각/기간에서 계산하고 캐시하지 않으며 변경과 공통 payment-user 잠금으로 경합을 직렬화한다.

기존 run의 최종 결과 제출/재생·개인 기록/연습 리포트, 예약 취소/환불 복구, 공개 동의 철회/참여 삭제, 구독/결제 상태·이력은 만료 후에도 허용한다. 이전 요청의 정확한 재생은 새 유료 동작을 만들지 않으므로 이전 영수증을 반환한다. 이 개발 범위를 운영 유료 서비스 정책으로 확정하지 않는다.

기본OFF 서버에서 기존86연산/차량 contractVersion1.0의 동작은 유지한다. OpenAPI0.15.0은8연산을 추가한다. 구독 결제 주문에는 선택 subscriptionCycleId·lotId=null과 구독 pricing이 추가되며 일반/예약 결제 응답 형태는 유지한다. 새 기능을 켜기 전에 앱이 새 주문 종류·기간/상태를 처리하도록 업그레이드해야 한다. 이전 앱이 /payments 목록의 모든 주문에 주차장 UUID가 있다고 가정하면 새 구독 결제를 처리할 수 없다. migrate deploy 후 generate/build가 필요하고 파괴적인 스키마 초기화는 없다.

## 검증·남은 작업

단위 검증은 KST/월말/윤년·원래 anchor 복원, 지연 승인/환불의 반열린 기간, 갱신 창·권한 유예 구분과 production 차단을 확인한다. 실제 PostgreSQL 통합은 다중 pool 가입/갱신/해지 경합, 변조 가격·타인/ADMIN 접근, signed webhook 중복/역순·응답 유실, 결제/기간/이력 저장 실패 rollback·재시도, MAX 요청의 활성/만료 경계, 과거 자격·이전 스키마 업그레이드/기존 결제 보존·프로세스 재시작을 확인한다. 테스트에서만 내부 SubscriptionClock을 제어하며 서버 환경/HTTP에 시각 조작 API를 제공하지 않는다.

이 문서가 실제 공유 서버 배포·PG 정기결제·SDK/실차·운영 자격/보상을 완료했다는 뜻은 아니다. develop 통합 후 Wiki Home/Subscriptions/Payments·MAX 관련 가이드·업데이트 기록을 게시하고 연결을 확인한 뒤 이슈의 Wiki 완료 기준을 체크한다.

선결제한 미래 cycle만 남고 현재 cycle을 환불한 경우에는 SCHEDULED로 표시하며 startsAt까지 권한을 주지 않는다. 해지 상태/선결제 상태를 현재 이용 가능으로 해석하지 않는다.

## S-18 합성 정산 소비자

[rewards.md](rewards.md)는 원천 월 마지막1ms의 불변 paidAt/revokedAt 이력으로 합성 pass를 재현한다. 이 고정 과거 조회는 현재 권한을 연장하지 않으며 상용 정산 자격 시점은 계속 D-05 미확정이다. 쿠폰으로 구독료를 결제할 수 없다. DB 연결은 UTC로 고정해 KST 호스트에서도 원래 anchor 시각을 보존한다.
