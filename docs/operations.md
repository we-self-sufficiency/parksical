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
