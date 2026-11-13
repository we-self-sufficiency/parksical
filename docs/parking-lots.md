# S-05 주차장·구조 관리와 가상 데이터

이슈 #6, F-01/F-02/F-06. 사용자의 2026-11-13 결정으로 원 기획의 4곳+연습용 1곳 대신 **직접 만든 가상 주차장 1곳**을 사용한다. 외부 주차장 API·지오코딩·구조도·사진은 연동하지 않는다. 이 문서는 S-05 PR의 구현 안내이며 SDK 공개 검색/상세 API는 후속 #8 범위다. 실제 호출 가능 상태는 [Wiki](https://github.com/we-self-sufficiency/parksical-server/wiki)의 develop 통합 현황으로 확인한다.

## 데이터와 출처

`fixtures/lots/one-synthetic-lot.json`의 code는 `parksical-synthetic-001`, 시드 UUID는 `66666666-6666-4666-8666-666666666666`이다. 이름은 **P지컬 가상 주차장 1**이며 실제 주소가 없다. 지상 1층/지하 1층, 각 층의 A구역, 양방향 출입구 1개와 경사로 1개를 가진다. 24시간 운영과 요금(최초 30분 1,000원·추가 10분 500원·일 최대 15,000원)은 모두 합성값이다. 사진은 넣지 않는다.

- WGS84 latitude/longitude=(0,0)은 **합성 anchor**이며 실제 주차장 위치/내비 목적지로 쓰지 않는다.
- 구역 polygon·입구 point는 `LOCAL_METERS` x/y다. 모든 층은 동일한 가상 로컬 원점을 공유하며 GPS 좌표가 아니다. zone polygon은 닫힌 단일 외곽선이며 hole/multipolygon은 지원하지 않는다.
- `source=SYNTHETIC`, `sourceReference`, `rightsNote`, `sourceUpdatedAt`을 모든 revision에 보존한다. 현재 API는 REAL 입력을 거절한다. 출처 라벨은 실차/실측/권리 검증의 증거가 아니다.
- `structureStatus` UNKNOWN/DRAFT/COMPLETE는 입력 완성도다. COMPLETE도 합성 구조이며 실측 확인이 아니다.
- sourceUpdatedAt은 자료의 갱신 시각, revisionCreatedAt은 서버 저장 시각이다. sourceUpdatedAt 미래 오차는 5분 이내만 허용한다.
- 좌표·운영시간·요금·준공연도·공영/민영·기계식 여부·제휴·태그·사진 출처·요소 점수를 저장한다. 요소 점수는 1~5 또는 null이며 최종 난이도 별점은 아직 계산하지 않는다. null을 0점으로 채우지 않는다.
- builtYear/운영시간/요금과 개별 점수·층 level·polygon·입구 point·경사로 폭/기울기는 미확정이면 명시적 null이다. null은 필드 생략과 다르다. operatingHours=null은 미확인, []는 모든 날 휴무다. day=1(월)~7(일), 분은 KST 자정 기준이며 자정 넘김은 날짜별로 나눈다. 겹치는 구간은 거절한다.
- `challengeAllowed`는 현재 **false만** 허용한다. 합성 요소 점수나 구조 완성도를 도전 자격으로 변환하지 않는다. 기계식 포함 모든 주차장의 도전 활성화는 별도 정책/장소 검증 범위다.

실제 데이터 도입 시에는 실제 장소·좌표/구조의 근거·사진/구조도 이용 권한·갱신 책임을 D-03에 기록한 뒤 REAL 수신 계약과 검증을 별도 구현한다. 현재는 이를 기다리지 않고 합성 데이터로 개발한다.

## 관리 API

모든 경로 앞에 `/api/v1`이 붙는다. [개발 인증](authentication.md)의 **ADMIN 역할+WEB 세션**이 필요하다. USER 또는 VEHICLE 토큰으로 관리할 수 없다. 역할을 HTTP body로 승격하는 경로는 없다. 개발 관리자는 합성 계정의 User.role을 담당자가 개발 DB에서 명시적으로 ADMIN으로 설정한다. 운영 제공자는 D-01 미정이며 production 개발 로그인은 계속 차단된다.

| 메서드 | 경로 | 동작 |
|---|---|---|
| POST | /admin/lots | `{code,snapshot}` 등록, revision 1, 201 |
| GET | /admin/lots | 비활성 포함 관리자 목록, UUID 오름차순 고정 50개 |
| GET | /admin/lots/{lotId} | 현재 revision 전체 조회, 200 |
| PUT | /admin/lots/{lotId} | `{expectedVersion,snapshot}` 전체 교체, 새 version, 200 |
| GET | /admin/lots/{lotId}/revisions/{version} | 과거 revision 조회, 200 |

목록의 nextCursor를 다음 요청의 `?after={nextCursor}`로 전달한다. 추가 필터/임의 query는 거절한다. 목록은 스냅샷 고정 조회가 아니므로 페이지 사이 새 등록은 다음 순회에서 확인할 수 있다. 공개 검색·거리/난이도 정렬은 #8에서 별도로 구현한다.

POST/PUT는 `Idempotency-Key`(ASCII 영문/숫자/`_.-`, 1~64자)가 필수다. ADMIN 자격을 매번 재검사한 뒤 같은 인증 세션+키+동일 요청은 원래 응답과 `Idempotency-Replayed: true`를 재생한다. 새 상태가 필요하면 GET을 사용한다. 다른 경로/body로 같은 키를 쓰면 409 IDEMPOTENCY_CONFLICT다. object key 순서와 UTC 시각의 ms 표기는 정규화하며 배열 순서는 의미가 있다. 실패한 입력은 성공 receipt로 저장하지 않는다.

수정은 **전체 snapshot**을 보내며 PATCH가 아니다. expectedVersion이 현재 값과 다르면 409 LOT_VERSION_CONFLICT다. 서로 다른 인증 세션의 동시 수정도 주차장별 DB advisory transaction lock으로 직렬화한다. 같은 code 신규 등록 경합도 DB 고유 제약/잠금으로 보호하며 LOT_CODE_CONFLICT를 반환한다.

비활성화는 새 snapshot의 `active:false`로 수행한다. 기존 snapshot과 층/구역/경사로를 물리 삭제하지 않는다. 과거 조회의 version은 요청한 값, currentVersion은 조회 시점의 최신 값이다. 후속 개인 위치/미션 기록은 **lotId+version+child id**를 보존하도록 FK를 연결해야 한다. 같은 문자열의 floor/zone id를 다른 주차장 또는 다른 버전의 구조로 간주하지 않는다.

## 구조 무결성과 제한

- 각 구조 배열 안에서 id는 유일해야 한다. zone/entrance/ramp가 참조하는 층·구역은 **동일 lotId·version**에 존재해야 하며 zone과 지정 floor도 일치해야 한다. PostgreSQL 복합 FK도 이를 강제한다.
- 경사로는 서로 다른 층을 연결한다. ONE_WAY는 from→to, TWO_WAY는 양방향, UNKNOWN은 방향 미확인이다. 입구는 ENTRY/EXIT/BOTH/UNKNOWN이다.
- polygon은 4~65점(마지막 점=첫 점), 축 ±10,000m·소수 최대 3자리다. 중복 꼭짓점·자기 교차·면적 0·인접 변 역주행을 거절한다. 서로 다른 zone끼리의 겹침·주차장 외곽 포함 관계·실제 통행 가능성을 검증하는 GIS 엔진은 아니다.
- COMPLETE에는 최소 한 층/구역/출입구와 알려진 층 level·다각형·입구 위치/방향·경사로 방향이 필요하다. 전체 연결성/실측/안전 인증은 아니다. UNKNOWN/DRAFT는 불완전 입력을 보관할 수 있으며 없는 구조를 자동 생성하지 않는다.
- 최대 층 50, 구역 100, 입구 30, 경사로 100, 사진 10, 태그 20. 전체 JSON 상한 64KiB를 함께 적용한다.
- 값 범위/미정 필드/object 형식은 400, 구조 참조/다각형/운영시간 모순은 422 INVALID_LOT_STRUCTURE다. sourceUpdatedAt 미래 오차는 422 CLOCK_SKEW다.
- 미인증 401, 일반 사용자/차량 세션 403, 없는 자원 404, 중복/버전 충돌 409, 크기 초과 413. 관리자 쓰기는 인증 세션당 5분 100회이며 429의 Retry-After를 따른다.
- 사진은 HTTPS URL·caption·rightsNote 메타데이터만 저장한다. URL에 자격 증명을 포함할 수 없고 서버는 원격 이미지를 가져오지 않는다. 파일 업로드/저장소·사진 권리 검증은 별도다.
- 인증·목록/구조·오류 응답은 no-store다. HTTP 로그에 body/주소/구조/토큰/설치 비밀을 남기지 않는다.

## 시드 실행

시드는 자동 startup/migration 작업이 아니다. [호스트 개발 환경](server-development.md)에서 migration과 build 후 명시적으로 실행한다.

```sh
npm run migrate:deploy
npm run build
NODE_ENV=development ALLOW_SYNTHETIC_SEED=true npm run seed:synthetic
```

DATABASE_URL은 개발용 DB를 사용한다. production, NODE_ENV 미설정, opt-in 없는 실행은 거절한다. 반복/동시 실행은 같은 1개 주차장·동일 버전을 반환하며 새 revision을 만들지 않는다. 관리자가 수정한 최신 snapshot이 fixture와 다르면 SYNTHETIC_SEED_DIVERGED로 **실패하고 기존 내용을 유지**한다. 관리자 작성분을 시드로 되돌리지 않는다. CLI는 비밀/DB 오류 원문을 출력하지 않고 실패 exit code를 반환한다.

## 예제와 검증

정확한 전체 JSON은 [OpenAPI](openapi.json), [생성 요청](examples/admin-lot-create.json), [응답](examples/admin-lot-response.json), [비활성화 요청](examples/admin-lot-replace.json), [비활성화 응답](examples/admin-lot-updated.json)을 따른다. fixtures/예제의 좌표와 시각은 합성이다.

실제 PostgreSQL 통합 테스트는 권한, 같은 키 동시 생성, 서로 다른 인증 세션의 수정 경합, 실패 rollback, 비활성화/구조 삭제 후 과거 버전 보존, API와 DB에서 타 주차장/잘못된 floor-zone 참조 거절, 잘못된 다각형·값·시각·원본/도전 필드 거절, 시드 반복·동시 실행/변경 보존을 확인한다. 기존 인증/이벤트 테스트도 함께 실행한다. 실제 차량 SDK와 실제 주차장 정확성은 검증하지 않았다.

## Wiki 반영 계획

develop 통합 직후 Wiki Home 업데이트 기록에 이슈 #6·머지 PR·날짜를 남기고 이 관리 API/가상 주차장 가이드를 연결한다. ADMIN용 데이터 관리가 준비된 상태와 SDK용 `/lots` 검색·상세 미구현, 미배포·실제 SDK 미검증을 구분한다. 통합 전에는 PR 검토 대기 상태만 안내하며 구현 예정 API를 현재 develop 연동 가능으로 표시하지 않는다.
