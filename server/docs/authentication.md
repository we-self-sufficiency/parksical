# S-03 인증·차량 연결

이슈 #4. 구현은 제공자 인터페이스·개발 어댑터·사용자/세션·차량 연결·권한 검증이다. D-01의 실제 로그인 제공자와 운영 정책은 미정이다. 다른 제공자를 선택한 것으로 간주하지 않으며 운영에서 개발 계정으로 로그인할 수 없다.

## 개발 환경

호스트 실행의 `.env`에서 NODE_ENV=development, DEV_AUTH_ENABLED=true와 32자 이상의 DEV_AUTH_SECRET을 설정한다. 암호학적으로 임의 생성한 개발 키를 사용하고 Git·공유 로그에 넣지 않는다. NODE_ENV=production에서 true는 시작 실패다. Compose의 기본 API는 production으로 실행하므로 개발 로그인을 활성화하지 않는다.

POST `/api/v1/auth/development/login`은 X-Development-Key와 `{subject}`를 받는다. subject는 합성 계정을 구분하는 불투명 문자열이다. 사용자 이메일·차량 VIN을 넣지 않는다. 동일 DEV subject는 동일 사용자로 연결되며 role/userId 같은 추가 필드는 거절한다. 키가 틀리면 401, 미설정/비활성 제공자는 403 PROVIDER_NOT_CONFIGURED다. 운영 제공자의 인증을 성공으로 우회하지 않는다.

LOGIN_PROVIDER 인터페이스는 검증된 provider/subject만 반환한다. 실제 제공자 도입에는 해당 제공자의 인증 검증, 공개 클라이언트 로그인/콜백 보호, 허용할 provider와 운영 활성화 정책을 추가해야 한다. 현재 세션 검증도 DEV 및 명시적으로 활성화한 비운영 환경으로 제한한다. DB에 남은 개발 세션을 production으로 전환해 재사용할 수 없다.

## API

| 경로 | 자격·행동 |
|---|---|
| POST `/auth/development/login` | 개발 키, WEB 토큰 발급 |
| POST `/auth/refresh` | refreshToken, 단일 사용 회전 |
| POST `/auth/logout` | 현재 bearer 세션 폐기, 204 |
| GET `/me` | 현재 사용자 id/role/rankingPublic |
| GET `/auth/sessions` | WEB, 본인의 세션 목록만 |
| DELETE `/auth/sessions/{id}` | WEB, 본인 세션만 폐기 |
| POST `/auth/vehicle-links` | 신규 설치 생성 또는 기존 설치의 비밀 증명 |
| POST `/auth/vehicle-links/approve` | WEB, userCode의 명시적 승인 |
| POST `/auth/vehicle-links/exchange` | 차량의 deviceCode, 승인된 연결 1회 교환 |
| GET `/auth/vehicle-links` | WEB, 본인에게 연결된 설치의 최소 정보 |
| DELETE `/auth/vehicle-links/{id}` | WEB, 본인 연결 해제·차량 세션 폐기 |
| DELETE `/auth/admin/sessions/{id}` | ADMIN+WEB만 타인 세션 폐기 가능 |

경로 앞에는 `/api/v1`이 붙는다. 인증/개인 응답은 Cache-Control: no-store다. 사용자 식별·role은 인증한 서버 세션에서 얻으며 요청 body로 바꾸지 않는다. 기본 role은 USER다. HTTP로 role을 승격하는 경로는 없으며 관리자 부여의 운영 절차는 별도다. 일반 사용자의 관리자 요청은 403, 타인 개인 자원은 404다.

## 토큰과 갱신

- access/refresh는 각 32-byte 임의 값의 base64url 표현이다. DB에는 SHA-256 digest만 저장하고 원문은 발급 응답에서만 제공한다. JWT처럼 만료 전까지 폐기를 기다리지 않고 매 요청의 DB 상태를 검사한다.
- 개발 기본값은 access 15분, refresh 절대 만료 7일이다. refresh로 총 수명을 연장하지 않는다. 이는 A-06의 검토 가능한 개발 기본값이며 운영 수명 결정이 아니다.
- refresh를 교환하면 이전 access와 이전 refresh는 무효다. 사용한 refresh 재사용을 감지하면 해당 세션 전체를 폐기한다. 폐기를 커밋한 다음 401을 반환해 rollback으로 재활성화되는 일을 막는다.
- 동일 refresh의 동시 요청은 하나만 발급에 성공하고 나머지는 재사용으로 판단하여 그 세션을 폐기한다. 클라이언트는 갱신 요청을 직렬화해야 한다. 응답 유실 뒤 과거 refresh를 재시도하면 재로그인이 필요하다.
- 로그아웃은 현재 인증 세션만 폐기한다. 휴대폰 로그아웃이 모든 연결 차량의 자동 로그아웃을 뜻하지 않는다. 차량 연결 해제 또는 다른 세션 폐기는 각각의 API로 명시한다.
- 사용자 전환/로그아웃 시 차량 앱은 로컬 캐시와 업로드 큐도 계정별로 분리·정리해야 한다. 서버는 오프라인 기기에 저장된 화면/사진을 지우는 것을 보장하지 않는다.

## 차량 연결 흐름

1. 차량이 빈 body `{}`로 연결 요청을 만든다. 서버는 installationId, installationSecret, deviceCode, userCode, expiresAt을 반환한다. installationId는 서버 발급 UUID이며 VIN이나 인증 자격이 아니다.
2. installationSecret은 앱 설치만 보관한다. 이후 같은 설치에서 연결 요청을 만들 때 id와 secret을 둘 다 제출한다. id만 또는 타인의 id로는 기존 연결을 변경할 수 없다. OS의 안전한 저장소 사용은 차량 앱 책임이다.
3. 차량 화면의 userCode를 로그인된 휴대폰에서 명시적으로 승인한다. 기본 code는 12자리 hex, 유효기간 5분이다. 승인 응답은 토큰을 포함하지 않는다. 사용자에게 예상한 차량 연결임을 확인하는 UI는 앱에서 제공한다.
4. 차량은 자신만 받은 256-bit deviceCode로 교환한다. 승인 전은 409 AUTHORIZATION_PENDING와 Retry-After: 5다. intervalSeconds=5는 클라이언트 폴링 권장 간격이다.
5. 승인된 요청만 단 한 번 VEHICLE 세션으로 교환된다. 휴대폰에 보인 userCode는 차량 토큰 교환 자격이 아니다. 만료/이미 교환/취소된 요청은 409 PAIRING_UNAVAILABLE다.
6. 같은 설치에서 새 연결을 요청하면 이전 미완료 요청을 취소한다. 승인된 새 요청을 실제 교환하는 트랜잭션에서 기존 차량 세션을 모두 폐기하고 소유 계정을 전환한다. 승인만으로 기존 사용자 연결을 바꾸지는 않는다.
7. 연결 해제는 소유 WEB 사용자만 가능하며 해당 설치의 차량 세션과 미완료 요청을 함께 폐기한다. 해제 뒤에는 새 연결 요청과 휴대폰 승인이 다시 필요하다.

승인·교환·해제·차량 refresh는 installation 키의 PostgreSQL transaction advisory lock을 공유한다. WEB refresh/폐기는 세션 키를 사용한다. 잠금은 트랜잭션 종료에 해제되며 여러 서버에서도 동시 교환/사용자 변경을 직렬화한다. 메모리 mutex를 보안 근거로 쓰지 않는다. QR/SDK의 정확성이나 실제 차량 소유권 인증을 주장하지 않는다.

## 중복·속도 제한

인증 credential 흐름은 일반 업무 API의 Idempotency-Key 성공 재생에서 제외한다. 원문 토큰 응답을 DB에 저장해 재생하지 않기 때문이다. 로그인 재요청은 새 세션, refresh/교환은 단일 사용, 승인/해제/폐기는 현재 상태 기준으로 처리한다. 이 예외는 OpenAPI의 x-idempotency-policy=credential-flow에 표시한다. 다른 업무 API의 중복 규칙은 유지한다.

DB의 원자적 5분 버킷으로 개발 로그인/연결 시작은 원격 IP당 20회, refresh/교환은 IP당 100회, 승인은 사용자당 20회를 제한한다. 초과는 429와 Retry-After: 300이다. 프록시의 전달 헤더를 IP로 신뢰하지 않으며 현재는 socket 주소를 사용한다. D-06 프록시 구성 후 신뢰 범위/운영 한계를 다시 정해야 한다. 여러 인스턴스의 버킷도 DB를 공유한다.

버킷 키의 IP hash는 가명 정보이며 익명화가 아니다. 개발 데이터로만 검증한다. 계정·세션·사용된 refresh digest·요청 기록의 운영 보관/삭제와 장치 분실 시 설치 자격 폐기는 D-01/D-02에서 확정해야 한다. 만료를 곧바로 물리 삭제와 동일시하지 않는다.

## 검증과 근거

실제 PG 테스트는 두 계정의 소유권, 만료·폐기, refresh 회전/재사용/동시 요청, 승인/교환 경합, 설치 비밀 증명, 공유 차량 계정 전환·해제, role 거절, 운영에서 개발 세션 거절, DB/로그 원문 비밀값 제외, DB 속도 제한을 검사한다. 실제 주차 위치 API는 S-09 범위이며 아직 그 자원의 구현 완료를 주장하지 않는다.

설계 참고: [RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)의 별도 장치 승인과 [RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)의 토큰 회전/재사용 대응 원칙, [NestJS Guards](https://docs.nestjs.com/guards). 현재 경로·오류·payload는 서비스 내부 계약이며 OAuth device grant 전체 준수 구현이라는 뜻은 아니다.
