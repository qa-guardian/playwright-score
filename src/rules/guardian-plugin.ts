/**
 * Guardian house-style ESLint rules for profile=guardian.
 * Embedded in playwright-score — not claimed as official Playwright doctrine.
 */
import type { Rule } from 'eslint';

const DUMMY_SECRETS = new Set(
  [
    'password',
    'password123',
    'test',
    'test123',
    'secret',
    'changeme',
    'admin',
    'admin123',
    'pass',
    'pwd',
    '123456',
    'qwerty',
    '',
  ].map((s) => s.toLowerCase())
);

// Playwright's actual modifier API is test.fixme() — not test.fix().
const TEST_MODIFIERS = new Set(['only', 'skip', 'fixme', 'slow']);
const DESCRIBE_MODIFIERS = new Set(['serial', 'parallel', 'only', 'fixme']);

type Node = {
  type: string;
  computed?: boolean;
  callee?: Node;
  object?: Node;
  property?: Node;
  name?: string;
};

/** Matches a bare test(...) call. */
function isBareTestCall(node: Node): boolean {
  return node.callee?.type === 'Identifier' && node.callee.name === 'test';
}

/** Matches test.describe(...) and test.describe.serial/parallel/only/fixme(...). */
function isDescribeCall(node: Node): boolean {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  if (!obj || !prop || prop.type !== 'Identifier') return false;
  // test.describe(...)
  if (obj.type === 'Identifier' && obj.name === 'test' && prop.name === 'describe') {
    return true;
  }
  // test.describe.serial/parallel/only/fixme(...)
  if (
    obj.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object?.type === 'Identifier' &&
    obj.object.name === 'test' &&
    obj.property?.type === 'Identifier' &&
    obj.property.name === 'describe' &&
    DESCRIBE_MODIFIERS.has(prop.name ?? '')
  ) {
    return true;
  }
  return false;
}

/** Matches specifically test.describe.serial(...). */
function isSerialDescribeCall(node: Node): boolean {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  return (
    obj?.type === 'MemberExpression' &&
    !obj.computed &&
    obj.object?.type === 'Identifier' &&
    obj.object.name === 'test' &&
    obj.property?.type === 'Identifier' &&
    obj.property.name === 'describe' &&
    prop?.type === 'Identifier' &&
    prop.name === 'serial'
  );
}

/** Matches test.only/skip/fixme/slow(...) (a modifier form of a real test declaration). */
function isTestModifierCall(node: Node): boolean {
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression' || callee.computed) return false;
  const obj = callee.object;
  const prop = callee.property;
  return (
    obj?.type === 'Identifier' &&
    obj.name === 'test' &&
    prop?.type === 'Identifier' &&
    TEST_MODIFIERS.has(prop.name ?? '')
  );
}

/** Matches test.step(...). */
function isTestStepCall(node: Node): boolean {
  const callee = node.callee;
  return (
    callee?.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'test' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'step'
  );
}

function hasDisableNextLine(
  sourceCode: { getText: () => string },
  line: number,
  ruleId: string
): boolean {
  const lines = sourceCode.getText().split(/\r?\n/);
  if (line < 2) return false;
  const prev = lines[line - 2] ?? '';
  return (
    prev.includes('spec-score-disable-next-line') &&
    (prev.includes(ruleId) || prev.includes('guardian/'))
  );
}

const noWaitForLoadState: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow page.waitForLoadState()' },
    messages: {
      banned: 'waitForLoadState is banned under guardian profile. Use web-first assertions.',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'waitForLoadState'
        ) {
          context.report({ node, messageId: 'banned' });
        }
      },
    };
  },
};

const noDateNowId: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Date.now() for unique ids' },
    messages: {
      banned:
        'Date.now() is banned for unique ids. Use crypto.randomUUID().split("-")[0].',
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Date' &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'now'
        ) {
          context.report({ node, messageId: 'banned' });
        }
      },
    };
  },
};

// Whole words only (after splitting camelCase/snake_case/kebab-case), not a
// bare substring match — a substring match on "auth" flags "authorName",
// "isAuthenticated", every "Author"/"authenticate"/"authorize" field in a
// typical app under test, which is a lot of unrelated real-world test data.
const SENSITIVE_WORDS = new Set([
  'password',
  'passwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'auth',
  'authorization',
  'credential',
  'credentials',
]);

function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

function looksLikeSensitiveKey(rawKey: string): boolean {
  const words = splitIdentifierWords(rawKey);
  if (words.some((w) => SENSITIVE_WORDS.has(w))) return true;
  // apiKey / api_key / API-KEY — "key" alone is too generic (primaryKey,
  // sortKey, ...) so only flag it directly adjacent to "api".
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === 'api' && words[i + 1] === 'key') return true;
  }
  return false;
}

const noHardcodedSecrets: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Flag likely hardcoded secrets (with allowlist)' },
    messages: {
      secret: 'Possible hardcoded secret value. Use env/fixtures or allowlist dummy data.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function check(node: { type: string; value?: string; loc?: { start: { line: number } } }, rawKey?: string) {
      if (node.type !== 'Literal' || typeof (node as { value: unknown }).value !== 'string') return;
      const value = String((node as { value: string }).value);
      if (DUMMY_SECRETS.has(value.toLowerCase())) return;
      if (value.length < 6) return;
      if (!looksLikeSensitiveKey(rawKey ?? '')) return;
      const line = node.loc?.start.line ?? 1;
      if (hasDisableNextLine(sourceCode, line, 'guardian/no-hardcoded-secrets')) return;
      context.report({ node: node as never, messageId: 'secret' });
    }

    return {
      Property(node) {
        if (node.key.type === 'Identifier') {
          check(node.value as never, node.key.name);
        } else if (node.key.type === 'Literal') {
          check(node.value as never, String(node.key.value));
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && node.init) {
          check(node.init as never, node.id.name);
        }
      },
    };
  },
};

const noGenericLongTimeout: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Only allow timeout 2000 or 20000' },
    messages: {
      timeout: 'Avoid generic timeouts; allowed values under guardian: 2000 (audit) or 20000 (backend).',
    },
    schema: [],
  },
  create(context) {
    const allowed = new Set([2000, 20000]);
    return {
      Property(node) {
        if (
          node.key.type !== 'Identifier' ||
          node.key.name !== 'timeout' ||
          node.value.type !== 'Literal' ||
          typeof node.value.value !== 'number' ||
          allowed.has(node.value.value)
        ) {
          return;
        }
        // Only flag timeout options passed inline to a call, e.g.
        // locator.click({ timeout }), expect(x).toBeVisible({ timeout }),
        // test('x', { timeout }, fn) — not unrelated business data that
        // happens to have a field named "timeout" (session config, a
        // fixture payload, a mocked API response body, ...).
        const objectExpr = (node as unknown as { parent?: { type: string; parent?: { type: string; arguments?: unknown[] } } }).parent;
        const call = objectExpr?.parent;
        if (
          objectExpr?.type !== 'ObjectExpression' ||
          call?.type !== 'CallExpression' ||
          !call.arguments?.includes(objectExpr)
        ) {
          return;
        }
        context.report({ node, messageId: 'timeout' });
      },
    };
  },
};

const oneDescribeOneTest: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer one test.describe and one test per file' },
    messages: {
      describes: 'Guardian profile prefers exactly one test.describe() per file (found {{count}}).',
      tests: 'Guardian profile prefers exactly one test() per file (found {{count}}).',
    },
    schema: [],
  },
  create(context) {
    let describes = 0;
    let tests = 0;
    let usesSerialDescribe = false;
    return {
      CallExpression(node: Node) {
        if (isDescribeCall(node)) {
          describes++;
          if (isSerialDescribeCall(node)) usesSerialDescribe = true;
        }
        if (isBareTestCall(node) || isTestModifierCall(node)) tests++;
      },
      'Program:exit'() {
        if (describes > 1) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'describes',
            data: { count: String(describes) },
          });
        }
        // test.describe.serial(...) is Playwright's documented mechanism
        // for one user journey split into multiple ordered, dependent
        // test() calls — the same "one scenario per file" intent as this
        // rule, expressed a different way. Don't nag a pattern the
        // framework itself recommends for exactly this case.
        if (tests > 1 && !usesSerialDescribe) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'tests',
            data: { count: String(tests) },
          });
        }
      },
    };
  },
};

const requireTestStep: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Warn when file uses test() but no test.step()' },
    messages: {
      missing: 'Consider wrapping actions in test.step() for clearer structure.',
    },
    schema: [],
  },
  create(context) {
    let hasTest = false;
    let hasStep = false;
    return {
      CallExpression(node: Node) {
        if (isBareTestCall(node) || isTestModifierCall(node)) hasTest = true;
        if (isTestStepCall(node)) hasStep = true;
      },
      'Program:exit'() {
        if (hasTest && !hasStep) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'missing' });
        }
      },
    };
  },
};

const requireExpect: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require expect() in files with test()' },
    messages: {
      missing: 'Guardian profile requires at least one expect() in the spec.',
    },
    schema: [],
  },
  create(context) {
    let hasTest = false;
    let hasExpect = false;
    return {
      CallExpression(node: Node) {
        if (isBareTestCall(node) || isTestModifierCall(node)) hasTest = true;
        if (node.callee?.type === 'Identifier' && node.callee.name === 'expect') {
          hasExpect = true;
        }
        if (
          node.callee?.type === 'MemberExpression' &&
          node.callee.object?.type === 'Identifier' &&
          node.callee.object.name === 'expect'
        ) {
          hasExpect = true;
        }
      },
      'Program:exit'() {
        if (hasTest && !hasExpect) {
          context.report({ loc: { line: 1, column: 0 }, messageId: 'missing' });
        }
      },
    };
  },
};

export const guardianPlugin = {
  meta: { name: 'guardian', version: '0.1.0' },
  rules: {
    'no-wait-for-load-state': noWaitForLoadState,
    'no-date-now-id': noDateNowId,
    'no-hardcoded-secrets': noHardcodedSecrets,
    'no-generic-long-timeout': noGenericLongTimeout,
    'one-describe-one-test': oneDescribeOneTest,
    'require-test-step': requireTestStep,
    'require-expect': requireExpect,
  },
};

export const guardianRuleConfigs = {
  'guardian/no-wait-for-load-state': 'error',
  'guardian/no-date-now-id': 'error',
  'guardian/no-hardcoded-secrets': 'warn',
  'guardian/no-generic-long-timeout': 'warn',
  'guardian/one-describe-one-test': 'warn',
  'guardian/require-test-step': 'warn',
  'guardian/require-expect': 'error',
} as const;
