import type { Rule } from 'eslint';
import {
  TEST_ALIAS_SCHEMA,
  enclosingFunction,
  hookName,
  isDescribeCall,
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
 * Not matched: assignment only inside `beforeEach`/`beforeAll`/`afterEach`
 * (setup); a variable that any `beforeEach` assigns (it is reset before each
 * test); a reader that also writes the variable itself (its own setup);
 * variables declared inside a test.
 * Mutation = assignment, `++`/`--`, member assignment (`v.x = 1`), or a
 * call of `push/pop/shift/unshift/splice/set/add/delete/clear/sort/reverse`.
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
    const titleOf = (call: AnyNode): string => {
      const t = call.arguments?.[0];
      return t?.type === 'Literal' && typeof t.value === 'string' ? t.value : 'another test';
    };
    /** Is this reference a write/mutation of the variable? */
    const isMutation = (id: AnyNode, ref: AnyNode): boolean => {
      if (ref.isWrite()) return true;
      let child = id;
      let parent = id.parent;
      while (parent?.type === 'MemberExpression' && parent.object === child) {
        const gp = parent.parent;
        if (gp?.type === 'AssignmentExpression' && gp.left === parent) return true;
        if (gp?.type === 'UpdateExpression') return true;
        if (gp?.type === 'CallExpression' && gp.callee === parent) {
          const name = propName(parent);
          if (name && MUTATORS.has(name) && parent.object === id) return true;
        }
        child = parent;
        parent = gp;
      }
      return false;
    };

    return {
      VariableDeclaration(node: AnyNode) {
        if (!isSharedScope(node)) return;
        for (const decl of node.declarations) {
          if (decl.id?.type !== 'Identifier' || !isMutableInit(node.kind, decl.init)) continue;
          const [variable] = context.sourceCode.getDeclaredVariables(decl) as AnyNode[];
          if (!variable) continue;

          const writes = new Map<AnyNode, AnyNode>(); // test call -> write node
          const reads = new Map<AnyNode, AnyNode>(); // test call -> first read identifier
          let hookReset = false;
          for (const ref of variable.references as AnyNode[]) {
            const id = ref.identifier;
            if (id === decl.id) continue;
            const test = owningTest(id);
            const mutation = isMutation(id, ref);
            if (!test) {
              if (mutation && owningHook(id) === 'beforeEach') hookReset = true;
              continue;
            }
            if (mutation) {
              if (!writes.has(test)) writes.set(test, id);
            } else if (ref.isRead() && !reads.has(test)) {
              reads.set(test, id);
            }
          }
          if (hookReset || writes.size === 0) continue;
          for (const [test, id] of reads) {
            if (writes.has(test)) continue;
            const writer = [...writes.keys()][0];
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
        const callee = unwrap(node.callee);
        if (callee?.type !== 'MemberExpression') return;
        const name = propName(callee);
        const obj = unwrap(callee.object);
        if (name === 'serial' && obj?.type === 'MemberExpression' && propName(obj) === 'describe' && obj.object?.type === 'Identifier' && testNames.has(obj.object.name)) {
          context.report({ node: node as never, messageId: 'serial' });
          return;
        }
        if (name === 'configure' && obj?.type === 'MemberExpression' && propName(obj) === 'describe' && obj.object?.type === 'Identifier' && testNames.has(obj.object.name)) {
          const arg = unwrap(node.arguments?.[0]);
          if (arg?.type !== 'ObjectExpression') return;
          for (const p of arg.properties) {
            if (p.type === 'Property' && (p.key?.name ?? p.key?.value) === 'mode' && p.value?.type === 'Literal' && p.value.value === 'serial') {
              context.report({ node: node as never, messageId: 'serial' });
            }
          }
        }
      },
    };
  },
};
