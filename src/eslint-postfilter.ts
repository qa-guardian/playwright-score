import { parseForESLint } from '@typescript-eslint/parser';
import { sourceTypeFor } from './source-type.js';
import type { Severity } from './types.js';

// QAG-287 slice F: AST post-filters for upstream eslint-plugin-playwright
// messages. A hand-check of real findings showed several upstream rules fire on
// shapes that are not defects. Each filter below drops (or downgrades) one
// documented FALSE shape. Rule of thumb: when a shape is unclear, keep the
// finding. An exemption must never hide a defect, so each one is narrow.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type N = { type: string; [k: string]: any };

export interface Decision {
  drop?: boolean;
  severity?: Severity;
  reportOnly?: boolean;
}

export interface PostFilterMessage {
  ruleId: string;
  messageId?: string;
  line: number;
  /** 1-based, as ESLint reports it. */
  column: number;
}

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);

export class Tree {
  readonly parents = new Map<N, N | undefined>();
  private readonly at = new Map<string, N[]>();
  readonly root: N;
  readonly comments: N[];

  constructor(ast: N) {
    this.root = ast;
    this.comments = (ast.comments as N[] | undefined) ?? [];
    const visit = (node: N, parent: N | undefined): void => {
      this.parents.set(node, parent);
      const loc = node.loc as { start: { line: number; column: number } } | undefined;
      if (loc) {
        const key = `${loc.start.line}:${loc.start.column}`;
        const list = this.at.get(key);
        if (list) list.push(node);
        else this.at.set(key, [node]);
      }
      for (const key of Object.keys(node)) {
        if (SKIP_KEYS.has(key)) continue;
        const value = node[key];
        if (Array.isArray(value)) {
          for (const item of value) if (item && typeof item.type === 'string') visit(item, node);
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
          visit(value, node);
        }
      }
    };
    visit(ast, undefined);
  }

  parent(n: N): N | undefined {
    return this.parents.get(n);
  }

  /** Deepest node starting at an ESLint (1-based column) position. */
  nodeAt(line: number, column: number): N | undefined {
    const list = this.at.get(`${line}:${column - 1}`);
    return list?.[list.length - 1];
  }

  /** Walk every node below `n` (inclusive); return true from `visit` to stop. */
  some(n: N, visit: (node: N) => boolean): boolean {
    if (visit(n)) return true;
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item.type === 'string' && this.some(item, visit)) return true;
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        if (this.some(value, visit)) return true;
      }
    }
    return false;
  }

  /** Top of the member/call chain `n` belongs to (`expect(x).not.toBe(1)` from `expect`). */
  chainTop(n: N): N {
    let cur = n;
    for (;;) {
      const p = this.parent(cur);
      if (!p) return cur;
      if (p.type === 'MemberExpression') cur = p;
      else if (p.type === 'CallExpression' && p.callee === cur) cur = p;
      else if (p.type === 'TSNonNullExpression' || p.type === 'ChainExpression') cur = p;
      else return cur;
    }
  }

  enclosingFunction(n: N): N | undefined {
    let cur = this.parent(n);
    while (cur && !isFunction(cur)) cur = this.parent(cur);
    return cur;
  }
}

export function isFunction(n: N | undefined): n is N {
  return (
    !!n &&
    (n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression')
  );
}

function rootIdentifierName(node: N | undefined): string | undefined {
  let cur = node;
  while (cur) {
    if (cur.type === 'Identifier') return cur.name as string;
    if (cur.type === 'MemberExpression') cur = cur.object;
    else if (cur.type === 'CallExpression') cur = cur.callee;
    else if (cur.type === 'AwaitExpression' || cur.type === 'TSNonNullExpression') cur = cur.argument ?? cur.expression;
    else return undefined;
  }
  return undefined;
}

export function isExpectCall(n: N): boolean {
  return n.type === 'CallExpression' && rootIdentifierName(n.callee) === 'expect';
}

/** `name('title', () => {...})`: a function that is the last argument of a call whose first argument is a string. */
export function isStringTitledCallback(t: Tree, fn: N): boolean {
  const call = t.parent(fn);
  if (!call || call.type !== 'CallExpression') return false;
  const args = call.arguments as N[];
  if (args[args.length - 1] !== fn || args.length < 2) return false;
  const first = args[0];
  return first.type === 'Literal' ? typeof first.value === 'string' : first.type === 'TemplateLiteral';
}

/** A named helper: declared function, or a function stored in a variable, object property or class member. */
export function isHelperFunction(t: Tree, fn: N): boolean {
  if (fn.type === 'FunctionDeclaration') return true;
  const p = t.parent(fn);
  if (!p) return false;
  if (p.type === 'VariableDeclarator' && p.init === fn) return true;
  if (p.type === 'Property' && p.value === fn) return true;
  if ((p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.value === fn) return true;
  return false;
}

// ---- valid-expect -------------------------------------------------------

/**
 * `expect(...)` / `expect.poll(...)` with no matcher is a defect, except when
 * the expectation object is handed on: returned from a named helper (the caller
 * adds the matcher) or stored in a variable whose matcher is called later.
 * A returned expect inside a test callback is still a defect.
 */
function validExpectExempt(t: Tree, node: N): boolean {
  let top = t.chainTop(node);
  let p = t.parent(top);
  while (p && p.type === 'AwaitExpression') {
    top = p;
    p = t.parent(p);
  }
  if (!p) return false;
  if (p.type === 'ReturnStatement') {
    const fn = t.enclosingFunction(top);
    return !!fn && isHelperFunction(t, fn) && !isStringTitledCallback(t, fn);
  }
  if (p.type === 'ArrowFunctionExpression' && p.body === top) {
    return isHelperFunction(t, p) && !isStringTitledCallback(t, p);
  }
  if (p.type === 'VariableDeclarator' && p.init === top && p.id.type === 'Identifier') {
    const name = p.id.name as string;
    const scope = t.enclosingFunction(top) ?? t.root;
    const startLine = (top.loc as { end: { line: number } }).end.line;
    return t.some(scope, (n) => {
      if (n.type !== 'MemberExpression' || n.object?.type !== 'Identifier' || n.object.name !== name) return false;
      return (n.loc as { start: { line: number } }).start.line >= startLine;
    });
  }
  return false;
}

// ---- entry point --------------------------------------------------------

export type PostFilter = (msg: PostFilterMessage) => Decision | undefined;

function parse(source: string, file: string): Tree | undefined {
  try {
    const ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: sourceTypeFor(file),
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
      comment: true,
      loc: true,
      range: true,
    }).ast as unknown as N;
    return new Tree(ast);
  } catch {
    return undefined;
  }
}

/** Parses lazily, once per file; a file that does not parse gets no decisions (all findings kept). */
export function createPostFilter(source: () => string, file: string): PostFilter {
  let tree: Tree | undefined;
  let tried = false;
  return (msg) => {
    if (!tried) {
      tried = true;
      try {
        tree = parse(source(), file);
      } catch {
        tree = undefined;
      }
    }
    if (!tree) return undefined;
    const node = tree.nodeAt(msg.line, msg.column);
    if (!node) return undefined;
    switch (msg.ruleId) {
      case 'playwright/valid-expect':
        if ((msg.messageId === 'matcherNotFound' || msg.messageId === 'matcherNotCalled') && validExpectExempt(tree, node)) {
          return { drop: true };
        }
        return undefined;
      default:
        return undefined;
    }
  };
}
