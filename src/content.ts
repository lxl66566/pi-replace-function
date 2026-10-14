/**
 * Validate the replacement content and extract the single declaration it must
 * contain. Pure string-in / structured-out; no file IO.
 */
import { parse, type SgNode } from '@ast-grep/napi';

import { ParamSource, type LanguageSpec } from './langs.ts';
import { declarationName } from './locate.ts';
import { normalizeToLf } from './text.ts';

export type ContentCheck =
  | { decl: ExtractedDeclaration; ok: true }
  | { error: string; ok: false };

export interface ExtractedDeclaration {
  /** comment block the content carries above the declaration, verbatim (LF) */
  readonly leadComment: null | string;
  /** declared name when the node has a name field */
  readonly name: null | string;
  /** declared parameter count */
  readonly params: number;
  /** the declaration itself, exactly as parsed (LF), no surrounding trivia */
  readonly text: string;
}

/** Modifiers tolerated around the declaration (kept from the file, not content). */
const MODIFIERS = new Set([
  'abstract',
  'accessor',
  'const',
  'declare',
  'default',
  'export',
  'let',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'static',
  'var',
]);

/** Kinds that only parse inside a class body; used for the wrap fallback. */
const CLASS_BODY_KINDS = new Set([
  'abstract_method_signature',
  'field_definition',
  'method_definition',
  'method_signature',
  'public_field_definition',
]);

const NO_TARGET_ERROR =
  'content is not a complete function declaration — it may be truncated (missing closing brace or parenthesis) or a fragment. Provide the entire declaration, from the function/method/const header through the closing brace.';

interface TriviaScan {
  comments: string[];
  ok: boolean;
  /** when !ok: the offending remainder starting at the bad token */
  rest: string;
}

export function extractDeclaration(
  content: string,
  spec: LanguageSpec,
): ContentCheck {
  const text = normalizeToLf(content);
  if (text.trim() === '') return { error: NO_TARGET_ERROR, ok: false };

  // Direct parse first; method-shaped fragments fall back to a class-body wrap.
  let nodes = outermostTargets(text, spec, null);
  let base = 0;
  let wrapped = false;
  if (nodes.length === 0) {
    const wrapper = `class $Wrap {\n${text}\n}`;
    nodes = outermostTargets(wrapper, spec, CLASS_BODY_KINDS);
    base = `class $Wrap {\n`.length;
    wrapped = true;
    if (nodes.length === 0) return { error: NO_TARGET_ERROR, ok: false };
  }
  if (nodes.length > 1) {
    return {
      error: `content contains ${nodes.length} function declarations; provide exactly one.`,
      ok: false,
    };
  }

  const node = nodes[0];
  if (!node) return { error: NO_TARGET_ERROR, ok: false };
  const range = node.range();
  const prefix = text.slice(0, Math.max(0, range.start.index - base));
  const suffix = text.slice(Math.min(text.length, range.end.index - base));

  const scanned = scanTrivia(prefix);
  const scannedSuffix = scanTrailingTrivia(suffix);
  if (!scanned.ok || !scannedSuffix.ok) {
    // In wrapped mode a trivia failure means the fragment did not cleanly
    // occupy the whole content — most likely a truncated declaration.
    if (wrapped) return { error: NO_TARGET_ERROR, ok: false };
    if (!scanned.ok) {
      return {
        error: `unexpected text before the declaration: ${snippet(scanned.rest)} — only whitespace, comments and modifiers (export, const, …) may surround the declaration.`,
        ok: false,
      };
    }
    return {
      error: `unexpected text after the declaration: ${snippet(scannedSuffix.rest)} — only a trailing ";" or "," is allowed.`,
      ok: false,
    };
  }

  // Self kinds carry `parameters` directly; Value kinds keep it on the value node.
  const parameters =
    node.field('parameters') ?? node.field('value')?.field('parameters');
  const params = parameters ? parameters.namedChildren().length : 0;
  return {
    decl: {
      leadComment:
        scanned.comments.length > 0 ? scanned.comments.join('\n') : null,
      name: declarationName(node),
      params,
      text: text.slice(
        Math.max(0, range.start.index - base),
        Math.min(text.length, range.end.index - base),
      ),
    },
    ok: true,
  };
}

/** True when `maybeAncestor` contains `node` at any depth. */
function isAncestor(maybeAncestor: SgNode, node: SgNode): boolean {
  let parent = node.parent();
  while (parent) {
    if (parent.id() === maybeAncestor.id()) return true;
    parent = parent.parent();
  }
  return false;
}

/** Collect target nodes, keeping only those not nested inside another target. */
function outermostTargets(
  source: string,
  spec: LanguageSpec,
  kinds: null | Set<string>,
): SgNode[] {
  const root = parse(spec.lang, source).root();
  const all: SgNode[] = [];
  for (const kindSpec of spec.kinds) {
    if (kinds && !kinds.has(kindSpec.kind)) continue;
    for (const node of root.findAll({ rule: { kind: kindSpec.kind } })) {
      if (!declarationName(node)) continue;
      if (kindSpec.paramSource === ParamSource.Value) {
        const value = node.field('value');
        if (!value || !kindSpec.fnValueKinds?.includes(String(value.kind())))
          continue;
      }
      all.push(node);
    }
  }
  return all.filter(
    node =>
      !all.some(other => other.id() !== node.id() && isAncestor(other, node)),
  );
}

/** Whitespace plus at most trailing ";" / "," tokens. */
function scanTrailingTrivia(text: string): TriviaScan {
  const trimmed = text.trim();
  let rest = trimmed;
  while (rest.endsWith(';') || rest.endsWith(','))
    rest = rest.slice(0, -1).trimEnd();
  if (rest === '') return { comments: [], ok: true, rest: '' };
  return { comments: [], ok: false, rest };
}

/** Whitespace, comments and modifier keywords only. */
function scanTrivia(text: string): TriviaScan {
  const comments: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return { comments, ok: false, rest: text.slice(i) };
      comments.push(text.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    const ident = /^[A-Z_$][\w$]*/i.exec(text.slice(i));
    if (ident && MODIFIERS.has(ident[0])) {
      i += ident[0].length;
      continue;
    }
    return { comments, ok: false, rest: text.slice(i) };
  }
  return { comments, ok: true, rest: '' };
}

function snippet(text: string): string {
  const t = text.trim().split('\n')[0] ?? '';
  const shown = t.length > 60 ? `${t.slice(0, 57)}...` : t;
  return JSON.stringify(shown);
}
