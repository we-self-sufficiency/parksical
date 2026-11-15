# P지컬

**내 차에 맞는 주차장 탐색과 주차 위치 저장, 차량 신호를 활용한 주차 도전·연습을 제공하는 Pleos Connect 차량 앱입니다.**

일반 모드에서는 주차장과 차량 기준 난이도를 조회하고 주차 위치를 저장합니다. **P지컬 MAX**에서는 주차 미션, 도전 결과, 연습 리포트를 제공합니다. 현재 주차장·예약·결제 등의 서버 연동은 합성 데이터와 개발용 샌드박스를 기준으로 합니다. 서버에 연결할 수 없으면 앱이 자동으로 [목업 모드](#목업-모드)로 동작하므로, 서버 없이도 주요 기능을 확인할 수 있습니다.

## 실행 방법

### 1. 저장소 준비

```sh
git clone --branch develop https://github.com/we-self-sufficiency/parksical-server.git
cd parksical-server
```

Android Studio에서는 저장소 안의 **`client/` 폴더**를 프로젝트로 엽니다. 서버 명령은 `server/`, 앱 빌드 명령은 `client/`에서 실행합니다.

### 2. 서버 실행

Node.js **24.22.1**, PostgreSQL **18**, Docker Compose를 준비합니다. 다음 예시는 DB만 Docker로 실행하고 API는 호스트에서 실행하는 로컬 개발 방식입니다.

```sh
cd server
cp .env.example .env
```

`server/.env`의 DB 암호와 `DATABASE_URL`, `COMPOSE_DATABASE_URL`을 환경에 맞게 수정하고 다음 설정을 추가합니다. 개발 키는 임의로 생성한 **32자 이상의 값**을 사용합니다.

```dotenv
NODE_ENV=development
DEV_AUTH_ENABLED=true
DEV_AUTH_SECRET=<로컬에서 생성한 32자 이상의 개발 키>
ALLOW_SYNTHETIC_SEED=true
```

```sh
docker compose up -d --wait db
npm ci
npm run generate
npm run migrate:deploy
npm run build
npm run seed:synthetic
npm start
```

호스트에서 준비 상태를 확인합니다.

```sh
curl --fail http://127.0.0.1:3000/api/v1/health/ready
```

기본 Compose의 API 컨테이너는 `production`으로 실행되어 개발 인증을 허용하지 않습니다. 위의 앱 연동 시연은 호스트 API를 사용합니다. 자세한 절차는 [서버 개발 안내](server/docs/server-development.md)를 참고하세요.

### 3. 앱 설정 및 실행

Android SDK 경로는 Android Studio에서 설정하고, `client/local.properties`에 다음 값을 추가합니다.

```properties
PARKSICAL_API_BASE_URL=http://10.0.2.2:3000/api/v1
PARKSICAL_DEV_AUTH_KEY=<서버 DEV_AUTH_SECRET과 동일한 값>
KAKAO_NATIVE_APP_KEY=<카카오 네이티브 앱 키>
```

- `10.0.2.2`는 에뮬레이터에서 개발 PC에 접근하는 주소입니다. 서버를 먼저 실행한 뒤 앱을 실행합니다.
- 서버와 연동해 시연할 때는 앱의 **debug** 빌드를 사용합니다. 개발 인증 키는 debug 빌드에만 포함되며, 설정을 바꾼 뒤에는 앱을 다시 빌드합니다. release 빌드는 개발 인증 키가 없고 `http://` 접속을 허용하지 않으므로 [목업 모드](#목업-모드)로 동작합니다.
- 카카오맵을 사용하려면 Kakao Developers에 패키지 `com.parksical`과 서명 키 해시를 등록하고 지도 사용을 설정합니다. 키가 없으면 지도 영역에 안내 문구가 표시됩니다.
- `.env`와 `local.properties`는 로컬 설정 파일이며 커밋하지 않습니다.

Pleos Connect 에뮬레이터를 실행하고 Android Studio에서 `automotive` 모듈의 debug 빌드를 실행하거나, `client/`에서 다음 명령을 사용합니다.

```sh
./gradlew :automotive:assembleDebug
adb install -r automotive/build/outputs/apk/debug/automotive-debug.apk
```

Windows PowerShell에서는 `cp` 대신 `Copy-Item`, `./gradlew` 대신 `.\gradlew.bat`를 사용할 수 있습니다. `adb`는 Android SDK의 Platform-Tools에 포함되어 있으며, 여러 기기가 연결되어 있으면 `adb -s <기기 ID>`로 대상을 지정합니다.

## 테스트 환경 및 필요한 설정

### 빌드 환경

| 항목 | 버전·설정 |
| --- | --- |
| JDK | 17 |
| 개발 시 사용한 Android SDK / Compile SDK | API 35 — 개발자 제공 정보 |
| 현재 저장소의 Android 모듈 설정 | `compileSdk = 34`, `targetSdk = 34`, `minSdk = 28` |
| Gradle Wrapper / Android Gradle Plugin | 8.6 / 8.4.1 |
| Kotlin | 2.0.21 |
| Pleos Vehicle SDK | 2.3.2 |
| NaviHelper | 3.0.5 |
| 카카오맵 SDK | 2.15.2 |
| 서버 | Node.js 24.22.1, NestJS, Prisma, PostgreSQL 18 |

개발자가 제공한 Compile SDK 버전과 현재 [`client/automotive/build.gradle.kts`](client/automotive/build.gradle.kts)의 값은 다릅니다. 현재 체크아웃을 빌드할 때는 **Android SDK Platform 34**가 필요합니다. 지도 SDK의 네이티브 라이브러리를 지원하는 ARM 계열 에뮬레이터를 사용합니다.

### 기능별 준비 사항

| 테스트 대상 | 필요한 설정·데이터 |
| --- | --- |
| 주차장 검색·난이도 | 개발 인증, 서버 DB 마이그레이션, 합성 주차장 데이터 |
| 개인 주차 위치 저장 | `DEV_LOCATIONS_ENABLED=true` — [위치 연동 안내](server/docs/parked-locations.md) |
| QR 조회 | 위치 기능과 `DEV_QR_ENABLED=true`, `QR_PUBLIC_ORIGIN` — [QR 안내](server/docs/location-qr.md) |
| MAX 미션·결과 | `DEV_MISSIONS_ENABLED=true`, 미션 카탈로그 — [미션 안내](server/docs/missions.md) |
| MAX 예약·도전장 | `DEV_RESERVATIONS_ENABLED=true`, 관리자 API로 등록한 예약 정책 — [예약 안내](server/docs/reservations.md) |
| 샌드박스 결제 | `DEV_PAYMENTS_ENABLED=true`, `PAYMENT_PROVIDER=SANDBOX`, 별도 `PAYMENT_WEBHOOK_SECRET` — [결제 안내](server/docs/payments.md) |

기능 플래그는 기본적으로 꺼져 있습니다. 필요한 기능만 개발 환경에서 활성화하고 서버를 재시작합니다. 구독·랭킹·쿠폰 등 추가 기능의 설정은 [서버 문서](server/README.md)를 참고하세요.

**현재 연동 시 유의할 점:** 기본 합성 주차장 시드의 좌표는 `(0, 0)`이고, 앱의 검색 중심은 `(37.5006, 127.0364)` 반경 1km로 고정되어 있습니다. 기본 시드만 넣으면 앱 목록이 비어 있을 수 있습니다. 시연하려면 [주차장 관리 API](server/docs/parking-lots.md)로 검색 범위 안에 합성 데이터를 준비해야 합니다. 서버가 응답했는데 검색 범위에 주차장이 없으면 목업으로 바꾸지 않고 빈 목록을 보여 줍니다. 예약 정책이 없는 주차장은 도전장과 예약 화면이 제공되지 않습니다.

### 목업 모드

서버에 연결할 수 없거나 로그인이 불가능하면 앱이 자동으로 목업 데이터로 동작합니다.

- 화면 상단에 **"목업 데이터 · 서버 연결 안 됨"** 배지와 **서버 다시 연결** 버튼이 표시됩니다(홈, MAX 스테이지, 예약, 결과 화면).
- 목업 주차장 4곳(검색 중심 주변 실제 좌표, 길안내 가능)과 MAX 던전 1곳(다온빌딩, 스테이지 3개)을 제공합니다.
- 예약은 앱 안에서 처리합니다. 다가오는 30분 슬롯 7개, 요금 = 30분 요금 × 배수, 즉시 결제 완료.
- 런 판정과 안전 중단은 서버 모드와 같습니다. 결과는 서버에 제출하지 않고 "목업 · 서버 제출 안 함"으로 표시하며, 주차 위치는 기기에만 저장합니다.
- 서버 다시 연결에 성공하면 서버 데이터로 돌아갑니다. 두 데이터는 한 화면에 섞이지 않고, MAX 런 도중에는 모드가 바뀌지 않습니다.

### 테스트 명령

클라이언트 단위 테스트와 debug APK 빌드:

```sh
cd client
./gradlew :automotive:testDebugUnitTest :automotive:assembleDebug
```

서버 lint·타입 검사·단위 테스트·빌드:

```sh
cd server
npm run verify
```

서버 통합 테스트는 별도 PostgreSQL 테스트 DB와 셸 환경변수 `TEST_DATABASE_URL`이 필요합니다. DB 이름은 `_test`로 끝나야 하며 앱 DB와 분리합니다. `npm run test:integration`은 `.env`의 변수를 자동으로 읽지 않습니다. 설정 후 `server/`에서 `npm run test:integration`을 실행합니다. API 계약 검사는 Python 3.12에서 아래와 같이 실행합니다.

```sh
pip install -r scripts/contract-validation-requirements.txt
python scripts/check_contract.py
```

## Pleos Connect 에뮬레이터 버전과 화면 규격

| 항목 | 개발 환경 |
| --- | --- |
| Pleos Connect Emulator | **2.1.0** |
| 에뮬레이터 Android API | **34** (Android 14, arm64-v8a) |
| 시스템 이미지 | Pleos Connect v2.1.0 APIs (`RELEASE.release_connect_v2.1.0`) |
| Android Emulator | 37.2.13 |
| 에뮬레이터 전체 디스플레이 | 2560 × 1440 px |
| 화면 방향·창 구성 | 가로 모드, 2창 |
| 앱 표시 영역 | **1682 × 1210 dp** |
| 화면 밀도 | **160 dpi** |
| 화면 시안 원본 | 1280 × 800 — 앱 표시 영역과 별도 |

에뮬레이터 버전과 Android API는 개발자 제공 정보이며, 앱 표시 영역과 밀도는 [개발 문서](client/docs/AGENT_BRIEF.md)에 기록된 기준입니다. 위 크기는 에뮬레이터 전체 디스플레이가 아닌 **2창 모드의 앱 영역**입니다.

기어·차속·조향·문/트렁크는 에뮬레이터의 **Virtual Console**에서 조작합니다. `adb forward tcp:8088 tcp:8088`을 실행한 뒤 브라우저에서 `http://127.0.0.1:8088`을 엽니다. 콘솔 브라우저 탭이 열려 있어야 입력이 반영됩니다. debug 빌드에는 보조용 속도 패널(DBG)도 있으며, release 빌드에는 포함되지 않습니다.

앱을 처음 실행하면 차속 권한(`CAR_SPEED`) 허용 창이 **"위치 정보에 액세스하도록 허용"** 문구로 표시됩니다(AAOS는 이 권한을 위치 그룹으로 묶습니다). 허용해야 MAX 스테이지를 판정할 수 있습니다.

## APK 파일 위치

- **release APK:** [GitHub Release v1.0.0](https://github.com/we-self-sufficiency/parksical-server/releases/tag/v1.0.0)의 `parksical-v1.0.0.apk` (버전 1.0.0). 서버 주소와 개발 인증 키가 없어 [목업 모드](#목업-모드)로 동작합니다.
- **로컬 빌드:** `client/`에서 빌드하면 아래 경로에 생성됩니다.

```text
client/automotive/build/outputs/apk/debug/automotive-debug.apk      # ./gradlew :automotive:assembleDebug
client/automotive/build/outputs/apk/release/automotive-release.apk  # ./gradlew :automotive:assembleRelease
```

release 서명은 `client/local.properties`의 `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`로 설정합니다. 값이 없으면 서명되지 않은 APK가 만들어집니다. 카카오맵은 release 서명 키의 키 해시도 Kakao Developers에 등록해야 표시됩니다.

## 저장소 구성

```text
client/   Android 차량 앱, Gradle 설정, 테스트, 화면 설계 문서
server/   NestJS API, Prisma 스키마·마이그레이션, 테스트, Docker 설정
.github/  서버 자동 검증 워크플로
```

- [서버 개발·실행 안내](server/docs/server-development.md)
- [API 계약](server/docs/api-contract.md)
- [클라이언트 개발 계획·연동 기록](client/docs/PLAN.md)

클라이언트는 [원본 develop](https://github.com/we-self-sufficiency/parksical-client/tree/bb30806ed74bd39c3310913585fed3540f42883d)을 Git subtree로 가져왔으며, 기존 37개 커밋의 ID·작성자·날짜를 보존합니다. 가져오기 전 파일 경로는 원본 저장소 기준이며, 전체 이력은 `git log --graph --oneline develop`에서 확인할 수 있습니다.
