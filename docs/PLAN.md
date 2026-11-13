# P지컬 개발 계획 · 결정사항

- 작성일: 2026-11-13
- 근거 자료: `P지컬_접수양식.docx`(기획서), `고수의 주차장 화면 시안.html`(시안 7장), Pleos 문서(document.pleos.ai), Vehicle 2.3.2 · NaviHelper 3.0.5 소스 jar
- 프로젝트: `/Users/good/AndroidStudioProjects/parksical` (모듈 `:automotive`)

---

## 1. 결정사항

> 상태: ✅ 확정 / ⏳ 확인 대기

| # | 항목 | 기획서 | 실제 SDK 상황 | 결정 | 상태 |
|---|---|---|---|---|---|
| D1 | 기둥 숲 미션 판정 | Safety 경고 0회 | Safety에 근접·충돌 경고 없음 (에어백·벨트·오일·경고등만) | 저속(≤10km/h) 유지 + 급조향 없음 + 급제동 없음으로 대체 | ✅ |
| D2 | 내 차 차체 크기 | Vehicle SDK CarInfo | CarInfo는 VIN만 제공 | AAOS `INFO_EXTERIOR_DIMENSIONS`, `INFO_MAKE/MODEL` 사용. 값이 없으면 차급 수동 선택 | ✅ |
| D3 | 기어 상태 | AAOS `GEAR_SELECTION` | Vehicle SDK `Gear`는 deprecated | AAOS `GEAR_SELECTION`, `PERF_VEHICLE_SPEED` 사용 | ✅ |
| D4 | 차속 시뮬레이션 | Virtual Console로 시연 | Virtual Console에는 기어·브레이크·조향 카드만 있고 차속 카드 없음 | ~~adb 주입~~ → Pleos 에뮬레이터가 `user` 빌드라 `inject-vhal-event`가 SecurityException으로 거부됨(2026-11-13 확인). **디버그 빌드 전용 차속 오버라이드 슬라이더**로 변경: 기어·조향·브레이크는 Virtual Console 실제 값, 차속만 디버그 슬라이더로 덮어씀. 릴리스 빌드에는 없음 | ✅ |
| D5 | 지도 | 지도 기반 검색 | 일반 앱용 지도 SDK 없음 | **네이버 지도 SDK** 사용. 목업 주차장을 핀으로 표시하고, 길안내는 NaviHelper `requestRoute`. NCP Client ID는 사용자가 발급해 `local.properties`에 넣음. AAOS·arm64 에뮬레이터 동작은 0단계에서 확인 | ✅ |
| D6 | 앱 이름 | 접수양식: P지컬 / P지컬 MAX | 시안: 고수의 주차장 / 고수 모드 | P지컬 / P지컬 MAX로 통일 | ✅ |
| D7 | UI 툴킷 | – | 현재 AppCompat만 있음 | Jetpack Compose 도입 (네이버 지도는 `AndroidView`로 감싸서 사용) | ✅ |
| D8 | 화면 방향 | portrait 1창 + landscape 2창 | 시안은 1280×800 | MVP는 landscape(2창) 고정 | ✅ |
| D9 | 버전 관리 | – | 프로젝트가 git 저장소 아님 | 원격 `we-self-sufficiency/parksical-client`(비어 있었음)에 현재 프로젝트를 초기 커밋으로 `develop` push. `develop`에서 `feature/mvp` 브랜치를 만들어 단계별 커밋 | ✅ |

### 사용할 SDK (Maven 저장소 확인 완료)

- `ai.pleos.playground:Vehicle:2.3.2`: 조향각 콜백(`registerSteeringWheelAngle`), 브레이크 페달 콜백(`registerBrakePedalStatus`), Capabilities 확인 API. 권한 `pleos.car.permission.CAR_DRIVE`
- `ai.pleos.playground:NaviHelper:3.0.5`: `requestRoute`, `onDestinationArrived`, `onRouteStateInfo`. 권한 `pleos.car.permission.NAVI_ROUTE`
- `ai.pleos.playground:FusedLocation:1.1.3`: 필요 시. 권한 `pleos.car.permission.FUSED_LOCATION`
- `android.car` (`useLibrary`): `CarPropertyManager`(GEAR_SELECTION, PERF_VEHICLE_SPEED, INFO_EXTERIOR_DIMENSIONS), `CarUxRestrictionsManager`
- TextToSpeech 3.3.1: MVP 범위 밖

---

## 2. MVP 범위 (기획서 "PT 시연 준비" 단계)

### 일반 모드
1. **지도 홈**: 목업 주차장 4곳, 난이도 범례(쉬움 ★1–2 / 보통 ★3 / 어려움 ★4–5), 쉬운 순·가까운 순 정렬, 제휴 할인 필터, 도전장 배지
2. **주차장 상세**: 내 차 기준 난이도(구조 40 / 리뷰 25 / 주행 20 / 연식 15, 차체 크기 보정), 난이도 태그, 요금·운영·준공, 길안내 시작, 더 쉬운 주차장 보기
3. **주차 위치 자동 저장**: 도착 감지부터 차속 적분으로 이동 거리 계산, 조향 누적으로 나선 회전 수(층) 추정. P단 체결 시 "B2 · D구역 부근" + QR + 추정 신뢰도 표시, 위치 수정 가능

### P지컬 MAX
4. **더블 컨펌**: 1차 모드 전환, 2차 예약(30분 단위)·선결제(목업)·안전 수칙 동의
5. **스테이지 맵**: 던전 1곳(다온빌딩), 미션 3개
   - 나선 경사로 무정지 (차속, 브레이크)
   - 기둥 숲 통과 (D1 판정)
   - 한 번에 후진 주차 (기어 전환 2회 이내) + 타임어택
6. **주행 중 최소 HUD**: CarUxRestrictions + 기어 상태로 전환, 터치·애니메이션 차단. 10km/h를 넘으면 미션 자동 중단
7. **결과**: P단 체결 시 판정, 별, 도장, 칭호(초보→숙련→고수→달인)
8. **운전 연습 리플레이 리포트**: 회차별 기어 전환 횟수·조향 기록·소요 시간 비교, 전후진 전환 지점·급조향 구간을 픽셀 맵에 표시

### 공통 안전 원칙
- 모드 전환·도전장·컨펌·결제는 P단에서만 활성화. 주행 중에는 흐리게 표시하고, 누르면 "정차 후 이용할 수 있어요" 안내만 표시
- 결과·연출은 P단에서만 노출
- 미지원 차량 속성은 Capabilities 확인 후 해당 미션 자동 숨김

### 이번에 만들지 않는 것
블루링크 푸시, 실제 결제, 랭킹·쿠폰 서버, 리뷰 작성, portrait 1창 레이아웃, 음성(TTS·Gleo). 서버 데이터는 모두 앱 내부 목업으로 대체.

---

## 3. 기술 구조

```
VehicleSource (interface)
 ├─ PleosVehicleSource : Vehicle SDK + CarPropertyManager + CarUxRestrictionsManager
 └─ FakeVehicleSource  : 디버그 패널 / 주행 시나리오 재생
        │
        ▼
VehicleState Flow (gear, speedKmh, steeringDeg, brakePressed, uxRestricted)
        │
        ├─ domain (순수 Kotlin, 단위 테스트)
        │    ├─ DifficultyCalculator   : 난이도 지수 + 차체 보정
        │    ├─ MissionJudge           : 스테이지·미션 판정, 자동 중단
        │    ├─ PracticeRecorder       : 회차별 리플레이 기록
        │    └─ ParkingSpotEstimator   : 층·구역 추정
        ├─ data : 목업 주차장 / 던전 JSON, 기록 저장(로컬)
        └─ ui (Compose) : 일반 모드 테마 / 8비트 픽셀 테마
```

---

## 4. 진행 방식 (Opus 오케스트레이션 + Sonnet 병렬 구현)

| 단계 | 담당 | 내용 |
|---|---|---|
| 0 | Opus | Compose 설정, 매니페스트 권한, 내비게이션 뼈대, 테마, 모듈 간 인터페이스·데이터 모델 확정, 시안을 `docs/`로 복사 |
| 1 | Sonnet × 4 병렬 | **A** 차량 데이터 계층 · **B** 판정 엔진 + 테스트 · **C** 일반 모드 UI + NaviHelper · **D** MAX UI(픽셀 테마) |
| 2 | Opus | 각 에이전트 변경 리뷰, 통합, 빌드·테스트, 에뮬레이터 + Virtual Console로 시나리오 A·B·C 확인 |

0단계에서 인터페이스를 먼저 고정해 1단계 에이전트끼리 파일이 겹치지 않게 합니다.

---

## 5. 사용자 할 일
- NCP Maps Client ID 발급(패키지 `com.parksical`) 후 프로젝트 `local.properties`에 `NAVER_MAP_CLIENT_ID=...` 추가. 키가 없어도 빌드는 되고 지도만 비어 보이게 구성

## 6. 미확인 사항
- 에뮬레이터에서 NaviHelper가 실제로 동작하는지
- 에뮬레이터에서 `INFO_EXTERIOR_DIMENSIONS`가 값을 반환하는지
- 기획서 PDF·시안 PDF 원본은 열지 못함(PDF 도구 없음). 같은 내용의 docx와 시안 HTML로 분석
