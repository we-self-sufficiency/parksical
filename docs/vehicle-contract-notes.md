# 차량 계약 근거·확인 요청

2026-11-15 KST 확인 · S-11 [#12](https://github.com/we-self-sufficiency/parksical-server/issues/12). S-01의 초기 메모를 이번 조사로 보완한다. 미션별 판단·구간·중단 제안은 [MAX 적용 가능성](max-feasibility.md), 제품 결정 상태는 [DECISIONS.md](DECISIONS.md)를 따른다.

**문서에 API 이름이 있음, 설치된 SDK에서 호출 가능함, 대상 차량이 지원함, 운영에 허용됨은 서로 다른 확인이다.** 이번에는 공식 공개 자료를 조사했다. 앱 담당자의 답변·AAR/차량 로그·심사 답변은 받지 않았으며 외부 문의도 발송하지 않았다.

## 근거와 버전

다음은 모두 공식 자료이며 확인일은 위 날짜다. 웹 문서는 바뀔 수 있으므로 후속 구현 시 실제 앱 의존성과 다시 대조한다. 표의 ID를 아래 신호 표와 미션 문서에서 인용한다.

| ID | 공식 자료 | 이번에 확인한 범위 |
|---|---|---|
| P1 | [앱 카테고리](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/app-category) | 마켓 서비스 분류와 Android manifest 분류는 별개. 모빌리티 예시가 MAX 게임 동작의 허가는 아님 |
| P2 | [주의 분산 심사](https://document.pleos.ai/en/docs/pleos-only/distribute/app-review-guide/review-driver-distraction-elements) | 게임 기능을 포함한 앱은 주행 중 사용 제한·정지 시 사용, 주행 시작 시 일시정지/화면 숨김. 작은 HUD로 예외가 생긴다고 볼 근거 없음 |
| P3 | [주행 제한 개발](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/driving-restriction-development-guide) | CarUxRestrictionsManager의 변경 통지와 ActiveRestrictions를 기능별 적용. DO 선언만으로 모든 기능이 허용되지 않음 |
| P4 | [지역별 주행 제한](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/driving-restiction-policy) | 지역/플랫폼에 따라 제한이 다름. QR 로그인도 제한 항목에 있음. 우리 위치 공유 QR의 구체적 분류는 미확인 |
| P5 | [앱 구조·화면·백그라운드](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/app-structure-screen-model) | 화면에서 사라진 앱이 백그라운드에 남을 수 있음. 이 설명이 게임 판정의 지속 허용/콜백 보장은 아님 |
| P6 | [API 호환성과 가용성](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/api-compatibility-availability) | 차종별 capability와 AAOS 속성 접근 확인 필요. 모델명만으로 지원 단정 금지 |
| P7 | [SDK API 정책](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/pleos-connect-sdk-api) | 차속·기어 등 표준 기능은 AAOS 우선 경로. Pleos 전용 메서드 추측 금지 |
| V1 | [Vehicle SDK 소개](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/intro) | 문서 기준 Vehicle SDK **2.3.2**, Vehicle Service **2.3.21**. 차량 내부 IPC와 비동기 capability/get/callback 구분 |
| V2 | [SDK 릴리스](https://document.pleos.ai/en/docs/pleos-only/release-note/sdk-release-note) | **2026-10-19**, Vehicle SDK **2.3.1**, NaviHelper **3.0.5**, FusedLocation **1.1.2**. VehicleSpeedListener/onSpeedUpdated 제거, capability overload 변경 |
| V3 | [에뮬레이터 릴리스](https://document.pleos.ai/en/docs/pleos-only/release-note/emulator-release-note) | **2026-10-19 / 2.1.0**. 실제 설치 이미지·실차 지원의 증거는 아님 |
| V4 | [Virtual Console](https://document.pleos.ai/en/docs/pleos-only/app-test-guide/virtual-console-guide) | GearSelection·브레이크·조향·Telltales 모의 제어. 콘솔의 입력 범위/단위를 SDK 반환 계약으로 옮기지 않음 |
| V5 | [권한 가이드](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-permission) | 개별 API @RequiresPermission/PleosPermission과 실제 승인·grant 확인 필요 |
| V6 | [오류 가이드](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle-error-code) | 미지원/권한/연결/주행 제한/빈 결과 등을 구분. 모든 Exception이 VehicleException인 것은 아님 |
| V7 | [SteeringWheel 참조](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/steering-wheel/entry) | 조향각 capability/get/register/unregister 이름 확인 |
| V8 | [Brake 참조](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/brake/entry) | BrakePedalStatus capability/get/register/unregister 이름 확인 |
| V9 | [Safety 참조](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/Vehicle/vehicle/ai.pleos.playground.vehicle.api/safety/entry) | Telltales capability/get/register/unregister 이름 확인. 주차 장애물 거리/충돌 이벤트는 확인하지 못함 |
| V10 | [차량 SDK 샘플](https://document.pleos.ai/en/docs/pleos-only/tutorial/vehicle-sdk-sample-app) | 샘플 manifest는 실제 사용하는 SDK/API에 맞춰 대조할 자료이며 앱 전체 권한을 복사할 근거가 아님 |
| A1 | [AAOS VehiclePropertyIds](https://developer.android.com/reference/android/car/VehiclePropertyIds) | PERF_VEHICLE_SPEED(m/s, 부호 있음), GEAR_SELECTION과 CURRENT_GEAR 차이. API가 존재해도 대상 OS/차량/권한 확인 필요 |

V1과 V2의 버전이 일치하지 않는다. 따라서 “최신 SDK는 2.3.2로 검증됨”이라고 정리하지 않는다. 앱의 Gradle 좌표/고정 버전·AAR 해시·Service build·AAOS API level·에뮬레이터 이미지 버전이 확보될 때 적용 기준을 확정한다. V5의 도메인별 예시 권한과 V10의 `READ_CAR_STEERING` 같은 샘플 권한 표기도 개별 API의 실제 annotation과 대조해야 한다. `CAR_DRIVE` 예시 하나로 모든 조향/브레이크 API 접근을 보장하지 않는다.

이전 `/en/api-reference/.../Vehicle/intro` 대신 읽을 수 있는 V1의 공식 개발 가이드 경로를 사용한다. Pleos Fleet의 클라우드 Vehicle Data API는 차량 내부 SDK와 다른 제품이므로 이름이 비슷한 필드의 단위·권한을 가져오지 않는다.

## 신호별 확인 상태

`이름 확인`은 문서 탐색에 메서드가 있다는 뜻이다. 참조 페이지의 상세 시그니처/annotation/반환 모델을 이번 공개 본문에서 충분히 확보하지 못한 경우 타입·단위·Hz를 채우지 않는다. `실차 미확인`은 미지원과 다르며, 대상 차량에서 명시적 미지원 결과를 받으면 그 조합에 한해 미지원으로 기록한다.

| 신호 | 확인한 경로·심볼 | 미확인 계약 / 실차 상태 | 사용 조건·대체 |
|---|---|---|---|
| 실제 차속 | P7/A1: AAOS `PERF_VEHICLE_SPEED`, m/s; `Car.PERMISSION_SPEED` | 대상 API level/지원·grant·실제 빈도/오래된 값 경계 미확인 | 절댓값×3.6으로 km/h 비교. 표시용 차속이나 크루즈 목표 차속으로 대체 금지. 없으면 차속 의존 판정 비활성 |
| 과거 Pleos 차속 콜백 | V2: `VehicleSpeedListener`, `onSpeedUpdated` | **문서상 제거됨**(2.3.1 릴리스) | 신규 계약/어댑터의 기반으로 사용하지 않음 |
| 선택 기어 | P7/A1: AAOS `GEAR_SELECTION` | 값 집합/config·권한·grant·변경 전달/누락 미확인 | 선택 P/R/D는 이 속성 후보로 검증. 변속기의 `CURRENT_GEAR`를 동일시하지 않음. 없으면 기어 의존 판정 비활성 |
| 핸들 조향각 | V7: `checkSteeringWheelAngleCapabilities`, `getCurrentSteeringWheelAngle`, `registerSteeringWheelAngle`, `unregisterSteeringWheelAngle` | 이름 확인 / 단위·부호·중립·범위·timestamp·권한·주기·실차 모두 미확인 | V4 콘솔은 -540~540도/1도 단계지만 반환값 보증 아님. AAOS 바퀴 조향각과도 동일시 금지. 품질 미확인 시 smoothness 판정 금지 |
| 브레이크 페달 | V8: `checkBrakePedalStatusCapabilities`, `getCurrentBrakePedalStatus`, `registerBrakePedalStatus`, `unregisterBrakePedalStatus` | 이름 확인 / bool·상태·압력 등의 타입/의미·권한·단위·주기·실차 미확인 | 콘솔 0~100% 입력을 API percent로 단정 금지. 페달 해제는 이동 증명이 아니고 누름은 정지 증명이 아님 |
| 일반 경고등 | V9: `checkTelltalesCapabilities`, `getTelltalesInfo`, `registerTelltales`, `unregisterTelltales` | 이름 확인 / 코드·상태·심각도·빈도·권한·실차 미확인 | V4의 ABS/TPMS/벨트/주차브레이크 등 표시와 주차 접근 경고 구별. Blink나 재통지를 새 위험 1회로 세지 않음 |
| 주차/장애물/충돌 경고 | V9/V4에서 MAX에 필요한 정확한 API·이벤트 의미 확인 못함 | **미확인**. 전체 플랫폼에 기능이 없다는 단정 아님 | Telltales로 대체 금지. 장애물/무접촉 판정은 비활성, 공급자 명세와 실차 증거 필요 |
| 주행 UX 제한 | P3/P4: `CarUxRestrictionsManager`, `CarUxRestrictions`, `ActiveRestrictions` | 대상 차량·지역별 초기값/전이·앱 분류 승인 미확인 | 앱이 실제 제한을 적용. P단·차속 0만으로 허용 추정 금지. 제한/알 수 없음은 판정 시작 금지 제안 |
| 층·구간·주차 완료 | 주차장 version/floor/zone/space는 우리 서버 데이터. V1/P6만으로 실시간 구간 관측은 확보되지 않음 | 지하 위치 정확도/진입·이탈 근거/오탐·P단 시점 모두 미확인 | 수동 선택은 사용자의 주장으로 보관할 후보, 자동 입증으로 승격 금지. 조향각 360도 누적으로 층 계산 금지 |
| 내비·위치 | [NaviHelper](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/intro), [FusedLocation](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/FusedLocation/intro), P6/V2 | 지원 차량·실제 권한·정확도·목적지/경로 종료 의미·실차 미확인 | 도착/경로 종료/위치 콜백을 특정 주차면 완료나 경사로 출구의 증거로 단정 금지. 수동 일반 주차장 선택과 미션 자격을 분리 |

V6의 오류를 앱은 구별해 보존해야 한다. 예: `ERROR_NOT_SUPPORTED_PROPERTY`/`ERROR_NOT_SUPPORTED_AREA`, `ERROR_SECURITY_PERMISSION`, `ERROR_SERVICE_CONNECTION_FAILURE`, `ERROR_DRIVING_RESTRICTED`, `ERROR_EMPTY_RESULT`. 앱 내부 품질 모델은 미지원·권한 없음·일시 실패·결측·오래된 값·미확인을 구분하되, 이것은 신규 서버 enum이나 SDK 오류 타입을 정의한 것이 아니다. 결측을 0도/0km/h/경고 0회/정상으로 변환하지 않는다.

## 앱 담당자에게 받을 증거 — 미발송·미응답

아래 표의 각 행에 차량/버전/날짜가 붙은 답변이 필요하다. 현재 전부 미확인이다. 단순히 “SDK에서 지원”이라는 답변으로 완료 처리하지 않는다.

| 증거 ID | 질문 / 받을 자료 | 통과 기준 |
|---|---|---|
| E1 환경 | 대상 모델·연식·지역, AAOS API level, 앱 build/Gradle 좌표·AAR SHA-256, Vehicle Service build, emulator 이미지 | V1/V2 불일치 해소, 재현 가능한 고정 조합 |
| E2 정확한 계약 | 각 신호의 공식 URL/심볼·전체 시그니처·반환 모델·@RequiresPermission·area·단위·부호/중립·enum/config | 샘플 예시와 실제 설치 아티팩트의 차이 설명; 공개/privileged 권한과 배포 승인 범위 구분 |
| E3 capability/권한 | 초기화·capability 결과/범위·manifest 선언·런타임 grant/거절/철회·미지원/일시 오류의 구별 | 차량별 실제 읽기/구독 성공과 실패를 합성 시험/비식별 요약으로 재현 |
| E4 품질 | 요청/관측 Hz, 간격 분포·최대 공백, timestamp 시간원/단위, 초기값·중복·역순·멈춤·재연결 | 앱이 측정 주기/오래된 값 한계와 판정 가능한 연속 구간을 입증. 요청 Hz만 제시하면 미통과 |
| E5 의미 | 브레이크 반환 의미, 기어 선택/실제 기어, 핸들각/바퀴각, Telltales 코드·Blink·위험 종류와 장애물 경고 출처 | 주차 접근/접촉/위험 분류를 정확한 이벤트로 설명. 경고 없음=충돌 없음으로 대체하지 않음 |
| E6 구간 | 버전 고정 장소/층/구역/경로의 진입·이탈 관측, P단/정지/목적 주차면 확인, 수동 선택과 신뢰도 | 정상·오탐·센서 상실·지하·구조 변경 fixture와 미확정 처리 제공 |
| E7 수명/UX | 제한 초기값/변경·백그라운드·종료·재시작·오프라인·사용자/설치 연결 변경 | 로컬 제한이 서버 응답과 무관하게 적용되고 시도/로컬 큐가 다른 사용자와 섞이지 않음 |
| E8 최소 업로드 | 원본 대신 제공 가능한 결과·단위·룰 버전·품질 요약·중단 이유·시도 ID | D-02 전에는 SYNTHETIC만. 결과 주장의 검증 한계와 중복/응답 유실/재전송 fixture 명시 |

일반 API 연동의 세션/설치/사용자 분리·오프라인 eventId/sequence·늦은 위치 수정/QR 제약도 [수신](vehicle-ingestion.md), [위치](parked-locations.md), [QR](location-qr.md) 계약과 대조한다. 현재 capability DTO는 우리 서버의 자기 신고 모델이며 SDK API 시그니처나 차량 인증서가 아니다.
