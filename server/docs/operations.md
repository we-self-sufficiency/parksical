# Migration·백업·복구

S-02 #3 운영 준비 절차다. 실제 대상은 D-06에서 정한다. 사용자/차량/결제 모델이나 수집은 아직 없다.

## Migration

- 개발: `npm run migrate:dev`로 migration을 만들고 SQL·이전/새 앱의 호환성을 PR에서 검토한다.
- 배포: 검토한 파일과 `migrate deploy`만 사용한다. Compose의 단일 migrate 서비스가 성공해야 API가 실행된다. API 인스턴스마다 migration을 실행하지 않는다.
- 사전 백업·복원 가능성과 스키마 호환성을 확인한다. 파괴적 변경은 확장→전환→정리로 나눈다.
- 실패 시 API 교체를 중단하고 SQL·migration 상태·실제 DB 상태를 조사한다. db push/reset이나 기록 삭제로 우회하지 않는다. migrate resolve는 실제 DB 상태를 확인한 복구 계획에 따라서만 사용한다.
- Prisma config의 unconfigured URL은 DB 없는 generate 전용 실패 주소다. migration에는 실제 DATABASE_URL이 필수다. URL·암호를 오류 로그에 복사하지 않는다.

## 백업

아래는 로컬 Compose 예다. 외부 저장소·암호화·접근 제어·보관 기한·복구 목표는 D-02/D-06에서 정한다. 백업을 Git/이미지에 넣지 않는다. 사용자 모델 추가 후에는 백업도 개인 데이터다.

```sh
mkdir -p backups
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/parksical.dump
test -s backups/parksical.dump
```

DB 컨테이너 도구를 사용해 pg_dump와 서버 major를 맞춘다. 백업 파일 생성 성공만으로 복원 검증 완료라고 표시하지 않는다.

## 새 DB에 복원

기존 서비스 DB를 덮어쓰지 않는다. parksical_restore_test가 새 검증 DB인지 확인한 후 진행한다.

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" parksical_restore_test'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d parksical_restore_test --no-owner --exit-on-error' < backups/parksical.dump
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d parksical_restore_test -v ON_ERROR_STOP=1' <<'SQL'
SELECT count(*) FROM "ServiceMetadata";
SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;
SQL
```

백업 전 합성 marker를 넣고 복원 DB에서 키/값까지 대조한다. 후속 모델이 추가되면 관련 건수·참조·핵심 값도 검사한다. 운영 진입 전 별도 검증 API를 복원 DB에 연결해 준비 상태/핵심 기능까지 확인한다.

## 중단·복구

- DB 중단 시 live=200/ready=503, 복구 뒤 ready=200을 확인한다. 오류 응답은 DEPENDENCY_UNAVAILABLE와 요청 ID를 포함하며 DB 예외 원문을 노출하지 않는다.
- SIGTERM/SIGINT는 HTTP와 Prisma 연결을 정리한다. 10초 기한을 넘으면 실패 종료다. 배포 시스템은 더 긴 종료 유예를 둔다.
- 정산·알림 작업은 아직 없다. 후속 구현은 영속 상태와 재시도/중복 부작용 방지를 추가해야 한다.
- 운영 전 TLS/도메인, DB 권한, 비밀 주입, 로그 정책, 파일 저장, 외부 백업/복원 연습과 정책 활성화를 점검한다.


## S-13 합성 연습 확장

[practice.md](practice.md)의 실행/migration·호환성 절차를 따른다. 새 설정 없이 기존 DEV_AUTH_ENABLED/DEV_MISSIONS_ENABLED opt-in이며 기본 OFF다. `npm run migrate:deploy` 후 새 서버를 실행한다. 새 migration은 기존 PRACTICE에 불변 goalVersion membership만 backfill하며 미션 결과/영수증을 바꾸지 않는다. 새 선택 기어 횟수는 S-13 서버 배포 후 전송한다. PracticeRecognition은 재구성 가능한 파생 상태이며 진행도/도장 GET이 이전 서버의 지연 결과를 반영할 수 있다. 결과·무효/도장·영수증의 DB 원자성과 백업/복원 범위에 새3테이블이 포함된다. 이 구현이 배포/Base URL·실제 SDK/실차·D-02/D-04 또는 QR D-07 완료를 뜻하지 않는다.


## S-14 합성 예약

[reservations.md](reservations.md)의 migration/비운영 opt-in을 따른다. DEV_RESERVATIONS_ENABLED는 기본OFF, REAL_RESERVATIONS_ENABLED/REAL_PAYMENTS_ENABLED는 활성화 불가다. 새6테이블·DB 상태 guard/고유 제약을 migrate deploy 후 실행한다. 정책은 ADMIN+WEB으로 가상 장소에 명시하고 자동 예약/결제 시드를 만들지 않는다. 만료 정원은 DB UTC epoch/deadline 조건으로 즉시 제외하고 조회/후속 변경에서 상태와 점유를 재정리하므로 상시 만료 worker가 없어도 이중/영구 점유를 만들지 않는다. 결제 제공자/실제 청구/환불은 미구현이다. 원본 동의/금액/개인 예약·키/토큰을 로그에 넣지 않으며 정책/견적/이력/영수증/점유를 함께 백업·복원한다. 실제 운영/배포·D-04/D-05 승인은 별도다.


## S-15 합성 랭킹

[rankings.md](rankings.md)의 migration/generate/build·비운영 opt-in을 따른다. DEV_RANKINGS_ENABLED 기본OFF, REAL_RANKINGS_ENABLED 활성화 불가, 기본 Compose production은 변경하지 않는다. 새5테이블/인덱스/guard·membership 및 개발 전역 잠금 trigger를 migrate deploy 후 실행한다. 기존68연산 입력과 불변 결과를 보존한다. 동의/철회·현재 가명·이력·참여 표식·영수증·내부 월 확정 원천을 함께 백업한다. 공개 철회는 현재 동의를 재검사하므로 확정 snapshot을 그대로 외부에 직렬화하지 않는다. 공개 동의/키/개인 원천·해시를 로그에 넣지 않는다.

내부 finalizeSyntheticMonth는 cutoff 후 합성 S-18 계약 검증용이며 공개 HTTP/cron/실제 보상 실행이 없다. 후보 최대10000/주차장/월, 그룹100과 전체 개발 잠금은 가역적인 개발 한도다. 한도503을 순위 부분 성공으로 변환하지 않는다. 영수증 누적으로 공개 철회/참여 삭제를 차단하지 않고 동의 버전에는 최종 철회 여유를 남긴다. 실제 운영 규모/보관·완전 삭제·정산 자격은 D-02/04/05 확정 후 별도 구현한다.

## S-16 사전결제 복구

[payments.md](payments.md)의 비운영 opt-in과 migration20261115050000_payments를 따른다. 일반 사전결제는 MAX 없이 가능하며 실청구는 차단한다. 견적/주문/시도/환불/불변 승인 영수증/명령/알림·독립 합성 제공자8테이블을 함께 백업·복원한다. 별도 제공자 테이블은 테스트 gateway이므로 실제 PG로 오인하지 않는다. 비밀은 환경에서 주입하고 DB/로그/예제에 저장하지 않는다.

PENDING/REFUND_PENDING이면 본인 GET 확인 → 같은 명령 key/body 재전송 또는 새 key로 reconcile → 상태/영수증 재확인한다. 자동 청구/환불 worker는 없다. 실운영 서비스 활성화는 D-05와 실제 제공자 어댑터/장애/웹훅/배포 승인 후 별도 작업이다. merchant DB 롤백으로 이미 승인된 제공자 거래를 없었던 일로 취급하지 않는다.

## S-17 구독 복구·호환성

[subscriptions.md](subscriptions.md)의 비운영 opt-in과 migration20261115060000_subscriptions를 따른다. 구독/월별 cycle/불변 관측 이력/명령4테이블·PaymentOrder의 선택 cycle 참조/nullable lotId를 원자 추가한다. 일반/예약 주문의 필드와 금액/상태 제약은 보존하고 구독 주문에는 lotId=null·구독 pricing을 사용한다. 신규 앱/서버 계약 준비 후 명시적으로 기능을 켠다.

상품/기간/영수증·관측 이력·S-16 결제/환불을 함께 백업하고 실패한 merchant 트랜잭션이 이미 실행한 제공자 승인을 삭제했다고 간주하지 않는다. S-16 동일 명령 또는 reconcile로 복구한다. 갱신/환불은 명시 합성 실행이며 실제 정기 청구/worker는 없다. 만료 권한은 매 요청 계산하므로 만료 worker 중단/재시작이 기간을 늘리지 않는다. 취소·기록 조회·동의 철회는 pass 만료로 막지 않는다.

## S-18 정산·쿠폰·알림 복구

[rewards.md](rewards.md)의 비운영 opt-in과 migration20261115070000_rewards를 따른다. 정산/불변 manifest·grant/쿠폰/claim/outbox/대체 제공자/명령7테이블 및 S-16 주문 상태 제약을 원자 추가한다. 기존 S-12~S-17 데이터·가격/영수증/기간은 초기화하지 않는다. 신규 앱이 COUPON_SETTLED/COUPON_VOIDED와 INTERNAL_COUPON_LEDGER·현금0 증빙을 처리한 뒤 기능을 켠다. DB 연결에 UTC를 명시하여 호스트 기본KST에서도 시각을 보존한다.

월1일00:00KST prepare(이전 월) → WAITING_CUTOFF → 기존 랭킹72h 마감 후 새 key process(limit≤20) → COMPLETED까지 반복한다. 관리 실행은 ADMIN/WEB bearer를 요구하며 실제 운영 cron은 미활성이다. 중단 시 GET 요약/hash 확인 후 새 key의 process로 남은 PENDING만 처리한다. 같은 key는 원래 배치 응답 재생, 입력/hash 수동 수정·grant 삭제·임의 쿠폰 재발급은 하지 않는다. 발급/사용 취소가 원천 월2장 한도를 복원하지 않는다.

별도 dispatch로 PENDING/만료 lease를 처리한다. SANDBOX_MAILBOX/realDelivered=false이며 총3시도·30초 lease·60/300초 지연 후 FAILED다. 제공자 성공/ack 전 중단은 동일 notificationId로 중복 제거한다. 알림 실패가 발급 실패/재지급으로 이어지지 않는다. 사용자 점유/만료는 다음 조회 시 정리하며 결제 오류는 자동 현금 청구하지 않는다. 사용 취소는 원장 VOIDED/예약 해제이고 현금 환불·쿠폰 복원은 없다. 과거 사용 영수증과 현재 주문 상태를 함께 확인한다.

백업은 원천 ranking snapshot/mission·subscription 결제/기간·reward manifest/hash/grant/coupon/claim/notification/명령과 별도 합성 제공자 원장을 함께 보존한다. 복원 후 readiness200/인증/기존 데이터·작업 건수를 확인하고 동일 외부 알림 키로 복구한다. 실제 PG·블루링크·운영 일정/비용·D-02/D-04/D-05 및 배포/SDK/실차는 별도 승인/구현 항목이다.
