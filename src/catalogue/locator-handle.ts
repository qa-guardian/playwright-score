import type { RuleRow } from './types.js';
import { flakeRiskRows } from './flake-risk.js';

/**
 * `elementHandle()` and `elementHandles()` called on a Playwright Locator (QAG-287 S4c). The call turns a
 * Locator back into the ElementHandle the docs discourage, so it is reported under `no-element-handle`, in a
 * cell of its own: likely by design, never certain.
 */
export const LOCATOR_HANDLE_RULE = 'playwright/no-element-handle';

/** Form of a no-element-handle finding on a Locator's `elementHandle()` or `elementHandles()`. */
export const LOCATOR_HANDLE_FORM = 'locator-handle';

/** The `locator-handle` cell: the rule's own row (docs, family, basis, dimension, label) with copy for this call. */
export const locatorHandleRows: readonly RuleRow[] = [LOCATOR_HANDLE_RULE].map((rule) => {
  const base = flakeRiskRows.find((r) => r.rule === rule && r.form === '-');
  if (!base) throw new Error(`${rule} has no catalogue row`);
  const { cls: _cls, docsSentence: _docsSentence, ...rest } = base;
  return {
    ...rest,
    form: LOCATOR_HANDLE_FORM,
    design: 'likely',
    bcEligible: false,
    title: 'Element handle taken from a locator',
    what: 'The test turns a locator into an ElementHandle with elementHandle() or elementHandles().',
    why: 'A handle points at one element at one moment and can go stale after the page re-renders, which causes random failures.',
    fix: 'Use the locator directly: call its actions and web-first assertions instead of taking a handle.',
  };
});
