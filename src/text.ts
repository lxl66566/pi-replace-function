/** Text helpers shared by the replace-function pipeline. */

export type LineEnding = '\n' | '\r\n';

/** Zero-based line/column position into an LF-normalized source. */
export interface LinePos {
  column: number;
  line: number;
}

/** Longest whitespace prefix shared by all non-empty lines. */
export function commonIndent(lines: readonly string[]): string {
  let indent: null | string = null;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const lead = line.slice(0, line.length - line.trimStart().length);
    indent = indent === null ? lead : commonPrefix(indent, lead);
    if (indent === '') break;
  }
  return indent ?? '';
}

/**
 * Strip the common indent from every line (blank lines stay empty). The result
 * is relative to column 0; callers re-add the target indentation.
 */
export function dedentLines(lines: readonly string[]): string[] {
  const dedent = commonIndent(lines);
  return lines.map(line =>
    dedent !== '' && line.startsWith(dedent) ? line.slice(dedent.length) : line,
  );
}

/** CRLF when the text contains at least one CRLF sequence, LF otherwise.
 * Mixed-ending files are normalized to one ending throughout, including
 * regions the replacement did not touch. */
export function detectLineEnding(text: string): LineEnding {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function normalizeToLf(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function restoreLineEndings(lfText: string, eol: LineEnding): string {
  return eol === '\n' ? lfText : lfText.replace(/\n/g, eol);
}

/**
 * Replace the span [start, end) with `insertion` (both LF-normalized, columns
 * are UTF-16 offsets into their line).
 */
export function spliceSpan(
  source: string,
  start: LinePos,
  end: LinePos,
  insertion: string,
): string {
  const lines = toLines(source);
  const before = (lines[start.line] ?? '').slice(0, start.column);
  const after = (lines[end.line] ?? '').slice(end.column);
  const middle = insertion.split('\n');
  if (middle.length === 1) {
    return [
      ...lines.slice(0, start.line),
      before + middle[0]! + after,
      ...lines.slice(end.line + 1),
    ].join('\n');
  }
  const last = middle.length - 1;
  middle[0] = before + middle[0]!;
  middle[last] = middle[last]! + after;
  return [
    ...lines.slice(0, start.line),
    ...middle,
    ...lines.slice(end.line + 1),
  ].join('\n');
}

/** Split a UTF-8 BOM prefix, if any, from raw file content. */
export function splitBom(raw: string): { bom: string; text: string } {
  return raw.startsWith('\uFEFF')
    ? { bom: '\uFEFF', text: raw.slice(1) }
    : { bom: '', text: raw };
}

/** Split `source` (LF-normalized) into lines without terminators. */
export function toLines(source: string): string[] {
  return source.split('\n');
}

function commonPrefix(a: string, b: string): string {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i++;
  return a.slice(0, i);
}
