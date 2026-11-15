# S-14 예약 슬롯·견적·임시 점유·취소

2026-11-15(KST) · #15 / F-09 · 합성 개발 구현 범위. develop 통합/Wiki 게시·배포/Base URL·실제 SDK/실차·결제 제공자 검증은 이슈/PR에서 별도 추적한다.

## 범위·설정

TypeScript/NestJS/PostgreSQL/Prisma로 **명시적인 SYNTHETIC 장소 정책**과30분 슬롯, 서버 가격 견적, 유한 임시 점유, 취소·샌드박스 상태 전이를 제공한다. 가상 주차장1곳의32면 구조를 재사용한다. capacity는 합성 연습/도전 예약 정원이며 실시간 빈 주차면/실제 수용 가능 차량 수가 아니다. 별점이나 `challengeAllowed=false`를 운영 장소 허가로 바꾸지 않는다. 예약이 실제 정차/방문/미션 성공이나 연습 자격을 증명하거나 MissionRun을 자동 생성하지 않는다.

```sh
npm ci
npm run generate
npm run migrate:deploy
npm run build
# NODE_ENV=development/test, DEV_AUTH_ENABLED=true와 충분한 개발 키를 설정
# DEV_RESERVATIONS_ENABLED=true를 명시한 비운영 서버에서만 사용
npm start
```

`DEV_RESERVATIONS_ENABLED`는 기본false이며 비운영 개발 인증을 요구한다. production/개발 인증 없는 opt-in과 `REAL_RESERVATIONS_ENABLED=true`, 기존 `REAL_PAYMENTS_ENABLED=true`는 기동 차단이다. 미션/리뷰/위치 플래그는 예약의 선행 설정이 아니다. 기본 Compose는 production/기능OFF 그대로이며 공유/운영 서버에 opt-in하지 않는다.

D-04 실제 장소/시간·MAX 허용 범위와 D-05 실제 요금/청구·환불·노쇼는 **PENDING**이다. 모든 응답은 `source=SYNTHETIC`, `operationalAllowed=false`, `realPaymentVerified=false`, `operationalBlockers=[D-04,D-05]`다. 샌드박스 성공도 실제 결제·실제 예약 확정으로 표시하지 않는다. SDK/실차·E1~E8·D-02/D-04 및 QR D-07을 완료로 승격하지 않는다.

## API·소유권

경로 앞에는 `/api/v1`이 붙는다. Bearer 인증, 성공/오류 모두 no-store, JSON64KiB·미지 필드 거절. 예약 읽기300/쓰기100회·계정·5분, 견적/예약 각각1,000건·계정, 정책 최대1,000버전·주차장인 개발 한도를 둔다.

| 메서드·경로 | 자격·동작 |
|---|---|
| PUT `/admin/lots/{lotId}/reservation-policy` |ADMIN+WEB,200. expectedVersion0 최초/이후+1, 불변 정책·안전 규칙·일반 요금 snapshot|
| GET `/lots/{lotId}/reservation-policy` |WEB/VEHICLE,200. 최신 정책·currentlyAvailable·안전 수칙 표시문|
| GET `/lots/{lotId}/reservation-slots?date=YYYY-MM-DD&mode=PRACTICE&lengthMm=4800&widthMm=1850` |WEB/VEHICLE,200. KST 하루의 미래30분 슬롯·공유 잔여 정원|
| POST `/reservation-quotes` |WEB/VEHICLE,201. 서버 금액·요금/정책/구조·유효기간 고정, 정원 점유 없음|
| POST `/reservations` |WEB/VEHICLE,201. 본인 견적과 안전 동의로 전 슬롯을 원자 점유, HELD/미결제|
| GET `/reservations?limit=20&cursor=...` |본인 전체 예약·만료/취소/환불 이력,200|
| GET `/reservations/{reservationId}` |본인 현재 상태·고정 가격/안전 동의,200|
| POST `/reservations/{reservationId}/cancel` |본인 시작 전 취소,201. 점유 해제·필요 시 환불 대기|
| POST `/reservations/{reservationId}/sandbox-events` |본인 합성 테스트 명령,201. 실제 제공자 webhook/결제 검증 API 아님|

변경 요청은 Idempotency-Key(ASCII 영숫자/점/밑줄/하이픈1~64자)가 필수다. WEB과 VEHICLE 모두 **본인 계정** 범위이며 미션의 설치 한정 조회와 다르다. 차량 토큰은 현재 계정 연결이 유효해야 하고 연결 해제/사용자 변경은401이다. ADMIN도 타인 견적/예약에 접근하지 못한다. body의 userId·가격·정차 주장·제공자 ID/서명 확인 boolean은 받지 않는다.

목록 limit1~50(기본20), `startsAt DESC, UUID DESC`, cursor는 사용자/limit/API에 묶인다. 다른 사용자/limit 재사용은400이다. 새 예약이 추가될 수 있는 현재 뷰이며 고정 내보내기 스냅샷은 아니다. 물리 삭제 없이 취소/만료/실패/환불 이력을 보존한다. 실제 개인/결제 보관·삭제 정책은 D-02/D-05 후속이다.

## 장소 정책·차량 조건·슬롯

관리자는 [합성 정책 요청](examples/reservation-policy-write.json)으로 정책을 명시한다. 지속 시드/자동 승인 정책은 만들지 않는다. source=SYNTHETIC만 허용한다. active 정책은 현재 active COMPLETE SYNTHETIC SELF_PARK 구조, 알려진 일반 요금/운영 시간과 active GENERAL 면 수 이내 정원이 필요하다. 구조/요금이 새 revision으로 바뀌면 기존 정책은 사용할 수 없고 새 구조 버전의 정책을 발급해야 한다.

허용 모드·최대 전장/전폭(mm)·정원1~32·요일별 운영 구간을 고정한다. 정책 시간은30분 격자, 일반 운영 시간 내부·겹침 없음이며 야간 시간은 요일별로 분리한다. 월1~일7, 분0~1440, 시간대는Asia/Seoul이다. 차량 크기 한도는 합성 입력 자격일 뿐 회전 궤적/실차 주차 가능 판정이 아니다. 도전/연습과 모든 정책 버전이 **같은 lot/30분 슬롯의 정원**을 공유한다. 기존 진행 중/예정 점유보다 정원을 줄이는 정책은409로 거절한다. 비활성 정책은 조회 가능하지만 새 견적/점유/샌드박스 확정은 차단한다.

예약은30~240분/30분 배수, 시작은UTC/KST의정시·30분/초·밀리초0이다. 구간은 `[startsAt,endsAt)`로 인접 예약을 허용한다. 모든 단위 슬롯이 정책 운영 구간 안에 있어야 한다. KST오늘을 포함한7개 날짜, 끝은 오늘00:00+7일 이내다. 조회는 하루 최대48개 미래 슬롯을 반환하며 일부 구간 정원이 부족하면 전체 점유가 실패한다. 같은 계정의 겹치는 HELD/샌드박스 확정도 차단한다. 견적 조회만으로 정원은 보장되지 않는다.

시각·만료 판단은 잠금 획득 뒤 **DB clock의 UTC epoch milliseconds**를 읽는다. 세션 시간대/원시 timestamp 디코딩으로9시간이 가감되지 않게 하고, 클라이언트가 보낸 만료 시각을 사용하지 않는다. 견적/점유 만료는 `now >= deadline`에서 만료다.

## 서버 견적·원화 반올림 — A-17 개발 기본값

요청 예시(실제 lotId/현재 유효 시각으로 변경):

```json
{"lotId":"66666666-6666-4666-8666-666666666666","mode":"PRACTICE","startsAt":"2026-11-16T01:00:00.000Z","durationMinutes":60,"lengthMm":4800,"widthMm":1850}
```

[요청](examples/reservation-quote-request.json), [연습 견적](examples/reservation-quote.json), [도전 견적](examples/reservation-challenge-quote.json)을 참고한다. 서버가 정책 발급 때 일반 주차장 요금을 복사해 가격을 계산한다. DTO에 amountKrw·요금 배수를 넣어 덮어쓸 수 없다.

`reservation-price-v1` 계산 순서:

1. KST 날짜별 이용 분을 나누고 각 날짜에서 `baseAmount + ceil(max(0,분−baseMinutes)/additionalMinutes)*additionalAmount`를 계산한다.
2. 각 날짜의 일반 요금에 dailyMaxAmount를 적용한다(null이면 상한 없음). 날짜가 바뀌면 기본요금/상한도 별도로 적용한다.
3. 일반 합계에 모드 배수를 적용하고 **총액을1원 단위 HALF_UP으로 한 번 반올림**한다. 금액 곱셈/반올림은 BigInt 정수다.
4. 일반 합계/최종 견적0~100,000,000원 개발 한도를 넘으면422이며 DB 정수 overflow로 넘기지 않는다.

배수는 도전15000~20000bps(1.5~2.0), 연습12000~15000bps(1.2~1.5) 설정 범위다. 합성 fixture는 **도전1.75/연습1.25**다. 일반60분2,500원이면 도전4,375원/연습3,125원이다. 일반 일 최대액은 일반 요금에 먼저 적용하며 모드 할증에 다시 상한을 적용하지 않는다. 실제 운영 요금 약정이 아니다.

견적은 user/lot·정책/구조/요금 버전·모드·시간·차체·가격·안전 버전과 createdAt/expiresAt을 불변 저장한다. TTL은1~900초(합성 기본300), 시작 시각 이내다. 새 정책이 발행된 견적은 새 점유에 쓸 수 없다(409). 이미 점유한 가격을 다시 계산/증액하지 않으며, 정책이 바뀐 이전 점유의 뒤늦은 샌드박스 결제는 환불 대기로 분리한다. 가격 보장/실결제 전환 정책은 D-05/S-16에서 별도로 확정한다.

## 안전 동의·임시 점유·상태

```json
{"quoteId":"44444444-4444-4444-8444-444444444444","safetyRulesVersion":"synthetic-safety-v1","safetyAgreedAt":"2026-11-15T08:00:00.000Z"}
```

[점유 요청](examples/reservation-hold.json)/[HELD 응답](examples/reservation-held.json)을 참고한다. 안전 수칙 문구는 정책의 safetyRules로 제공하고, version과 클라이언트 동의UTC 시각을 기록한다(DB 기준±5분). 서버 수신 시각은 예약 createdAt으로 별도 보존한다. 이 선언이 실제 화면 표시/정차·UX 허용·차량 지원의 증거는 아니다. 현재 synthetic-safety-v1 문구/버전은 합성 테스트용이며 실제 장소 수칙은 미승인이다. 새 문구는 새 registry 버전으로 추가한다.

| 현재·입력 | 다음 상태·점유 |
|---|---|
| 유효 견적·동의·정원 확보 |HELD / NOT_STARTED, 전 슬롯 점유|
| HELD·점유 만료 |EXPIRED, 점유 해제|
| HELD·시작 전 취소 |CANCELLED, 점유 해제|
| HELD·샌드박스 성공·유효 정책/기한 |SANDBOX_CONFIRMED / SANDBOX_SUCCEEDED, 원래 시간 구간만 유지|
| HELD·샌드박스 실패 |PAYMENT_FAILED / SANDBOX_FAILED, 점유 해제|
| 만료/취소/실패/정책 변경 후 샌드박스 성공 |REFUND_PENDING / SANDBOX_REFUND_REQUIRED, 정원 재점유 없음|
| SANDBOX_CONFIRMED·시작 전 취소 |REFUND_PENDING, 점유 해제|
| REFUND_PENDING·샌드박스 환불 완료 |REFUNDED / SANDBOX_REFUNDED|

점유 TTL은1~900초(기본300), 시작 시각 이내다. 만료 작업자가 없어도 정원 계산은 deadline이 지난 HELD를 즉시 제외하며, 슬롯/본인 조회·후속 변경 시 같은 잠금 안에서 EXPIRED 상태와 점유 해제를 저장한다. 다른 변경이 실패해 sweep이 롤백돼도 만료 조건으로 정원을 제외하므로 영구 점유가 되지 않는다. 샌드박스 확정은 원래 점유 deadline 뒤에도 예약한 시간 구간까지 계산하지만 실제 사용/출차/노쇼 증명이 아니다. 시작 시각 이후 취소/노쇼 처리는 이 개발 API에서409이며 실제 정책은 D-05 후속이다.

취소는 [expectedVersion+reason 요청](examples/reservation-cancel.json)과 [응답](examples/reservation-cancelled.json)을 따른다. HELD취소는 미결제 취소이고, 결제된 샌드박스 취소도 환불 완료 전에 완료로 표시하지 않는다. 버전이 바뀌면 조회 후 재판단한다. 재활성화/기간 연장 API는 없으며 새 견적/예약이 필요하다.

## 결제 S-16 연동 경계

`sandbox-events`는 운영 webhook가 아닌 **명시적 합성 테스트 명령**이다. [요청](examples/reservation-sandbox-event.json)은 kind만 받는다. 서버 어댑터가 예약 ID·고정 금액/통화와 임의 providerEventId를 생성하고 [source=SANDBOX/realPaymentVerified=false 영수증](examples/reservation-sandbox-receipt.json)을 남긴다. 클라이언트 가격/providerEventId·REAL_PAID·검증 boolean은 거절한다. 실제 제공자 검증 포트는 PAYMENT_PROVIDER_NOT_IMPLEMENTED(503)이며 호출 가능한 실제 제공자 webhook/청구·자동 환불 경로는 없다.

S-16의 **내부 포트 계약**은 providerEventId/providerOrderId·reservationId/quoteId·금액KRW/통화·성공/실패/환불 종류와 서명 검증+제공자 서버 조회 증거다([payment-port.ts](../src/reservations/payment-port.ts)). 이 타입을 사용자 DTO로 바인딩하거나 true boolean을 믿지 않는다. 실제 구현은 제공자 이벤트 유일성/서버 조회·주문/금액/통화 일치·저장 이벤트 순서/재전송·진짜 청구/환불을 검증하고, 같은 사용자/lot 잠금 안에서 현재 기한/정책/상태를 재검사해야 한다. 실제 확정 상태/새 source·운영 gate·환불/노쇼 의미는 S-16 및 D-04/D-05 승인과 새 migration/계약으로 추가해야 한다. S-14 테스트 완료가 S-16 결제 구현 완료가 아니다.

## 원자성·중복·오류·호환성

모든 예약 변경은 계정 advisory lock, 이어서 S-05와 공유하는 lot advisory lock을 잡는다. 같은 lot의 모든 모드/정책 버전과 여러 서버 인스턴스가 같은 잠금을 사용한다. 전체 단위 슬롯 확인·한 예약/점유 생성·상태 전이·action/영수증은 같은 DB 트랜잭션이다. 하나라도 실패하면 전부 롤백한다. 본인 목록의 여러 lot은 정렬된 순서로 잠가 읽는다.

예약 API 영역의 Idempotency-Key는 계정+키에 route/body hash로 묶이며 같은 key/다른 내용은409다. 같은 quoteId/동일 동의 body를 새 키로 보내도 원래 생성 영수증을 반환하고 점유 deadline을 늘리거나 재점유하지 않는다. 이미 사용한 견적의 다른 동의 body는409다. 취소와 각 샌드박스 이벤트 종류도 예약당 고유 action 영수증을 남겨 새 키/중복 처리에 같은 응답을 반환한다. `Idempotency-Replayed:true`를 표시한다. 예전 생성/취소/결제 영수증은 역사적 확인이고 현재 자원 상태가 아니므로 항상 GET으로 다시 조회한다. 수정된 body를 재전송에 섞지 않는다.

| 상태 | 대표 원인·대응 |
|---|---|
|400|DTO/미지 필드·키·cursor·최소 범위/숫자 문자열. 클라이언트 가격/정차/제공자 ID 금지|
|401/403|미인증/연결 해제, RESERVATIONS_POLICY_DISABLED 또는 ADMIN+WEB 아님|
|404|없는 정책/lot 또는 타인의 견적/예약. 개인 자원 존재를 구별해 노출하지 않음|
|409|SLOT_FULL/USER_OVERLAP·QUOTE_EXPIRED/POLICY_CHANGED/ALREADY_USED·VERSION_CONFLICT·중복 다른 payload·부적절한 이벤트/취소·상한. 상태 재조회/새 견적|
|422|시간 격자/배수/허용 창·차체/모드/장소/수칙·가격 한도·샌드박스 증거 불일치|
|413/429|64KiB/빈도 상한, Retry-After 준수|
|503/5xx|제공자 미구현/의존 장애·저장 실패. 원래 body/key로만 재시도하며 확인 전 성공으로 표시하지 않음|

`20261115030000_reservations`는6테이블과 고유/FK/금액·기간·상태 제약/불변 영수증·전이 guard를 추가한다. 자동 예약/정책/결제 시드는 없고 기존 미션/연습/위치/QR 데이터와 입력은 바꾸지 않는다. OpenAPI0.12.0은9연산/16스키마를 추가하며 기존59연산/121스키마 의미를 유지한다. 새 설정은 기본OFF다. DB migration 후 새 서버를 실행하고, 기존 앱은 새 기능을 호출하지 않아도 동작한다.

검증은 npm run verify, 실제 PostgreSQL의 npm run test:integration, python scripts/check_contract.py다. 마지막 슬롯/모드 공유·서로 다른 서버 pool·다중 슬롯/취소/결제 원자성·receipt 실패 rollback·만료 재점유/늦은 결제 환불·불변 가격/동의·권한/연결 해제·정책/구조 비활성·재기동 영수증 재생을 포함한다. 테스트 결과/CI 링크는 PR/이슈에서 확인한다. develop 머지 직후 Wiki Home/Reservations 가이드와 MAX 후속 상태를 실제 게시하고 링크 확인 후 #15를 종료한다.
