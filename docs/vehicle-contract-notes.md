# 차량 계약 근거·확인 요청

2026-11-13 확인 · S-01 #2 · 상세 실차/미션 조사는 S-11 #12. 아래 공식 문서 확인과 대상 차량에서의 사용 가능 확인을 구분한다.

| 영역 | 확인한 문서상 사실 | 남은 확인·담당 |
|---|---|---|
| SDK 경계 | Vehicle SDK는 차량 내부 Vehicle Service에 연결 | 차량 앱의 실제 SDK/Service 버전·초기화/해제·오류 로그 확인. 서버는 SDK에 링크하지 않음 |
| 지원 여부 | API/AAOS 속성은 차종에 따라 다르며 실제 capability·접근 확인 필요 | gear/speed/steering/brake/safety/carProfile/navigation 각 상태·권한 거부·주기·단위·오래된 값 정의를 앱 담당자에게 확인 |
| UX 제한 | CarUxRestrictions와 ActiveRestrictions로 앱 기능별 제한 적용 | 실제 대상 차량/지역 restriction 값과 P단 충돌 처리. 서버에 정차 증명 API를 만들지 않음 |
| 내비 | 지원/도착 이벤트는 내비 환경과 구현에 의존 | 실제 목적지 요청/도착/해제·중복·실패, 수동 주차장 선택 대체 경로 확인 |
| Safety | 일반 경고등과 장애물/주차 접근 경고를 구분해야 함 | 필요한 이벤트 종류·의미·반복 횟수·원시 권한을 S-11에서 확인. 경고 0회로 충돌 없음 단정 금지 |
| 조향·위치 | 핸들 회전각과 차량 방향 변화는 같은 양이 아님 | 단위·조향비·축거·회전 방향·지하 구조 정합·정확도 실측은 앱/실차 검증 대상 |
| MAX | 카테고리·게임 주행 동작은 별도 확인 필요 | S-11에서 정책과 앱 분류 조사. 최소 HUD면 자동 허용된다고 가정하지 않음 |

## 앱 담당자와 합의할 질문

1. 각 SDK/AAOS 신호의 실제 API·권한·area·단위·주기·capability·읽기 실패를 공식 URL과 함께 제공할 수 있는가?
2. 앱 설치 연결과 로그인 사용자 변경 시 진행 중 세션/로컬 위치 큐를 어떻게 분리·폐기하는가?
3. 오프라인 이벤트 ID/sequence를 앱 재시작에도 유지할 수 있는가? 같은 설치 재설치 시 새 installationId를 만드는가?
4. 원본이 아닌 최소 결과 DTO로 어떤 근거/품질을 보낼 수 있는가? D-02 전에는 합성 데이터로 검증 가능한가?
5. 구간 진입/종료와 P단의 미션 종료 의미, 과속 중단 시각과 경고의 정확한 종류는 무엇인가?
6. 늦은 위치 업로드·사용자 수정 충돌·QR 표시 제한을 앱과 어떻게 재현할 것인가?

SDK 클래스/메서드 이름을 API 계약의 필드 이름으로 추측 생성하지 않는다. OpenAPI의 Capabilities는 우리 서비스 DTO이며 SDK API 시그니처가 아니다. 기어/차속/조향각 원본 시계열과 범용 map 필드는 이번 수신 명세에 없다. 현재 자료는 실차 테스트·플랫폼 심사 승인·센서 정확성 증거가 아니다.

## 공식 근거

- [Vehicle SDK](https://document.pleos.ai/en/api-reference/connect-sdk-pleos/Vehicle/intro) — 기존 Agent.md의 연결 경계 근거. 세부 시그니처는 S-11에서 버전별 재확인.
- [API Compatibility & Availability](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-planning-guide/api-compatibility-availability) — 이번 확인: 차종별 capability/AAOS 접근 확인 원칙, 모델명 분기 대신 지원 확인.
- [Driving Restriction Development Guide](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/driving-restriction-development-guide) — 이번 확인: 앱에서 CarUxRestrictions와 ActiveRestrictions 적용.
- [NaviHelper](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/NaviHelper/intro), [Virtual Console](https://document.pleos.ai/en/docs/pleos-only/app-test-guide/virtual-console-guide), [앱 심사](https://document.pleos.ai/en/docs/pleos-only/distribute/app-review-guide/review-driver-distraction-elements) — Agent.md 참고 자료. 미션별 신호·주행 허용 범위의 결론은 S-11에서 기록.

외부 담당자에게 문의를 보냈거나 승인을 받았다고 기록하지 않는다. 질문을 정리하고 실제 답변·실측 자료가 확보됐을 때 출처/차량/버전/날짜를 추가한다.
