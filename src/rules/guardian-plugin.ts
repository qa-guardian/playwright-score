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
    const keyRe = /password|passwd|secret|token|api[_-]?key|auth/i;

    function check(node: { type: string; value?: string; loc?: { start: { line: number } } }, rawKey?: string) {
      if (node.type !== 'Literal' || typeof (node as { value: unknown }).value !== 'string') return;
      const value = String((node as { value: string }).value);
      if (DUMMY_SECRETS.has(value.toLowerCase())) return;
      if (value.length < 6) return;
      if (!keyRe.test(rawKey ?? '')) return;
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
          node.key.type === 'Identifier' &&
          node.key.name === 'timeout' &&
          node.value.type === 'Literal' &&
          typeof node.value.value === 'number' &&
          !allowed.has(node.value.value)
        ) {
          context.report({ node, messageId: 'timeout' });
        }
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
    return {
      CallExpression(node) {
        if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
          if (
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'test' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'describe'
          ) {
            describes++;
          }
        }
        if (node.callee.type === 'Identifier' && node.callee.name === 'test') {
          tests++;
        }
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'test' &&
          node.callee.property.type === 'Identifier' &&
          ['only', 'skip', 'fix', 'slow'].includes(node.callee.property.name)
        ) {
          tests++;
        }
      },
      'Program:exit'() {
        if (describes > 1) {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: 'describes',
            data: { count: String(describes) },
          });
        }
        if (tests > 1) {
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
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'test') {
          hasTest = true;
        }
        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.computed &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'test' &&
          node.callee.property.type === 'Identifier'
        ) {
          if (['only', 'skip', 'fix', 'slow'].includes(node.callee.property.name)) {
            hasTest = true;
          }
          if (node.callee.property.name === 'step') hasStep = true;
        }
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
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'test') {
          hasTest = true;
        }
        if (node.callee.type === 'Identifier' && node.callee.name === 'expect') {
          hasExpect = true;
        }
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
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
