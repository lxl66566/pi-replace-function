/**
 * Validate the replacement content and extract the single declaration it must
 * contain. Pure string-in / structured-out; no file IO.
 */
import { parse, type SgNode } from '@ast-grep/napi';

import { CommentFamily, ParamSource, type LanguageSpec } from './langs.ts';
import { candidateName, countParams, declarationName } from './locate.ts';
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

const NO_TARGET_ERROR =
  'content is not a complete function declaration — it may be truncated (missing closing brace or parenthesis) or a fragment. Provide the entire declaration, from the function/method/const header through the closing body.';

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

  // Direct parse first; method-shaped fragments fall back to a class-body wrap
  // for languages whose method syntax requires an enclosing type.
  let nodes = outermostTargets(text, spec);
  let base = 0;
  let wrapped = false;
  if (nodes.length === 0 && spec.classWrap !== null) {
    const wrapper = spec.classWrap.replace('%s', text);
    base = spec.classWrap.indexOf('%s');
    nodes = outermostTargets(wrapper, spec);
    wrapped = true;
    if (nodes.length === 0) return { error: NO_TARGET_ERROR, ok: false };
  }
  if (nodes.length === 0) return { error: NO_TARGET_ERROR, ok: false };
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

  const scanned = scanTrivia(prefix, spec);
  const scannedSuffix = scanTrailingTrivia(suffix);
  if (!scanned.ok || !scannedSuffix.ok) {
    // In wrapped mode a trivia failure means the fragment did not cleanly
    // occupy the whole content — most likely a truncated declaration.
    if (wrapped) return { error: NO_TARGET_ERROR, ok: false };
    if (!scanned.ok) {
      return {
        error: `unexpected text before the declaration: ${snippet(scanned.rest)} — only whitespace, comments, modifiers and decorators may surround the declaration.`,
        ok: false,
      };
    }
    return {
      error: `unexpected text after the declaration: ${snippet(scannedSuffix.rest)} — only a trailing ";" or "," is allowed.`,
      ok: false,
    };
  }

  const kindSpec = spec.kinds.find(k => k.kind === String(node.kind()));
  return {
    decl: {
      leadComment:
        scanned.comments.length > 0 ? scanned.comments.join('\n') : null,
      name: kindSpec ? candidateName(kindSpec, node) : declarationName(node),
      params: kindSpec ? countParams(kindSpec, node) : 0,
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

/** Collect target nodes, keeping only those not nested inside another target.
 * Nodes without a usable name (declarators without a function value, …) are
 * dropped so they never surface as candidates. */
function outermostTargets(source: string, spec: LanguageSpec): SgNode[] {
  const root = parse(spec.lang, source).root();
  const all: SgNode[] = [];
  for (const kindSpec of spec.kinds) {
    for (const node of root.findAll({ rule: { kind: kindSpec.kind } })) {
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

/** Whitespace, comments, modifier keywords and decorator lines only.
 * Decorator/annotation/attribute lines are tolerated but, unlike comments,
 * never become part of the replacement — the file keeps its own. */
function scanTrivia(text: string, spec: LanguageSpec): TriviaScan {
  const comments: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (spec.decoratorLine) {
      // `@Override`, `#[derive(..)]`, `[Route("..")]`, … to end of line.
      const lineEnd = text.indexOf('\n', i);
      const stop = lineEnd === -1 ? text.length : lineEnd;
      if (spec.decoratorLine.test(text.slice(i, stop))) {
        i = stop;
        continue;
      }
    }
    if (
      spec.commentLineFamily === CommentFamily.C &&
      ch === '/' &&
      text[i + 1] === '/'
    ) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (
      spec.commentLineFamily === CommentFamily.C &&
      ch === '/' &&
      text[i + 1] === '*'
    ) {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) return { comments, ok: false, rest: text.slice(i) };
      comments.push(text.slice(i, end + 2));
      i = end + 2;
      continue;
    }
    if (spec.commentLineFamily === CommentFamily.Hash && ch === '#') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (
      spec.commentLineFamily === CommentFamily.Dash &&
      ch === '-' &&
      text[i + 1] === '-'
    ) {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i, stop));
      i = stop;
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
