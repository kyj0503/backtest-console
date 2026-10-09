# Backtest Console — 라고할때살걸 프론트엔드

React·TypeScript로 구현한 전략·포트폴리오 백테스트 화면입니다.
백엔드와 DB는 [kyj0503/backtest](https://github.com/kyj0503/backtest)에서 관리합니다.
기존 backtest 저장소의 `backtest_fe` 관련 커밋 456개를 보존하여 분리했습니다.

## 로컬 실행

백엔드 저장소에서 개발 Compose를 먼저 실행한 후:

```bash
docker compose -f compose.dev.yaml up -d --build
```

localhost:5173에서 접속합니다. Docker의 Vite 프록시는 호스트의 백엔드 :8000을 사용합니다.
네이티브 실행은 `.env.example`을 참고하여 `npm ci`, `npm run dev`를 사용합니다.
`VITE_API_BASE_URL`은 비워 두어야 합니다. API 호출에 이미 `/api/v1/...` 전체 경로가 들어갑니다.

## 검증

```bash
docker build --target test .
sh scripts/audit-deps.sh
docker build --target runtime .
```

Docker test 단계에서 ESLint, 앱·테스트 TypeScript 검사, Vitest를 실행합니다.
의존성 감사는 예외 없이 high/critical 발견을 차단합니다. Playwright E2E는 FE/BE가 실행 중일 때 별도로 수행합니다.
shadcn으로 생성한 UI 컴포넌트는 저장소 소스에 포함되어 있습니다. 빌드·실행에서 쓰지 않는 생성 CLI 의존성은 제거했습니다.

## GitHub Actions 배포

- PR(main/dev): Docker 테스트, 의존성 감사, 런타임 빌드.
- main push/수동 실행: 검증 후 production에 배포합니다. dev는 CI 검증만 수행합니다.
- GHCR ARM64 이미지 `ghcr.io/kyj0503/backtest-console`를 불변 digest로 배포합니다.
- OCI 컨테이너는 `backtest-fe` 하나입니다. 개발은 로컬 `compose.dev.yaml`을 사용합니다.
- 서버 배포 경로는 `/opt/backtest-console/production`입니다.
- Compose는 외부 `backend-net`을 사용하고 호스트 포트를 공개하지 않습니다.
- OCI의 `BACKTEST_API_UPSTREAM`은 `backtest-be:8000`입니다. 브라우저에는 같은 Origin의 API 경로만 사용합니다.
- GitHub의 production Environment에 `OCI_SSH_KEY` Secret과 `OCI_HOST`, `OCI_USER`, `OCI_KNOWN_HOSTS`, `TS_CLIENT_ID`, `TS_AUDIENCE` Variables가 필요합니다.
- 자동 GITHUB_TOKEN으로 GHCR를 사용하고 Tailscale OIDC로 github-oci의 SSH에 연결합니다.
- 프론트엔드는 현재 비밀 런타임 환경변수가 필요하지 않습니다. VITE_* 값은 공개 번들에 포함되므로 비밀값을 넣지 않습니다.
- 실패 시 이전 릴리스를 복원합니다. 공통 Nginx는 `/opt/gateway`에서 별도로 관리합니다.
- main 대상 PR은 사용자가 직접 병합합니다.

## 소스 규칙

Feature-Sliced Design의 `shared <- features <- pages` 방향을 유지합니다.
실행 관련 주의사항은 [AGENTS.md](AGENTS.md), UI 상세 문서는 [docs/README.md](docs/README.md)를 참고합니다.
