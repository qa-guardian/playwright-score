import {
  enclosingFunction,
  hookName,
  isDescribeCall,
  isInSerialScope,
  isTestDeclaration,
  propName,
  unwrap,
  type AnyNode,
} from './rule-util.js';

/**
 * Shared writer-before-reader analysis (QAG-287) used by
 * `pwscore/no-shared-mutable-state` and `pwscore/serial-mode-dependency`.
 * For one module- or describe-level mutable variable it lists every
 * (writer test, reader test) pair where the writer runs earlier in source
 * order, writes the same property the reader reads, and the reader does not
 * set the variable up itself. `serial` marks a pair whose tests are ordered on
 * purpose (declared in, or both tests inside, a serial scope).
 */
export interface SharedPair {
  reader: AnyNode; // identifier read in the reader test
  readerTest: AnyNode;
  writerTest: AnyNode;
  serial: boolean;
}
export interface SharedVar {
  name: string;
  pairs: SharedPair[];
}

const MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'set', 'add', 'delete', 'clear', 'sort', 'reverse']);

export function titleOf(call: AnyNode): string {
  const t = call.arguments?.[0];
  return t?.type === 'Literal' && typeof t.value === 'string' ? t.value : 'another test';
}

export function analyzeSharedVariable(
  sourceCode: AnyNode,
  decl: AnyNode,
  testNames: ReadonlySet<string>
): SharedVar | undefined {

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

  if (!isSharedScope(decl.parent)) return undefined;
  if (decl.id?.type !== 'Identifier' || !isMutableInit(decl.parent.kind, decl.init)) return undefined;
  const [variable] = sourceCode.getDeclaredVariables(decl) as AnyNode[];
  if (!variable) return undefined;
  const declSerial = isInSerialScope(decl, testNames);

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
  if (hookReset || writes.size === 0) return undefined;
  const pairs: SharedPair[] = [];
  for (const [test, id] of reads) {
    if (writes.has(test)) continue;
    // A reader that calls a helper which assigns the variable sets it up itself.
    if (callsAny(test, helperWriters)) continue;
    const readKey = firstKey(id);
    const readerSerial = isInSerialScope(test, testNames);
    const candidates: SharedPair[] = [];
    for (const [w, wr] of writes) {
      if (startOf(w) >= startOf(test)) continue;
      if (wr.path !== undefined && readKey !== undefined && wr.path !== readKey) continue;
      candidates.push({
        reader: id,
        readerTest: test,
        writerTest: w,
        serial: declSerial || (readerSerial && isInSerialScope(w, testNames)),
      });
    }
    // Prefer an unordered writer: that is the one worth reporting.
    const pick = candidates.find((c) => !c.serial) ?? candidates[0];
    if (pick) pairs.push(pick);
  }
  return pairs.length ? { name: decl.id.name, pairs } : undefined;
}
