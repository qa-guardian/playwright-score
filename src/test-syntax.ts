/**
 * Syntax helpers and fixed tables for the test states (QAG-287 S12): the shape of a call chain,
 * the text a callee is reported under, a tree walk, and the names Playwright Test provides.
 * Used by src/test-callees.ts and src/test-states.ts. Nothing here resolves a binding.
 */
import type { N, ScopeFile } from './rules/proof.js';
import { strip } from './rules/scope-resolve.js';

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
export const isFunction = (n: N | null | undefined): boolean => !!n && FUNCTIONS.has(n.type);

/** Fixtures and options Playwright Test provides to every test. */
export const BUILT_IN_FIXTURES = new Set(
  ('page context browser browserName request baseURL playwright mount router viewport storageState locale isMobile hasTouch headless channel ' +
    'userAgent video trace screenshot testIdAttribute colorScheme timezoneId deviceScaleFactor javaScriptEnabled acceptDownloads bypassCSP ' +
    'extraHTTPHeaders geolocation httpCredentials ignoreHTTPSErrors offline permissions proxy launchOptions contextOptions connectOptions ' +
    'defaultBrowserType actionTimeout navigationTimeout serviceWorkers clientCertificates').split(' ')
);
/** Parameter names and types that make a parameter a Playwright object. */
export const PW_PARAM_NAMES = new Set([...BUILT_IN_FIXTURES, 'frame', 'locator', 'frameLocator', 'testInfo']);
export const PW_PARAM_TYPES = new Set('Page Frame FrameLocator Locator BrowserContext Browser APIRequestContext TestInfo'.split(' '));
/** Is this parameter a Playwright object, by its name or by its TypeScript type? */
export function isPwParam(id: N): boolean {
  const type = id.typeAnnotation?.typeAnnotation;
  const typeName = type?.type === 'TSTypeReference' ? (type.typeName?.name as string | undefined) : undefined;
  return PW_PARAM_NAMES.has(id.name as string) || (!!typeName && PW_PARAM_TYPES.has(typeName));
}

/** Standard globals of the language and of Node. */
export const GLOBALS = new Set(
  ('console JSON Math Object Array Promise Date Number String Boolean Symbol BigInt RegExp Error TypeError RangeError Map Set WeakMap WeakSet ' +
    'parseInt parseFloat isNaN isFinite setTimeout clearTimeout setInterval clearInterval setImmediate clearImmediate queueMicrotask process ' +
    'Buffer URL URLSearchParams Intl globalThis structuredClone fetch Headers Request Response FormData Blob AbortController TextEncoder ' +
    'TextDecoder encodeURIComponent decodeURIComponent encodeURI decodeURI crypto performance atob btoa Reflect Proxy undefined NaN Infinity ' +
    'Uint8Array ArrayBuffer require module exports __dirname __filename').split(' ')
);

export function propName(member: N): string | undefined {
  const p = member.property as N | undefined;
  if (!member.computed) return p?.type === 'Identifier' || p?.type === 'PrivateIdentifier' ? p.name : undefined;
  return p?.type === 'Literal' && typeof p.value === 'string' ? p.value : undefined;
}

export const unwrap = (node: N | null | undefined): N | undefined => {
  let n = strip(node);
  while (n?.type === 'AwaitExpression') n = strip(n.argument);
  return n;
};

/** The identifier a call chain starts with and the property names along it: `test`, [describe, skip]. */
export function chain(callee: N | null | undefined): { root?: N; props: string[] } {
  const props: string[] = [];
  let n = unwrap(callee);
  for (let i = 0; n && i < 64; i++) {
    if (n.type === 'MemberExpression') {
      const p = propName(n);
      if (p) props.unshift(p);
      n = unwrap(n.object);
    } else if (n.type === 'CallExpression') n = unwrap(n.callee);
    else break;
  }
  return { root: n?.type === 'Identifier' ? n : undefined, props };
}

/** The text a callee is reported under. */
export function text(node: N | null | undefined): string {
  const n = unwrap(node);
  if (!n) return '(expression)';
  if (n.type === 'Identifier') return n.name as string;
  if (n.type === 'ThisExpression') return 'this';
  if (n.type === 'MemberExpression') return `${text(n.object)}.${propName(n) ?? '[...]'}`;
  if (n.type === 'CallExpression') return `${text(n.callee)}()`;
  return '(expression)';
}

export const packageRoot = (spec: string): string => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
export const listed = (list: readonly string[], spec: string): boolean => list.includes(spec) || list.includes(packageRoot(spec));

export const exportedName = (n: N | undefined): string | undefined => (n?.type === 'Identifier' ? n.name : typeof n?.value === 'string' ? n.value : undefined);

const SKIP_KEYS = new Set(['parent', 'loc', 'range', 'tokens', 'comments']);
export function walk(node: N | null | undefined, visit: (n: N) => void): void {
  const stack: N[] = node ? [node] : [];
  while (stack.length > 0) {
    const n = stack.pop()!;
    visit(n);
    for (const key of Object.keys(n)) {
      if (SKIP_KEYS.has(key)) continue;
      const value = n[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) if (value[i] && typeof value[i].type === 'string') stack.push(value[i]);
      } else if (value && typeof value === 'object' && typeof value.type === 'string') stack.push(value);
    }
  }
}

/** The key under which an object pattern binds the identifier `id`. */
export function patternKey(pattern: N, id: N): string | undefined {
  for (const p of (pattern.properties ?? []) as N[]) {
    const target = p.value?.type === 'AssignmentPattern' ? p.value.left : p.value;
    if (p.type === 'Property' && target === id) return exportedName(p.key);
  }
  return undefined;
}

/** A function whose whole body is one returned expression: that expression. */
export function returned(fn: N): N | undefined {
  if (fn.body?.type !== 'BlockStatement') return fn.body;
  const only = fn.body.body.length === 1 ? (fn.body.body[0] as N) : undefined;
  return only?.type === 'ReturnStatement' ? only.argument : undefined;
}

export function enclosingClass(sf: ScopeFile, node: N): N | undefined {
  for (let n = sf.parents.get(node); n; n = sf.parents.get(n)) {
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') return n;
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
      const owner = sf.parents.get(n);
      if (owner?.type !== 'MethodDefinition' && owner?.type !== 'PropertyDefinition') return undefined;
    }
  }
  return undefined;
}
