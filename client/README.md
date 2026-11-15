# P지컬 (Parksical)

> 어려운 주차장은 피하고, 원하면 정복한다.
> 내 차 기준 주차 난이도와 주차 위치를 알려주는 주차장 안내 앱 **P지컬**과, 차량 데이터로 주차 실력을 판정하는 도전·운전 연습 모드 **P지컬 MAX**를 갖춘 Pleos Connect 차량용 앱입니다.

## 주요 기능

**일반 모드 (P지컬)**
- 목적지 주변 주차장 지도·목록. 쉬운 순과 가까운 순으로 정렬하고, 제휴 할인 주차장만 볼 수 있습니다.
- 내 차 크기(`INFO_EXTERIOR_DIMENSIONS`)를 기준으로 서버가 계산한 주차 난이도(★1–5)와 요소별 점수를 보여줍니다.
- NaviHelper로 길안내를 시작합니다. 도착 후 P단을 체결하면 주차 위치를 추정해 저장하고 서버와 동기화합니다.

**P지컬 MAX**
- 도전장이 있는 주차장에서 2단계 확인을 거쳐 도전·연습 시간을 예약하고 결제합니다(샌드박스).
- 스테이지 3개를 차량 신호로 판정합니다.

  | 스테이지 | 판정 |
  |---|---|
  | 경사로 무정지 통과 | 정지 없이 통과하면 ★3, 정지하면(P단 포함) 중단 |
  | 부드러운 조향 | 급조향 1회당 ★1 감점 |
  | 한 번에 후진 주차 | 후진(R) 진입이 정확히 1회일 때만 ★3 |

- 안전 제한: 10km/h를 넘으면 즉시 중단합니다. 에어백 전개, 또는 P가 아닌 상태에서 문·후드·트렁크가 열려도 중단합니다. 주행 중에는 최소 HUD만 표시합니다.
- 결과·도장·연습 리포트를 보여주고, 런 결과를 서버에 제출합니다.

## 실행 방법

### 1. 필요 도구
- Android Studio (AGP 8.4.1, Kotlin 2.0.21), JDK 17
- Pleos Connect 에뮬레이터(아래 [에뮬레이터 버전](#개발에-사용한-pleos-connect-에뮬레이터-버전과-화면-규격) 참고)
- 서버 데이터를 보려면 이 저장소의 [`server/`](../server/)를 실행해야 합니다(Node.js 24, PostgreSQL). 서버 없이도 [목업 모드](#목업-모드)로 앱 전체를 사용할 수 있습니다.

### 2. `local.properties` 설정
`local.properties`는 git에 올리지 않습니다. `client/`에 직접 만듭니다(Android Studio에서는 `client/`를 프로젝트로 엽니다).

```properties
sdk.dir=/path/to/Android/sdk

# 카카오맵 네이티브 앱 키. 비어 있으면 지도 자리에 안내 문구가 표시됩니다.
KAKAO_NATIVE_APP_KEY=

# 서버 주소. 기본값은 에뮬레이터에서 호스트 PC를 가리키는 http://10.0.2.2:3000/api/v1 입니다.
PARKSICAL_API_BASE_URL=http://10.0.2.2:3000/api/v1

# (debug 전용) 서버의 DEV_AUTH_SECRET. 개발 로그인으로 차량을 자동 연결합니다.
PARKSICAL_DEV_AUTH_KEY=
```

- 카카오맵은 앱 서명 키의 키 해시를 카카오 개발자 콘솔에 등록해야 표시됩니다(debug와 release는 서명 키가 다릅니다).
- debug 빌드는 `10.0.2.2`, `localhost`, `127.0.0.1`에만 `http://`를 허용합니다. 그 밖의 주소와 release 빌드는 `https://`만 사용할 수 있습니다.

### 3. 빌드·설치
`client/`에서 실행합니다.

```sh
./gradlew :automotive:installDebug        # 에뮬레이터에 debug 설치
./gradlew :automotive:testDebugUnitTest   # 단위 테스트
./gradlew :automotive:assembleRelease     # release APK (서명 설정이 있을 때만 서명됨)
```

release 서명은 `local.properties`의 `RELEASE_STORE_FILE`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`로 설정합니다. 이 값이 없으면 서명되지 않은 APK가 만들어집니다.

### 4. 서버 실행 (로컬)
[`server/`](../server/)의 안내에 따라 `server/.env`를 준비하고 DB 마이그레이션·빌드를 마친 뒤, `server/`에서 앱이 사용하는 개발 기능을 켜고 실행합니다.

```sh
DEV_AUTH_ENABLED=true DEV_MISSIONS_ENABLED=true DEV_LOCATIONS_ENABLED=true \
DEV_RESERVATIONS_ENABLED=true DEV_PAYMENTS_ENABLED=true PAYMENT_PROVIDER=SANDBOX \
PAYMENT_WEBHOOK_SECRET=<32자 이상 임의 값> node dist/main.js
```

- MAX를 보려면 미션 구조(경사로·구역·주차면)가 있는 합성 주차장(`npm run seed:synthetic`)과, 그 주차장의 예약 정책(`PUT /admin/lots/{lotId}/reservation-policy`)이 필요합니다.
- 도전장은 예약 정책이 있고 도전 예약을 받는 주차장에만 표시됩니다.
### 목업 모드
서버에 연결할 수 없거나 로그인이 불가능하면, 앱이 자동으로 목업 데이터로 동작합니다.

- 화면 상단에 **"목업 데이터 · 서버 연결 안 됨"** 배지와 **서버 다시 연결** 버튼이 표시됩니다. 홈, MAX 스테이지, 예약, 결과 화면에 모두 나옵니다.
- 목업 주차장 4곳(테헤란로 주변 실제 좌표, 길안내 가능)과 MAX 던전 1곳(다온빌딩, 스테이지 3개)을 제공합니다.
- 예약은 앱 안에서 처리합니다. 다가오는 30분 슬롯 7개, 요금 = 30분 요금 × 배수, 즉시 결제 완료.
- 런 판정·안전 중단은 서버 모드와 같습니다. 결과는 서버에 제출하지 않고 "목업 · 서버 제출 안 함"으로 표시합니다. 주차 위치는 기기에만 저장합니다.
- 서버가 응답했는데 주변 주차장이 0곳이면 목업으로 바꾸지 않습니다. 서버 다시 연결에 성공하면 서버 데이터로 돌아갑니다.
- 서버·목업 데이터는 한 화면에 섞이지 않습니다. MAX 런 도중에는 모드가 바뀌지 않습니다.

## 테스트 환경 및 필요한 설정

- **에뮬레이터:** Pleos Connect v2.1.0 (Android 14 / API 34), 가로 화면.
- **차량 신호 조작:** 에뮬레이터의 Virtual Console을 씁니다.
  1. `adb forward tcp:8088 tcp:8088`를 실행합니다.
  2. 브라우저에서 `http://127.0.0.1:8088`을 엽니다.
  3. 기어(P/R/N/D), 차속, 조향, 문·트렁크·프렁크를 조작합니다.
  - 콘솔 브라우저 탭이 열려 있어야 입력이 반영됩니다.
- **서버:** 로컬 parksical-server(위 4번). 앱 기본 주소 `http://10.0.2.2:3000/api/v1`.
- **서버 없이 테스트:** 서버를 켜지 않고 앱을 실행하면 [목업 모드](#목업-모드)로 동작합니다. release APK도 같습니다.
- **로그인:** debug 빌드는 `PARKSICAL_DEV_AUTH_KEY`로 개발 로그인과 차량 연결을 자동으로 진행합니다. release 빌드에는 개발 키가 들어가지 않습니다.
- **권한:** `CAR_POWERTRAIN`, `CAR_SPEED`, `CAR_INFO`, Pleos `CAR_DRIVE`, `CAR_INFO`, `CAR_SAFETY`, `CAR_DOORS`, `NAVI_ROUTE`, `NAVI_ROUTE_SEARCH`(모두 normal), `FOREGROUND_SERVICE_SPECIAL_USE`.
  - 차속(`CAR_SPEED`)은 실행 중 허용이 필요한 권한입니다. 처음 실행하면 "위치 정보에 액세스하도록 허용" 창이 뜨고(AAOS는 이 권한을 위치 그룹으로 묶습니다), 허용해야 MAX 스테이지를 판정할 수 있습니다.
  - MAX 런 동안에는 포그라운드 서비스를 켜서, R 기어에서 후방 카메라가 앱을 덮어도 판정이 끊기지 않게 합니다.
- **사용 SDK:** Pleos Vehicle SDK 2.3.2, NaviHelper 3.0.5, Kakao Map SDK 2.15.2 (arm64-v8a·armeabi-v7a만 지원).
- **알려진 제한:**
  - 에뮬레이터는 에어백 전개(SEAT_AIRBAGS_DEPLOYED)를 지원하지 않아, 해당 중단은 단위 테스트로만 검증했습니다.
  - 미션 결과의 `uxState`는 현재 `ALLOWED`로 보고합니다([#4](https://github.com/we-self-sufficiency/parksical-client/issues/4)).
  - 랭킹·구독·쿠폰·일반 모드 사전결제는 아직 연동하지 않았습니다. 기록 공유 버튼은 비활성화되어 있습니다.

## 개발에 사용한 Pleos Connect 에뮬레이터 버전과 화면 규격

| 항목 | 값 |
|---|---|
| 시스템 이미지 | Pleos Connect v2.1.0 APIs (`RELEASE.release_connect_v2.1.0`) |
| Android / API | Android 14 / API 34, arm64-v8a |
| Android Emulator | 37.2.13 |
| 화면 해상도 | 2560 × 1440 px, 160 dpi |
| 앱 표시 영역 | 1682 × 1210 (가로, 멀티윈도우 앱 영역) |

## APK

- GitHub Release: [v1.0.0](https://github.com/we-self-sufficiency/parksical-server/releases/tag/v1.0.0) — `parksical-v1.0.0.apk` (release 빌드, 버전 1.0.0)
- release APK는 서버 주소가 설정되지 않아 [목업 모드](#목업-모드)로 동작합니다.
