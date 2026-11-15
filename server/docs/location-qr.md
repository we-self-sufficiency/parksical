# S-10 QR 교환·휴대폰 위치 조회

이슈 #11 / F-06. [개인 위치](parked-locations.md)를 소유자가 QR 링크로 발급하고 명시적 교환을 거쳐 휴대폰 웹에서 최소 정보만 조회한다. 실제 차량 QR 표시·스캐너는 앱 책임이다. 서버는 URL을 반환하며 QR 비트맵 생성/차량 UI는 제공하지 않는다.

## 개발 설정과 미정 정책

D-07은 **PENDING**이다. A-13의 가역 개발안은 “발급 후24시간 이내1회 교환, 같은 브라우저 쿠키로 원래 만료 시각까지 재조회”다. 휴대폰 하드웨어 신원이나 수신자 본인 확인이 아니며 자격을 복사하면 다른 클라이언트도 사용할 수 있는 범위 제한 bearer 권한이다. 운영 로그인/D-02 실제 자료/D-03 실제 장소/D-06 운영 도메인·파일/D-07 운영 QR 의미를 승인한 것으로 확대하지 않는다.

DEV_QR_ENABLED 기본false, REAL_QR_ENABLED는 false만 허용한다. 비운영 DEV_AUTH_ENABLED=true·DEV_LOCATIONS_ENABLED=true와 QR_PUBLIC_ORIGIN의 명시 설정이 모두 필요하다. production/잘못된 설정은 기동 시 거절한다. QR_PUBLIC_ORIGIN은 trailing slash/path/query/사용자정보 없는 정확한 origin이며 HTTPS 또는127.0.0.1/localhost/[::1]의 개발 HTTP만 허용한다. 예: http://127.0.0.1:3000. Host/X-Forwarded-Host/클라이언트 본문으로 링크 origin을 정하지 않는다. 공유 Base URL·실제 SDK/실차는 미검증이다. 실제 휴대폰에서 접근할 개발 HTTPS origin은 별도 준비해야 하며 다른 기기의 loopback은 서버가 아니다.

Prisma migrate deploy는 QrAccessGrant/QrPhoneSession·FK/unique/index/lifetime CHECK만 추가한다. 위치·주차장·사용자/QR 시드를 startup이나 migration에 만들지 않는다. 기존 인증·검색·난이도·리뷰·위치 요청 계약은 유지한다. 정적 휴대폰 자산 public/qr는 Docker runtime에 포함한다.

## 소유자 발급·폐기·재발급

| 메서드·경로 (/api/v1) | 자격·입력 | 동작 |
|---|---|---|
| POST /parked-locations/{locationId}/qr-tokens | 현재 WEB/VEHICLE bearer, Idempotency-Key, JSON {expectedVersion} | 201 grantId/url/expiresAt/policyStatus |
| DELETE /parked-locations/{locationId}/qr-tokens/{grantId} | 본인 bearer, Idempotency-Key, 빈 JSON {} | 200 {grantId,revoked:true} |

관리자도 타인 위치로 발급/폐기하지 못한다. 발급 시 현재 location.version이 expectedVersion과 다르면409 VERSION_CONFLICT, 타인/없음/삭제404다. 한 위치에 새 키로 발급하면 이전 grant와 그 파생 조회를 같은 트랜잭션에서 무효화한다. 위치 버전/수정 이력 자체는 QR 발급으로 바꾸지 않는다. 동시 재발급은 계정 잠금 순서상 가장 마지막 grant만 유효하다.

256bit 난수 토큰 원문은 **최초201 응답에서만** 공개하며 서버에는 SHA-256 hash만 저장한다. URL은 QR_PUBLIC_ORIGIN/p#TOKEN이다. grantId는 공개 제어 식별자이며 비밀 토큰이 아니다. 만료는 발급 createdAt+86400000ms, 경계에서 거절(expiresAt<=now)한다. TTL을 클라이언트가 늘리거나 범위/redirect URL을 지정할 수 없다. 개발 상한은 계정 누적1000grant·발급/폐기60회/5분이다. 정리/보관 기한은 운영 정책과 별도다.

사용자+발급 key는 고유하고 location/version hash에 묶인다. 같은 key/body 재요청은409 QR_SECRET_ALREADY_ISSUED, 다른 body는409 IDEMPOTENCY_CONFLICT다. 저장된 영수증에서 원문 비밀을 재노출하지 않기 위한 **공통 성공 재생의 명시적 예외**다. 응답 유실/재발급 의도라면 사용자가 새 키로 재발급하여 이전 권한을 폐기한다. 이전 키 재요청은 새 grant를 폐기하지 않는다. 트랜잭션 실패 전에는 동일 키로 재시도할 수 있다. DELETE는 자원 경로에 묶인 멱등 폐기이며 빈 body만 받는다. 이미 폐기된 같은 자원은 같은 최소 응답을 반환한다.

## 링크·미리보기와 명시적 교환

GET/HEAD /p와 정적 /p/app.js, /p/style.css는 일반 화면/자산만 제공한다. DB에서 토큰을 조회하거나 소비하지 않고 쿠키를 발급하지 않는다. #fragment는 HTTP 요청 경로/query로 전송되지 않으며 자체 JS가 메모리에 읽고 즉시 history.replaceState로 제거한다. /p/{token}·query token·임의 redirect는 구현하지 않는다. 이전 /p/{token}는 미구현 설계였으며 이 계약으로 바꿨다.

JavaScript가 필요하다. 토큰 있는 페이지는 “이 휴대폰에서 열기” 버튼을 누를 때만 교환한다. 링크 미리보기/prefetch가 GET/HEAD를 수행해도 권한을 소모하지 않는다. 토큰을 URL 외부로 다시 쓰거나 localStorage/sessionStorage·분석 도구에 저장하지 않는다. 다만 전달한 링크/QR 자체와 브라우저·스캐너·확장프로그램의 동작까지 서버가 회수/통제하는 것은 아니다.

| 메서드·경로 (/api/v1) | 입력·자격 | 응답 |
|---|---|---|
| POST /qr/bootstrap | 정확한 Origin, 빈 JSON {} | 200 csrfToken, HttpOnly challenge cookie |
| POST /qr/exchanges | Origin·challenge cookie·X-CSRF-Token·Idempotency-Key, JSON {token} | 200 expiresAt/viewPath, HttpOnly phone cookie |
| GET /qr/location | QR 전용 phone cookie, query 없음 | 200 최소 위치/선택 층 평면도 |
| POST /qr/logout | Origin·challenge cookie·X-CSRF-Token·Idempotency-Key, 빈 JSON {} | 204 phone session 폐기·cookie 삭제 |

bootstrap은 기존 유효 형식 challenge를 재사용하거나256bit 난수를 만들고 쿠키를10분으로 설정한다. CSRF proof는 challenge의 domain-separated hash다. 교환 key는 ASCII 영숫자/밑줄/점/하이픈1~64자이며 브라우저 JS는 교환 시도 동안 같은 난수 key를 메모리에 유지한다. Origin은 설정과 정확히 일치해야 하고 Sec-Fetch-Site가 있으면 same-origin만 허용한다. 교환/로그아웃은 challenge+custom CSRF header까지 검사한다. CORS credential origin은 열지 않는다.

HTTP는 loopback 개발에서만 허용하며 쿠키 이름 parksical-qr-challenge/parksical-qr, HTTPS는 __Host-parksical-qr-challenge/__Host-parksical-qr를 사용한다. HTTPS에 Secure, 항상 HttpOnly·SameSite=Strict·Path=/·Domain 없음이다. Path=/는 __Host- 요건이며 계정 API는 이 쿠키로 인증하지 않는다. QR 쿠키를 계정 bearer로 보내도401이며 QR 조회로 원래 계정/사진/위치 목록에 접근할 수 없다.

교환은 같은 발급자 인증/설치 잠금→계정 위치 잠금→현재 grant/위치 재확인→소비/파생 session 커밋 순서다. grantId당 session 한 개(unique)이며 다른 브라우저 또는 다른 교환 key는409 QR_ALREADY_EXCHANGED다. 같은 토큰+challenge+key의 재시도는 같은 파생 자격을 HMAC-SHA256으로 재현해 응답 유실 쿠키를 복구하며 Idempotency-Replayed:true를 반환한다. DB에는 토큰·challenge·파생 자격 원문 없이 hash/binding만 남긴다. 저장 실패 시 소비/세션 모두 rollback한다.

파생 세션은 **원래 grant 만료 시각**을 그대로 사용한다. 늦게 교환했다고 새24시간을 주지 않는다. 새 탭/새로고침에서 #fragment가 없어도 같은 브라우저의 아직 유효한 쿠키로 재조회한다. 브라우저에는 QR 조회 쿠키 한 개를 쓰므로 다른 위치 QR을 교환하면 가장 최근 교환한 위치를 조회한다. 여러 위치의 동시 탭별 세션 선택 UI는 제공하지 않는다. challenge를 잃거나 JS 메모리의 교환 key/토큰을 잃은 상태에서 최초 응답까지 유실되면 새 QR 발급이 필요하다. phone logout은 계정 인증을 건드리지 않고 파생 session만 폐기한다. 소비된 토큰으로 이 세션을 되살릴 수 없다.

## 최소 화면·평면도와 접근 해제

휴대폰 응답은 source=SYNTHETIC/estimated=true·원래 confidence·userEdited·발생/만료 시각·주차장명·현재 선택 층/구역/면 label·선택 층의 가상 평면도만 포함한다. 계정/clientRecord/location/vehicle/installation ID, 위경도/주소, 사진/메모·원본 신호·전체 이력·다른 층을 제외한다. 층 미확정은 label/map=null이며 임의 층/면을 채우지 않는다. 화면에는 추정/낮은 신뢰도·사용자 수정·합성 표시를 유지한다.

평면도는 저장된 구조 버전의 구역 외곽·면 사각형·기둥과 선택 면 강조다. 실제 점유/빈자리·회전 궤적·주차 가능 인증이 아니다. 새 구조로 임의 재매핑하지 않는다. 위치의 사용자 수정은 같은 공유 자원의 현재 선택으로 후속 조회에 반영하지만 private note/photo는 여전히 제외한다. DOM은 textContent/createElement(SVG)로 구성하고 입력 HTML을 삽입하지 않는다.

매 교환/조회는 grant 만료/폐기·location.deletedAt/accessEpoch/소유자·phone 만료/폐기·발급 인증 session/차량 연결 상태를 다시 확인한다. 발급자 로그아웃·관리 폐기·refresh family 폐기/만료·차량 연결 해제/다른 사용자 연결 시 원 토큰과 파생 접근을410 QR_UNAVAILABLE로 거절한다. 발급자의15분 access-token 만료/정상 회전만으로24시간 grant를 끊지는 않는다. 원 grant/session 기한도 연장하지 않는다. 다른 본인 WEB 세션에서 발급했다면 차량 연결 해제만으로 그 별개 WEB 발급 세션을 폐기하지 않는다.

위치 삭제는 기존 S-09의 deleted/epoch 경계로 모든 파생 접근을 즉시 서버에서 차단한다. 발급/폐기/삭제와 교환/조회는 같은 잠금 순서를 사용한다. 이미 내려받은 화면/bytes를 원격 회수하지는 못한다. 화면은 재조회/복귀 시 현재 권한을 확인하고 visible 상태30초마다 갱신하고 표시된 만료 시각에 화면을 가리며 숨겨진 탭의 위치를 가린다. 만료/오류/닫기 시 이전 표시를 숨기고 안내한다.

페이지/API/오류는 Cache-Control:no-store·Referrer-Policy:no-referrer·nosniff·DENY·noindex/noarchive를 적용한다. CSP는 self script/style/connect만 허용하며 inline script·외부 자원·frame·base·form을 막는다. QR 경로에서는 외부 X-Request-Id도 로그에 반영하지 않고 서버 UUID를 쓴다. 로그는 method/status/requestId/시간만 허용한다. TLS 종단/리버스 프록시의 별도 본문 로그·스캐너 분석 도구는 운영 도입 시 검토 대상이다.

## 오류·검증·Wiki

400 DTO/query/key,401 소유자 인증,403 설정/Origin/CSRF,404 타인/없는 소유자 자원,409 version/발급 key/이미 소비/상한,410 QR_UNAVAILABLE,429 속도,500 저장 실패,503 의존성 오류다. 공개 교환/조회/로그아웃은 socket remoteAddress의 hash bucket으로300회/5분 제한하며 X-Forwarded-For를 신뢰하지 않는다. 프록시 뒤 운영 rate 설계는 별도다. unknown/expired/revoked 원인을 세부 반사하지 않는다. 429/503은 Retry-After/backoff, 커밋 전500은 같은 교환 key/브라우저로 재시도한다.

합성 HTTP의 첫 연동은 실제 계정 로그인→차량 연결→검색(목록의 대상 확인)→구조/차량 난이도→위치 생성/응답 유실 재전송→층/면 수정→QR 발급→미리보기→명시적 교환→최소 휴대폰 조회로 검증한다. jsdom31.0.1(개발 의존성)에서 실제로 제공된 HTML/JS와 실제 HTTP API를 연결해 명시적 버튼·fragment 제거·평면도 강조·HttpOnly cookie 재조회/닫기·폐기 후 화면 숨김·입력 HTML 비실행을 검증한다. DOM 테스트는 브라우저의 레이아웃/CSP/쿠키 엔진 검증을 대신하지 않는다. 이 작업 환경의 브라우저에서 로컬 서버 연결이 거절돼 실제 모바일 브라우저 시각 검증은 미수행이다.

실제 PostgreSQL에서 동시 소비·같은 브라우저 재시도·저장 강제 실패 rollback·만료/epoch/삭제·소유권·앱 재시작·발급 세션/연결 해제·로그 제외·미확정 map을 검사한다. 이를 실제 SDK/실차·운영 배포 완료로 보고하지 않는다.

OpenAPI0.9.0과 examples/manifest.json의 합성 예제가 정본이다. develop 머지 뒤 Wiki Home/QR 신규 가이드·Parked Locations 등의 후속 표현을 실제 게시하고 링크 확인 후 #11 완료로 처리한다. 이번 PR 단계에서 Wiki 준비 현황을 미리 완료로 바꾸지 않는다.

공식 근거(2026-11-15 확인): [MDN fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment), [MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie), [Referrer-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy), [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html). 기술적 방어와 D-07 제품 정책의 확정은 구분한다.
