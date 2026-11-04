# Contributing

## Prerequisites

- Node.js 20+ (tested on 24.18.0)
- npm 10+
- Chrome / Chromium 116+
- A Gemini API key (only for live smoke tests; unit and E2E tests are fully offline)

## Setup

```bash
npm install
npm run build
```

Create a `.env` in the repository root (see `.env.example`) or run the Windows setup script:

```powershell
.\scripts\setup-windows.ps1
```

## Development workflow

| Command              | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `npm run check`      | Typecheck + lint + format check + unit tests   |
| `npm run build`      | Production build (extension + bridge)          |
| `npm test`           | Unit tests (Vitest)                            |
| `npm run test:e2e`   | Playwright E2E against a real Chromium         |
| `npm run test:soak`  | Long-session stability smoke test              |
| `npm run release`    | Production build + deterministic ZIP + SHA-256 |
| `npm run bridge`     | Run the built bridge                           |
| `npm run dev:bridge` | Run the bridge in watch mode                   |

## Commit conventions

Conventional commits with a DCO sign-off (`git commit -s`):

```
type(scope): short description

Longer explanation of why, not what.

Signed-off-by: Your Name <email>
```

Types: `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `perf`, `ci`.

## Tests

- Unit tests live in `tests/unit/` and run in Node by default. DOM-dependent suites opt into `happy-dom` per file via `// @vitest-environment happy-dom`.
- E2E tests live in `tests/e2e/` and use a real unpacked extension. They rebuild the extension in global setup.
- Never mark a test as passing without running it. If a check cannot be automated, document it as `PARTIAL` or `NOT TESTED` in `docs/IMPLEMENTATION_STATUS.md`.

## Pull requests

1. Run `npm run check` and `npm run test:e2e` locally.
2. Update `docs/IMPLEMENTATION_STATUS.md` and `docs/TEST_REPORT.md` if you changed behaviour or test counts.
3. Keep commits atomic (one logical change per commit).
4. No force-push to shared branches.
