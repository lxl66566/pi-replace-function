import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * The replace_function tool: swap one whole function or method by name
 * without restating the old code.
 */
import {
  defineTool,
  generateDiffString,
  generateUnifiedPatch,
  withFileMutationQueue,
  type AgentToolResult,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { type Static, Type } from 'typebox';

import { extractDeclaration } from './content.ts';
import { specForPath } from './langs.ts';
import { locate, type FunctionCandidate } from './locate.ts';
import { replaceFunction } from './replace.ts';
import {
  detectLineEnding,
  normalizeToLf,
  restoreLineEndings,
  splitBom,
} from './text.ts';

const parameters = Type.Object({
  content: Type.Optional(
    Type.String({
      description:
        'New declaration source: exactly one complete function/method declaration, from the header through the closing brace. Surrounding modifiers (export, const, declare, …) are ignored — the file keeps its own. Comments placed above the declaration replace the old comment block attached to the function; omit them to keep the old comments. Indentation may start at column 0. Omit content to look up the current declaration without changing the file.',
    }),
  ),
  line: Type.Optional(
    Type.Integer({
      description:
        'Disambiguator: 1-based start line of the declaration, when several declarations share the name.',
    }),
  ),
  name: Type.String({
    description:
      'Function name exactly as declared (`foo`; include `#` for private methods, quotes for string-literal names)',
  }),
  params: Type.Optional(
    Type.Integer({
      description:
        'Disambiguator: number of declared parameters, when several declarations share the name (e.g. overloads). Optional/rest parameters count as one each.',
    }),
  ),
  path: Type.String({
    description: 'Path to the file to edit (relative or absolute)',
  }),
});

export interface ReplaceFunctionDetails {
  /** display-oriented diff of the change */
  diff: string;
  /** 1-based line of the first change in the new file */
  firstChangedLine?: number;
  /** unified patch of the change */
  patch: string;
}

export type ReplaceFunctionInput = Static<typeof parameters>;

export const replaceFunctionToolDefinition: ToolDefinition<
  typeof parameters,
  ReplaceFunctionDetails | undefined
> = {
  constrainedSampling: { strict: 'prefer', type: 'json_schema' },
  description:
    'Replace one entire function or method in a file by name, without restating the old code. Give only the new declaration; the tool locates the old one by name (`params` = parameter count, `line` = start line, disambiguate overloads and same-name methods) and swaps it. Surrounding modifiers (export, const), decorators and indentation are preserved from the file. Leading comments are kept unless the new content brings its own, which then replace them. Best for rewriting or refactoring a whole function body; prefer `edit` for small in-place tweaks or non-function regions, and `write` for new files or whole-file rewrites. Omit `content` to preview the current declaration first. Supports TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Lua, Scala, Bash and Haskell files. When several declarations match, the tool lists them instead of replacing.',
  async execute(_toolCallId, input, signal, _onUpdate, ctx) {
    return applyReplaceFunction(input, ctx.cwd, signal);
  },
  label: 'replace function',
  name: 'replace_function',
  parameters,
  prepareArguments: stripFencedContent,
  promptGuidelines: [
    'Use replace_function to rewrite a whole function or method: pass path, name and the complete new declaration; no need to restate or read the old body first.',
    'If unsure about the current shape, call replace_function without content to fetch the current declaration, then call again with the replacement.',
    'Use edit for small targeted changes inside a function or in non-function code; use write only for new files or whole-file rewrites.',
  ],

  promptSnippet:
    'Replace a whole function or method by name, restating only the new code',
};

/** File-IO core of the tool; also the integration-test entry point. */
export async function applyReplaceFunction(
  input: ReplaceFunctionInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentToolResult<ReplaceFunctionDetails | undefined>> {
  const absolutePath = resolveToCwd(input.path, cwd);
  const spec = specForPath(absolutePath);
  if (!spec) {
    throw new Error(
      `replace_function supports only function-declaration languages (TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Lua, Scala, Bash, Haskell), got: ${input.path}`,
    );
  }

  return withFileMutationQueue(absolutePath, async () => {
    // Check the abort flag between awaits instead of racing the queue with a
    // listener, so the queue stays locked until the current write settles.
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error('Operation aborted');
    };
    throwIfAborted();

    try {
      await access(absolutePath, constants.R_OK | constants.W_OK);
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? ` Error code: ${String(error.code)}`
          : '';
      throw new Error(`Could not edit file: ${input.path}.${code}`, {
        cause: error,
      });
    }
    throwIfAborted();

    const raw = await readFile(absolutePath, 'utf-8');
    throwIfAborted();
    const { bom, text } = splitBom(raw);
    const eol = detectLineEnding(text);
    const source = normalizeToLf(text);

    const located = locate(source, spec, {
      line: input.line,
      name: input.name,
      params: input.params,
    });
    if (located.status === 'not-found') {
      throw new Error(notFoundMessage(input.path, input.name, located.all));
    }
    if (located.status === 'ambiguous') {
      throw new Error(ambiguousMessage(input.name, located.sameName));
    }
    const candidate = located.candidate;

    if (input.content === undefined) {
      return {
        content: [
          { text: probeMessage(input.path, source, candidate), type: 'text' },
        ],
        details: undefined,
      };
    }
    throwIfAborted();

    const checked = extractDeclaration(input.content, spec);
    if (!checked.ok) throw new Error(checked.error);
    const { decl } = checked;

    const result = replaceFunction(
      source,
      spec,
      candidate,
      decl.text,
      decl.leadComment,
    );
    if (!result.ok) throw new Error(result.error);
    throwIfAborted();

    await writeFile(
      absolutePath,
      bom + restoreLineEndings(result.source, eol),
      'utf-8',
    );
    throwIfAborted();

    const { diff, firstChangedLine } = generateDiffString(
      source,
      result.source,
    );
    const notes: string[] = [];
    if (decl.name !== null && decl.name !== input.name) {
      notes.push(
        `The declaration is now named "${decl.name}" (was "${input.name}").`,
      );
    }
    if (decl.leadComment !== null) {
      notes.push('Replaced the comment block attached above the function.');
    }
    return {
      content: [
        {
          text: [
            `Replaced ${input.name} (old lines ${result.replacedFrom}-${result.replacedTo}) in ${input.path}; new declaration is lines ${result.insertedFrom}-${result.insertedTo}.`,
            ...notes,
          ].join(' '),
          type: 'text',
        },
      ],
      details: {
        diff,
        firstChangedLine,
        patch: generateUnifiedPatch(input.path, source, result.source),
      } satisfies ReplaceFunctionDetails,
    };
  });
}

export const replaceFunctionTool = defineTool(replaceFunctionToolDefinition);

function ambiguousMessage(name: string, sameName: FunctionCandidate[]): string {
  const lines = sameName.map(
    c => `- line ${c.line}, params ${c.params}: ${c.preview}`,
  );
  return [
    `"${name}" matches ${sameName.length} declarations. Re-call with params (parameter count) or line (start line) to pick one:`,
    ...lines,
  ].join('\n');
}

function notFoundMessage(
  path: string,
  name: string,
  all: FunctionCandidate[],
): string {
  const available = all.map(
    c => `${c.name} (line ${c.line}, params ${c.params})`,
  );
  const list =
    available.length > 0
      ? `Declarations in ${path}:\n${available.slice(0, 60).join('\n')}${available.length > 60 ? '\n…' : ''}`
      : `${path} declares no functions.`;
  return `No declaration named "${name}" in ${path}. ${list}`;
}

/** Preview reply for a content-less lookup call. */
function probeMessage(
  path: string,
  source: string,
  candidate: FunctionCandidate,
): string {
  const lines = source.split('\n');
  const body = lines.slice(candidate.start.line, candidate.end.line + 1);
  const header = `Found "${candidate.name}" (${candidate.kind}, params ${candidate.params}) at ${path}:${candidate.line}-${candidate.endLine}.`;
  if (body.length > 200 || body.join('\n').length > 10_000) {
    return `${header} Declaration is too large to inline; read ${path} lines ${candidate.line}-${candidate.endLine}, then call again with content.`;
  }
  return `${header}\nCurrent declaration:\n${body.join('\n')}\nCall again with content to replace it.`;
}

/** Expand `~` and resolve the model-supplied path against cwd. */
function resolveToCwd(filePath: string, cwd: string): string {
  const expanded =
    filePath === '~' || filePath.startsWith('~/')
      ? filePath.replace(/^~/, homedir())
      : filePath;
  return resolve(cwd, expanded);
}

/** Some models wrap the content in a markdown code fence; strip one full fence. */
function stripFencedContent(args: unknown): ReplaceFunctionInput {
  if (!args || typeof args !== 'object') return args as ReplaceFunctionInput;
  const record = args as Record<string, unknown>;
  if (typeof record.content === 'string') {
    const fenced = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(record.content);
    if (fenced?.[1] !== undefined) record.content = fenced[1];
  }
  return record as ReplaceFunctionInput;
}
