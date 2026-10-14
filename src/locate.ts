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

/** Name and parameters of a C-family declaration, which keeps both inside
 * the declarator subtree (e.g. `static char *fmt(...)` or `int A::get()`). */
export interface DeclaratorInfo {
  readonly name: null | string;
  readonly params: number;
}

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

/** Name of a candidate node per its param source. */
export function candidateName(
  spec: FunctionKindSpec,
  node: SgNode,
): null | string {
  if (spec.paramSource === ParamSource.Declarator)
    return declaratorInfo(node)?.name ?? null;
  return declarationName(node);
}

/** Count declared parameters; a missing parameter list counts as zero. */
export function countParams(spec: FunctionKindSpec, node: SgNode): number {
  if (spec.paramsLeafKind !== undefined) {
    // Swift spreads parameters as direct children (no container node).
    return node.namedChildren().filter(c => c.kind() === spec.paramsLeafKind)
      .length;
  }
  if (spec.paramSource === ParamSource.Declarator)
    return declaratorInfo(node)?.params ?? 0;
  const holder = functionHolder(spec, node);
  if (!holder) return 0;
  if (spec.paramsContainerKind !== undefined) {
    const container = holder
      .namedChildren()
      .find(c => c.kind() === spec.paramsContainerKind);
    return container ? container.namedChildren().length : 0;
  }
  const parameters = holder.field(spec.paramsField ?? 'parameters');
  return parameters ? parameters.namedChildren().length : 0;
}

/**
 * Declaration name for Self/Value kinds: the `name` field, falling back to
 * the first property_identifier child (JavaScript field_definition has no
 * name field). Qualified names (`A::get`, `M.foo`) reduce to their last
 * segment so callers can match the bare name.
 */
export function declarationName(node: SgNode): null | string {
  const name = node.field('name');
  if (name) return normalizeName(name.text());
  const prop = node
    .namedChildren()
    .find(c => c.kind() === 'property_identifier');
  return prop ? normalizeName(prop.text()) : null;
}

/** Walk down the declarator subtree to the first function_declarator. */
export function declaratorInfo(node: SgNode): DeclaratorInfo | null {
  const queue = [...node.children()];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.kind() === 'function_declarator') {
      const name = current.field('declarator');
      const parameters = current.field('parameters');
      return {
        name: name ? normalizeName(name.text()) : null,
        params: parameters ? parameters.namedChildren().length : 0,
      };
    }
    queue.push(...current.children());
  }
  return null;
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
      if (kindSpec.paramSource === ParamSource.Value) {
        const value = node.field('value');
        if (!value || !kindSpec.fnValueKinds?.includes(String(value.kind())))
          continue;
      }
      const name = candidateName(kindSpec, node);
      if (!name) continue;
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

/** The node that carries the parameter list for this kind. */
function functionHolder(spec: FunctionKindSpec, node: SgNode): null | SgNode {
  if (spec.paramSource === ParamSource.Value) return node.field('value');
  return node;
}

/** `A::get` / `M.foo` -> `get` / `foo`. */
function normalizeName(name: string): string {
  const parts = name.split(/[.:]+/).filter(p => p.length > 0);
  return parts.at(-1) ?? name;
}

function previewOf(text: string): string {
  const first = text.split('\n')[0]?.trim() ?? '';
  return first.length > 100 ? `${first.slice(0, 97)}...` : first;
}
