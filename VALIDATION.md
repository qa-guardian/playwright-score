# Real-world validation

`playwright-score` is validated against real, public Playwright suites —
not just its own fixtures — on an ongoing basis. This file documents the
methodology and the current results; `scripts/validate-corpus.sh`
re-produces them from scratch against each repo's live `main`/`master`.

Every bug this project has found and fixed was found this way: point the
tool at real code, read the findings by hand, and treat anything
suspicious as a bug in the scorer until proven otherwise.

## Running it yourself

```bash
npm run build
bash scripts/validate-corpus.sh            # profile=standard threshold=80
bash scripts/validate-corpus.sh guardian 75
```

Each entry is a fresh, shallow, sparse clone of the real repo (only the
Playwright suite's own subdirectory is fetched) — nothing here is
committed to this repository, so there's no third-party source to keep in
sync or any licensing question to answer. Scores will drift slightly over
time as these projects' own suites change; that's expected and fine.

## Results (last run: 2026-08-19, `sqs-v1`, `standard` profile, threshold 80)

Chosen deliberately to include both well-known, heavily-engineered
platforms and smaller, less mature projects — this isn't a corpus
selected to make the tool look good.

| Repo (source scanned) | Score | Grade | Pass | Files | Tests | Findings |
|---|---:|:-:|:-:|---:|---:|---:|
| [Playwright (own TodoMVC example)](https://github.com/microsoft/playwright/tree/main/examples/todomvc) | 98 | A | ✓ | 24 | 24 | 4 |
| [n8n](https://github.com/n8n-io/n8n/tree/master/packages/testing/playwright) | 95 | A | ✓ | 256 | 1,047 | 39 |
| [Supabase](https://github.com/supabase/supabase/tree/master/e2e) | 98 | A | ✓ | 31 | 271 | 167 |
| [Storybook](https://github.com/storybookjs/storybook/tree/next/code/e2e-internal) | 96 | A | ✓ | 6 | 25 | 12 |
| [freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp/tree/main/e2e) | 97 | A | ✓ | 89 | 372 | 187 |
| [cal.com](https://github.com/calcom/cal.com/tree/main/apps/web/playwright) | 85 | B | ✓ | 53 | 278 | 1,215 |
| [Grafana](https://github.com/grafana/grafana/tree/main/e2e-playwright) | 92 | A | ✓ | 213 | 672 | 744 |
| [Mattermost](https://github.com/mattermost/mattermost/tree/master/e2e-tests/playwright) | 90 | A | ✓ | 284 | 1,157 | 1,476 |
| [dub](https://github.com/dubinc/dub/tree/main/apps/web/playwright) | 95 | A | ✓ | 15 | 125 | 26 |
| [Documenso](https://github.com/documenso/documenso/tree/main/packages/app-tests) | 96 | A | ✓ | 125 | 1,109 | 579 |
| [PostHog](https://github.com/PostHog/posthog/tree/master/playwright) | 91 | A | ✓ | 42 | 124 | 261 |
| [novu](https://github.com/novuhq/novu/tree/next/apps/dashboard/tests) | 93 | A | ✓ | 2 | 2 | 3 |
| [Immich](https://github.com/immich-app/immich/tree/main/e2e/src/specs) | 90 | A | ✓ | 13 | 43 | 39 |
| [openplayerjs](https://github.com/openplayerjs/openplayerjs/tree/master/e2e) | 77 | C | ✗ FAIL | 8 | 77 | 36 |
| [livecodes](https://github.com/live-codes/livecodes/tree/develop/e2e) | 78 | C | ✗ FAIL | 14 | 280 | 140 |
| [TheCyberHub](https://github.com/th3cyb3rhub/TheCyberHub/tree/dev/e2e) | 73 | C | ✗ FAIL | 11 | 138 | 275 |
| [sencho](https://github.com/Studio-Saelix/sencho/tree/main/e2e) | 90 | A | ✓ | 26 | 177 | 263 |

Repo names link straight to the exact scanned source on GitHub — re-run
`scripts/validate-corpus.sh` for the full findings list of any entry, or
`playwright-score <path> --format markdown` against your own clone.

**14 pass / 3 fail / 17 total.** 1,262 files, 5,701 tests.

## Bugs found this way, and fixed

Each of these was a real repo producing a wrong or unusable result — not
a hypothetical:

- **ESLint `basePath` bug** — the core reason the tool had zero effect
  anywhere it was used before this hardening pass.
- **Syntax errors scored 100/A** — the worst possible input got the best
  possible grade. Now a hard fail.
- **`node_modules` not excluded from directory scans** — a vendored
  dependency shipping its own `*.spec.ts` files got silently swept in.
- **`playwright/prefer-locator`/`prefer-native-locators` configured but
  never enabled** — Playwright's classic `page.click(selector)` anti-pattern
  was completely invisible to the score.
- **Page Object Model suites scored 0/100 on locators** (n8n: 256 spec
  files, 0 direct locator calls, real locators living in a separate
  page-object layer) — fixed by tracing relative imports into local
  dependency files (`src/import-graph.ts`).
- **Assertion delegation only recognized free functions, never a class
  method** — almost every real Page Object Model is a class. Also missed
  `.waitFor({ state })`-style assertions and delegation more than one call
  deep (n8n's `NotificationsPage`).
- **`.e2e.`/`.e2e-spec.` naming conventions not discovered at all** —
  cal.com (53 specs, `*.e2e.ts`) and Immich (13 specs, `*.e2e-spec.ts`,
  alongside 31 same-suffix `vitest`/`supertest` backend specs correctly
  excluded) both hard-failed with "no files matched" despite fully healthy
  suites.
- **CLI stdout truncation on large output** — `console.log()` immediately
  followed by `process.exit()` raced Node's async pipe write; any report
  over 64KB (cal.com's 1,215-finding JSON, ~370KB) was silently cut at
  exactly the pipe buffer boundary when piped to another process. Anyone
  running `playwright-score ... | jq` (or any CI log processor) on a large
  enough suite got truncated, invalid JSON with no error.

See `CHANGELOG.md` for the full, dated history.
