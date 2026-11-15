# S-16 사전결제·검증·영수증·취소/환불

[이슈 #17](https://github.com/we-self-sufficiency/parksical-server/issues/17) · F-04/F-09 · [OpenAPI](openapi.json) · [결정 A-19/D-05](DECISIONS.md).

이 문서는 비운영 SYNTHETIC 개발 구현이다. D-05의 결제사·실제 청구 시점/취소·환불/구독/쿠폰 비용은 미정이다. 샌드박스의 HMAC과 독립 DB 제공자 조회를 검증하며 실제 PG 계약·카드 청구·세금/법정 영수증을 제공하지 않는다. 배포/Base URL·실제 SDK/실차 검증은 별도 미완료다. develop 통합·Wiki 게시 상태는 연결 PR/이슈로 확인한다.

## 준비와 인증

`npm run migrate:deploy`, `npm run generate`, `npm run build` 후 개발 서버를 실행한다. migration `20261115050000_payments`는 원자 트랜잭션으로 견적/주문/시도/환불/영수증/명령/알림과 독립 샌드박스 제공자8테이블 및 상태/불변 guard를 추가한다. 이전 데이터 변경·자동 주문/청구·시드는 없다.

비운영에서 `DEV_AUTH_ENABLED=true`, `DEV_PAYMENTS_ENABLED=true`, `PAYMENT_PROVIDER=SANDBOX`, 32자 이상 별도 `PAYMENT_WEBHOOK_SECRET`을 명시한다. 개발 로그인 설정은 [인증](authentication.md)을 따른다. 기본OFF, production 및 `REAL_PAYMENTS_ENABLED=true`는 차단한다. 실제 제공자 어댑터는 미구현이다. 일반 사전결제는 DEV_MISSIONS/DEV_RESERVATIONS/DEV_RANKINGS가 필요 없다. 예약 주문 생성/최초 시도에는 추가로 DEV_RESERVATIONS_ENABLED가 필요하며 이미 시작한 거래의 조회/환불 복구는 예약 기능을 꺼도 허용한다.

업무 API는 WEB/VEHICLE bearer·현재 유효 세션/차량 연결을 재검사하고 본인만 접근한다. ADMIN 우회가 없고 타인/없는 거래는404다. 모든 응답 no-store, JSON64KiB, 읽기300/쓰기100회·계정/5분이다. 카드번호·보안코드·원문 PG payload·비밀/토큰·주문/거래ID/가격을 HTTP 로그에 남기지 않는다. 결제 경로의 외부 X-Request-Id도 새 UUID로 교체한다.

## 일반 사전결제

1. `POST /payment-quotes`에 lotId·startsAt(UTC Z)·durationMinutes를 보낸다. 요청 예제 [payment-quote-request.json](examples/payment-quote-request.json), 응답 [payment-quote.json](examples/payment-quote.json).
2. `POST /payments`에 서버 quoteId만 보낸다. 같은 견적으로는 주문1개다. [payment-order-request.json](examples/payment-order-request.json), [payment-created.json](examples/payment-created.json).
3. `POST /payments/{orderId}/attempts`의 `{ "sandboxOutcome": "SUCCEEDED" }` 또는 FAILED는 명시적 테스트 시나리오다. 클라이언트의 실제 결제 승인 선언이 아니다. 서버 어댑터가 독립 제공자 저장소에 거래를 만들고 그 결과를 대조한다. [payment-attempt.json](examples/payment-attempt.json), [payment-paid.json](examples/payment-paid.json).
4. `GET /payments/{orderId}`로 현재 상태, `GET /payments/{orderId}/receipt`로 본인 승인 증빙과 현재 환불 상태를 조회한다. [payment-receipt.json](examples/payment-receipt.json). `GET /payments?limit=20&cursor=...`는 본인 생성시간 DESC/UUID DESC 목록이다. limit1..50, cursor는 계정/페이지 크기에 바인딩한다.

일반 견적은 현재 active/SYNTHETIC/SELF_PARK 주차장의 알려진 요금·운영시간을 사용한다. 시작30분 격자·기간30..240분/30분 배수·KST오늘 포함7개 날짜/운영시간을 검증한다. `prepayment-v1`은 KST 날짜별 기본+추가요금 올림·일 최대액을 BigInt로 계산한다. 일반 사전결제에는 MAX 배수가 없다. KRW 정수1..100,000,000, 0원은 미지원이다. 구조/요금/기간/가격을 고정하며 TTL300초와 시작 시각 중 이른 값 미만만 유효하다. 주문/첫 시도 때 현재 장소/구조와 기한을 재확인한다. 일반 결제는 실제 정차·빈자리·입출차·예약 점유를 보장하지 않는다.

## 상태·취소·전액 환불

| 현재 상태 | 명령/제공자 결과 | 다음 상태 |
|---|---|---|
| CREATED | 최초 시도 의도 DB 저장 | PENDING |
| CREATED/PENDING | 시작 전 취소 | CANCELLED |
| PENDING | 서버 검증 승인/실패 | SUCCEEDED/FAILED |
| SUCCEEDED | 시작 전 취소 | REFUND_PENDING |
| CANCELLED 또는 기한/점유가 끝난 PENDING | 늦은 승인 | REFUND_PENDING, 재점유 없음 |
| REFUND_PENDING | 제공자 전액 환불 조회 검증 | REFUNDED |

주문당 시도1개다. FAILED는 terminal이며 새 견적/주문으로 다시 시도한다. 승인 상태를 실패 알림으로 되돌리거나 환불을 승인 상태로 되돌리지 않는다. 시작 후 취소/노쇼·부분 환불·여러 차례 부분 승인·실제 서비스 사용/출차 정산은 미지원이며 실제 정책은 D-05에서 정한다.

`POST /payments/{orderId}/cancel`에 `{ "reason": "USER_REQUEST" }`를 보내면 미결제는 CANCELLED, 승인 거래는 REFUND_PENDING이 된다. 이 응답을 환불 완료로 표시하지 않는다. `POST /payments/{orderId}/reconcile`에 `{ "action": "RECOVER" }`와 새 Idempotency-Key를 보내면 제공자 조회/필요한 미완료 시도 재전송/전액 환불을 진행한다. 제공자 조회와 금액/통화/주문/거래 ID 대조가 끝난 뒤에만 REFUNDED다. 요청에 amountKrw·currency·provider ID·성공 boolean을 넣으면400이다. 부분 환불 금액을 받는 API가 없다.

승인 영수증은 주문당1개 불변이며 환불 후에도 남는다. receipt의 별도 refund/state가 환불 현재 상태를 표시한다. 현금·세금 영수증 발급의 법적 완료를 의미하지 않는다.

## 재시도·장애 복구

모든 업무 POST에는 1..64자 `[A-Za-z0-9_.-]` Idempotency-Key가 필수다. 같은 계정/키/route/body는 저장한 응답을 재생하고 헤더 Idempotency-Replayed=true를 반환한다. 다른 내용은409 IDEMPOTENCY_CONFLICT다. 응답은 당시 snapshot이므로 현재 상태는 GET으로 확인한다. 새 key라도 같은 견적/예약은 기존 주문을 반환하고, 같은 주문의 같은 sandboxOutcome은 동일 제공자 주문 ID를 사용한다. 다른 outcome은409다.

시도 의도·outcome과 pending 명령을 먼저 영속 저장하고 제공자 호출을 별도 트랜잭션으로 수행한다. providerOrderId=서버 orderId, 전체 환불 키=동일 orderId로 고정한다. 승인 후 통신 유실/DB 영수증 실패에서 명령 재시도 또는 reconcile은 제공자 거래를 조회·재생하며 중복 승인/영수증을 만들지 않는다. 전체 환불도 독립 제공자 저장소에 한 번 적용하고 응답 유실 후 조회로 이어간다. 어댑터가 실패하면503/오류이며 성공을 만들어내지 않는다.

복구 순서: GET 상태 확인 → 같은 key/body 재전송 → 결과 유실/예약 직접 취소는 새 key로 reconcile → GET/본인 영수증 확인. 이미 완료한 reconcile 키는 이전 응답을 재생하므로 새로운 상태 동기화에는 새 키를 쓴다. CREATED 만료는 시도를 거절하며 취소할 수 있다. 자동 결제/환불 worker·cron은 없으므로 REFUND_PENDING은 명시 reconcile로 완료해야 한다. 운영 제공자에는 독립 idempotency·조회·서명·타임아웃·재처리/작업 권한 정책과 장애 검증이 추가로 필요하다.

계정당 견적/주문1000개·신규 거래 명령4000개는 합성 개발 한도다. 취소/복구는 명령 수 한도에서도 허용한다. 한도409를 임의로 새 결제 성공으로 처리하지 않는다. 운영 보관/완전 삭제는 미확정이며 임의로 금융 기록을 삭제하지 않는다.

## 제공자 webhook

`POST /payments/webhooks/sandbox`는 bearer/사용자 Idempotency-Key 대신 제공자 eventId와 두 헤더로 인증/중복 처리한다. [payment-webhook.json](examples/payment-webhook.json)은 합성 body다.

`X-Payment-Timestamp`는 Unix초10자리이며 현재±300초 이내다. `X-Payment-Signature`는 소문자 hex64, `HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, timestamp + "." + rawBodyBytes)`다. JSON 재직렬화·공백 변경은 서명을 무효화한다. timingSafeEqual로 검사하고 서명 원문을 보관/로그 출력하지 않는다. body의 eventId·orderId·transactionId는 UUID, amountKrw는 정수, currency는 KRW다.

서명을 확인한 뒤 독립 제공자 조회 결과와 서버 주문의 금액/통화/주문/거래ID를 대조한다. body.status만으로 승인/환불하지 않는다. 순서가 역전된 승인/실패 알림도 현재 제공자 조회 결과를 적용한다. 동일 eventId+동일 body는 이전 ack를 재생하며 다른 body는409 PAYMENT_EVENT_CONFLICT다. 알림 저장·주문/예약 상태·영수증은 한 merchant 트랜잭션이다. 알림 유실은 reconcile로 복구한다. 예제에 비밀이나 실카드 정보를 넣지 않는다.

## S-14 예약 연동

`POST /payments/reservations`에 reservationId를 보낸다. [예약](reservations.md)의 본인 HELD·미결제·현재 정책/장소/기한·동의를 확인하고 기존 불변 견적 amountKrw/통화에 연결한다. 예약당 주문1개다. S-16에 연결된 예약의 기존 `/sandbox-events`는409 RESERVATION_PAYMENT_ORDER_BOUND로 차단한다.

검증된 샌드박스 승인만 SANDBOX_CONFIRMED로 전환한다. 실제 예약/실차/결제 검증은 false다. 예약/결제 모두 reservation-user→payment-user→lot 순서의 잠금을 사용한다. 기존 예약 취소 또는 결제 취소가 정원을 해제한 뒤 승인이 도착하면 REFUND_PENDING으로 보상하며 claim을 다시 만들지 않는다. 만료 뒤 다른 사용자가 마지막 슬롯을 확보해도 동일하다. 예약 직접 취소 뒤 결제 상태는 webhook/reconcile에서 동기화하고 완료 전 환불됐다고 표시하지 않는다. 실패·영수증 저장 실패는 merchant 상태/claim/알림을 함께 롤백한다.

## 검증·호환성·남은 조건

OpenAPI0.14.0은 이전76연산/146스키마·차량 contractVersion1.0을 유지하고10연산을 추가한다. 기존 미연결 S-14 sandbox 명령은 유지하고 S-16 연결 이후에만 차단한다. 이전 서버는 새 결제 API를 제공하지 않으므로 migration 후 새 서버 배포가 필요하다. 기존 앱은 새 API를 선택적으로 호출하고 알 수 없는 상태를 성공으로 해석하지 않는다.

단위 검증은 HMAC 정확한 bytes/기한, 제공자 식별/금액/통화 대조와 production 차단/일반 모드 독립성을 확인한다. 실제 PostgreSQL 통합은 두 pool의 중복 시도, 승인/환불 응답 유실, 영수증 실패 롤백/재시도, webhook 중복/위조/순서 역전, 타인/ADMIN/로그아웃, 독립 compiled API 조회, S-14 취소/만료·마지막 슬롯 재판매/늦은 승인 보상을 확인한다. 실제 PG 사업자·운영 청구·실제 SDK/실차·배포·D-05 승인은 검증하지 않았다. develop 머지 뒤 Wiki Home/Payments/Reservations와 API 준비 현황을 게시해야 이슈의 문서 완료 기준을 충족한다.

## S-17 구독 결제

[subscriptions.md](subscriptions.md)의 월별 cycle도 같은 결제 API/제공자·서명/서버 조회·영수증/환불 복구를 사용한다. 해당 주문에는 subscriptionCycleId·lotId=null·4900KRW 버전 구독 pricing이 있으며 일반/예약의 가격을 구독으로 변환하지 않는다. 검증된 결제/환불 변경과 기간/불변 이력은 한 DB 트랜잭션이다. 구독 해지는 향후 갱신 중단이고, cycle 전액 환불은 payment cancel→reconcile이다. 실제 정기 청구·D-05 운영 정책은 미구현/미승인이다.
