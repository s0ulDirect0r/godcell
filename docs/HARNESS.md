# Harness

The harness is a simple quality gate: **typecheck + lint + test**.

## Running

```bash
npm run harness
```

This runs:
1. `npm run typecheck` - TypeScript type checking (server + client)
2. `npm run lint` - ESLint on all .ts/.tsx files
3. `npm run test:run` - Vitest unit tests

## When to Run

- After making code changes (before committing)
- Before creating a PR
- CI runs it automatically on push/PR

## When It Fails

Fix the failure before continuing:

1. **Typecheck failed** - Fix the type error. Read the error message carefully.
2. **Lint failed** - Run `npm run lint:fix` for auto-fixable issues.
3. **Tests failed** - Fix the failing test. If it's a flaky test, create a beads issue.

## CI

The harness runs on GitHub Actions for all pushes to main/staging and all PRs.
See `.github/workflows/harness.yml`.
