# S-09 개인 주차 위치·수정 이력·비공개 사진

이슈 #10 / F-06. 차량 앱이 로컬에 먼저 저장한 추정 위치를 본인 계정으로 동기화한다. 주차장/구조 버전·층/구역/주차면, 신뢰도·거리·발생/수신 시각, 추정 원본과 사용자 수정을 분리한다. 이 PR은 **명시적 비운영 개발 opt-in·합성 자료** 범위이며 운영 로그인·D-02 실제 수집/보관·D-03 실제 주차장·D-06 운영 파일 제공자는 미정이다. 위치/주차 완료/정차/실차 정확성을 증명하지 않는다.

## 준비·인증·범위

migrate deploy/build와 [개발 인증](authentication.md), [가상 한 곳·32면 시드](parking-lots.md)를 준비한다. DEV_LOCATIONS_ENABLED는 기본false다. DEV_AUTH_ENABLED=true인 development/test에서 DEV_LOCATIONS_ENABLED=true로 명시 활성화한다. production·개발 인증 없는 활성화·REAL_LOCATIONS_ENABLED=true는 기동 시 거절한다. 위치/방문/사진을 startup이나 migration에서 자동 생성하지 않는다. 실제 SDK/실차 연결·배포는 미검증이다.

기본 /api/v1, WEB 또는 VEHICLE bearer가 필요하다. 모든 위치/이력/사진은 본인 계정 전용이며 ADMIN도 타인의 자료를 읽거나 수정/삭제할 수 없다. 계정 주체는 인증 컨텍스트에서 얻는다. source는 SYNTHETIC만 허용하며 실제 신호·운전 요약·userId·사진 URL을 body에 추가할 수 없다. rawSignals/미정 필드는400이다. 활성화하지 않은 경로는403 LOCATIONS_POLICY_DISABLED다.

| 메서드·경로 | 동작 |
|---|---|
| POST /parked-locations | 추정 위치 생성/오프라인 동기화,201 최소 영수증 |
| GET /parked-locations | 본인 목록, limit/cursor |
| GET /parked-locations/current | 가장 최신 발생 기록 또는 {location:null} |
| GET /parked-locations/{locationId} | 원본·선택/수정·사진 metadata·버전 |
| PATCH /parked-locations/{locationId} | expectedVersion과 선택 위치/메모 수정 |
| DELETE /parked-locations/{locationId} | JSON {expectedVersion}, 접근 차단·내용/첨부/이력 삭제 |
| GET /parked-locations/{locationId}/history | limit/beforeVersion으로 본인 수정 이력 |
| POST /parked-locations/{locationId}/photos | JSON {expectedVersion,contentType,dataBase64},201 최소 사진 영수증 |
| GET /parked-locations/{locationId}/photos/{photoId} | bearer로 비공개 정규화 JPEG bytes 조회 |
| DELETE /parked-locations/{locationId}/photos/{photoId} | JSON {expectedVersion}, 사진 bytes 삭제 |

공유 Base URL은 미정이며 api.example.invalid는 placeholder다. 차량의127.0.0.1은 서버 주소가 아니다. GET에 Idempotency-Key는 필요 없고 POST/PATCH/DELETE에 필수다.

## 생성·주차면/구조 참조

생성 body는 clientRecordId(ASCII 영숫자/밑줄/점/하이픈1–64자), lotId(UUID), structureVersion(양의 정수 또는null), floorId/zoneId/parkingSpaceId(각각 식별자 또는null), confidence(HIGH/MEDIUM/LOW/UNKNOWN), distanceM(0–100000m·소수3자리 또는null), occurredAt(엄격한 UTC Z·ms최대3자리), source=SYNTHETIC이다. 선택 note(최대1000자/null), vehicleSessionId(UUID/null)를 받을 수 있다. 임의 위경도/원본 신호 배열을 받지 않는다.

미확정은 null로 보존한다. structureVersion=null이면 floor/zone/parkingSpace도null, floor=null이면 zone/space도null, space를 고르면 zone이 필요하다. 알려진 floor/zone/space는 **동일 lotId+structureVersion**에 존재하고 서로 맞아야 한다. 주차면이 해당 버전에서 비활성이면422다. 없는 주차장404, 없는/모순된 구조 참조422이며 잘못된 값을 다른 층/면으로 자동 매핑하지 않는다. 낮은 신뢰도는 그대로 유지하고 서버가 주차면을 임의 선택하거나 확정하지 않는다. 클라이언트가 보낸 면 ID와 confidence도 추정/신고다.

selected/original snapshot에는 그 버전의 층/구역 label과 선택한 주차면 label·center/크기/방향/진입 공간을 담는다. 현재 구조가 바뀌거나 면이 비활성화돼도 과거 기록은 해당 snapshot으로 복원한다. 늦은 업로드를 위해 존재하는 과거/비활성 revision 참조도 허용하지만 structureActive=false를 보존하며 방문/주차 가능/빈자리라는 뜻이 아니다. 관리 active와 실제 점유는 별개다. 현재 버전으로 자동 이관하지 않는다.

vehicleSessionId를 보내면 VEHICLE 자격과 해당 사용자/현재 설치에 속하는 SYNTHETIC S-04 세션인지 확인한다. 오프라인 동기화를 위해 종료된 세션도 허용하며 이벤트 수신을 재개하지 않는다. 다른 사용자/설치의 참조404, WEB에서 차량 세션 지정403이다. 이를 방문 진위 증거로 사용하거나 S-08 리뷰 방문을 자동 생성하지 않는다.

## 재전송·최신 위치·충돌

A-12 개발 규칙: **인증 사용자+clientRecordId**가 로컬 기록의 유일성 경계다. 같은 생성 body를 다른 키/재인증 세션으로 보내도 한 기록/최초 영수증을 반환하며 추정 원본/수정값을 덮어쓰지 않는다. 같은 ID에 다른 body는409 RECORD_CONFLICT다. timestamp는 UTC ms와 JSON object 키 순서/누락 선택값을 정규화한다. 사용자/주차장/추정 입력을 바꾸려면 새 로컬 기록을 생성하거나 허용된 PATCH를 사용한다.

Idempotency-Key는 ASCII 영숫자/밑줄/점/하이픈1–64자이며 **사용자+key**, method/route/body hash에 묶인다. 같은 키/요청은 원래 상태·최소 영수증과 Idempotency-Replayed:true를 재생하고 다른 경로/body는409 IDEMPOTENCY_CONFLICT다. 인증/연결/소유권은 매번 다시 확인한다. 폐기 토큰으로 재생할 수 없다. 삭제 후에는 과거 생성/PATCH/사진 추가 재생도409 RESOURCE_DELETED다. 위치 DELETE의 동일 키 재생은 삭제 영수증만 돌려주며 되살리지 않는다.

위치 영수증은 locationId/version/deleted/accessEpoch만 담고 사진 변경에는 photoId/photoDeleted를 추가한다. 메모·위치 원문/사진 bytes를 영수증에 저장하지 않는다. 최초 생성 영수증version1은 이후 수정된 현재 상태를 뜻하지 않으므로 GET으로 재조회한다. DB 커밋 전 실패는 같은 키로 다시 시도할 수 있다.

최신 위치는 **occurredAt DESC,id DESC**로 선택하며 receivedAt/updatedAt/사용자 수정 시각으로 재정렬하지 않는다. 과거 기록이 늦게 올라와도 현재 위치/수정값을 덮지 않는다. 동일 발생 시각은 서버 UUID가 동점 기준이다. 발생 시각은2000년 이후·서버 미래5분 이내를 허용하고 오래된 위치에 S-04 이벤트의72시간 제한을 적용하지 않는다. 시각 역시 클라이언트 주장이다. 최신 기록 삭제 후 이전 미삭제 기록이 current가 된다.

목록은 기본20/상한50의 keyset 페이지다. cursor에는 anchor의 불투명 기록 ID와 사용자/페이지 크기 hash만 넣고 위치·시각·메모·사용자 ID 원문은 넣지 않는다. 다른 사용자/limit·잘못된 cursor는400 INVALID_LOCATION_CURSOR다. 삭제 anchor의 최소 tombstone으로 다음 경계를 유지한다. 순회 중 신규/삭제가 생길 수 있으며 장시간 snapshot을 보관하지 않는다. occurredAt/id가 불변이므로 경계 뒤로 중복 진입하지 않는다. 새 과거 업로드는 이후 페이지에 포함될 수 있다.

## 원본·사용자 수정·이력

original은 최초 앱 추정과 confidence/distance를 보존한다. selection은 현재 사용자 선택, note는 메모다. PATCH는 expectedVersion과 structureVersion/floorId/zoneId/parkingSpaceId/note 중 하나 이상 필요하며 누락은 유지, null은 미확정/지움이다. 상위 층/버전을 미확정으로 바꿀 때는 관련 하위 ID도 명시적으로 null로 보낸다. confidence/distance/occurredAt/source/lotId/clientRecordId/차량 세션은 PATCH로 덮지 않는다.

위치 선택을 명시 수정하면 userEdited=true이며 note만 수정하면 위치 수정 표시를 바꾸지 않는다. 사용자 수정도 실측 검증이 아니다. 같은 expectedVersion의 동시 수정/사진 변경은 하나만 성공하고 나머지는409 VERSION_CONFLICT다. 충돌은 GET 후 사용자가 의도한 값을 합쳐 새 버전으로 제출한다.

생성/수정/사진 추가/삭제 이력은 version/kind/before/after/actorKind/서버시각을 본인에게만 제공한다. 원본과 수정 전후 선택/메모를 비교할 수 있으며 사진 bytes를 이력에 복제하지 않는다. 사진 변경도 location.version을 증가시킨다. 조회 limit20기본/50상한, nextBeforeVersion을 beforeVersion으로 넘긴다. 개발 상한은 계정 미삭제1000기록·기록당200이력·활성 사진5장이다. 위치 삭제는 이력 상한에 막히지 않는다.

## 비공개 사진 저장·검증·삭제

D-06 운영 파일 제공자를 가정하지 않고 **PrivatePhotoStore 어댑터의 PostgreSQL BYTEA 개발 구현**을 사용한다. 외부 URL/공개 bucket/파일 경로를 받거나 반환하지 않는다. metadata는 LocationPhoto, 정규화 bytes는 PrivatePhotoBlob에 분리하며 DB 트랜잭션에서 같이 저장/삭제한다. 원격 제공자 도입에는 staging/삭제 재시도/고아 정리 설계가 별도로 필요하므로 설정만 바꿔 같은 원자성을 보장한다고 주장하지 않는다.

JSON base64 업로드를 사용하며 multipart/presigned URL은 없다. 일반 JSON64KiB 제한은 유지하고 사진 POST 경로만3MiB로 제한한다. raw 사진은2MiB 이하, 정규 base64만 허용한다. JPEG/PNG magic과 선언 MIME이 맞아야 하며 실제 디코딩·12MP 픽셀 상한·PNG 애니메이션/다중 페이지·손상 입력을 검사한다. 입력/출력 bytes2MiB, 출력 최대2048×2048, 메타데이터를 제거한 JPEG로 재인코딩한다. EXIF 회전은 픽셀에 적용하고 원본/EXIF/GPS/XMP/ICC를 저장하지 않는다. 얼굴/번호판 자동 가림이나 익명화는 제공하지 않는다.

sharp0.35.5를 lockfile에 고정했다. [constructor](https://sharp.pixelplumbing.com/api-constructor/)의 untrusted failOn/pixel 제한과 [output](https://sharp.pixelplumbing.com/api-output/)의 기본 metadata 제거를 따르고 실제 디코딩/EXIF 제거/크기 제한을 검증한다. 사진 처리 동시2건 초과는429 IMAGE_PROCESSING_BUSY/Retry-After1이다. 운영 성능·보관량·보관 정책은 별도 확정 대상이다.

사진 조회는 유효 bearer+부모 위치 소유권+미삭제 상태를 매번 확인한다. image/jpeg, no-store, nosniff와 고정 filename으로 bytes를 반환한다. 사진을 삭제하면 bytes를 즉시 지우고 metadata tombstone으로 조회를 막는다. 위치 삭제는 모든 사진 bytes/metadata와 수정 이력을 같은 트랜잭션에서 지운다. 저장 실패 시 metadata·bytes·위치 버전·이력·영수증 모두 rollback한다.

## 접근 해제·삭제·QR 후속 경계

로그아웃/인증 세션 폐기/차량 연결 해제/계정 변경은 기존 AuthGuard·트랜잭션 재확인으로 위치/사진 접근을 막는다. 차량 연결 해제는 해당 차량 자격을 폐기하며 본인 WEB 계정의 기록까지 삭제하지 않는다. 새로운 차량 사용자는 이전 사용자 자료를 조회할 수 없다.

위치 삭제는 추정/선택/메모·차량 세션 참조/사진/이력을 지우고 version/accessEpoch를 증가시킨다. 최소 사용자/clientRecordId/발생시각/생성 hash/삭제 표시는 개발 dedup과 cursor를 위해 남긴다. hash를 익명화로 취급하지 않고 실데이터 보관/완전 삭제 기한 D-02는 미정이다. GET/이력/사진은404, 같은 clientRecordId 재생성은409 RESOURCE_DELETED다.

QR 발급/휴대폰 조회는 **#11 미구현**이다. 미래 grant는 locationId/accessEpoch에 묶고 미삭제·현재 epoch·소유권/허용 정책을 매번 확인해야 한다. 이번 작업이 기존 QR 토큰을 실제 폐기했다고 보고하지 않는다. 삭제 전 이미 내려받은 bytes를 원격 회수하는 기능도 아니다.

## 오류·검증·Wiki

400 DTO/query/빈 수정/키/base64,401 미인증/폐기,403 기능 비활성/차량 세션 자격,404 타인/없음/삭제,409 키/생성/버전/상한/삭제 충돌,413 JSON/raw 사진 크기,422 시각/구조/비활성 주차면/사진 형식·디코딩을 구분한다. 실패에 위치/메모/파일 원문을 반사하지 않는다. 계정 공통 쓰기100회/5분·읽기300회/5분,429는 Retry-After를 따른다. 모든 성공/오류는 no-store이며 서버 로그는 method/status/requestId/시간만 허용해 위치/사진 URL·ID·토큰·본문을 제외한다.

원자성은 인증 재확인→계정 잠금→버전/소유권→변경/사진 bytes/이력/최소 영수증 커밋으로 보장한다. 외부 파일 작업·큐/미완성 업로드 상태가 없어 DB 재시작 후에도 일관된 자료를 읽는다. migration은 위치·이력·사진/bytes·영수증과 FK/unique/index/CHECK만 추가하며 기존 자료를 바꾸지 않는다.

S-01의 미구현 위치 설계는 구조 버전의 정수화·명시 nullable 주차면/source·최소 영수증·원본/현재 선택·수신 시각·첨부 경로로 구체화한다. 기존 구현된 인증/이벤트/카탈로그/난이도/리뷰 요청은 유지한다. 실제 SDK 호환은 별도 검증이며 문서/JSON 예제와 CI 결과를 PR에 기록한다.

develop 머지 후 Wiki Home의 #10/날짜/머지 PR과 위치/첨부 가이드를 게시하고 기존 Reviews/Parking Lot Data의 후속 표현을 맞춘다. 실제 Wiki 반영 전에는 완료로 표시하지 않는다. 합성 계약/DB/사진 테스트를 실제 SDK·실차 위치 정확성·배포·운영 수집/파일 보관 승인으로 보고하지 않는다.
