# AGENTS.md

## Repository and Git

- This repository owns the Backtest React console. Backend code and DB migrations are in `kyj0503/backtest`.
- Work on `feature/*` branches based on `dev`; send reviewed changes through `dev` to `main`.
- Agents never merge a PR targeting `main` or enable auto-merge. The user merges it in GitHub.
- Preserve unrelated local changes and never force-push shared branches.
- Keep this as the only agent instruction file.

## Validation and deployment

- Verify in Docker before declaring work complete: `docker build --target test .`, `sh scripts/audit-deps.sh`, and `docker build --target runtime .`.
- The test target runs ESLint, production and test TypeScript checks, and Vitest. All 344 tests passed before the repository split (2026-10-09).
- GitHub Actions validates PRs, publishes an ARM64 image on main/dev, and deploys its immutable digest through Tailscale and pinned OpenSSH.
- main uses production; dev uses development. Each environment has its own deployment SSH key and OIDC identity.
- Compose and deployment scripts live here; shared gateway files live outside the application repositories. Runtime secrets never belong in Git.
- Playwright E2E requires a running frontend and backend; it is not part of a Docker image build.

## Application constraints

- Feature-Sliced Design: shared <- features <- pages. No reverse imports.
- `VITE_API_BASE_URL` must stay empty. Callers already supply full `/api/v1/...` paths.
- Build with `NODE_ENV=production`. Preserve the existing build scripts' explicit setting.
- Never disable Vitest isolation (`isolate: false` makes test order affect results).
- Keep axios `adapter: 'fetch'`; timeout/cancellation tests rely on it with happy-dom/MSW.
- Render external news text as React text, never with `dangerouslySetInnerHTML`.
- Tailwind 4 is CSS-first. Theme values are injected at runtime; preserve `.app-container` and the existing dark custom variant.
- The backend's minimum period and FE `VALIDATION_RULES.MIN_BACKTEST_PERIOD_DAYS` must remain aligned.
- `/api/v1/backtest` must reach the environment-specific backend without redirecting POSTs or adding a duplicate `/api` prefix.
- Node package changes require updating package-lock.json and re-running tests and dependency audit. Do not weaken the high/critical vulnerability gate.

## Commit messages

Use `tag(scope): subject`, typically scopes `fe` or `infra` and tags `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
