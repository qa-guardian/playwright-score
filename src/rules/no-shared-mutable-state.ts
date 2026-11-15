import type { Rule } from 'eslint';
import {
  TEST_ALIAS_SCHEMA,
  enclosingFunction,
  hookName,
  isDescribeCall,
  isInSerialScope,
  isSerialConfigureCall,
  isSerialDescribeCall,
  isTestDeclaration,
  propName,
  testNamesFromOptions,
  unwrap,
  type AnyNode,
} from './rule-util.js';

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
 * Companion `pwscore/serial-mode-dependency` is report-only information:
 * `test.describe.configure({ mode: 'serial' })` and `test.describe.serial()`
 * declare that tests depend on order; not an error on its own.
 */
const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'set', 'add', 'delete', 'clear', 'sort', 'reverse']);

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

    /** The test(...) call (and its title) whose callback contains `node`, if any. */
    const owningTest = (node: AnyNode): AnyNode => {
      let fn = enclosingFunction(node);
      while (fn) {
        const call = fn.parent;
        if (call?.type === 'CallExpression' && call.arguments.includes(fn)) {
          if (isTestDeclaration(call, testNames)) return call;
          if (hookName(call, testNames)) return undefined;
        }
        fn = enclosingFunction(fn);
      }
      return undefined;
    };
    const owningHook = (node: AnyNode): string | undefined => {
      let fn = enclosingFunction(node);
      while (fn) {
        const call = fn.parent;
        if (call?.type === 'CallExpression' && call.arguments.includes(fn)) {
          const h = hookName(call, testNames);
          if (h) return h;
          if (isTestDeclaration(call, testNames)) return undefined;
        }
        fn = enclosingFunction(fn);
      }
      return undefined;
    };
    /** Declared directly at module level or directly in a describe callback. */
    const isSharedScope = (decl: AnyNode): boolean => {
      const fn = enclosingFunction(decl);
      if (!fn) return true;
      const call = fn.parent;
      return call?.type === 'CallExpression' && call.arguments.includes(fn) && isDescribeCall(call, testNames);
    };
    const isMutableInit = (kind: string, init: AnyNode): boolean => {
      if (kind !== 'const') return true;
      const i = unwrap(init);
      return (
        !!i &&
        (i.type === 'ObjectExpression' ||
          i.type === 'ArrayExpression' ||
          (i.type === 'NewExpression' && i.callee?.type === 'Identifier' && (i.callee.name === 'Map' || i.callee.name === 'Set')))
      );
    };
    const isCollectionLike = (node: AnyNode): boolean => {
      const i = unwrap(node);
      return (
        !!i &&
        (i.type === 'ObjectExpression' ||
          i.type === 'ArrayExpression' ||
          (i.type === 'NewExpression' &&
            i.callee?.type === 'Identifier' &&
            ['Map', 'Set', 'Array', 'WeakMap', 'WeakSet'].includes(i.callee.name)))
      );
    };
    /** First property key read or written through `id` (`v.a.b` -> 'a', `v[0]` -> '0'), if static. */
    const firstKey = (id: AnyNode): string | undefined => {
      const m = id.parent;
      if (m?.type !== 'MemberExpression' || m.object !== id) return undefined;
      if (!m.computed && m.property?.type === 'Identifier') return m.property.name;
      if (m.computed && m.property?.type === 'Literal') return String(m.property.value);
      return undefined;
    };
    const startOf = (call: AnyNode): number => (call.range ? call.range[0] : (call.start ?? 0));
    /** Does the test callback call one of these same-file helpers? */
    const callsAny = (testCall: AnyNode, names: Set<string>): boolean => {
      if (names.size === 0) return false;
      let found = false;
      const visit = (n: AnyNode): void => {
        if (found || !n || typeof n !== 'object') return;
        if (Array.isArray(n)) {
          for (const x of n) visit(x);
          return;
        }
        if (typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && names.has(n.callee.name)) {
          found = true;
          return;
        }
        for (const [k, v] of Object.entries(n)) if (k !== 'parent') visit(v);
      };
      visit(testCall.arguments);
      return found;
    };
    /** Name of the same-file function (declaration or const arrow) that contains `node`, if any. */
    const helperNameOf = (node: AnyNode): string | undefined => {
      const fn = enclosingFunction(node);
      if (!fn) return undefined;
      if (fn.type === 'FunctionDeclaration' && fn.id) return fn.id.name;
      if (fn.parent?.type === 'VariableDeclarator' && fn.parent.id?.type === 'Identifier') return fn.parent.id.name;
      return undefined;
    };
    const titleOf = (call: AnyNode): string => {
      const t = call.arguments?.[0];
      return t?.type === 'Literal' && typeof t.value === 'string' ? t.value : 'another test';
    };
    /**
     * Is this reference a write/mutation of the variable? `path` is the first
     * property written (`v.x = 1`), undefined for a whole-variable write or a
     * collection mutation. `isCollection` gates the push/set/add/... calls.
     */
    const isMutation = (id: AnyNode, ref: AnyNode, isCollection: boolean): { path?: string } | undefined => {
      if (ref.isWrite()) return {};
      let child = id;
      let parent = id.parent;
      while (parent?.type === 'MemberExpression' && parent.object === child) {
        const gp = parent.parent;
        if (gp?.type === 'AssignmentExpression' && gp.left === parent) return { path: firstKey(id) };
        if (gp?.type === 'UpdateExpression') return { path: firstKey(id) };
        if (gp?.type === 'CallExpression' && gp.callee === parent) {
          const name = propName(parent);
          if (isCollection && name && MUTATORS.has(name) && parent.object === id) return {};
        }
        child = parent;
        parent = gp;
      }
      return undefined;
    };

    return {
      VariableDeclaration(node: AnyNode) {
        if (!isSharedScope(node)) return;
        for (const decl of node.declarations) {
          if (decl.id?.type !== 'Identifier' || !isMutableInit(node.kind, decl.init)) continue;
          const [variable] = context.sourceCode.getDeclaredVariables(decl) as AnyNode[];
          if (!variable) continue;
          // Serial mode is Playwright's documented way to share state in order.
          if (isInSerialScope(decl, testNames)) continue;

          const refs = variable.references as AnyNode[];
          const isCollection =
            isCollectionLike(decl.init) || refs.some((r) => r.isWrite() && r.writeExpr && isCollectionLike(r.writeExpr));
          type Write = { id: AnyNode; path?: string };
          const writes = new Map<AnyNode, Write>(); // test call -> first write
          const reads = new Map<AnyNode, AnyNode>(); // test call -> first read identifier
          const helperWriters = new Set<string>(); // same-file helpers that assign the variable
          let hookReset = false;
          for (const ref of refs) {
            const id = ref.identifier;
            if (id === decl.id) continue;
            const test = owningTest(id);
            const mutation = isMutation(id, ref, isCollection);
            if (!test) {
              if (mutation) {
                const hook = owningHook(id);
                if (hook === 'beforeEach') hookReset = true;
                if (!hook) {
                  const helper = helperNameOf(id);
                  if (helper) helperWriters.add(helper);
                }
              }
              continue;
            }
            if (mutation) {
              if (!writes.has(test)) writes.set(test, { id, path: mutation.path });
            } else if (ref.isRead() && !reads.has(test)) {
              reads.set(test, id);
            }
          }
          if (hookReset || writes.size === 0) continue;
          for (const [test, id] of reads) {
            if (writes.has(test)) continue;
            // A reader that calls a helper which assigns the variable sets it up itself.
            if (callsAny(test, helperWriters)) continue;
            // Serial mode orders the tests that share state: skip a writer/reader
            // pair only when BOTH sit in a serial scope.
            const readerSerial = isInSerialScope(test, testNames);
            const readKey = firstKey(id);
            const writer = [...writes.entries()].find(
              ([w, wr]) =>
                startOf(w) < startOf(test) &&
                !(readerSerial && isInSerialScope(w, testNames)) &&
                !(wr.path !== undefined && readKey !== undefined && wr.path !== readKey)
            )?.[0];
            if (!writer) continue;
            context.report({
              node: id as never,
              messageId: 'shared',
              data: { name: decl.id.name, writer: titleOf(writer) },
            });
            break; // one finding per variable
          }
        }
      },
    };
  },
};

/** Report-only companion: serial mode declares order dependence. */
export const serialModeDependency: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Report serial-mode describe blocks (tests depend on order)' },
    messages: {
      serial: 'Serial mode: the tests in this scope depend on running in order, so one failure skips the rest and retries rerun the whole group. Information only.',
    },
    schema: TEST_ALIAS_SCHEMA,
  },
  create(context) {
    const testNames = testNamesFromOptions(context.options);
    return {
      CallExpression(node: AnyNode) {
        if (isSerialDescribeCall(node, testNames) || isSerialConfigureCall(node, testNames)) {
          context.report({ node: node as never, messageId: 'serial' });
        }
      },
    };
  },
};
