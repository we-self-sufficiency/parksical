# S-07 차량 크기별 난이도

이슈 #7, F-03. 순수 계산 함수와 버전 고정 개발 룰, 활성 합성 주차장의 인증된 난이도 조회를 구현한다. 실제 차량 조향/회전 궤적·주차 가능·안전을 판정하지 않는다. 현재 구조 점수는 관리자가 작성한 **합성 요소 점수**이며 주차면·통로·기둥 배치에서 자동 산출한 실측 점수가 아니다.

## 조회 API

`GET /api/v1/lots/{lotId}/difficulty`

유효한 WEB 또는 VEHICLE bearer를 요구한다. 일반 USER도 활성 카탈로그의 점수를 볼 수 있으며 ADMIN 전용 구조 관리 API와 다르다. 요청 차량 크기는 호출자가 제공한 값이지 SDK가 검증한 차체 인증이 아니다. 조회만 수행하고 차량 크기/운전 기록을 DB에 저장하지 않는다. 응답과 오류는 `Cache-Control: no-store`다.

개발 인증은 [authentication.md](authentication.md), 가상 주차장 시드 준비는 [parking-lots.md](parking-lots.md)를 따른다. 아래 고정 UUID의 예제는 개발 DB에 해당 시드가 존재할 때 호출한다. API 시작 시 시드를 자동 생성하지 않으며 자료가 없으면 404다.

| Query | 의미 |
|---|---|
| vehicleLengthMm / vehicleWidthMm | 전장 1000~10000mm, 전폭 500~4000mm 정수. 두 값을 함께 제공 |
| vehicleStatus | SUPPORTED / UNSUPPORTED / PERMISSION_DENIED / ERROR / UNKNOWN |
| asOfYear | 준공연도 계산 기준 2000~2200. 생략 시 서버 UTC 현재 연도이며 응답에 명시 |
| lotVersion | 생략 시 현재 구조 버전. 명시하면 과거 버전을 계산 |
| ruleVersion | 생략 시 difficulty-v1. 미지원 값은 422 |

query 정수는 십진 숫자 문자열만 받는다. 지수·hex·공백·배열·추가 query를 거절한다. vehicleStatus 생략 시 두 크기가 있으면 SUPPORTED, 없으면 UNKNOWN이다. SUPPORTED에는 두 크기가 모두 필요하고, 다른 상태에는 크기를 보내지 않는다. 미지원/권한/오류/미확인은 기준 차체로 계산하고 입력 상태와 `REFERENCE_DEFAULT`를 보존한다. 잘못된 치수를 조용히 기준 차체로 바꾸지는 않는다.

```text
/api/v1/lots/66666666-6666-4666-8666-666666666666/difficulty?asOfYear=2026
/api/v1/lots/66666666-6666-4666-8666-666666666666/difficulty?asOfYear=2026&vehicleLengthMm=5100&vehicleWidthMm=1900&ruleVersion=difficulty-v1
```

현재 버전과 요청한 과거 버전이 **모두 active**여야 한다. 현재 비활성 주차장을 과거 버전 query로 우회할 수 없다. 읽기 전용 RepeatableRead 트랜잭션에서 기준 버전을 고정한다. 현재 실제 자료 경로는 비활성으로 두고 SYNTHETIC 이외 출처는 거절한다. 인증된 검색/상세 `/lots`는 S-06 #8에서 같은 계산기에 연결한다([검색 가이드](lot-search.md)).

## difficulty-v1 개발 기본값

[rules.ts](../src/difficulty/rules.ts)는 중첩 객체까지 불변인 룰 설정이다. 이 값은 경험적 보정 모델이나 확정 운영 정책이 아니다. 계수/가중치/표본 기준을 바꾸려면 새 버전과 호환성 기록을 추가한다. 환경 변수로 같은 버전의 의미를 바꾸지 않는다.

| 요소 | 원래 가중치 | 포함 조건 |
|---|---:|---|
| 구조 | 40% | 1~5의 알려진 출처 점수. 현재는 합성 fixture의 작성 점수 |
| 리뷰 | 25% | 알려진 출처의 점수와 5개 이상 표본 |
| 주행 집계 | 20% | 알려진 출처의 점수와 20개 이상 표본 |
| 연식 | 15% | 준공연도 확인, 기준 연도보다 미래가 아님 |

표본 기준 5/20은 재현 가능한 개발 품질 기준이며 익명화·동의·기록 인정 정책을 승인한 것이 아니다. 실제 리뷰/주행 집계 구현과 D-02 결정 전 실제 관측을 생성하지 않는다. 순수 계산기는 향후 집계 어댑터를 위한 입력을 지원하지만 기본 비활성 설정에서는 표본 수 없이 리뷰·주행 요소를 제외한다. S-08의 명시적 개발 opt-in은 실제 저장한 같은 구조 버전의 합성 리뷰 평균/표본을 연결하며 주행 표본은 계속 생성하지 않는다([리뷰](reviews.md)). 관리자가 factorScores.review/driving 값을 입력해도 표본을 임의로 부여하지 않는다.

결측 점수·출처 미확인·표본 수 미확인·표본 부족·미래/미확인 준공연도는 서로 다른 제외 사유다. 제외 요소의 contribution은 **null**, normalizedWeight는 0이다. 점수를 0으로 대입하지 않는다. 참여 요소의 원래 가중치 합으로 가중치를 다시 정규화한다. 참여 가중치가 40% 미만이면 `INSUFFICIENT_DATA`로 score/baseScore/unroundedScore를 모두 null로 반환한다. 예를 들어 연식만 있는 15% 자료로 낮은 별점을 만들어내지 않는다.

연식 점수는 `1 + min(asOfYear-builtYear, 40) × 0.1`이다. 준공연도가 미래/미확인이면 제외한다. 이 함수는 연식을 위한 개발 가정이며 건물의 실제 주차 설계 품질을 증명하지 않는다. 저장된 factorScores.age는 사용하지 않고 기준 연도와 준공연도로 계산해 중복/임의 대체를 막는다.

## 차량 크기 보정·반올림 순서

기준 차체는 **전장 4800mm·전폭 1850mm**다.

```text
delta = (전장-4800)/1000 × 0.8 + (전폭-1850)/1000 × 1.6
appliedDelta = clamp(delta, -1.5, +1.5)
base = 포함한 요소의 가중합 / 포함한 원래 가중치 합
unroundedScore = clamp(base + appliedDelta, 1, 5)
score = unroundedScore를 0.5 단위로 반올림(정확한 중간값은 올림)
```

폭 보정 계수를 길이의 두 배로 둔 것은 협소 공간에서 폭의 영향을 더 크게 두는 **가역적인 기술 제안**이다. 실차 회전반경·축거/미러 폭·주차 방식·운전자 실력에서 학습/검증한 계수는 아니다. 주차면 크기와 차체의 단순 차이가 주차 성공을 뜻하지 않는다.

입력 요소 점수와 가중 평균은 소수 6자리까지 반올림해 계산하고, 차체 보정·최종 클리핑·0.5 반올림은 정수 마이크로 점수로 처리한다. 같은 전체 입력(asOfYear 포함)과 같은 룰은 같은 결과다. 개별 contribution도 소수 6자리로 표시하므로 합계와 baseScore 사이에 수 마이크로 점수의 표시 오차가 있을 수 있다. 최종 계산은 개별 표시 기여분을 다시 더하지 않고 전체 가중합에서 수행한다.

양의 길이/폭 계수, 단조 클리핑과 반올림 때문에 각 차체 축이 증가할 때 점수가 내려가지 않는다. 표시 점수는 0.5 간격이므로 차체가 커져도 같은 별점일 수 있다. 검색 정렬에서 세부 차이가 필요하면 같은 ruleVersion/asOfYear/차체 기준의 unroundedScore를 사용하고 동점 기준을 추가한다. null 점수를 0으로 취급하지 않는다.

## 합성 한 곳의 재현 예시

2026년 기준 구조 2.5, 준공연도 2020 → 연식 1.6이다. 리뷰/주행 표본은 없다.

- 참여 가중치 0.55, baseScore = `(2.5×0.4 + 1.6×0.15)/0.55` → 2.254545.
- 기준 차체: 보정 0, 최종 표시 2.5.
- 5100×1900mm: 보정 +0.32, unroundedScore 2.574545, 표시 2.5.
- 3600×1900mm: 보정 -0.88, unroundedScore 1.374545, 표시 1.5.

차체 입력과 기준 사용 여부, 모든 요소의 원래/정규화 가중치·출처·표본 수·제외 사유·기여와 룰을 응답한다. 이 예시는 SYNTHETIC이며 실측 난이도나 실차 성공률이 아니다. 자료가 없어서 제외된 sampleCount는 null로 보존한다.

전체 JSON: [기본](examples/difficulty-reference.json), [차량 보정](examples/difficulty-adjusted.json), [미지원 차체](examples/difficulty-unsupported.json), [자료 부족](examples/difficulty-insufficient.json), [query](examples/difficulty-query.json). [OpenAPI](openapi.json)의 연산 상태는 구현된 개발 API와 후속 설계 API를 구분한다.

## 오류·호환성·검증

형식/범위/누락 차체 쌍/모순된 상태는 400, 인증 만료/폐기는 401, 없는/비활성 주차장과 버전은 404다. `DIFFICULTY_RULE_UNSUPPORTED`, `LOT_SOURCE_UNSUPPORTED`, 저장된 부정 계산 입력은 422다. 인증 세션당 5분 300회이며 429의 Retry-After를 따른다. 원문 query/차체/토큰을 로그에 남기지 않는다. GET은 데이터를 변경하지 않으므로 Idempotency-Key가 필요 없다.

새 읽기 경로를 추가하며 기존 인증·차량 이벤트·주차장 관리 요청/응답은 바꾸지 않는다. S-07에는 DB migration이 없었다. #8 검색은 같은 순수 계산기를 사용하며 #9는 별도 migration과 합성 리뷰 opt-in·표본/출처/정책 경계로 연결한다. 원본 차량 신호/개인 운전 요약 수집·실결제·도전 활성화는 계속 꺼져 있다.

검증은 각 차체 축 단조성, 5100mm≥3600mm, 경계/클리핑/6자리·0.5 반올림, 모든 결측/표본 사유, 불변 룰·입력 비변경·재현성, 실제 DB/HTTP의 WEB/VEHICLE·로그 제외·과거 버전/비활성·미지원 출처·오류/제한을 포함한다. 합성 API 테스트를 실제 SDK/실차 검증으로 바꾸어 보고하지 않는다.

## Wiki 반영

PR #26 develop 통합 뒤 [Wiki Difficulty](https://github.com/we-self-sufficiency/parksical-server/wiki/Difficulty)와 Home에 S-07 API/예제·계산·검증 상태를 반영했다. S-06 #8 검색/상세는 같은 계산기를 재사용하며 해당 PR 머지 후 Wiki를 별도로 갱신한다. 미배포/실제 SDK 미검증은 유지한다.

S-06에서 인증된 SDK 카탈로그 검색·상세를 연결한다. query·목록/전체 구조·차량별 난이도 정렬·페이지 및 미배포/미검증 경계는 [lot-search.md](lot-search.md)를 따른다.

S-08 리뷰 집계 metadata·소표본 평균 비공개·동일 버전 반영은 [reviews.md](reviews.md)를 따른다. 이는 difficulty-v1 계수 변경이나 실제 리뷰/익명화 승인과 다르다.
