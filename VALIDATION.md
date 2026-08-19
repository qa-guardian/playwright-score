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

| Repo | Score | Grade | Pass | Files | Tests | Findings |
|---|---:|:-:|:-:|---:|---:|---:|
| Playwright (own TodoMVC example) | 98 | A | ✓ | 24 | 24 | 4 |
| n8n | 95 | A | ✓ | 256 | 1,047 | 39 |
| Supabase | 98 | A | ✓ | 31 | 271 | 167 |
| Storybook | 96 | A | ✓ | 6 | 25 | 12 |
| freeCodeCamp | 97 | A | ✓ | 89 | 372 | 187 |
| cal.com | 85 | B | ✓ | 53 | 278 | 1,215 |
| Grafana | 92 | A | ✓ | 213 | 672 | 744 |
| Mattermost | 90 | A | ✓ | 284 | 1,157 | 1,476 |
| dub | 95 | A | ✓ | 15 | 125 | 26 |
| Documenso | 96 | A | ✓ | 125 | 1,109 | 579 |
| PostHog | 91 | A | ✓ | 42 | 124 | 261 |
| novu | 93 | A | ✓ | 2 | 2 | 3 |
| Immich | 90 | A | ✓ | 13 | 43 | 39 |
| openplayerjs | 77 | C | ✗ FAIL | 8 | 77 | 36 |
| livecodes | 78 | C | ✗ FAIL | 14 | 280 | 140 |
| TheCyberHub | 73 | C | ✗ FAIL | 11 | 138 | 275 |
| sencho | 90 | A | ✓ | 26 | 177 | 263 |

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
