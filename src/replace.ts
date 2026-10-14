/**
 * Apply an extracted declaration over a located candidate: extend the span
 * over the attached comment block when the content brings its own comments,
 * re-indent, splice, and syntax-check the result.
 */
import { parse } from '@ast-grep/napi';

import type { LanguageSpec } from './langs.ts';
import type { FunctionCandidate } from './locate.ts';
import { dedentLines, spliceSpan, toLines, type LinePos } from './text.ts';

export interface ReplaceFailure {
  readonly error: string;
}

export type ReplaceResult =
  | (ReplaceFailure & { ok: false })
  | (ReplaceSuccess & { ok: true });

export interface ReplaceSuccess {
  /** 1-based first/last line of the new declaration in the new file */
  readonly insertedFrom: number;
  readonly insertedTo: number;
  /** 1-based first/last line replaced in the old file (comments included) */
  readonly replacedFrom: number;
  readonly replacedTo: number;
  /** LF-normalized new source */
  readonly source: string;
}

/**
 * First line (0-based) of the comment block sitting directly above `startLine`
 * with no blank line in between, or null when there is none.
 */
export function attachedCommentStart(
  lines: readonly string[],
  startLine: number,
  commentLine: RegExp,
): null | number {
  let first = null as null | number;
  for (let i = startLine - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined || !commentLine.test(line)) break;
    first = i;
  }
  return first;
}

/**
 * Replace `candidate` inside LF-normalized `source` with the extracted
 * declaration. `leadComment` non-null means the content carries comments, so
 * the file's attached comment block is replaced together with the function.
 */
export function replaceFunction(
  source: string,
  spec: LanguageSpec,
  candidate: FunctionCandidate,
  declText: string,
  leadComment: null | string,
): ReplaceResult {
  const lines = toLines(source);
  const baseIndent = leadingWhitespace(lines[candidate.start.line] ?? '');

  let start: LinePos = candidate.start;
  if (leadComment !== null) {
    const commentStart = attachedCommentStart(
      lines,
      candidate.start.line,
      spec.commentLine,
    );
    if (commentStart !== null) start = { column: 0, line: commentStart };
  }

  const pieces =
    leadComment !== null ? `${leadComment}\n${declText}` : declText;
  const insertion = buildInsertion(
    pieces.split('\n'),
    baseIndent,
    start.column,
  );
  const newSource = spliceSpan(source, start, candidate.end, insertion);

  const errorDelta = countErrors(newSource, spec) - countErrors(source, spec);
  if (errorDelta > 0) {
    return {
      error:
        'the replacement does not parse in place (the declaration likely does not fit this position, e.g. a method body sent for a top-level function). The file was not changed.',
      ok: false,
    };
  }

  return {
    insertedFrom: start.line + 1,
    insertedTo: start.line + insertion.split('\n').length,
    ok: true,
    replacedFrom: start.line + 1,
    replacedTo: candidate.end.line + 1,
    source: newSource,
  };
}

/**
 * Re-indent the dedented replacement lines for a splice at `startColumn`.
 * spliceSpan keeps the text before `startColumn` on the first line, so the
 * first line gets `baseIndent` only when the span starts at column 0 (e.g.
 * an extended comment block); otherwise it is placed after the kept prefix.
 */
function buildInsertion(
  lines: readonly string[],
  baseIndent: string,
  startColumn: number,
): string {
  return dedentLines(lines)
    .map((line, i) => {
      if (line === '') return '';
      const first = i === 0 && startColumn > 0 ? '' : baseIndent;
      return first + line;
    })
    .join('\n');
}

/** Count tree-sitter ERROR nodes; tolerant of already-broken files. */
function countErrors(source: string, spec: LanguageSpec): number {
  return parse(spec.lang, source)
    .root()
    .findAll({ rule: { kind: 'ERROR' } }).length;
}

function leadingWhitespace(line: string): string {
  return line.slice(0, line.length - line.trimStart().length);
}
