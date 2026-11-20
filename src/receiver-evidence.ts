import type { N, Tree } from './eslint-postfilter.js';

/**
 * QAG-287 S4a-R (ADR 0.H H-3): positive evidence that the receiver of a
 * Page/Frame-API call is NOT a Playwright Page or Frame. Upstream matches the
 * receiver by name (`page`, `fooPage`), so the project's own page-object
 * instance and a Puppeteer page both look like a Playwright Page.
 *
 * Only two kinds of evidence count; anything else (the `page` fixture,
 * `this.page`, a destructured fixture, an untyped parameter, a type imported
 * from playwright, an unresolved import) is "unknown" and the finding stays.
 *
 *  (a) the receiver resolves to `new X(...)`, or to a parameter typed as the
 *      class X, where X is a class defined or imported in the project and
 *      declares an instance member named like the called method;
 *  (b) the receiver resolves to `.newPage()` / `.pages()` on a browser
 *      obtained from puppeteer / puppeteer-core, directly or through a
 *      function imported from a local module whose imports include
 *      puppeteer / puppeteer-core (and no playwright package).
 *
 * Resolution is depth-limited and follows `const`/`let` initialisers plus
 * plain `x = ...` assignments in the declaring scope. A variable only counts
 * when every value it can hold is non-Playwright.
 */

export interface ProjectAccess {
  /** Resolve an import specifier from a file to a project file (relative, alias, workspace). */
  resolve(fromFile: string, specifier: string): string | undefined;
  read(file: string): string | undefined;
}

export type ParseFile = (source: string, file: string) => Tree | undefined;

const MAX_DEPTH = 4;
const PUPPETEER = new Set(['puppeteer', 'puppeteer-core']);
const PLAYWRIGHT = new Set(['playwright', 'playwright-core', '@playwright/test']);

/** Page/Frame-API rules whose subject is a call on a page-like receiver. */
export const PAGE_RECEIVER_RULES: ReadonlySet<string> = new Set([
  'playwright/no-wait-for-navigation',
  'playwright/no-element-handle',
  'playwright/no-networkidle',
  'playwright/no-wait-for-selector',
  'playwright/no-wait-for-timeout',
  'playwright/no-page-pause',
  'playwright/no-eval',
  'playwright/no-useless-await',
  'playwright/no-raw-locators',
  'playwright/no-force-option',
  'playwright/prefer-locator',
  'playwright/prefer-native-locators',
  'pwscore/no-brittle-selector',
]);

type Binding =
  | { kind: 'values'; values: N[]; arrayPattern: boolean; annotation?: N }
  | { kind: 'param'; annotation?: N }
  | { kind: 'import'; source: string; imported: string }
  | { kind: 'unknown' };

const unwrap = (n: N | undefined | null): N | undefined => {
  let cur = n ?? undefined;
  while (
    cur &&
    (cur.type === 'AwaitExpression' ||
      cur.type === 'TSNonNullExpression' ||
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSTypeAssertion' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'ChainExpression')
  ) {
    cur = (cur.argument ?? cur.expression) as N | undefined;
  }
  return cur;
};

const propertyName = (m: N | undefined): string | undefined => {
  if (!m || m.type !== 'MemberExpression') return undefined;
  if (!m.computed && m.property?.type === 'Identifier') return m.property.name;
  if (m.computed && m.property?.type === 'Literal' && typeof m.property.value === 'string') return m.property.value;
  return undefined;
};

function patternHas(p: N | null | undefined, name: string): boolean {
  if (!p) return false;
  switch (p.type) {
    case 'Identifier':
      return p.name === name;
    case 'AssignmentPattern':
      return patternHas(p.left, name);
    case 'RestElement':
      return patternHas(p.argument, name);
    case 'ArrayPattern':
      return (p.elements as N[]).some((e) => patternHas(e, name));
    case 'ObjectPattern':
      return (p.properties as N[]).some((e) => patternHas(e.type === 'RestElement' ? e : e.value, name));
    case 'TSParameterProperty':
      return patternHas(p.parameter, name);
    default:
      return false;
  }
}

export function createReceiverEvidence(parse: ParseFile, project: ProjectAccess | undefined) {
  const trees = new Map<string, Tree | null>();
  const treeFor = (file: string): Tree | undefined => {
    if (trees.has(file)) return trees.get(file) ?? undefined;
    let tree: Tree | undefined;
    const source = project?.read(file);
    if (source !== undefined) tree = parse(source, file);
    trees.set(file, tree ?? null);
    return tree;
  };
  type Ctx = { tree: Tree; file: string };

  /** Binding of identifier `id` as seen from its position. */
  const bindingOf = (ctx: Ctx, id: N): Binding | undefined => {
    const { tree } = ctx;
    const name = id.name as string;
    for (let a = tree.parent(id); a; a = tree.parent(a)) {
      if (a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration') {
        for (const p of a.params as N[]) {
          if (!patternHas(p, name)) continue;
          const plain = p.type === 'AssignmentPattern' ? p.left : p;
          return plain.type === 'Identifier' ? { kind: 'param', annotation: plain.typeAnnotation?.typeAnnotation } : { kind: 'unknown' };
        }
      }
      if (a.type === 'Program' || a.type === 'BlockStatement' || a.type === 'StaticBlock' || a.type === 'TSModuleBlock') {
        for (const raw of a.body as N[]) {
          const st = raw.type === 'ExportNamedDeclaration' && raw.declaration ? (raw.declaration as N) : raw;
          if (st.type === 'VariableDeclaration') {
            for (const d of st.declarations as N[]) {
              if (!patternHas(d.id, name)) continue;
              if (d.id.type !== 'Identifier' && d.id.type !== 'ArrayPattern') return { kind: 'unknown' };
              const values: N[] = d.init ? [d.init] : [];
              tree.some(a, (n) => {
                if (n.type === 'AssignmentExpression' && n.operator === '=' && n.left?.type === 'Identifier' && n.left.name === name) {
                  values.push(n.right);
                }
                return false;
              });
              return { kind: 'values', values, arrayPattern: d.id.type === 'ArrayPattern', annotation: d.id.typeAnnotation?.typeAnnotation };
            }
          } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id?.name === name) {
            return { kind: 'unknown' };
          } else if (st.type === 'ImportDeclaration') {
            for (const s of st.specifiers as N[]) {
              if (s.local?.name !== name) continue;
              const imported =
                s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : (s.imported?.name ?? s.imported?.value);
              return { kind: 'import', source: String(st.source.value), imported };
            }
          }
        }
      }
    }
    return undefined;
  };

  /** `const x = require('mod')` / `await import('mod')` / import binding -> module source. */
  const moduleOf = (ctx: Ctx, id: N, depth: number): { source: string; imported: string } | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const b = bindingOf(ctx, id);
    if (!b) return undefined;
    if (b.kind === 'import') return b;
    if (b.kind === 'values' && b.values.length === 1 && !b.arrayPattern) {
      const e = unwrap(b.values[0]);
      if (e?.type === 'CallExpression' && e.callee?.type === 'Identifier' && e.callee.name === 'require' && e.arguments[0]?.type === 'Literal') {
        return { source: String(e.arguments[0].value), imported: '*' };
      }
      if (e?.type === 'ImportExpression' && e.source?.type === 'Literal') return { source: String(e.source.value), imported: '*' };
    }
    return undefined;
  };

  const importedSources = (file: string): Set<string> | undefined => {
    const tree = treeFor(file);
    if (!tree) return undefined;
    const out = new Set<string>();
    tree.some(tree.root, (n) => {
      if (n.type === 'ImportDeclaration' || ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source)) {
        out.add(String(n.source.value));
      } else if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'require' && n.arguments[0]?.type === 'Literal') {
        out.add(String(n.arguments[0].value));
      } else if (n.type === 'ImportExpression' && n.source?.type === 'Literal') {
        out.add(String(n.source.value));
      }
      return false;
    });
    return out;
  };

  const isPuppeteerOnlyModule = (file: string): boolean => {
    const s = importedSources(file);
    if (!s) return false;
    const list = [...s];
    return list.some((x) => PUPPETEER.has(x)) && !list.some((x) => PLAYWRIGHT.has(x));
  };

  /** Class `name` as seen from `file`; true when it is a project class with an instance member `method`. */
  const classDeclares = (file: string, tree: Tree, name: string, method: string, depth: number, seen: Set<string>): boolean => {
    if (depth > MAX_DEPTH) return false;
    const key = `${file}\0${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const hasMember = (cls: N): boolean =>
      ((cls.body?.body ?? []) as N[]).some(
        (m) =>
          (m.type === 'MethodDefinition' || m.type === 'PropertyDefinition') &&
          !m.static &&
          !m.computed &&
          (m.key?.name === method || m.key?.value === method) &&
          (m.type === 'MethodDefinition' ||
            (m.value && (m.value.type === 'ArrowFunctionExpression' || m.value.type === 'FunctionExpression')))
      );
    const into = (spec: string, wanted: string): boolean => {
      const target = project?.resolve(file, spec);
      if (!target) return false;
      const t = treeFor(target);
      return t ? classDeclares(target, t, wanted, method, depth + 1, seen) : false;
    };
    for (const raw of tree.root.body as N[]) {
      let st = raw;
      let exportedAsDefault = false;
      if (raw.type === 'ExportNamedDeclaration' && raw.declaration) st = raw.declaration;
      if (raw.type === 'ExportDefaultDeclaration') {
        st = raw.declaration;
        exportedAsDefault = true;
      }
      if (st.type === 'ClassDeclaration' || st.type === 'ClassExpression') {
        if (st.id?.name === name || (exportedAsDefault && name === 'default' && !st.id)) {
          if (hasMember(st)) return true;
          continue;
        }
        if (exportedAsDefault && name === 'default') return hasMember(st);
      }
      if (exportedAsDefault && name === 'default' && st.type === 'Identifier') {
        return classDeclares(file, tree, st.name, method, depth + 1, seen);
      }
      if (st.type === 'VariableDeclaration') {
        for (const d of st.declarations as N[]) {
          if (d.id?.type === 'Identifier' && d.id.name === name && d.init?.type === 'ClassExpression' && hasMember(d.init)) return true;
        }
      }
      if (st.type === 'ImportDeclaration') {
        for (const s of st.specifiers as N[]) {
          if (s.local?.name !== name) continue;
          const imported = s.type === 'ImportDefaultSpecifier' ? 'default' : (s.imported?.name ?? s.imported?.value);
          if (s.type !== 'ImportNamespaceSpecifier' && into(String(st.source.value), imported)) return true;
        }
      }
      if (raw.type === 'ExportNamedDeclaration' && raw.source) {
        for (const s of (raw.specifiers ?? []) as N[]) {
          if ((s.exported?.name ?? s.exported?.value) === name && into(String(raw.source.value), s.local?.name ?? s.local?.value)) return true;
        }
      }
      if (raw.type === 'ExportAllDeclaration' && raw.source && into(String(raw.source.value), name)) return true;
    }
    return false;
  };

  const classOfType = (ctx: Ctx, annotation: N | undefined, method: string): boolean => {
    const t = annotation?.type === 'TSTypeReference' && annotation.typeName?.type === 'Identifier' ? annotation.typeName.name : undefined;
    return t !== undefined && classDeclares(ctx.file, ctx.tree, t, method, 0, new Set());
  };

  const isPuppeteerBrowser = (ctx: Ctx, expr: N | undefined, depth: number): boolean => {
    const e = unwrap(expr);
    if (!e || depth > MAX_DEPTH) return false;
    if (e.type === 'Identifier') {
      const b = bindingOf(ctx, e);
      return b?.kind === 'values' && !b.arrayPattern && b.values.length > 0 && b.values.every((v) => isPuppeteerBrowser(ctx, v, depth + 1));
    }
    if (e.type !== 'CallExpression') return false;
    const callee = e.callee as N;
    if (callee.type === 'MemberExpression') {
      const m = propertyName(callee);
      const obj = unwrap(callee.object);
      if ((m === 'launch' || m === 'connect') && obj?.type === 'Identifier') {
        const mod = moduleOf(ctx, obj, 0);
        return !!mod && PUPPETEER.has(mod.source);
      }
      return false;
    }
    if (callee.type === 'Identifier') {
      const b = bindingOf(ctx, callee);
      if (b?.kind !== 'import') return false;
      if (PUPPETEER.has(b.source)) return b.imported === 'launch' || b.imported === 'connect';
      if (PLAYWRIGHT.has(b.source)) return false;
      const target = project?.resolve(ctx.file, b.source);
      return !!target && isPuppeteerOnlyModule(target);
    }
    return false;
  };

  /** `<puppeteer browser>.pages()` (an array of pages). */
  const isPuppeteerPages = (ctx: Ctx, expr: N | undefined, depth: number): boolean => {
    const e = unwrap(expr);
    return !!e && e.type === 'CallExpression' && propertyName(e.callee) === 'pages' && isPuppeteerBrowser(ctx, e.callee.object, depth + 1);
  };

  const nonPlaywrightPage = (ctx: Ctx, expr: N | undefined, method: string, depth: number): boolean => {
    const e = unwrap(expr);
    if (!e || depth > MAX_DEPTH) return false;
    switch (e.type) {
      case 'NewExpression':
        return e.callee?.type === 'Identifier' && classDeclares(ctx.file, ctx.tree, e.callee.name, method, 0, new Set());
      case 'CallExpression':
        return propertyName(e.callee) === 'newPage' && isPuppeteerBrowser(ctx, e.callee.object, depth + 1);
      case 'MemberExpression':
        return e.computed && isPuppeteerPages(ctx, e.object, depth);
      case 'Identifier': {
        const b = bindingOf(ctx, e);
        if (!b) return false;
        if (b.kind === 'param') return classOfType(ctx, b.annotation, method);
        if (b.kind !== 'values' || b.values.length === 0) return false;
        if (b.annotation && !classOfType(ctx, b.annotation, method)) {
          // An annotation that is not a project class (Page from playwright, ...) is not evidence either way: keep.
          if (b.annotation.type === 'TSTypeReference') return false;
        }
        return b.values.every((v) => (b.arrayPattern ? isPuppeteerPages(ctx, v, depth + 1) : nonPlaywrightPage(ctx, v, method, depth + 1)));
      }
      default:
        return false;
    }
  };

  /** The call chain a reported node belongs to: its root receiver and the first member read from it. */
  const chainOf = (tree: Tree, node: N): { root: N; first: string } | undefined => {
    let start: N | undefined = node;
    const p = tree.parent(node);
    if (node.type === 'Identifier' && p?.type === 'MemberExpression' && p.property === node && !p.computed) start = p;
    let call: N | undefined;
    for (let c: N | undefined = start; c; c = tree.parent(c)) {
      if (c.type === 'CallExpression' && c.callee?.type === 'MemberExpression') {
        call = c;
        break;
      }
    }
    if (!call) return undefined;
    let cur: N | undefined = call.callee;
    let first: string | undefined;
    for (;;) {
      cur = unwrap(cur);
      if (!cur) return undefined;
      if (cur.type === 'CallExpression') cur = cur.callee;
      else if (cur.type === 'MemberExpression') {
        first = propertyName(cur);
        const obj = unwrap(cur.object);
        if (obj?.type !== 'CallExpression' && obj?.type !== 'MemberExpression') {
          return first === undefined || !obj ? undefined : { root: obj, first };
        }
        cur = obj;
      } else return undefined;
    }
  };

  /** True only with positive evidence that the receiver of the call at `node` is not a Playwright Page/Frame. */
  return function receiverIsNotPlaywright(tree: Tree, file: string, node: N): boolean {
    const chain = chainOf(tree, node);
    if (!chain) return false;
    const ctx = { tree, file };
    if (chain.root.type === 'Identifier' || chain.root.type === 'NewExpression') {
      return nonPlaywrightPage(ctx, chain.root, chain.first, 0);
    }
    return false;
  };
}
