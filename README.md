# P지컬

차량 앱 클라이언트와 서버를 함께 관리하기 위한 저장소입니다.

- [`client/`](client/): Android 차량 앱, Gradle 설정, 테스트, 화면 설계 문서
- [`server/`](server/): 기존 NestJS 서버 코드, Prisma 스키마·마이그레이션, 테스트, 문서, Docker 설정
- [서버 개발 안내](server/docs/server-development.md)
- [서버 작업지시서](server/Agent.md)

서버 명령은 저장소 루트에서 `cd server`를 실행한 뒤 사용합니다.

```sh
cd server
npm ci
npm run verify
```

환경 설정은 `server/.env.example`을 `server/.env`로 복사해 준비합니다. Docker Compose도 `server/`에서 실행합니다.

GitHub Actions 설정은 자동 실행을 위해 루트의 `.github/workflows/`에 유지하며, `server/`를 기준으로 서버를 검증합니다.

클라이언트는 Android Studio에서 `client/`를 프로젝트로 엽니다. 로컬 Android SDK·개발 설정은 `client/local.properties`에 준비하고 커밋하지 않습니다. 클라이언트 빌드·테스트는 `client/`에서 실행합니다.

```sh
cd client
./gradlew :automotive:assembleDebug :automotive:testDebugUnitTest
```

클라이언트는 [parksical-client의 develop](https://github.com/we-self-sufficiency/parksical-client/tree/bb30806ed74bd39c3310913585fed3540f42883d)을 Git subtree로 가져왔습니다. 기존 37개 커밋의 ID·작성자·날짜를 보존하며, 가져오기 전 커밋의 파일 경로는 원본 저장소 기준입니다. 전체 이력은 `git log --graph --oneline develop`에서 확인할 수 있습니다.
