# P지컬 서버 — 개발 작업지시서

> 대상: `we-self-sufficiency/parksical-server` · 기준 브랜치: `develop` · 작성일: 2026-11-13 (KST)
>
> 이 문서는 차량 앱 전체 구현 지시서를 서버 전용으로 재작성한 기준이다. 기존 문서의 Android 기술 스택·모듈 구조·목업 서버 구조와 T-01~T-17 작업 번호는 이 저장소에 적용하지 않는다.

## 0. 역할과 우선순위

이 저장소에서의 역할은 P지컬 서비스 백엔드 개발자다. 실제 차량 앱이 호출할 API와 영속 데이터, 서버의 비즈니스 규칙을 구현한다.

1. 명시적인 사용자 결정, 이 문서의 확정 사항, 각 GitHub 이슈의 수용 기준을 따른다. 권장안이나 미결정 사항을 확정 정책으로 바꾸지 않는다.
2. 한 작업 브랜치와 PR은 원칙적으로 S-xx 작업 하나를 다룬다. 구현 전 해당 이슈와 선행 작업의 현재 상태를 확인한다.
3. SDK 메서드·권한·지원 신호와 외부 연동 기능을 추측하지 않는다. 미확인 내용은 출처와 함께 기록하고 해당 기능만 분리한다.
4. 문서와 이슈가 충돌하면 영향과 권장안을 기록한다. 현재 지시와 확인된 범위로 계속할 수 있는 작업은 진행하고, 실제 제품 정책을 바꾸는 부분만 결정 대상으로 남긴다.
5. 현재 단계는 문서와 백로그 준비다. 작업 표의 기능이 이미 구현됐다고 간주하지 않는다.

총괄 이슈: [#1 P지컬 서버 구현](https://github.com/we-self-sufficiency/parksical-server/issues/1)

## 1. 제품 범위와 책임

P지컬 일반 모드는 주차장 검색·난이도·사전결제·주차 위치 저장을 제공한다. MAX는 차량 데이터에서 얻은 도전·연습 결과, 예약, 랭킹, 구독과 쿠폰을 다룬다.

### 1-1. 차량 앱과 서버의 경계

| 영역 | 차량 앱 | 이 서버 |
|---|---|---|
| SDK | Pleos Vehicle SDK·AAOS Car API·NaviHelper 초기화, 구독, 해제 | SDK에 의존하지 않는 HTTPS API와 데이터 계약 |
| 차량 지원 여부 | 실제 권한·capability·신호 품질 확인 | 앱이 보고한 지원 정보와 계약 버전 검증 |
| 안전 | CarUxRestrictions 기반 화면 제한, 즉시 중단, 통신 단절 대응 | 중단 결과 저장, 기록 인정 정책과 설정 제공 |
| 미션 | 로컬 신호 처리·판정, 진행 상태 복원 | 미션·룰 버전 제공, 결과 정합성 검증, 기록 관리 |
| 주차 위치 | 로컬 추정·저장·수정, 오프라인 동작 | 계정별 동기화, 수정 이력, 사진·메모, QR 웹 |
| 주차장 | 지도 표시, 차량 크기 제공, 내비 목적지 설정 | 검색, 상세, 구조 데이터, 난이도와 요금 |
| 금전·보상 | 결제 절차와 결과 표시 | 가격 확정, 결제 검증, 예약·구독·쿠폰·월간 정산 |

차량 SDK는 차량 내부 Vehicle Service와 통신한다. 차량 앱이 이 서버와 HTTPS로 통신하며, 서버가 SDK 콜백을 직접 받거나 차량 장치를 제어하는 API는 이 범위에 없다.

주행 제한·중단·주차 위치의 로컬 저장은 서버 응답과 연결 상태에 의존하지 않는다. Android UI, Compose, DrivingGate, Room, Foreground Service와 에뮬레이터 설치는 차량 앱 저장소의 작업이다. 휴대폰용 주차 위치 웹은 이 서버 범위에 포함한다.

### 1-2. 개발 순서

1. S-01~S-04: 계약, 서버 기반, 인증, 차량 앱 데이터 수신.
2. S-05~S-10: 주차장·난이도·리뷰·주차 위치·QR의 실제 연동.
3. S-11~S-15: MAX 적용 가능성 검증 후 미션·연습·예약·랭킹.
4. S-16~S-18: 결제·구독·정산·쿠폰. 일반 사전결제가 우선이면 S-16은 해당 선행 작업 완료 후 앞당긴다.

S-11의 문서·SDK 조사는 S-01 이후 먼저 진행할 수 있다. 제품 출시 범위는 D-04에서 확정하며, 위 순서는 구현 순서다.

## 2. 확정 기술과 서버 구조

| 항목 | 선택 |
|---|---|
| 언어 | TypeScript, strict 모드 |
| API 프레임워크 | NestJS |
| 데이터베이스 | PostgreSQL |
| ORM·스키마 변경 | Prisma, 검토 가능한 migration 파일 |
| API | HTTPS REST, `/api/v1`, OpenAPI |
| 실행·배포 기본 형태 | Docker, 개발용 Docker Compose |
| 초기 형태 | 기능별 모듈로 나눈 단일 서버 |
| 테스트 | NestJS 기본 테스트 도구, 실제 PostgreSQL을 쓰는 필요한 통합 테스트 |

Node.js와 각 패키지의 정확한 버전은 S-02에서 공식 지원 범위를 확인해 호환되는 버전으로 고정하고 lockfile과 실행 환경에 남긴다. 서버는 Android SDK·Gradle·Kotlin에 의존하지 않는다.

목표 디렉터리는 아래 책임을 따른다. S-02에서 실제 골격을 만들며 빈 모듈을 미리 전부 생성할 필요는 없다.

| 경로 | 책임 |
|---|---|
| `src/main.ts`, `src/app.module.ts` | 부트스트랩·모듈 조립 |
| `src/common/`, `src/config/` | 입력 검증·오류·권한·설정·로그 |
| `src/modules/auth/`, `vehicle-sessions/` | 사용자·차량 연결, 수신 이벤트 |
| `src/modules/lots/`, `difficulty/`, `reviews/` | 주차장·구조·검색·점수 |
| `src/modules/parked-locations/` | 개인 위치·첨부·QR 웹 |
| `src/modules/missions/`, `runs/`, `practice/`, `rankings/` | MAX 설정과 기록 |
| `src/modules/reservations/`, `payments/`, `subscriptions/`, `coupons/` | 거래·이용 권한·보상 |
| `src/integrations/` | 결제·파일 저장·알림 제공자 어댑터 |
| `prisma/` | schema, migrations, 구분 가능한 개발 시드 |
| `test/`, `fixtures/` | 통합·계약 테스트, 합성 차량 시나리오 |
| `docs/` | 계약·결정·SDK 근거·실행 및 운영 절차 |

도메인 계산은 HTTP·DB·SDK에 의존하지 않는 함수/서비스로 분리한다. 필요가 입증되기 전에는 마이크로서비스·별도 메시지 브로커·상시 차량 스트리밍 인프라를 추가하지 않는다.

## 3. 확정 사항, 개발 기본값, 결정 필요 사항

### 3-1. 이미 확정된 사항

- 독립된 실제 서비스 서버이며, 전체가 목업인 Ktor 서버로 구현하지 않는다.
- TypeScript + NestJS + PostgreSQL + Prisma를 사용한다.
- 개발 통합 브랜치는 `develop`이다.
- 주차 위치는 추정치이며 사용자 수정과 본인 소유권을 지원한다.
- 공개 랭킹은 명시적 동의가 있어야 한다.
- 실제 블루링크 연동은 협의가 필요하다. 제공자 인터페이스와 개발용 대체 구현을 준비한다.

### 3-2. 결정 전 적용할 개발 기본값

- 고빈도 차량 원본 신호·전체 이동 궤적을 운영 API나 로그로 수집하지 않는다. 앱이 계산한 결과의 계약부터 정의한다.
- 개인 주차 위치는 인증한 소유자에게만 제공한다. QR은 별도 최소 범위 접근 권한으로 취급한다.
- 개인 운전 요약은 익명 데이터라고 부르지 않는다. D-02 승인 전 합성 데이터로 계약과 검증을 개발하고 실제 계정 연결 운전 기록 수집은 켜지 않는다.
- 개발·시뮬레이션 기록은 표시를 유지하며 운영 랭킹과 실제 금전 보상에서 제외한다. 단순한 클라이언트의 source 선언을 실차 증명으로 쓰지 않는다.
- 결제·구독·쿠폰은 테스트 제공자로 검증할 수 있게 하되, 운영 실제 청구·무료 주차 보상은 D-05 승인 전 활성화하지 않는다.
- 외부 제공자 장애와 미지원 신호를 정상적인 실패/미지원 상태로 표현한다. 실패를 성공처럼 반환하지 않는다.

### 3-3. 결정 목록

| ID | 필요한 결정 | 권장안·결정 전 경계 | 영향 작업 |
|---|---|---|---|
| D-01 | 로그인 제공자, 차량·휴대폰 연결 방식 | 사용자 계정에 차량 앱 세션 연결. 개발 인증은 운영에서 차단 | S-01, S-03 |
| D-02 | 전송·보관 데이터, 동의·삭제, 기록 인정 기준 | 원본은 로컬, 최소 개인 결과와 익명 집계를 구분. 실제 수집은 정책 확정 후 | S-01, S-04, S-08, S-12, S-15 |
| D-03 | 주차장 데이터 출처, 첫 검증 대상, 구조도·사진 이용 권한 | 검증 가능한 실제 주차장부터. 합성 시드는 별도 표시 | S-05~S-10 |
| D-04 | 첫 출시 범위, MAX 분류·주행 중 허용 동작, 도전 운영 장소 | 일반 기능 우선. 게임 HUD의 주행 중 허용을 가정하지 않음 | S-11~S-15 |
| D-05 | 결제사·실결제 시점·취소/환불, 구독 자격, 쿠폰 비용·한도·기간 | 샌드박스 우선. 무제한 무료 주차 조건을 확정 구현하지 않음 | S-14~S-18 |
| D-06 | 운영 서버·도메인·파일 저장소·접속 및 백업 환경 | Docker 기반으로 준비하고 실제 운영 전 확정 | S-02, S-09, S-10 |
| D-07 | QR 사용 의미: 한 번 교환한 휴대폰에서 재조회할 수 있는지 | 24시간 이내 1회 교환 후 제한된 세션으로 재조회하는 안. 확정 전 계약에 잠정 표시 | S-01, S-10 |

결정 사항은 S-01이 만드는 `docs/DECISIONS.md`에 날짜·근거·상태·영향 이슈와 함께 기록한다. 가중치·동점 기준 같은 가역적인 구현 기본값은 담당자가 제안·기록하고, 금전·개인정보·대외 제공 조건만 사용자 결정과 구분한다. 결정을 기다리는 동안 무관한 기능까지 멈추지 않는다.

## 4. 데이터와 API 계약

### 4-1. 수신 데이터 원칙

- OpenAPI와 JSON 예제로 요청·응답·오류·인증·페이지 처리·재시도 계약을 제공한다. S-01에서 기준을 만들고 각 기능 PR에서 함께 갱신한다.
- API 스키마 버전, 앱 버전, 세션 식별자, 이벤트 식별자, 발생 시각·수신 시각, 세션 내 순서를 구분한다. 사용자 식별은 인증 컨텍스트에서 얻으며 요청 body의 userId를 신뢰하지 않는다.
- 서버 소유 세션이 앱 설치/기기 연결과 어떤 관계인지 명시한다. 공유 차량에서 사용자 변경·로그아웃·연결 해제 시 이전 계정 정보가 노출되지 않아야 한다.
- 시간은 UTC 시각으로 저장하고 월 경계는 `Asia/Seoul`로 계산한다. 짧은 구간의 지속시간은 앱의 단조 증가 시간 기준으로 계산한 값과 품질 정보를 구분한다.
- 단위는 명세에 고정한다. 차체 크기 mm, 거리 m, 속도 km/h, 조향각 degree를 사용할 경우 경계에서만 변환한다. SDK 원본 단위를 추측하지 않는다.
- 미지원, 권한 없음, 일시 오류, 값 없음, 오래된 값을 구분한다. 0/false/정상값으로 대체하지 않는다.
- 같은 이벤트나 요청의 재전송은 같은 결과를 돌려주며 중복 저장·과금·보상을 만들지 않는다. 동일 키에 다른 payload가 오면 충돌로 처리한다.
- 오프라인 뒤 지연 수신된 이벤트를 현재 차량 상태로 사용하지 않는다. 최대 허용 지연, 순서 역전, 세션 종료 뒤 수신 처리 규칙을 계약으로 정한다.
- 비정상 크기·빈도·범위·잘못된 참조를 제한하고, source/지원 신호/점수의 클라이언트 주장을 검증된 사실과 구분한다.

### 4-2. API 영역

아래는 경로 설계의 출발점이며, 구체적인 DTO와 미결정 동작은 S-01과 각 기능 이슈에서 확정한다. 표에 있다고 이미 제공되는 API는 아니다.

| 영역 | 대표 경로·동작 |
|---|---|
| 인증·연결 | `/api/v1/auth/*`, `/api/v1/me`, 차량 연결·해제·세션 폐기 |
| 차량 앱 수신 | `/api/v1/vehicle-sessions`, `/api/v1/vehicle-sessions/{id}/events` — 정규화한 비즈니스 이벤트·결과, 고빈도 원본 스트리밍 아님 |
| 주차장 | `GET /api/v1/lots`, `GET /api/v1/lots/{id}`, 권한 있는 관리 경로 |
| 난이도·리뷰 | 차량 크기별 계산 결과·근거, `/api/v1/reviews` |
| 개인 주차 위치 | `/api/v1/parked-locations`, 본인 조회·수정·삭제, 첨부 관리 |
| QR | 위치별 토큰 발급·폐기와 `/p/{token}` 휴대폰 웹/교환 흐름 |
| 미션·기록·연습 | `/api/v1/missions`, `/api/v1/runs`, 본인 결과·연습 리포트 |
| 예약 | `/api/v1/reservations`, 슬롯 조회, 취소·만료 |
| 랭킹 | `GET /api/v1/rankings/{lotId}?month=YYYY-MM`, 본인 공개 동의 관리 |
| 결제·구독 | `/api/v1/payments`, 제공자 webhook, `/api/v1/subscriptions`, 상태·해지 |
| 쿠폰·정산 | `/api/v1/coupons/me`, 쿠폰 적용·해제·사용, 내부 정산 작업 |

이벤트 저장과 기능 변경을 이중 적용하지 않도록, 이벤트 수신과 개별 자원 API의 정본 경로를 S-01에서 정한다. 결제 webhook 인증은 사용자 로그인과 분리한다. 운영 정산을 무인증 `POST /admin/settle-month`로 공개하지 않는다.

## 5. 기능별 서버 요구사항

### 5-1. 주차장·구조·검색 (F-01, F-02, F-05)

- 기본 위치·요금·운영시간·준공연도·공영/민영·제휴·사진·태그와 데이터 출처를 저장한다.
- 층, 구역 다각형, 입구, 경사로 연결과 방향은 버전 있는 구조 데이터로 관리한다. 모르는 값을 임의 생성하지 않는다.
- 반경/지도 범위, 거리·난이도 정렬, 필터, 페이지 처리와 좌표 검증을 제공한다. 가까움은 어떤 거리 기준인지 응답/계약에 명시한다.
- 내비 연동용 좌표·목적지 식별 정보를 제공한다. 실제 목적지 설정·도착 이벤트 수신은 차량 앱이 수행한다.
- 개발 시드는 원 문서의 가상 주차장 4곳과 연습용 1곳을 합성 데이터로 구분한다. 가상의 위치·요금·별점을 실제 검증 정보로 게시하지 않는다.
- 도전 자격은 별점만으로 정하지 않는다. 허용된 운영 장소·시간·미션·차량 조건을 별도로 검증한다. 기계식 주차장을 자동으로 도전 장소로 등록하지 않는다.

### 5-2. 난이도·리뷰·집계 (F-03, F-07)

- 초기 기획 가중치는 구조 40%, 리뷰 25%, 주행 집계 20%, 건물 연식 15%이며 설정과 버전을 둔다.
- 기준 차체는 전장 4,800mm, 전폭 1,850mm다. 차체 보정식, 계수, 결측 요소 처리, 별점 반올림을 문서화한다.
- 결과는 1.0~5.0, 0.5 단위로 표시한다. 차체 미확인은 기본 기준으로 구분하고, 차체 크기가 커질 때 보정 난이도가 낮아지지 않는지 검증한다.
- 요소 점수 미확인을 0점으로 채우지 않는다. 표본 수·결측 처리·산출 버전을 응답한다. 검증된 관측이 없는 경우 합성 점수와 실제 집계를 구분한다.
- 리뷰의 값 범위·중복 방지·수정 정책과 집계 반영을 명시한다. 사용자 연결 개인 기록과 비식별 집계의 저장 경계를 지킨다.

### 5-3. 개인 주차 위치·QR (F-06)

- lotId, floor/zone(미확정 허용), confidence, 거리, 원래 추정값, 사용자 수정값, 발생 시각·서버 수신 시각을 구분한다.
- 로컬에서 먼저 저장한 위치를 재전송해도 같은 기록으로 동기화한다. 오래된 업로드가 최신 위치를 덮어쓰지 않으며 충돌 정책을 제공한다.
- 층·구역이 해당 주차장 구조에 존재하는지 검증한다. 구조 데이터가 없거나 추정 근거가 부족하면 미확정/낮은 신뢰도를 표현한다.
- 사진과 메모는 소유권, 파일 크기·유형·접근 제어·삭제를 적용한다. 공개 URL이나 로그로 개인 위치와 사진이 새지 않게 한다.
- QR은 예측하기 어려운 범위 제한 토큰으로 발급하고 원문을 로그에 남기지 않는다. 서버에는 검증 가능한 해시 등 필요한 형태만 저장한다.
- 기본 만료 시간은 원 기획의 24시간이며, 정확한 1회 사용 의미는 D-07에 따른다. 만료·폐기·삭제는 웹 접근을 무효화한다.
- QR 링크의 GET/미리보기 요청만으로 1회 권한을 소모하지 않는다. 토큰 교환은 명시적인 동작과 원자적 처리로 구현한다.
- 휴대폰 웹은 주차장·층·구역·추정 표시·허용된 평면도 등 최소 정보만 제공한다. 민감한 계정 정보·전체 주행 이력을 노출하지 않는다.
- "조향각 360° 누적 = 경사로 한 바퀴"를 실차의 층 추정 공식으로 구현하지 않는다. 로컬 추정 알고리즘과 실차 정확성 검증은 차량 앱 작업이며 서버는 계약과 구조 데이터로 지원한다.

### 5-4. MAX·미션·연습·랭킹 (F-08, F-10~F-13, F-16)

- S-11에서 공식 정책과 실제 지원 신호를 조사한다. 게임 기능의 주행 중 HUD나 계속 실행을 허용된 기능으로 단정하지 않는다.
- Safety 경고등과 장애물·주차 센서 경고를 같은 것으로 처리하지 않는다. 실제 이벤트 종류·단위·빈도·권한을 앱 담당자와 확인한다.
- 앱은 지원 신호에 맞는 미션을 고르고 서버는 필요한 신호와 룰·구조 버전을 제공한다. 차종명만으로 지원 여부를 판정하지 않는다.
- NO_STOP_RAMP, ONE_SHOT_REVERSE, PILLAR_FOREST, SMOOTH_STEERING, TIME_ATTACK은 기획 미션 후보다. 지원·장소·정책 검증이 끝난 미션만 운영에 활성화한다.
- 구간 시작·종료, P단 완료의 의미, 신호 품질 저하, 앱 재시작, 예약 만료와 중단 결과를 명시한다. 원본 없이 검증할 수 없는 사실을 검증 완료로 표시하지 않는다.
- 원 기획의 10km/h·1초, 3초 내 경고 2회는 검토할 초기 설정값이다. 즉시 중단 문구와의 충돌을 S-11에서 정리하고, 대기 중인 설정을 서버의 안전 보장으로 표시하지 않는다.
- 별점·기어 전환·급조향·시간·중단 근거의 허용 범위와 완료 상태 전이를 검증한다. 점수는 빠른 속도를 보상하지 않는 방향으로 규칙을 확정한다.
- 연습은 랭킹과 분리한다. 연속 3회 성공 판정은 중복·지연 업로드·동일 시각의 순서 기준을 고정하고, [성공, 성공, 실패, 성공, 성공, 성공]에서 6회차에 자격을 부여한다.
- 도장과 칭호는 같은 기록으로 중복 지급하지 않는다. 리포트용 집계와 개인 궤적은 구분하며, 원본 궤적을 자동 수집하지 않는다.
- 월간 랭킹은 공개 동의, 기록 인정 수준, 동일 룰 간 비교, 개인 최고 기록·동점 규칙을 명시한다. 동의 철회와 삭제가 공개 응답에 반영돼야 한다.

### 5-5. 예약·결제·구독 (F-04, F-09, F-15)

- 예약은 최소 30분, 30분 단위로 검증한다. 운영 장소의 허용 시간, 수용량, 차량·모드 자격을 검사하고 동시 요청의 초과 예약을 DB 트랜잭션으로 막는다.
- 초기 기획의 요금 배수는 도전 1.5~2.0, 연습 1.2~1.5다. 원화 정수 금액, 반올림, 요금 버전과 견적 유효기간을 정한다. 요청 body의 최종 가격을 신뢰하지 않는다.
- 안전 수칙 동의의 버전과 시각을 기록한다. 화면 활성화·주행 제한 확인은 차량 앱이 담당하며 서버 입력을 물리적 정차 증명으로 간주하지 않는다.
- 결제 전 슬롯 점유 만료, 결제 후 예약 확정, 실패·취소·환불·노쇼 정책을 명시한다. 예약과 결제는 각각의 상태를 유지하며 잘못된 상태 전이를 거부한다.
- 외부 결제는 어댑터로 분리하고 샌드박스로 검증한다. 운영 승인 전 실제 청구를 활성화하지 않는다.
- 제공자 서명·서버 조회 검증, 거래 식별자, 금액·통화·주문 일치, 중복/순서가 바뀐 webhook, 환불 재시도를 처리한다. 카드 원문 정보는 저장하지 않는다.
- 구독 초기 기획가는 월 4,900원이며 설정값이다. 갱신·만료·해지·환불과 MAX 이용 범위, 정산 시 자격 판정 시점은 D-05에 기록한다.

### 5-6. 월간 정산·쿠폰·알림 (F-14)

- 월 경계는 매월 1일 00:00 `Asia/Seoul` 기준으로 이전 월을 확정한다. 원본 기록을 삭제하는 리셋 대신 월별 확정 결과와 처리 이력을 유지한다.
- 기획 조건은 주차장별 월간 1위, 기준점수 이상, 패스 자격, 차량 데이터 기반으로 인정된 도전 기록이다. 연습·시뮬레이션·인정되지 않은 기록은 실제 지급에서 제외한다.
- 1인당 원천 랭킹 월 기준 최대 2장으로 설계하고 지급 월과 원천 월을 구분한다. 3곳 이상 1위 시 선택 순서, 동점·지연 기록 마감, 구독 판단 시점·기준점수·유효기간은 D-05에서 확정한다.
- 무료 주차의 최대 금액·시간·대상 제휴사·비용 부담을 설정 가능한 정책으로 둔다. 기획의 "주차 시간과 무관한 무료"를 무제한 금전 의무로 확정하지 않는다.
- 정산은 재실행·다중 인스턴스·중간 장애 이후에도 같은 월·사용자·원천 결과로 중복 지급하지 않는다. DB 고유 제약과 트랜잭션, 실행 이력으로 보장한다.
- 쿠폰 발급·예약/결제 중 점유·사용·해제·취소·만료를 구분하고 동시 이중 사용을 막는다.
- 블루링크 푸시는 실제 지원이 확인되기 전 개발용 대체 제공자로 둔다. 저장/지급 완료와 알림 실패를 분리하고 제한된 재시도로 처리한다. 토큰·개인 위치를 알림 로그에 남기지 않는다.

## 6. 저장·보안·운영 원칙

1. 사용자·차량 연결·주차장 구조·개인 위치·리뷰·미션 룰·기록·예약·결제·구독·쿠폰·정산 실행을 관계와 상태에 맞춰 모델링한다. 모델을 기획의 Kotlin 예제 그대로 복사하지 않는다.
2. 금액은 부동소수로 계산하지 않는다. 좌표·차체 크기·시각·길이·페이지 크기 등 외부 입력은 명세 범위를 검증한다.
3. 인증·소유권·관리자 권한을 API에 적용한다. webhook·정산 작업·관리 도구는 각각 용도에 맞는 접근 제어를 둔다.
4. 비밀값은 환경/비밀 저장소로 주입하고 저장소·시드·오류 응답에 넣지 않는다. 운영에서는 개발 로그인·테스트 PG·실제처럼 보이는 합성 데이터가 활성화되지 않아야 한다.
5. 개인 위치, 원본 차량 신호, 인증 토큰, QR 토큰, 결제 민감정보는 로그/추적에서 제외한다. 로그에는 요청/작업 식별자와 필요한 오류 상태를 남긴다.
6. Prisma migration은 코드로 검토·적용한다. 운영에 `db push`나 파괴적 초기화를 사용하지 않는다. 배포 전후 적용 책임과 실패 시 준비 상태를 S-02에서 문서화한다.
7. 상태 확인은 프로세스 생존과 DB 준비 상태를 구분한다. 종료 시 수신을 정리하고 진행 중 작업의 재시도/복구 경계를 제공한다.
8. 정산·만료·알림 같은 작업은 재시작 후 이어갈 수 있게 DB에 상태를 남긴다. 여러 인스턴스가 같은 일을 수행해도 중복 부작용이 없어야 한다.
9. 로컬·테스트·운영 데이터를 분리하고 PostgreSQL 백업·복원 절차와 검증 방법을 준비한다. 실제 배포는 대상 환경과 별도 요청 범위에 따른다.
10. 개인정보 보관·삭제·동의 정책은 D-02를 따른다. 해시한 사용자 ID나 가명화된 개인 데이터를 자동으로 익명 통계로 분류하지 않는다.

## 7. 실행 가능한 작업 목록

각 항목의 상세 범위·선행·수용 기준은 연결된 GitHub 이슈를 따른다. 이 표는 ID와 범위의 정본이며, 현재 진행 상태·담당·브랜치는 GitHub에서 관리한다.

| ID | 단계 | 작업 이슈 | 선행 |
|---|---|---|---|
| S-01 | 기반 | [#2 서버 요구사항·앱/서버 API 계약과 결정 기록 확정](https://github.com/we-self-sufficiency/parksical-server/issues/2) | 없음 |
| S-02 | 기반 | [#3 NestJS·PostgreSQL·Prisma 기반과 Docker·검증 환경 구축](https://github.com/we-self-sufficiency/parksical-server/issues/3) | [S-01 #2](https://github.com/we-self-sufficiency/parksical-server/issues/2) |
| S-03 | 기반 | [#4 사용자 인증·차량 앱 연결·세션과 소유권 구현](https://github.com/we-self-sufficiency/parksical-server/issues/4) | [S-01 #2](https://github.com/we-self-sufficiency/parksical-server/issues/2), [S-02 #3](https://github.com/we-self-sufficiency/parksical-server/issues/3) |
| S-04 | 기반 | [#5 차량 앱 세션·정규화 이벤트 수신과 오프라인 재전송 구현](https://github.com/we-self-sufficiency/parksical-server/issues/5) | [S-01 #2](https://github.com/we-self-sufficiency/parksical-server/issues/2), [S-02 #3](https://github.com/we-self-sufficiency/parksical-server/issues/3), [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4) |
| S-05 | 일반 | [#6 주차장·층·구역·경사로 모델과 관리·시드 구축](https://github.com/we-self-sufficiency/parksical-server/issues/6) | [S-02 #3](https://github.com/we-self-sufficiency/parksical-server/issues/3), [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4) |
| S-06 | 일반 | [#8 주변 주차장 검색·필터·정렬·상세 API 구현](https://github.com/we-self-sufficiency/parksical-server/issues/8) | [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6), [S-07 #7](https://github.com/we-self-sufficiency/parksical-server/issues/7) |
| S-07 | 일반 | [#7 차량 크기 보정 난이도 계산·결측 처리·룰 버전 구현](https://github.com/we-self-sufficiency/parksical-server/issues/7) | [S-01 #2](https://github.com/we-self-sufficiency/parksical-server/issues/2), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6) |
| S-08 | 일반 | [#9 1탭 리뷰·익명 집계와 난이도 반영 구현](https://github.com/we-self-sufficiency/parksical-server/issues/9) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6), [S-07 #7](https://github.com/we-self-sufficiency/parksical-server/issues/7) |
| S-09 | 일반 | [#10 개인 주차 위치 동기화·수정 이력·사진·메모 구현](https://github.com/we-self-sufficiency/parksical-server/issues/10) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-04 #5](https://github.com/we-self-sufficiency/parksical-server/issues/5), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6) |
| S-10 | 일반 | [#11 주차 위치 QR 토큰·휴대폰 조회 웹과 만료·폐기 구현](https://github.com/we-self-sufficiency/parksical-server/issues/11) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6), [S-09 #10](https://github.com/we-self-sufficiency/parksical-server/issues/10) |
| S-11 | MAX 선행 조사 | [#12 MAX 주행 정책·SDK 지원 신호·미션 구간 판정 조사](https://github.com/we-self-sufficiency/parksical-server/issues/12) | [S-01 #2](https://github.com/we-self-sufficiency/parksical-server/issues/2) |
| S-12 | MAX | [#13 미션 룰·도전 기록·판정 결과 정합성 검증 구현](https://github.com/we-self-sufficiency/parksical-server/issues/13) | [S-04 #5](https://github.com/we-self-sufficiency/parksical-server/issues/5), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6), [S-11 #12](https://github.com/we-self-sufficiency/parksical-server/issues/12) |
| S-13 | MAX | [#14 운전 연습 리포트·3회 연속 자격·도장·칭호 구현](https://github.com/we-self-sufficiency/parksical-server/issues/14) | [S-12 #13](https://github.com/we-self-sufficiency/parksical-server/issues/13) |
| S-14 | MAX | [#15 도전·연습 예약 슬롯·견적·동시성·취소 구현](https://github.com/we-self-sufficiency/parksical-server/issues/15) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6), [S-11 #12](https://github.com/we-self-sufficiency/parksical-server/issues/12) |
| S-15 | MAX | [#16 주차장별 월간 랭킹·기록 인정·공개 동의 구현](https://github.com/we-self-sufficiency/parksical-server/issues/16) | [S-11 #12](https://github.com/we-self-sufficiency/parksical-server/issues/12), [S-12 #13](https://github.com/we-self-sufficiency/parksical-server/issues/13) |
| S-16 | 과금 | [#17 사전결제·제공자 검증·영수증·취소·환불 구현](https://github.com/we-self-sufficiency/parksical-server/issues/17) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-05 #6](https://github.com/we-self-sufficiency/parksical-server/issues/6) |
| S-17 | 과금 | [#18 MAX 패스 구독·갱신·만료·해지와 이용 권한 구현](https://github.com/we-self-sufficiency/parksical-server/issues/18) | [S-03 #4](https://github.com/we-self-sufficiency/parksical-server/issues/4), [S-16 #17](https://github.com/we-self-sufficiency/parksical-server/issues/17) |
| S-18 | 보상 | [#19 KST 월간 정산·월 최대 2장 쿠폰·중복 사용 방지·알림 구현](https://github.com/we-self-sufficiency/parksical-server/issues/19) | [S-15 #16](https://github.com/we-self-sufficiency/parksical-server/issues/16), [S-16 #17](https://github.com/we-self-sufficiency/parksical-server/issues/17), [S-17 #18](https://github.com/we-self-sufficiency/parksical-server/issues/18) |

## 8. 검증과 완료 정의

### 8-1. 모든 PR

- 관련 S-xx/F-xx와 이슈 링크, 바뀐 동작, 실행한 검증, 미결정/제한 사항을 설명한다.
- 사용자 입력·인증·소유권·실패 경로를 포함해 변경 위험에 맞는 검증을 한다. 단순 문서 수정에 실행 코드 테스트를 억지로 추가하지 않는다.
- DTO/OpenAPI/DB migration/설정 예제와 실제 구현을 함께 맞춘다. 문서만 구현 완료로 표시하지 않는다.
- lint·타입 검사·필요 테스트·빌드를 통과한다. S-02에서 실제 명령과 CI를 확정하고 이후 PR이 이를 따른다.
- 새 SDK 근거는 `docs/vehicle-contract-notes.md`, 정책·공식은 `docs/DECISIONS.md`에 출처와 상태를 남긴다.

### 8-2. 필요한 핵심 회귀 검증

| 영역 | 반드시 확인할 경우 |
|---|---|
| 인증·개인 위치 | 타인 조회/수정/삭제 차단, 차량 사용자 변경, 세션 해제 |
| 수신 | 중복 키, 다른 payload 충돌, 순서 역전, 오래된 이벤트, 미지원/누락 신호 |
| 난이도 | 차체 보정 단조성, 1~5 범위, 반올림, 결측 요소 |
| QR | 만료·폐기·삭제, 동시 교환, 링크 미리보기, 소유권과 최소 정보 |
| 예약·결제 | 동시 마지막 슬롯 예약, 변조 금액, 중복 webhook, 취소/환불 경합 |
| 기록·연습 | 시뮬레이션 구분, 룰 버전, 중복 완료, 3회 연속 성공과 지연 업로드 |
| 정산·쿠폰 | KST 월 경계, 3곳 1위→최대 2장, 점수 미달·비구독, 중복 실행·중간 재시작·이중 사용 |

차량 신호 시나리오는 합성 fixture로 공유한다. 서버 계약 테스트 통과를 실제 SDK 연동·실차 위치 정확성·플랫폼 심사 통과의 증거로 대신하지 않는다.

### 8-3. 첫 연동 완료 기준

인증된 차량 앱/테스트 클라이언트가 주차장 검색 → 상세·차량 기준 난이도 조회 → 개인 위치 업로드 → 재전송 → 수정 → QR 발급 → 휴대폰 웹 조회를 연속 수행한다. DB 재시작 후 데이터가 유지되고 타인·만료 토큰 접근이 거절돼야 한다. 실제 차량 앱 연결에서 확인한 범위와 합성 fixture 검증 범위를 구분해 기록한다.

## 9. 브랜치·이슈·협업

- 개발 작업은 최신 `develop`에서 `feature/S-xx-short-description` 또는 `docs/S-xx-short-description`으로 시작한다.
- 기능 변경은 `develop` 대상 PR로 통합한다. `main` 반영은 릴리스 작업으로 분리한다. 강제 푸시와 관련 없는 변경을 섞지 않는다.
- 이번 문서 초기 작성은 사용자가 `develop` 직접 커밋을 명시적으로 요청한 초기화 작업이다. 이를 이후 기능 작업의 상시 직접 푸시 규칙으로 확대하지 않는다.
- 이슈를 착수 상태로 갱신하고, PR이 준비됐는지와 선행 작업이 완료됐는지를 구분한다. 이슈마다 수용 기준 체크리스트를 완료한 뒤 닫는다.
- 진행 상태를 별도 PROGRESS 파일과 이중 관리하지 않는다. GitHub 이슈/PR을 기준으로 삼고 총괄 이슈에서 추적한다.
- API·룰·DB 변경은 호환성과 마이그레이션을 PR에 설명한다. 두 저장소가 다른 시점에 배포돼도 이전 앱이 어떻게 동작할지 기록한다.

## 10. 확인한 공식 근거와 조사 대상

아래는 판단 근거다. 실제 구현 시 해당 버전과 대상 차량의 API/권한/단위/지원 여부를 다시 확인하고 조사 결과를 남긴다.

- [Pleos Vehicle SDK 개요](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/Vehicle/intro): 차량 내부 Vehicle Service와 SDK 통신 경계.
- [API Compatibility & Availability](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/api-compatibility-availability): 차종별 capability와 AAOS 속성 접근 확인.
- [Driving Restriction Development Guide](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/driving-restriction-development-guide): 차량 앱의 CarUxRestrictions 적용.
- [App Categories](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/app-category), [심사 시 운전자 주의 분산 최소화](https://document.pleos.ai/en/docs/pleos-only/distribute/app-review-guide/review-driver-distraction-elements): MAX 분류·주행 중 허용 범위 조사.
- [Virtual Console User Guide](https://document.pleos.ai/en/docs/pleos-only/app-test-guide/virtual-console-guide): Safety 경고등과 실제 미션 필요 신호 구분.
- [NaviHelper 개요](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/intro): 내비 앱을 통한 요청·이벤트이며 실제 이벤트는 구현과 상태에 따라 달라짐.
- [Autoware Steer Offset Estimator](https://autowarefoundation.github.io/autoware_universe/main/vehicle/autoware_steer_offset_estimator/): 조향과 차량 방향 변화의 운동학적 관계 참고. P지컬 실차 정확성을 보장하는 자료는 아님.
- [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [Prisma PostgreSQL](https://www.prisma.io/docs/orm/core-concepts/supported-databases/postgresql): 서버 구현 시 공식 지원·설정 확인.

## 11. 다음 작업 시작 방법

1. 이 문서와 대상 GitHub 이슈를 읽는다.
2. 선행 이슈와 미결정 항목 중 실제로 이번 작업을 막는 부분을 확인한다.
3. 최신 `develop`에서 해당 작업 브랜치를 만들고 이슈에 착수 내용을 기록한다.
4. 변경할 API·데이터·검증 범위를 정한 뒤 구현한다. 이미 승인된 범위의 가역적 구현을 반복 승인 요청으로 중단하지 않는다.
5. 수용 기준을 검증하고 `develop` 대상 PR을 연다. 남은 결정·차량 앱 측 작업·실차 미검증 범위를 명확하게 설명한다.
