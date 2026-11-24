import type { RuleRow } from './types.js';
import { flakeRiskRows } from './flake-risk.js';
import { passesRegardlessRows } from './passes-regardless.js';
import { suiteRows } from './suite.js';

/**
 * Forms decided from how a reported value or call is used (QAG-287 B3b, src/use-forms.ts). Each is likely by
 * design, never certain, and keeps the docs, family, basis, dimension and label of the row it narrows:
 *  handle-argument  no-element-handle (C11). The handle is only passed to a function that is neither a Playwright API
 *                   nor expect; whether that function accepts a Locator is not decided from the source. Docs: "The use
 *                   of ElementHandle is discouraged, use Locator objects and web-first assertions instead."
 *  escaped          valid-expect (C2). The matcherless expect(...) is returned, assigned, passed on or stored, so a
 *                   matcher may be applied elsewhere. Docs: "To make an assertion, call `expect(value)` and choose a
 *                   matcher that reflects the expectation."
 *  gated            no-page-pause (C12). The pause runs only when a condition holds. Docs: "This method requires
 *                   Playwright to be started in a headed mode, with a falsy headless option."
 */
export const HANDLE_ARGUMENT_FORM = 'handle-argument';
export const ESCAPED_FORM = 'escaped';
export const GATED_FORM = 'gated';

type Copy = Pick<RuleRow, 'title' | 'what' | 'why' | 'fix'>;

const CELLS: ReadonlyArray<[rule: string, from: string, form: string, copy: Copy]> = [
  [
    'playwright/no-element-handle',
    '-',
    HANDLE_ARGUMENT_FORM,
    {
      title: 'Element handle passed to another function',
      what: 'The test takes an ElementHandle with $(), $$() or elementHandle() and only passes it to another function.',
      why: 'If that function can take a locator, the handle is not needed: a handle can go stale after the page re-renders, which causes random failures.',
      fix: 'If the function accepts a locator, pass the locator instead of a handle.',
    },
  ],
  [
    'playwright/valid-expect',
    'matcherless',
    ESCAPED_FORM,
    {
      title: 'expect() without a matcher, used elsewhere',
      what: 'An expect() call without a matcher is returned, stored or passed on, so a matcher may be applied elsewhere.',
      why: 'If no code applies a matcher to it, the check verifies nothing, so a broken feature can ship while the test passes.',
      fix: 'Make sure a matcher is called and awaited on every such value, or call the matcher where expect() is called.',
    },
  ],
  [
    'playwright/no-page-pause',
    '-',
    GATED_FORM,
    {
      title: 'Debugger pause behind a condition',
      what: 'page.pause() runs only when a condition holds, such as an environment flag.',
      why: 'If the condition is ever true in a CI run, the run halts until someone intervenes and the job hangs.',
      fix: 'Delete page.pause() before committing; to step through a test, run it with the --debug flag instead.',
    },
  ],
];

/** One row per form: the narrowed row with its own copy, likely by design. */
export const useFormRows: readonly RuleRow[] = CELLS.map(([rule, from, form, copy]) => {
  const base = [...passesRegardlessRows, ...flakeRiskRows, ...suiteRows].find((r) => r.rule === rule && r.form === from);
  if (!base) throw new Error(`${rule} has no catalogue row of form ${from}`);
  const { cls: _cls, docsSentence: _docsSentence, ...rest } = base;
  return { ...rest, form, design: 'likely', bcEligible: false, ...copy };
});
