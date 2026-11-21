import { parseForESLint } from '@typescript-eslint/parser';
import { sourceTypeFor } from '../../src/source-type.js';

// A copy of the list-building loop of importsPlaywrightTestTransitively
// (src/playwright-config.ts: requireCallSpecifier, requireSpecifiersInBody and
// the import/export loop), with the same parser options. The collector in
// src/admission.ts must return this list for every source this parser
// accepts. Test-only: used by tests/admission-table.test.ts and by the
// collector comparison script.

type Node = Record<string, unknown>;

function requireCallSpecifier(node: Node | undefined | null): string | undefined {
  if (!node || node.type !== 'CallExpression') return undefined;
  const callee = (node as { callee?: Node }).callee;
  if (callee?.type !== 'Identifier' || (callee as { name?: string }).name !== 'require') return undefined;
  const args = (node as { arguments?: Node[] }).arguments ?? [];
  const arg = args[0];
  if (arg?.type === 'Literal' && typeof (arg as { value?: unknown }).value === 'string') {
    return (arg as { value: string }).value;
  }
  return undefined;
}

function requireSpecifiersInBody(body: Node[]): string[] {
  const specifiers: string[] = [];
  for (const node of body) {
    if (node.type === 'ExpressionStatement') {
      const spec = requireCallSpecifier((node as { expression?: Node }).expression);
      if (spec) specifiers.push(spec);
      continue;
    }
    if (node.type === 'VariableDeclaration') {
      for (const decl of (node as { declarations?: Array<{ init?: Node | null }> }).declarations ?? []) {
        const spec = requireCallSpecifier(decl.init);
        if (spec) specifiers.push(spec);
      }
    }
  }
  return specifiers;
}

/** The ordered specifier list, or undefined when the strict parser rejects the source. */
export function parentSpecifierList(file: string, source: string): string[] | undefined {
  let body: Node[];
  try {
    const ast = parseForESLint(source, {
      ecmaVersion: 2022,
      sourceType: sourceTypeFor(file),
      ecmaFeatures: { jsx: /\.(tsx|jsx)$/.test(file) },
    }).ast as unknown as { body?: Node[] };
    body = ast.body ?? [];
  } catch {
    return undefined;
  }
  const list = requireSpecifiersInBody(body);
  for (const node of body) {
    if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration' && node.type !== 'ExportAllDeclaration') {
      continue;
    }
    const src = (node as { source?: { value?: unknown } }).source?.value;
    if (typeof src !== 'string') continue;
    list.push(src);
  }
  return list;
}
