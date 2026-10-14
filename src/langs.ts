/**
 * Language table: which file extensions we handle and which tree-sitter node
 * kinds count as a replaceable function declaration.
 *
 * ast-grep parses via tree-sitter grammars; `findAll({ rule: { kind } })`
 * matches by kind name, and kind names absent from a grammar simply match
 * nothing, so TS-only kinds are harmless for .js files.
 */
import { Lang } from '@ast-grep/napi';

import type { LinePos } from './text.ts';

export type { LinePos };

/** Where the parameter list of a target node lives. */
export enum ParamSource {
  /** the node has its own `parameters` field (function/method declarations) */
  Self = 'self',
  /** params come from the `value` child (variable declarator, class field) */
  Value = 'value',
}

export interface FunctionKindSpec {
  /** for ParamSource.Value: value node kinds that make the holder a function */
  readonly fnValueKinds?: readonly string[];
  /** tree-sitter kind name of the declaration node */
  readonly kind: string;
  readonly paramSource: ParamSource;
}

export interface LanguageSpec {
  /** matches a whole line that is a comment (for the attached-comment scan) */
  readonly commentLine: RegExp;
  readonly extensions: readonly string[];
  readonly kinds: readonly FunctionKindSpec[];
  readonly lang: Lang;
}

/** Value node kinds that make a declarator/field hold a function. */
const FN_VALUE_KINDS = [
  'arrow_function',
  'function_expression',
  'generator_function',
] as const;

const tsFamilyKinds: readonly FunctionKindSpec[] = [
  { kind: 'function_declaration', paramSource: ParamSource.Self },
  { kind: 'generator_function_declaration', paramSource: ParamSource.Self },
  { kind: 'function_signature', paramSource: ParamSource.Self },
  { kind: 'method_definition', paramSource: ParamSource.Self },
  { kind: 'method_signature', paramSource: ParamSource.Self },
  { kind: 'abstract_method_signature', paramSource: ParamSource.Self },
  {
    fnValueKinds: FN_VALUE_KINDS,
    kind: 'variable_declarator',
    paramSource: ParamSource.Value,
  },
  {
    fnValueKinds: FN_VALUE_KINDS,
    kind: 'public_field_definition',
    paramSource: ParamSource.Value,
  },
];

/** JavaScript grammar: no TS signature kinds, class fields are `field_definition`. */
const jsKinds: readonly FunctionKindSpec[] = [
  { kind: 'function_declaration', paramSource: ParamSource.Self },
  { kind: 'generator_function_declaration', paramSource: ParamSource.Self },
  { kind: 'method_definition', paramSource: ParamSource.Self },
  {
    fnValueKinds: FN_VALUE_KINDS,
    kind: 'variable_declarator',
    paramSource: ParamSource.Value,
  },
  {
    fnValueKinds: FN_VALUE_KINDS,
    kind: 'field_definition',
    paramSource: ParamSource.Value,
  },
];

// `*` covers `*/` lines, so no separate alternative is needed.
const tsCommentLine = /^\s*(\/\/|\/\*|\*)/;

const SPECS: readonly LanguageSpec[] = [
  {
    commentLine: tsCommentLine,
    extensions: ['.ts', '.mts', '.cts'],
    kinds: tsFamilyKinds,
    lang: Lang.TypeScript,
  },
  {
    commentLine: tsCommentLine,
    extensions: ['.tsx'],
    kinds: tsFamilyKinds,
    lang: Lang.Tsx,
  },
  {
    commentLine: tsCommentLine,
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    kinds: jsKinds,
    lang: Lang.JavaScript,
  },
];

/** Resolve the language spec for a file path, or undefined for unsupported types. */
export function specForPath(filePath: string): LanguageSpec | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = filePath.slice(dot).toLowerCase();
  return SPECS.find(spec => spec.extensions.includes(ext));
}
