/**
 * Is a CSS selector string statically an `<input>` whose text is always empty? (QAG-287 N1, `form-control-text`.)
 *
 * Playwright's text assertions read an element's text, not the value typed into it; an `<input>` has no text,
 * except `type=button` and `type=submit`, whose text is their value. So the selector must end in an `input`
 * compound that carries a `type` attribute compared with `=`, and no such attribute may name `button`,
 * `submit` or `reset`. A bare `input` (it may be a submit button), `textarea` (its text is its initial
 * content) and `select` (its text is its options) are not read as one.
 *
 * Only plain CSS is read, optionally behind `css=`: selector lists, `>>` chains, other engines, parentheses
 * (`:not(...)`, `:has(...)`) and quotes outside attribute brackets give no answer, so the shape is not reported.
 */

const NOT_TEXT_TYPES = new Set(['button', 'submit', 'reset']);
/** `input`, then attribute, class, id and argument-free pseudo-class parts only. */
const INPUT_COMPOUND = /^input((?:\[[^\]]*\]|[.#][\w-]+|:[\w-]+)*)$/i;
const ATTRIBUTE = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s"'\]]+))\s*([is])?)?\s*$/i;

/** The last compound of a plain CSS selector, or undefined when the selector is not one this module reads. */
function lastCompound(selector: string): string | undefined {
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      if (--depth < 0) return undefined;
    } else if (depth > 0) {
      if (c === '"' || c === "'") quote = c;
    } else if (c === '"' || c === "'" || c === '(' || c === ')' || c === ',' || c === '\\') {
      return undefined;
    } else if (c === '>' && selector[i + 1] === '>') {
      return undefined;
    } else if (c === '>' || c === '+' || c === '~' || /\s/.test(c)) {
      start = i + 1;
    }
  }
  return depth === 0 && !quote ? selector.slice(start) : undefined;
}

/** True when `selector` ends in `input[type=<t>]`, with every `type=` value present and not button, submit or reset. */
export function isTextlessInputSelector(selector: string): boolean {
  let s = selector.trim();
  if (/^css\s*=/i.test(s)) s = s.replace(/^css\s*=/i, '').trim();
  const compound = lastCompound(s);
  const parts = compound === undefined ? undefined : INPUT_COMPOUND.exec(compound);
  if (!parts) return false;
  let typed = false;
  for (const [, body] of parts[1].matchAll(/\[([^\]]*)\]/g)) {
    const a = ATTRIBUTE.exec(body);
    if (!a) return false;
    if (a[1].toLowerCase() !== 'type') continue;
    const value = (a[3] ?? a[4] ?? a[5] ?? '').trim().toLowerCase();
    if (a[2] !== '=') {
      // `[type]` only says an attribute is there; `[type^=sub]` and the like may still match a button.
      if (a[2] !== undefined) return false;
      continue;
    }
    if (value === '' || NOT_TEXT_TYPES.has(value)) return false;
    typed = true;
  }
  return typed;
}
