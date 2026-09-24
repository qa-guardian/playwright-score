# Vendored files — microsoft/playwright examples

These fixtures are unmodified (attribution header only) copies of real spec
files from the [microsoft/playwright](https://github.com/microsoft/playwright)
repository, used by `tests/official-examples.test.ts` to assert that
Playwright's own official examples score highly under this package's
`standard` profile (2.0.0 acceptance bar — see CHANGELOG.md).

- **Source repo:** https://github.com/microsoft/playwright
- **License:** Apache-2.0 — see `LICENSE` and `NOTICE` in this directory,
  copied unmodified from the upstream repo's own root-level `LICENSE` and
  `NOTICE` files at the commit below.
- **Commit scanned:** `91eeb0cfe92482f18ff8d40d746903ef23c0d8fd` (`main`, 2026-09-23)
- **Files:** unmodified except for the two-line attribution header this
  project adds at the top of each file (source path, commit SHA, license).

| Vendored file | Upstream path |
|---|---|
| `todomvc/should-add-single-todo.spec.ts` | `examples/todomvc/tests/adding-todos/should-add-single-todo.spec.ts` |
| `todomvc/should-complete-single-todo.spec.ts` | `examples/todomvc/tests/completing-todos/should-complete-single-todo.spec.ts` |
| `todomvc/should-delete-single-todo.spec.ts` | `examples/todomvc/tests/deleting-todos/should-delete-single-todo.spec.ts` |
| `examples/test-api.spec.ts` | `examples/github-api/tests/test-api.spec.ts` |

`examples/test-api.spec.ts` scores 97/A, not 100 — its only finding is
`pwscore/eslint-disable-comment` on the same `/* eslint-disable
notice/notice */` licence-header comment discussed below, a real,
unconditional demerit regardless of what the comment is aimed at (see
CHANGELOG.md's 2.0.0 "Added — inline eslint-disable comments" entry).
97 still clears the >= 90 acceptance bar.

## Investigated and excluded: `examples/svgomg/tests/example.spec.ts`

This is also a real, currently-published Playwright example — literally
named `example.spec.ts`, the closest match in the monorepo to the
`create-playwright` scaffold's `tests/example.spec.ts` (that scaffold
itself isn't a static file in the `microsoft/playwright` repo — the
`npm init playwright` CLI generates it from a template that isn't checked
in as its own file, so it can't be vendored the same way). It was checked
against the 2.0.0 acceptance bar and scores **79/C**, not ≥90/A.

Investigated before excluding it, per the instruction to treat a low
official-example score as a scorer bug by default: the finding is 12×
`playwright/no-raw-locators` and 1× `playwright/prefer-locator`, all from
`page.locator('.menu li')`-style CSS selectors and `page.click('text=...')`
calls — the exact anti-pattern Playwright's own current docs (see
[Locators](https://playwright.dev/docs/locators)) recommend against in
favor of `getByRole`/`getByText`/`getByTestId`. The file also carries a
`/* eslint-disable notice/notice */` comment — this is Playwright's own
monorepo license-header lint escape (`notice/notice` enforces a copyright
header ESLint rule this package doesn't bundle or check), not a sign of
outdated code: `github-api/tests/test-api.spec.ts` (vendored above as
`examples/test-api.spec.ts`) carries the exact same comment and still
scores 97/A. This is genuine outdated locator practice in an older,
less-maintained example, not a scorer false positive: the three
`todomvc` specs above and `github-api/tests/test-api.spec.ts`, all more
recently written and locator-idiomatic, score 100/A and 97/A respectively
on the exact same rule set. `svgomg`'s `example.spec.ts` was left out of
the vendored set rather than special-cased in a rule to make it pass.
