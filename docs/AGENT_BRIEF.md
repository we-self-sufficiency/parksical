# Agent brief (1단계 공통)

Read first: `docs/PLAN.md` (decisions D1–D9), `docs/mockups/*.src.html` (screen mockups; readable HTML/inline CSS, 1280×800).

## Ground rules
- Package root: `automotive/src/main/java/com/parksical`. **Only edit files you own** (below). Shared contracts are frozen:
  `vehicle/VehicleState.kt`, `vehicle/VehicleSource.kt`, `domain/model/*`, `domain/engine/Engines.kt`, `data/Repositories.kt`,
  `data/MockParkingRepository.kt`, `navi/NaviGateway.kt`, `nav/*`, `ui/theme/Theme.kt`, `ui/common/ParkedGate.kt`,
  `AppContainer.kt`, `DriveCoordinator.kt`, `MainActivity.kt`, `AndroidManifest.xml`, `build.gradle.kts`, `libs.versions.toml`.
  If a contract truly blocks you, stop and report what you need instead of editing it.
- Keep the placeholder function signatures exactly (they are called from `nav/AppNavHost.kt`).
- You may add new files under your own package directory.
- Must pass: `./gradlew :automotive:assembleDebug :automotive:testDebugUnitTest`.
- Korean UI text. Kotlin, Jetpack Compose (Material3), coroutines. No new dependencies unless listed for your role.
- Commit your work on your branch when done (message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).

## Screen
Pleos Connect emulator, app runs in landscape 2-window area: **1682 × 1210 dp** (160 dpi). Mockups are 1280×800 — keep their
proportions/layout, scale with weights/fillMaxSize, don't hard-code 1280 px. Touch targets ≥ 48dp, body text ≥ 16sp.

## Safety rules (all UI)
- `LocalVehicleState.current` gives gear/speed/steering/brake/uxRestricted.
- Mode switch, 도전장 badge, confirm dialogs, reservation/payment: `onClick = parkedOnly { ... }` and render dimmed (alpha 0.4) when `!isParked`.
- While `uxRestricted` or not parked during a MAX run: minimal HUD only (stage no., remaining time, one text line), no touch, no animation.
- Results/stamps/practice reports only shown when parked; otherwise "정차하면 결과를 보여드려요".

## Vehicle facts (verified from SDK sources)
- Pleos Vehicle 2.3.2 (`ai.pleos.playground.vehicle.Vehicle(context)`; `initialize()` / `release()`):
  - `getSteeringWheel().registerSteeringWheelAngle(SteeringWheelAngleListener { onSteeringWheelAngleUpdated(angle: Float?) })`, `checkSteeringWheelAngleCapabilities(onComplete: (CapabilityConfig, AreaBounds<Float>) -> Unit, onFailed)`
  - `getBrake().registerBrakePedalStatus(BrakePedalStatusListener { onBrakePedalStatusUpdated(status: Boolean?) })`, `checkBrakePedalStatusCapabilities(onComplete: (CapabilityConfig) -> Unit, onFailed)`
  - `CapabilityConfig(accessType: AccessType)`; `AccessType.NONE` = unsupported.
  - CarInfo only gives VIN; Gear API is deprecated; Safety has no proximity warnings.
- AAOS (`useLibrary("android.car")`, permissions already in manifest): `Car.createCar(context)`, `CarPropertyManager`
  `VehiclePropertyIds.GEAR_SELECTION` (VehicleGear constants), `PERF_VEHICLE_SPEED` (m/s), `INFO_EXTERIOR_DIMENSIONS` (int[], mm; index 0 height, 1 length, 2 width ...);
  `CarUxRestrictionsManager` (`Car.CAR_UX_RESTRICTION_SERVICE`).
- Emulator is a `user` build: adb cannot inject properties. Virtual Console controls gear (P/R/N/D), brake (0–100%), steering (-540..540°). **No speed card** → debug speed slider (`DebugSpeedOverride`).
- NaviHelper 3.0.5 (`ai.pleos.playground.navi.helper.NaviHelper`): `initialize()`, `addListener(NaviHelperEventListener)`, `requestRoute(RouteInfo)`, `onDestinationArrived(DestinationArrivedInfo)`, `release()`. Sources jar: `~/.gradle/caches/modules-2/files-2.1/ai.pleos.playground/NaviHelper/3.0.5/`.

## Roles

### A — vehicle layer
Owns: `vehicle/PleosVehicleSource.kt`, `vehicle/DebugSpeedPanel.kt`, new files in `vehicle/`.
- Combine AAOS gear/speed + Pleos steering/brake + CarUxRestrictions into `VehicleState` (timestamp = `SystemClock.elapsedRealtime()`), emit on every change.
- Capabilities from Pleos `check*Capabilities` and AAOS property availability.
- `DebugSpeedOverride.kmh` non-null replaces speed. `DebugSpeedPanel`: small collapsible overlay (bottom-left), slider 0–20 km/h + "정지" button + 3 presets (0 / 5 / 12 km/h). Debug only (already gated by `BuildConfig.DEBUG`).
- `readDimensions()` from INFO_EXTERIOR_DIMENSIONS, null on any failure.
- Must never crash when a service/property is missing (log + capability false).

### B — domain engines (pure Kotlin + JUnit tests in `src/test`)
Owns: `domain/engine/Default*.kt`, new files in `domain/engine/`, tests.
- `DefaultDifficultyCalculator`: factors 1..5 → structure (entrance width, ramp type/turns, pillar density, bay width), review (= reviewDifficulty), driving (avg gear shifts + park seconds), age (build year; older = harder). base = 0.40/0.25/0.20/0.15. Car-size correction: COMPACT −1.0, MIDSIZE 0, LARGE_SEDAN +0.5 on narrow lots… tune so mock data matches the mockup: 다온빌딩 대형 세단 ★4.5 / 소형 ★3.5, 새솔 ★1.5, 누리 ★3.0, 한결 ★5.0. If `structure.maxSize` < size → 5.0. Round to 0.5, clamp 1..5. `sizeOf(dimensions)`: by length/width thresholds.
- `DefaultMissionJudge`: stages advance by distance (∫speed dt, `Stage.lengthM`); last stage ends when gear → P after having moved. Timer = `Dungeon.timeLimitSec` (CHALLENGE only; PRACTICE no limit). Abort if speed > 10 km/h for > 2 s (reason "저속 상한 초과로 미션이 중단됐어요"). Missions:
  - SPIRAL_NO_STOP: stop = speed < 0.5 km/h for ≥ 1 s while not P. 0 stops ★3, 1 ★2, 2+ ★1.
  - PILLAR_SMOOTH: sharp steer = |Δangle|/Δt > 180°/s; hard brake = decel > 8 km/h per s. 0 events ★3, 1 ★2, 2+ ★1. Max speed in summary.
  - REVERSE_PARK_ONE_SHOT: gear changes in stage ≤ 2 ★3, 3 ★2, 4+ ★1. CHALLENGE: +timeattack note in summary.
  - Skip a mission (stars 0, summary "이 차량에서 지원하지 않는 미션") when its input capability is false.
  - Record `TracePoint` every sample (or ≥ 200 ms apart) and `TraceEvent`s. HUD text = current mission title.
- `DefaultParkingSpotEstimator`: after arrival, distance by ∫speed; floors from cumulative |steering| integrated while moving on the ramp (one spiral turn ≈ sustained steering for a full circle — model: accumulated heading change = Σ(steeringDeg / 15 [steering ratio]) × distance / wheelbase(2.9 m) in radians → turns). floor index = turns / rampTurnsPerFloor. Zone = distance on that floor / laneLength × zones. Confidence lower when steering capability missing or values ambiguous. Tests with synthetic drives.

### C — general mode UI + NaviHelper
Owns: `ui/general/*`, `navi/PleosNaviGateway.kt`, new files in `ui/general/`, `navi/`.
- Naver Map SDK 3.24.1 (`com.naver.maps.map.MapView` in `AndroidView`, forward lifecycle). Client ID may be empty → map stays blank; the screen must still work (list panel + pins overlay is fine).
- Home (mockup 01): header (logo "P지컬", destination field showing `ParkingRepository.destinationName`, mode toggle 일반/P지컬 MAX → `onOpenMaxEntry(null)`), map with star pins (+ 도전장 badge on `challengeOpen` lots → `onOpenMaxEntry(lotId)`), legend, right panel "목적지 주변 N곳" sorted 쉬운 순/가까운 순 (straight-line distance), 제휴 할인 filter, 내 차 기준 난이도 (session.vehicleSize; if null show a size picker chip row).
- Detail (mockup 02): info, factor bars from `DifficultyCalculator`, 내 차 vs 소형차 stars, tags, 길안내 시작 (set `session.navigatingLotId`, `NaviGateway.requestRoute`), 더 쉬운 주차장 보기, 도전장 card when `challengeOpen`.
- Parked screen: "B2 · D구역 부근에 주차했어요", confidence ("추정 위치"), QR (generate with a tiny pure-Kotlin QR encoder or draw a placeholder pattern — no new dependency unless ZXing core is truly needed; ask), floor/zone correction pickers, "오늘 주차 어땠나요?" one-tap 쉬움/보통/어려움.
- `PleosNaviGateway`: wrap NaviHelper; on `onDestinationArrived` emit `Arrival`. Never crash if the navi service is missing.

### D — P지컬 MAX UI (8-bit pixel theme)
Owns: `ui/max/*`, new files in `ui/max/`.
- Pixel style from mockups 05–07 (`PixelColors`, crisp 1px-grid borders, Press Start 2P-like headings — Latin only; Korean uses default font bold). Original assets only, drawn with Canvas.
- `MaxEntryDialogs` (mockups 03, 04): step 1 "P지컬 MAX로 전환할까요?" (일반→MAX illustration, 취소/전환하기); step 2 reservation: date, `Dungeon.openSlots` 30-min chips (multi-select contiguous), fee = fee30MinWon × multiplier × slots, 도전/연습 toggle, 3 safety checkboxes all required, "결제하고 도전 시작" (mock pay) → `onConfirmed(Reservation)`. lotId null → pick among lots with a dungeon (only 다온). Everything `parkedOnly`.
- `StageScreen`: parked → stage map (floors B1–B3, stage nodes, mission list with rules, TIME, "P단 정차 중. 기어를 바꾸면…" banner, start button → `container.drive.startRun(...)`; run starts on start button, judging begins when gear leaves P). Driving / uxRestricted → minimal HUD (mockup 06): stage no., remaining time, hudText, "판정 중 · 정차하면 결과를 보여드려요", no animation. Reads `container.judge.status`.
- `ResultScreen` (mockup 07): latest CHALLENGE record from `session.records`; CLEAR!/중단, stars per stage, total, clear time, stamps = baseStamps + records count, `Title.of`, 기록 공유 (toast only), 일반 모드로.
- `PracticeReportScreen`: all PRACTICE records for lot as attempts; table (기어 전환, 소요 시간, 급조향 수), pixel trace map (distance × steering path; mark GEAR_CHANGE and SHARP_STEER events), "3회 연속 목표 달성 시 다음 난이도 추천 + 도전 가능 배지" logic (target: gearShifts ≤ 2 and no SHARP_STEER), buttons 다시 연습 / 도전 예약 / 일반 모드로.
