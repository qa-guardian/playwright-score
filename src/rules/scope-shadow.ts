/**
 * The rules a scope alias is checked by (QAG-287 S4a, aliased-page-api.ts), and the wrapper that lets them see one.
 *
 * The page and value rules read a page or a value by its syntax. For a name the scope lint lists (settings
 * `scopeAliases`), the wrapped rule's visitor is given a shallow copy of the node in which that name reads as
 * `page` or as its value. Positions, parents and every other node are the real ones; the rule itself decides
 * and reports.
 */
import type { Rule } from 'eslint';
import type { N } from './proof.js';

/** Page-method rules and the methods each reports. */
export const PAGE_RULES: ReadonlyMap<string, readonly string[]> = new Map([
  ['playwright/no-wait-for-selector', ['waitForSelector']],
  ['playwright/no-wait-for-navigation', ['waitForNavigation']],
  ['playwright/no-element-handle', ['$', '$$']],
  ['playwright/no-page-pause', ['pause']],
  ['playwright/no-wait-for-timeout', ['waitForTimeout']],
]);
export const UNAWAITED = 'pwscore/no-unawaited-action';
export const NETWORKIDLE = 'playwright/no-networkidle';
export const FOCUSED = 'playwright/no-focused-test';

/** The rules a scope alias is checked by. Every other rule never sees one. */
export const SCOPE_RULES: readonly string[] = [...PAGE_RULES.keys(), UNAWAITED, NETWORKIDLE, FOCUSED];

/** Per spec file: the names proven at one site or more. */
export interface ScopeAliases {
  page: string[];
  value: string[];
  test: string[];
}

const at = (where: N, n: N): N => ({ ...n, loc: where.loc, range: where.range, parent: where.parent });
const asPage = (id: N): N => at(id, { type: 'Identifier', name: 'page' });
const asIdle = (id: N): N => at(id, { type: 'Literal', value: 'networkidle', raw: "'networkidle'" });
const asIdleOptions = (id: N): N =>
  at(id, { type: 'ObjectExpression', properties: [{ type: 'Property', key: { type: 'Identifier', name: 'waitUntil' }, value: asIdle(id), computed: false, method: false, shorthand: false, kind: 'init' }] });

type Shadow = (node: N, names: ReadonlySet<string>) => N | undefined;
const shadowPage: Shadow = (n, names) => {
  const c = n.callee as N;
  return c?.type === 'MemberExpression' && c.object?.type === 'Identifier' && names.has(c.object.name) ? { ...n, callee: { ...c, object: asPage(c.object) } } : undefined;
};
const shadowHead = (o: N | undefined, names: ReadonlySet<string>): N | undefined => {
  if (o?.type === 'Identifier') return names.has(o.name) ? asPage(o) : undefined;
  if (o?.type !== 'CallExpression' || o.callee?.type !== 'MemberExpression') return undefined;
  const head = shadowHead(o.callee.object as N, names);
  return head && { ...o, callee: { ...o.callee, object: head } };
};
const shadowStatement: Shadow = (s, names) => {
  const e = s.expression as N;
  const c = e?.type === 'CallExpression' ? (e.callee as N) : undefined;
  const head = c?.type === 'MemberExpression' ? shadowHead(c.object as N, names) : undefined;
  return head && { ...s, expression: { ...e, callee: { ...c, object: head } } };
};
const shadowIdle: Shadow = (n, names) => {
  let hit = false;
  const args = (n.arguments as N[]).map((a, i) => {
    if (a.type === 'Identifier' && names.has(a.name)) {
      hit = true;
      return i === 0 ? asIdle(a) : asIdleOptions(a);
    }
    if (a.type !== 'ObjectExpression') return a;
    const props = (a.properties as N[]).map((p) => (p.type === 'Property' && p.value?.type === 'Identifier' && names.has(p.value.name) ? { ...p, value: asIdle(p.value) } : p));
    if (props.every((p, j) => p === a.properties[j])) return a;
    hit = true;
    return { ...a, properties: props };
  });
  return hit ? { ...n, arguments: args } : undefined;
};

type Wrap = [keyof ScopeAliases, 'CallExpression' | 'ExpressionStatement', Shadow];
const WRAPPED: ReadonlyMap<string, Wrap> = new Map<string, Wrap>([
  ...[...PAGE_RULES.keys()].map((r): [string, Wrap] => [r, ['page', 'CallExpression', shadowPage]]),
  [UNAWAITED, ['page', 'ExpressionStatement', shadowStatement]],
  [NETWORKIDLE, ['value', 'CallExpression', shadowIdle]],
]);

/** `plugin` (rule prefix `prefix`) whose page and value rules see, for a listed name, the shadow copy of the node. */
export function scopePlugin<P extends { rules?: Record<string, unknown> }>(prefix: string, plugin: P): P {
  const rules: Record<string, unknown> = { ...plugin.rules };
  for (const [id, [kind, visitor, shadow]] of WRAPPED) {
    const short = id.startsWith(`${prefix}/`) ? id.slice(prefix.length + 1) : undefined;
    const rule = short ? (rules[short] as Rule.RuleModule | undefined) : undefined;
    if (!short || !rule) continue;
    rules[short] = {
      ...rule,
      create(context: Rule.RuleContext) {
        const names = new Set<string>((context.settings as { scopeAliases?: Partial<ScopeAliases> }).scopeAliases?.[kind] ?? []);
        const visit = names.size > 0 ? (rule.create(context) as Record<string, ((n: N) => void) | undefined>)[visitor] : undefined;
        if (!visit) return {};
        return {
          [visitor](node: N) {
            const copy = shadow(node, names);
            if (copy) visit(copy);
          },
        } as Rule.RuleListener;
      },
    } as Rule.RuleModule;
  }
  return { ...plugin, rules };
}
