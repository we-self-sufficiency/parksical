# S-02 실행·검증

## 버전

Node.js **24.22.1**, NestJS **12.5.0**, TypeScript **6.0.3**, Prisma CLI/Client/PG adapter **7.10.1**, PostgreSQL **18**을 사용한다. package.json과 lockfile은 정확한 패키지 버전을 고정한다. Prisma latest는 8 RC여서 안정된 7.10.1을 Client/adapter와 맞췄다. PostgreSQL 이미지는 보안 패치를 받는 `18-bookworm` major 태그이며 운영 digest는 D-06에서 결정한다.

근거: [Nest 버전 호환성](https://docs.nestjs.com/faq/versions), [Nest 12](https://docs.nestjs.com/migration-guide), [Prisma 7 설정](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference), [PG adapter](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/database-drivers). npm registry engines/peerDependencies도 확인했다.

## 호스트 개발

1. `.nvmrc`의 Node로 `npm ci` → `npm run generate`.
2. `.env.example`을 `.env`로 복사하고 예제 암호와 URL을 변경한다. 암호의 URL 특수문자는 인코딩한다. 파일은 커밋하지 않는다.
3. `docker compose up -d db`. Compose가 해석하는 COMPOSE_DATABASE_URL도 설정해야 한다.
4. `npm run migrate:deploy` → `npm run build` → `npm start`.
5. `GET /api/v1/health/live`는 DB에 질의하지 않는다. `/api/v1/health/ready`는 연결과 기반 테이블을 확인하고 DB/스키마 실패 시 503이다.

호스트 DATABASE_URL은 127.0.0.1, COMPOSE_DATABASE_URL은 내부 호스트 db를 사용한다. `.env`의 DB 사용자·암호·이름과 URL을 함께 변경한다. 기존 DB의 암호는 POSTGRES_PASSWORD 변경만으로 갱신되지 않는다.

소스 변경 후 `npm run build`를 다시 실행한다. `start:dev`는 빌드 파일을 감시하며 소스를 자동 transpile하지 않는다. 잘못된 PORT/DATABASE_URL은 시작 실패다. 개발 인증은 [인증 안내](authentication.md)에 따라 비운영에서 키와 함께 명시적으로 켠다. 원본 신호·개인 운전 요약·실결제 활성화는 거절한다.

## 전체 Compose

```sh
docker compose up -d --build --wait
curl --fail http://127.0.0.1:3000/api/v1/health/live
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

PostgreSQL 준비 → 일회 migration 성공 → API 순서다. migration 실패 시 API를 시작하지 않는다. migrate stage에는 Prisma CLI가 있고 API runtime은 개발 의존성이 없는 non-root node 사용자로 실행한다. API의 graceful shutdown 기한은 10초, Compose 유예는 15초다.

`docker compose down`은 데이터를 유지한다. `down -v`는 명시적으로 폐기할 개발/CI 데이터에만 쓴다. 운영 대상·TLS·비밀 주입·이미지 digest는 D-06에서 확정한다.

## 설계와 구현

구현한 경로는 health, 계약 문서, S-03 인증/차량 연결, S-04 capability/종료 메타데이터 수신, S-05 ADMIN+WEB 주차장·버전별 구조 관리, S-07 인증된 차량 크기별 난이도, S-06 인증된 주변 검색/상세, S-08 개발 합성 리뷰, S-09 본인 위치·이력·비공개 사진 조회다. [가상 주차장 1곳의 시드](parking-lots.md)는 migration/build 뒤 비운영에서 명시적으로 실행한다. OpenAPI는 설계와 구현을 함께 담아 `X-Contract-Status: mixed`와 연산별 구현 상태를 제공한다. 원본 주행 신호·실제 개인 운전/위치 수집은 미정·비활성이다. [수신·재전송 안내](vehicle-ingestion.md)를 따른다.

S-07의 인증된 `GET /lots/{lotId}/difficulty`는 [난이도 안내](difficulty.md)에 따라 구조/연식과 차량 크기를 계산한다. 현재 합성 자료만 사용하며 S-07 기본 설정은 리뷰/주행 표본을 만들지 않는다. S-08 개발 opt-in은 저장된 합성 리뷰 표본만 전달한다. 같은 계산기를 S-06 검색/상세에서 재사용하며 실제 SDK/실차 주차 가능 검증은 아니다. S-07에는 migration이 없었고 S-06에는 검색 색인/할인 코드 migration이 있다.

공통 기반은 요청 ID·오류 envelope·JSON 64KiB 제한(위치 사진 POST만3MiB)·ValidationPipe의 미지 필드 거절이다. HTTP 로그는 event/requestId/method/status/durationMs만 기록한다. URL·query·header·body·예외 원문을 기록하지 않아 QR 토큰/위치/자격 증명이 기본 로그에 남지 않는다. 시작 오류도 비밀을 포함할 수 있는 객체/stack을 출력하지 않는다.

## 검증

```sh
npm run verify
python scripts/check_contract.py
```

verify는 generate → lint → typecheck → 단위 테스트 → build다. Python 문서 검사 의존성은 scripts/contract-validation-requirements.txt를 따른다.

실제 DB 테스트에는 별도 `parksical_test`를 만들고 TEST_DATABASE_URL을 shell/CI에 주입한다. npm은 이 변수에 대해 `.env`를 자동 로드하지 않는다. 일반 DATABASE_URL과 달라야 하고 테스트 DB 이름은 `_test`로 끝나야 한다.

```sh
# 먼저 shell/CI에 TEST_DATABASE_URL과 일반 DATABASE_URL을 서로 다르게 설정
npm run test:integration
```

통합 검증은 migration 적용/재적용, Prisma CRUD·독립 PG 클라이언트 대조, 인증/차량 연결, 중복·순서/시각·폐기와 별도 API 프로세스 재시작 뒤 receipt 재생을 확인한다. compiled API를 사용하는 수신 테스트 전에 `npm run build`가 필요하다(`verify`와 CI에 포함). CI는 실제 DB 재시작·pg_dump/pg_restore와 Compose 이미지 빌드/중단/재연결도 검사한다. 운영 DB에서 테스트하지 않는다.

로컬에는 Docker가 없어 native PostgreSQL 18.6으로 실제 통합·프로세스 재시작 영속성을 확인했다. Docker/Compose 및 pg_dump/pg_restore의 실행 결과는 PR verify CI에서 확인한다. 미실행 검증을 통과로 기록하지 않는다. 실제 운영·차량 SDK는 후속 범위다.

S-06 #8: 인증된 주변 검색·상세 API, 차량별 난이도 정렬·불변 구조 조회는 [검색/상세 가이드](lot-search.md)를 따른다. 공유 서버/실제 SDK 검증은 별도다.

S-08 #9의 리뷰/집계는 기본 비활성이다. DEV_REVIEWS_ENABLED=true는 비운영 개발 인증과 합성 방문 fixture에만 사용하며 [리뷰 가이드](reviews.md)의 명시적 준비·별도 CLI를 따른다. REAL_REVIEWS_ENABLED는 false만 허용한다. 새 migration 적용이 필요하고 startup에 리뷰/방문을 시드하지 않는다.

S-09 #10은 [개인 위치·첨부 가이드](parked-locations.md)를 따른다. DEV_LOCATIONS_ENABLED 기본false이며 DEV_AUTH_ENABLED=true인 비운영에서만 켠다. REAL_LOCATIONS_ENABLED는 false만 허용한다. migration은 위치/원본·현재 선택·이력·사진 metadata/비공개 BYTEA·최소 변경 영수증을 추가하며 자동 시드는 없다. 사진 처리는 sharp0.35.5로 고정하고 JPEG/PNG 실제 디코딩·12MP·2MiB·EXIF 제거를 검증한다. 파일 어댑터는 DB 트랜잭션 범위이며 운영 저장소/보관 정책은 미정이다. QR은 아래 S-10 개발 경로를 따른다.

S-10 #11은 [QR·휴대폰 가이드](location-qr.md)를 따른다. DEV_QR_ENABLED=true에는 비운영 개발 인증·위치 opt-in과 정확한 QR_PUBLIC_ORIGIN이 필요하다. REAL_QR_ENABLED는 false만 허용한다. 새 migration 적용 후 소유자 발급/폐기·/p 휴대폰 웹·1회 교환/쿠키 조회를 검증한다. build는 public/qr/app.js 구문도 검사하고 Docker에 정적 자산을 포함한다. GET/HEAD는 비소모이며 운영 D-06/D-07은 미정이다.
