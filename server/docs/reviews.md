# S-08 1탭 리뷰·개발 집계·난이도 반영

이슈 #9 / F-07·F-03. 쉬움(EASY)/보통(NORMAL)/어려움(HARD)을 본인 소유의 합성 방문과 주차장 구조 버전에 연결한다. 이 PR은 **개발용 합성 리뷰 경로**이며 D-02의 실제 리뷰/운전 자료 수집·익명화·동의/보관/삭제 운영 승인이 아니다. 공개 집계에 계정 식별자를 넣지 않지만 이를 익명화 완료로 부르지 않는다. production에서는 활성화할 수 없다.

## 활성화·합성 방문 준비

기본 DEV_REVIEWS_ENABLED=false, REAL_REVIEWS_ENABLED=false다. development/test의 개발 인증을 켜고 DEV_REVIEWS_ENABLED=true를 명시해야 리뷰 API·집계 반영이 동작한다. 개발 인증 없이 켜거나 production에서 켜면 기동을 거절한다. 실제 수집 REAL_REVIEWS_ENABLED=true는 지원하지 않는다. 기존 난이도/검색/상세는 리뷰 비활성 시 이전 계산을 유지하며 reviewAggregation.status=DISABLED를 추가한다.

[개발 서버/인증](server-development.md)·[주차장 한 곳 시드](parking-lots.md)·migration/build를 준비하고 합성 개발 계정으로 로그인한다. 개발자가 해당 계정의 userId로 아래 **별도 CLI**를 실행한다. 실제 사용자의 방문/차량 신호를 등록하는 API가 아니다.

~~~sh
npm run migrate:deploy
npm run build
NODE_ENV=development DEV_AUTH_ENABLED=true DEV_REVIEWS_ENABLED=true \
ALLOW_SYNTHETIC_REVIEW_VISIT=true SYNTHETIC_REVIEW_USER_ID='<개발 계정 userId>' \
npm run seed:review-visit
~~~

DEV_AUTH_SECRET/DATABASE_URL은 기존 개발 환경에서 비밀값으로 주입한다. CLI는 DEV identity·현재 active SYNTHETIC 구조 버전을 확인하고 visitId/lotId/lotVersion/source만 출력한다. 기본 주차장은 기존66666666-6666-4666-8666-666666666666·버전1이며 SYNTHETIC_REVIEW_LOT_ID/SYNTHETIC_REVIEW_LOT_VERSION으로 명시 변경할 수 있다. 반복 실행은 같은 사용자/주차장/버전의 기존 방문을 유지하고 리뷰/집계를 생성하지 않는다. startup/migration에서 자동 실행하지 않는다. 지속 주차장 시드는 여전히 한 곳·32면이다.

#10의 [개인 위치 동기화](parked-locations.md)도 개발용 합성 자료만 받으며 리뷰 방문을 자동 생성하지 않는다. 현재 리뷰 방문은 합성 fixture 전용이다. 후속 실제 기록 어댑터는 소유권·주차장/구조 버전·동의·수집 정책 확정 뒤 연결한다. 임의 visitId/lotId/source/P단 신고로 실제 방문을 인정하지 않는다. P단/화면 안전 제한은 차량 앱 책임이며 서버가 정차를 보장하지 않는다.

## API·소유권

기본 /api/v1, 유효한 WEB 또는 VEHICLE bearer가 필요하다. 본인의 리뷰만 조회/수정/삭제하며 ADMIN도 타인의 개인 리뷰를 볼 수 없다. 관리 재집계만 ADMIN+WEB 전용이다. feature 미활성 리뷰 경로는403 REVIEWS_POLICY_DISABLED, 미인증은401이다. API는 원본 차량 신호·운전 요약·자유문구·차체/VIN·body의 userId/source를 받지 않고 미정 필드는400이다.

| 메서드·경로 | 입력/결과 |
|---|---|
| POST /reviews | {lotId,lotVersion,visitId,rating}, 201 변경 영수증 |
| GET /reviews/{reviewId} | 본인의 활성 리뷰 최소 정보, 없거나 타인/삭제는404 |
| GET /reviews/me?lotId=…&lotVersion=1 | 해당 본인 리뷰 또는 {review:null} |
| PUT /reviews/{reviewId} | {expectedVersion,rating}, 200 변경 영수증 |
| DELETE /reviews/{reviewId} | JSON {expectedVersion}, 200 삭제 영수증 |
| GET /lots/{lotId}/reviews/aggregate | 현재 또는 선택 lotVersion의 최소 집계·표본/갱신/버전·출처 |
| POST /admin/lots/{lotId}/revisions/{version}/review-aggregate/rebuild | {ruleVersion:"reviews-v1"}, ADMIN+WEB, 201 재집계 영수증 |

POST/PUT/DELETE와 관리 재집계는 Idempotency-Key(ASCII 영숫자/밑줄/점/하이픈1–64자)가 필수다. 같은 인증 세션+키+경로+동일 body는 원래 영수증과 Idempotency-Replayed:true를 반환한다. 다른 body/경로는409 IDEMPOTENCY_CONFLICT다. 다른 세션의 키는 별개이지만 방문 unique 제약과 lot 잠금으로 중복 리뷰/표본을 막는다. 응답 유실에는 같은 키/body를 재전송한다.

생성·수정·삭제 영수증은 {reviewId,version,deleted,aggregateVersion}뿐이다. 원래 평가값·방문 내용·개인 식별자를 재생 저장하지 않는다. 영수증은 당시 변경 확인이며 현재 상태는 GET으로 다시 확인한다. 삭제 후 과거 생성 영수증을 재생해도 리뷰가 부활하거나 집계가 바뀌지 않는다. 키는 인증 세션이 바뀌면 재사용 scope가 달라진다.

## 반복 제출·수정·삭제·버전 정책

A-11 개발 기본값: **사용자+주차장+구조 버전당 합성 방문/리뷰 한 건**이다. 새 키·다른 인증 세션으로 반복 생성하면409 REVIEW_ALREADY_EXISTS이며 표본이 늘지 않는다. 활성 리뷰는 PUT으로 수정한다. stale expectedVersion은409 REVIEW_VERSION_CONFLICT다. 같은 버전 동시 수정은 하나만 성공한다.

삭제는 rating을 null로 지우고 deletedAt·버전·최소 중복 방지 참조를 남기는 개발용 tombstone이다. 해당 평가가 즉시 집계에서 빠진다. 같은 방문/사용자/구조 버전의 재생성은409 REVIEW_DELETED다. 이후 새 구조 버전은 별개다. 이는 최종 사용자 삭제/보관 정책 확정이 아니며 실데이터 보관/완전 삭제는 D-02에서 결정해야 한다. 삭제 후 GET은404, mine은null이다. 비활성 주차장에도 본인의 리뷰 삭제는 가능하다. 생성/수정·집계 조회에는 현재와 대상 구조 버전 모두 active여야 한다.

리뷰는 방문의 lotId/lotVersion과 정확히 일치해야 한다. 없는/타인/다른 주차장·버전 참조는404로 동일 처리한다. 다른 버전의 리뷰를 새 구조로 자동 이관하지 않는다. 새 구조에는 NO_SAMPLES부터 시작하며 과거 active 버전 조회 시 그 버전의 집계만 사용한다.

## 집계·난이도·작은 표본

reviews-v1의 제안 척도는 EASY=1/NORMAL=3/HARD=5다. 사용자/구조 버전당 한 표본이며 삭제되지 않은 SYNTHETIC 리뷰의 합과 개수로 산술 평균(소수6자리)을 계산한다. 구조 점수와 마찬가지로 실제 운전자/차량 성공률로 보정한 척도가 아니다. 원본 평가/소유권은 Review/ReviewVisit 내부에, ReviewAggregate에는 주차장/버전·source·scoreSum·sampleCount·version·updatedAt만 저장한다. hash/가명 ID를 익명 통계에 넣지 않는다.

공개 집계 DTO는 lotId/lotVersion, 상태·SYNTHETIC 출처·privacyStatus=DEVELOPMENT_ONLY_NOT_ANONYMIZED·reviews-v1·sampleCount·updatedAt·집계 version·score만 제공한다. 계정/세션/방문/리뷰 ID·scoreSum·개별 평가를 제공하지 않는다. 표본5 미만은 score=null이다. 최소5는 개발 품질/소표본 평균 노출 제한이지 익명성·차등 개인정보 보호·법적 동의의 증명이 아니다. 정확한 합성 표본 수와 갱신 시각은 개발 검증용이다.

S-07 difficulty-v1의 구조40/리뷰25/주행20/연식15·차체 보정 룰은 바꾸지 않는다. 명시적 opt-in 시 같은 구조 버전의 실제 저장된 합성 리뷰 평균/표본을 계산기에 전달한다. 1–4개는 INSUFFICIENT_SAMPLES로 제외하고 factors.review.score도 null로 감춘다. 5개 이상은 리뷰25%를 포함해 참여 가중치를 다시 정규화한다. count0은 결측이다. 주행 표본이나 실제 관측은 생성하지 않는다. 관리자 snapshot.factorScores.review에 작성한 값을 실제 표본으로 바꾸지 않는다.

난이도 전용·검색 요약·상세 모두 reviewAggregation(status/source/privacyStatus/ruleVersion/sampleCount/version/updatedAt)을 추가하고 같은 집계를 사용한다. 상태는 DISABLED/NO_SAMPLES/INSUFFICIENT_SAMPLES/READY다. 계산 ruleVersion과 집계 ruleVersion은 별개다. 집계 version이 바뀌면 거리 정렬에도 기존 검색 cursor는409 SEARCH_CHANGED다. 리뷰 없는/비활성 기본 설정의 이전 계산 결과는 유지된다. 이전 배포 cursor는 재검색해야 할 수 있다.

재현 예: 구조2.5·준공2020·기준2026에 [HARD,HARD,NORMAL,EASY,EASY]는 평균3·5표본, 참여 가중치0.8, baseScore=(2.5×.4+3×.25+1.6×.15)/.8=2.4875다. EASY 한 건을 삭제하면4표본이라 리뷰가 제외되고 baseScore=2.254545로 돌아간다. 자료가 부족한 것을0점으로 취급하지 않는다.

## 원자성·재집계·실패 복구

유효한 인증/연결을 트랜잭션 안에서 재확인하고 모든 리뷰 변경·관리 재집계는 같은 lot advisory lock을 사용한다. 잠금 후 최신 버전을 다시 읽고 리뷰 변경→현재 원본 재합산→집계 버전 갱신→영수증 저장을 한 트랜잭션에 커밋한다. 증분 더하기가 아니므로 재시도/재실행이 표본/점수를 두 번 더하지 않는다. 실패 시 모두 rollback하여 같은 키로 다시 시도할 수 있다. 테스트에서는 집계 갱신에 DB 오류를 강제해 리뷰·집계·영수증이 함께 되돌아가는 것을 확인한다.

관리 재집계는 해당 버전의 원본에서 다시 합산하며 비활성/과거 구조도 내부 수리할 수 있다. 이를 공개 조회의 비활성 우회로 사용하지 않는다. 같은 키의 재집계는 version도 재증가하지 않으며 새 키의 재실행은 version만 갱신하고 개수/평균은 재계산한다. 별도 큐·누적 배치·백그라운드 작업은 없다. 조회는 커밋된 projection을 사용하므로 중간 결과를 내보내지 않는다.

## 오류·제한·호환성·검증

400 입력/미정 필드/누락 키, 401 인증 만료/폐기, 403 기능 비활성·관리 권한, 404 타인/없는/삭제/비활성 참조, 409 키/중복/삭제 tombstone/버전 충돌, 422 미지원 출처를 구분한다. 429는 쓰기(생성/수정/삭제/재집계) 공통 세션당5분100회, 읽기 공통5분300회이며 Retry-After를 따른다. 기존 난이도/카탈로그 제한은 별개다. 인증/검증 오류를 포함해 no-store이며 토큰·리뷰 원문/식별자·방문·운전 정보는 서버 로그에서 제외한다. 네트워크/응답 유실은 동일 키/body로 재시도하고 버전 충돌은 GET 후 사용자 수정 여부를 확인한다. 내부 집계 오류는 안전한500이며 원문/stack을 반사하지 않는다.

DB migration은 새 ReviewVisit/Review/ReviewAggregate/ReviewMutation·복합 FK/unique·검색 색인·합성 출처/상태 CHECK만 추가한다. 기존 주차장/이벤트/계정 자료를 바꾸거나 합성 방문을 자동 생성하지 않는다. 새 읽기 metadata와 개발 opt-in 외 기존 요청 계약·difficulty-v1·차량 contractVersion1.0은 유지한다. OpenAPI/JSON 예제와 실행 결과는 PR에 함께 기록한다.

검증 범위: 순수 척도/평균/표본/가드·cursor 변경, 실제 PostgreSQL의 방문 소유권·부정 값/원본 입력 차단·기본 비활성·WEB/VEHICLE·동시 생성/수정·응답 재생·롤백/재시도/관리 재집계·삭제/표본 감소·새 구조·서버 로그 제외·속도 제한·폐기와 세 난이도 경로 일치다. 합성 테스트를 실제 SDK·실차·익명화 심사·운영 동의 검증으로 보고하지 않는다.

develop 머지 후 Wiki Home의 #9/머지 PR/날짜와 리뷰 연동 가이드·검색/상세·난이도 문서를 갱신한다. 그 전에는 Wiki API 준비 현황에 올리거나 Wiki 완료 기준을 체크하지 않는다. 운영 배포/실제 리뷰·SDK 연결은 별도다.
