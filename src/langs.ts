import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Language table: which file extensions we handle, which tree-sitter node
 * kinds count as a replaceable function declaration, and how to load each
 * grammar. ast-grep ships TS/TSX/JS built in; everything else is registered
 * dynamically from tree-sitter npm packages' prebuilt libraries.
 *
 * NOTE: ast-grep validates kind matchers against the grammar — an invalid
 * kind throws instead of matching nothing, so every kind listed here has
 * been verified against its grammar.
 */
import {
  registerDynamicLanguage,
  type DynamicLangRegistrations,
  Lang,
} from '@ast-grep/napi';

import type { LinePos } from './text.ts';

export type { LinePos };

/** Comment syntax family, shared by the trivia scanner and the
 * attached-comment scan. */
export enum CommentFamily {
  /** // and slash-star block comments */
  C = 'c',
  /** -- to end of line */
  Dash = 'dash',
  /** # to end of line */
  Hash = 'hash',
}

/** How name and parameters are extracted from a target node. */
export enum ParamSource {
  /** C family: name and parameters live inside the declarator subtree */
  Declarator = 'declarator',
  /** the node has its own name/parameters fields (function/method declarations) */
  Self = 'self',
  /** params come from the `value` child (variable declarator, class field) */
  Value = 'value',
}

/** Prebuilt tree-sitter grammar library shipped by an npm package. */
export interface DynamicGrammar {
  /** .node file name under prebuilds/<platform>-<arch>/ */
  readonly nodeFile: string;
  /** npm package that ships the prebuild */
  readonly pkg: string;
  /** exported tree_sitter_* symbol */
  readonly symbol: string;
}

export interface FunctionKindSpec {
  /** for ParamSource.Value: value node kinds that make the holder a function */
  readonly fnValueKinds?: readonly string[];
  /** tree-sitter kind name of the declaration node */
  readonly kind: string;
  /** find the parameter container by child kind when it has no field name (Kotlin) */
  readonly paramsContainerKind?: string;
  /** parameter-list field name; defaults to `parameters` */
  readonly paramsField?: string;
  /** count direct children of this kind as parameters (Swift) */
  readonly paramsLeafKind?: string;
  readonly paramSource: ParamSource;
}

export interface LanguageSpec {
  /** wrap template for method-shaped content; `%s` is the content. Languages
   * whose method syntax parses standalone (Python, Go, Rust, …) use null. */
  readonly classWrap: null | string;
  readonly commentLineFamily: CommentFamily;
  /** matches decorator/annotation/attribute lines tolerated above content */
  readonly decoratorLine?: RegExp;
  readonly extensions: readonly string[];
  /** grammar library to register; undefined means ast-grep built-in */
  readonly grammar?: DynamicGrammar;
  readonly kinds: readonly FunctionKindSpec[];
  readonly lang: string;
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

const cFamilyKinds: readonly FunctionKindSpec[] = [
  // Plain prototypes are a generic `declaration` kind, so only definitions
  // are replaceable targets in C/C++.
  { kind: 'function_definition', paramSource: ParamSource.Declarator },
];

const SELF = ParamSource.Self;

const WRAP = 'class Wrap {\n%s\n}\n';

// Matches a whole line that is a comment, per family.
// A bare `*` alternative already covers block-comment closers.
const COMMENT_LINES: Readonly<Record<CommentFamily, RegExp>> = {
  [CommentFamily.C]: /^\s*(\/\/|\/\*|\*)/,
  [CommentFamily.Dash]: /^\s*--/,
  [CommentFamily.Hash]: /^\s*#/,
};

export function commentLineFor(spec: LanguageSpec): RegExp {
  return COMMENT_LINES[spec.commentLineFamily];
}

// Decorator/annotation/attribute lines tolerated above content.
const atDecorator = /^\s*@/;
const bracketAttr = /^\s*\[/;

const SPECS: readonly LanguageSpec[] = [
  {
    classWrap: WRAP,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.ts', '.mts', '.cts'],
    kinds: tsFamilyKinds,
    lang: Lang.TypeScript,
  },
  {
    classWrap: WRAP,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.tsx'],
    kinds: tsFamilyKinds,
    lang: Lang.Tsx,
  },
  {
    classWrap: WRAP,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    kinds: jsKinds,
    lang: Lang.JavaScript,
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.Hash,
    decoratorLine: atDecorator,
    extensions: ['.py'],
    grammar: {
      nodeFile: 'tree-sitter-python.node',
      pkg: 'tree-sitter-python',
      symbol: 'tree_sitter_python',
    },
    kinds: [{ kind: 'function_definition', paramSource: SELF }],
    lang: 'Python',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    decoratorLine: /^\s*#\[/,
    extensions: ['.rs'],
    grammar: {
      nodeFile: 'tree-sitter-rust.node',
      pkg: 'tree-sitter-rust',
      symbol: 'tree_sitter_rust',
    },
    kinds: [
      { kind: 'function_item', paramSource: SELF },
      { kind: 'function_signature_item', paramSource: SELF },
    ],
    lang: 'Rust',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    extensions: ['.go'],
    grammar: {
      nodeFile: 'tree-sitter-go.node',
      pkg: 'tree-sitter-go',
      symbol: 'tree_sitter_go',
    },
    kinds: [
      { kind: 'function_declaration', paramSource: SELF },
      { kind: 'method_declaration', paramSource: SELF },
    ],
    lang: 'Go',
  },
  {
    classWrap: WRAP,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.java'],
    grammar: {
      nodeFile: 'tree-sitter-java.node',
      pkg: 'tree-sitter-java',
      symbol: 'tree_sitter_java',
    },
    kinds: [
      { kind: 'method_declaration', paramSource: SELF },
      { kind: 'constructor_declaration', paramSource: SELF },
    ],
    lang: 'Java',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    extensions: ['.c', '.h'],
    grammar: {
      nodeFile: 'tree-sitter-c.node',
      pkg: 'tree-sitter-c',
      symbol: 'tree_sitter_c',
    },
    kinds: cFamilyKinds,
    lang: 'C',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    extensions: ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx'],
    grammar: {
      nodeFile: 'tree-sitter-cpp.node',
      pkg: 'tree-sitter-cpp',
      symbol: 'tree_sitter_cpp',
    },
    kinds: cFamilyKinds,
    lang: 'Cpp',
  },
  {
    classWrap: WRAP,
    commentLineFamily: CommentFamily.C,
    decoratorLine: bracketAttr,
    extensions: ['.cs'],
    grammar: {
      nodeFile: 'tree-sitter-c-sharp.node',
      pkg: 'tree-sitter-c-sharp',
      symbol: 'tree_sitter_c_sharp',
    },
    kinds: [
      { kind: 'method_declaration', paramSource: SELF },
      { kind: 'constructor_declaration', paramSource: SELF },
      { kind: 'local_function_statement', paramSource: SELF },
    ],
    lang: 'CSharp',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.Hash,
    extensions: ['.rb'],
    grammar: {
      nodeFile: 'tree-sitter-ruby.node',
      pkg: 'tree-sitter-ruby',
      symbol: 'tree_sitter_ruby',
    },
    kinds: [
      { kind: 'method', paramSource: SELF },
      { kind: 'singleton_method', paramSource: SELF },
    ],
    lang: 'Ruby',
  },
  {
    classWrap: '<?php\nclass Wrap {\n%s\n}\n',
    commentLineFamily: CommentFamily.C,
    decoratorLine: /^\s*(?:<\?php\b|#\[)/,
    extensions: ['.php'],
    grammar: {
      nodeFile: 'tree-sitter-php.node',
      pkg: 'tree-sitter-php',
      symbol: 'tree_sitter_php',
    },
    kinds: [
      { kind: 'function_definition', paramSource: SELF },
      { kind: 'method_declaration', paramSource: SELF },
    ],
    lang: 'Php',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.swift'],
    grammar: {
      nodeFile: 'tree-sitter-swift.node',
      pkg: 'tree-sitter-swift',
      symbol: 'tree_sitter_swift',
    },
    kinds: [
      {
        kind: 'function_declaration',
        paramsLeafKind: 'parameter',
        paramSource: SELF,
      },
    ],
    lang: 'Swift',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.kt', '.kts'],
    grammar: {
      nodeFile: '@tree-sitter-grammars+tree-sitter-kotlin.node',
      pkg: '@tree-sitter-grammars/tree-sitter-kotlin',
      symbol: 'tree_sitter_kotlin',
    },
    kinds: [
      {
        kind: 'function_declaration',
        paramsContainerKind: 'function_value_parameters',
        paramSource: SELF,
      },
    ],
    lang: 'Kotlin',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.Dash,
    extensions: ['.lua'],
    grammar: {
      nodeFile: '@tree-sitter-grammars+tree-sitter-lua.node',
      pkg: '@tree-sitter-grammars/tree-sitter-lua',
      symbol: 'tree_sitter_lua',
    },
    kinds: [{ kind: 'function_declaration', paramSource: SELF }],
    lang: 'Lua',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.C,
    decoratorLine: atDecorator,
    extensions: ['.scala'],
    grammar: {
      nodeFile: 'tree-sitter-scala.node',
      pkg: 'tree-sitter-scala',
      symbol: 'tree_sitter_scala',
    },
    kinds: [{ kind: 'function_definition', paramSource: SELF }],
    lang: 'Scala',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.Hash,
    extensions: ['.sh', '.bash'],
    grammar: {
      nodeFile: 'tree-sitter-bash.node',
      pkg: 'tree-sitter-bash',
      symbol: 'tree_sitter_bash',
    },
    kinds: [{ kind: 'function_definition', paramSource: SELF }],
    lang: 'Bash',
  },
  {
    classWrap: null,
    commentLineFamily: CommentFamily.Dash,
    extensions: ['.hs'],
    grammar: {
      nodeFile: 'tree-sitter-haskell.node',
      pkg: 'tree-sitter-haskell',
      symbol: 'tree_sitter_haskell',
    },
    kinds: [{ kind: 'function', paramsField: 'patterns', paramSource: SELF }],
    lang: 'Haskell',
  },
];

/** Resolve the prebuilt library path for a grammar, or null when the current
 * platform has no prebuild (the language is then silently unsupported). */
function grammarLibraryPath(grammar: DynamicGrammar): null | string {
  try {
    const pkgRoot = dirname(
      createRequire(import.meta.url).resolve(`${grammar.pkg}/package.json`),
    );
    const libraryPath = join(
      pkgRoot,
      'prebuilds',
      `${process.platform}-${process.arch}`,
      grammar.nodeFile,
    );
    return existsSync(libraryPath) ? libraryPath : null;
  } catch {
    // Package missing entirely (broken install) — treat like no prebuild.
    return null;
  }
}

const available = new Set<string>();
{
  // registerDynamicLanguage must run exactly once per process; the ESM module
  // cache guarantees this module body runs once even under jiti.
  const registrations: DynamicLangRegistrations = {};
  for (const spec of SPECS) {
    if (!spec.grammar) {
      available.add(spec.lang);
      continue;
    }
    const libraryPath = grammarLibraryPath(spec.grammar);
    if (libraryPath === null) continue;
    available.add(spec.lang);
    registrations[spec.lang] = {
      extensions: [...spec.extensions],
      languageSymbol: spec.grammar.symbol,
      libraryPath,
    };
  }
  if (Object.keys(registrations).length > 0) {
    registerDynamicLanguage(registrations);
  }
}

/** Resolve the language spec for a file path, or undefined for unsupported types. */
export function specForPath(filePath: string): LanguageSpec | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot < 0) return undefined;
  const ext = filePath.slice(dot).toLowerCase();
  return SPECS.find(
    spec => available.has(spec.lang) && spec.extensions.includes(ext),
  );
}
