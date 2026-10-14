/**
 * Find function declarations in a source string and filter them by name and
 * the optional disambiguators (parameter count, start line).
 */
import { parse, type SgNode } from '@ast-grep/napi';

import {
  ParamSource,
  type FunctionKindSpec,
  type LanguageSpec,
} from './langs.ts';
import type { LinePos } from './text.ts';

export interface FunctionCandidate {
  readonly end: LinePos;
  /** 1-based inclusive end line */
  readonly endLine: number;
  /** tree-sitter kind, e.g. function_declaration / method_definition */
  readonly kind: string;
  /** 1-based line of the declaration itself, leading comments excluded */
  readonly line: number;
  /** declared name, exactly as written (includes `#` for private methods) */
  readonly name: string;
  /** declared parameter count */
  readonly params: number;
  /** first source line, trimmed, for display */
  readonly preview: string;
  /** precise 0-based span in the LF-normalized source */
  readonly start: LinePos;
}

export interface LocateQuery {
  /** 1-based start line of the declaration */
  readonly line?: number | undefined;
  readonly name: string;
  readonly params?: number | undefined;
}

export type LocateResult =
  | { all: FunctionCandidate[]; status: 'not-found' }
  /** name matched but the filters left zero or several candidates */
  | { candidate: FunctionCandidate; status: 'unique' }
  /** nothing in the file declares this name */
  | { sameName: FunctionCandidate[]; status: 'ambiguous' };

/**
 * Declaration name: the `name` field, falling back to the first
 * property_identifier child (JavaScript field_definition has no name field).
 */
export function declarationName(node: SgNode): null | string {
  const name = node.field('name');
  if (name) return name.text();
  const prop = node
    .namedChildren()
    .find(c => c.kind() === 'property_identifier');
  return prop ? prop.text() : null;
}

/** Collect every function declaration in the source, sorted by position. */
export function listFunctions(
  source: string,
  spec: LanguageSpec,
): FunctionCandidate[] {
  const root = parse(spec.lang, source).root();
  const out: FunctionCandidate[] = [];
  for (const kindSpec of spec.kinds) {
    for (const node of root.findAll({ rule: { kind: kindSpec.kind } })) {
      const name = declarationName(node);
      if (!name) continue;
      if (kindSpec.paramSource === ParamSource.Value) {
        const value = node.field('value');
        if (!value || !kindSpec.fnValueKinds?.includes(String(value.kind())))
          continue;
      }
      const range = node.range();
      out.push({
        end: { column: range.end.column, line: range.end.line },
        endLine: range.end.line + 1,
        kind: String(node.kind()),
        line: range.start.line + 1,
        name,
        params: countParams(kindSpec, node),
        preview: previewOf(node.text()),
        start: { column: range.start.column, line: range.start.line },
      });
    }
  }
  out.sort(
    (a, b) => a.start.line - b.start.line || a.start.column - b.start.column,
  );
  return out;
}

/** Apply the name filter, then params/line when provided. */
export function locate(
  source: string,
  spec: LanguageSpec,
  query: LocateQuery,
): LocateResult {
  const all = listFunctions(source, spec);
  const sameName = all.filter(c => c.name === query.name);
  if (sameName.length === 0) return { all, status: 'not-found' };

  let filtered = sameName;
  if (query.params !== undefined)
    filtered = filtered.filter(c => c.params === query.params);
  if (query.line !== undefined)
    filtered = filtered.filter(c => c.line === query.line);
  const only = filtered[0];
  if (filtered.length === 1 && only)
    return { candidate: only, status: 'unique' };
  // List the surviving candidates; fall back to all same-name matches when the
  // filters excluded everything, so the caller can correct the filter values.
  return {
    sameName: filtered.length > 0 ? filtered : sameName,
    status: 'ambiguous',
  };
}

/** Count declared parameters; a missing parameters field counts as zero. */
function countParams(spec: FunctionKindSpec, node: SgNode): number {
  const holder =
    spec.paramSource === ParamSource.Value ? node.field('value') : node;
  const parameters = holder?.field('parameters');
  return parameters ? parameters.namedChildren().length : 0;
}

function previewOf(text: string): string {
  const first = text.split('\n')[0]?.trim() ?? '';
  return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}
