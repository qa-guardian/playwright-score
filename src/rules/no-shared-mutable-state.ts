import type { Rule } from 'eslint';
import { TEST_ALIAS_SCHEMA, serialScopeOf, testNamesFromOptions, type AnyNode } from './rule-util.js';
import { analyzeSharedVariable, titleOf } from './shared-state-analysis.js';

/**
 * `pwscore/no-shared-mutable-state` (QAG-287). A module-level or
 * describe-level `let`/`var` (or a `const` bound to an object/array
 * literal, `new Map()` or `new Set()`) that one `test(...)` body assigns or
 * mutates and a DIFFERENT `test(...)` body reads without writing it
 * itself. Run alone, in another order or on another worker, the reader sees
 * the initial value, so the suite is order-dependent.
 *
 * Not matched: variables in serial mode (`test.describe.serial`, or
 * `test.describe.configure({ mode: 'serial' })` at file level or in an
 * enclosing describe); assignment only inside `beforeEach`/`beforeAll`/`afterEach`
 * (setup); a variable that any `beforeEach` assigns (it is reset before each
 * test); a reader that also writes the variable itself (its own setup);
 * variables declared inside a test.
 * Mutation = assignment, `++`/`--`, member assignment (`v.x = 1`), or a
 * call of `push/pop/shift/unshift/splice/set/add/delete/clear/sort/reverse`
 * on a variable that is known to be a collection (initialised, or assigned
 * anywhere, with an array/object/Map/Set literal or constructor). A method
 * call on anything else (an SDK client `payload.delete(...)`) is a call, not
 * a mutation of the variable.
 *
 * QAG-287 slice E2: a writer only counts for a reader when it runs BEFORE the
 * reader in source order, writes the same property (`made.yearTeam = x` does
 * not feed a reader of `made.team`), and the reader does not itself call a
 * same-file helper that assigns the variable (its own setup).
 *
 */
export const noSharedMutableState: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow state written in one test and read in another' },
    messages: {
      shared:
        '`{{name}}` is written in test "{{writer}}" and read in this test. Tests that share state depend on run order and break under retries or parallel workers. Create the state inside each test (or a fixture/beforeEach).',
    },
    schema: TEST_ALIAS_SCHEMA,
  },
  create(context) {
    const testNames = testNamesFromOptions(context.options);
    return {
      VariableDeclarator(node: AnyNode) {
        const shared = analyzeSharedVariable(context.sourceCode, node, testNames);
        // Serial mode is Playwright's documented way to share state in order:
        // only an unordered pair is a finding. One finding per variable.
        const pair = shared?.pairs.find((p) => !p.serial);
        if (!shared || !pair) return;
        context.report({
          node: pair.reader as never,
          messageId: 'shared',
          data: { name: shared.name, writer: titleOf(pair.writerTest) },
        });
      },
    };
  },
};

/**
 * Report-only companion (QAG-287 E3). A serial scope is reported only when it
 * holds tests that really depend on order: one test assigns a shared
 * variable and a LATER test in the same serial scope reads it (the same
 * writer-before-reader analysis as `no-shared-mutable-state`). Serial mode
 * used for mutual exclusion, a shared expensive setup, or around a single
 * test is not reported. No double report: `no-shared-mutable-state` skips
 * pairs that sit in a serial scope, and this rule skips any variable that
 * rule reports (a pair outside a serial scope), so one variable produces at
 * most one finding across the two rules. One finding per serial scope.
 */
export const serialModeDependency: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Report serial scopes where a later test reads state an earlier test wrote' },
    messages: {
      serial:
        'Serial mode: test "{{reader}}" reads `{{name}}`, which test "{{writer}}" sets earlier, so these tests depend on running in order. One failure skips the rest and retries rerun the whole group. Information only.',
    },
    schema: TEST_ALIAS_SCHEMA,
  },
  create(context) {
    const testNames = testNamesFromOptions(context.options);
    const reported = new Set<AnyNode>();
    return {
      VariableDeclarator(node: AnyNode) {
        const shared = analyzeSharedVariable(context.sourceCode, node, testNames);
        if (!shared || shared.pairs.some((p) => !p.serial)) return;
        const pair = shared.pairs[0];
        const scope = serialScopeOf(pair.readerTest, testNames);
        if (!scope || reported.has(scope)) return;
        reported.add(scope);
        context.report({
          node: scope as never,
          messageId: 'serial',
          data: { name: shared.name, writer: titleOf(pair.writerTest), reader: titleOf(pair.readerTest) },
        });
      },
    };
  },
};
