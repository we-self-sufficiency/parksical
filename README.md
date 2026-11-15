# P지컬

차량 앱 클라이언트와 서버를 함께 관리하기 위한 저장소입니다.

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
