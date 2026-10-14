# pi-replace-function

A [pi](https://github.com/earendil-works/pi) extension that adds a `replace_function` tool: the agent names a function and provides only the new declaration, and the tool swaps the old one in place.

It targets two costs of editing code through an agent:

- hash-line edit formats attach a hash to every line, which pollutes context and prompt caches;
- whole-region replacement forces the agent to re-output code that did not change.

Functions are the most common unit of change in real code, so replacing one whole function by name captures most rewrite edits while the agent restates only what is new.

## Install

Requires pi with extension support. Put this directory under your user extensions directory (`~/.pi/agent/extensions/`) or your project extensions directory (`.pi/extensions/`), then install dependencies:

```sh
pnpm install
```

pi loads extensions with jiti, so no build step is needed. The entry point is `src/index.ts` (also declared in `package.json` under `pi.extensions` for package-style installs).

## Tool usage

```
replace_function(path, name, content?, params?, line?)
```

| Parameter | Type    | Meaning                                                 |
| --------- | ------- | ------------------------------------------------------- |
| `path`    | string  | File path, relative to cwd or absolute; `~` is expanded |
| `name`    | string  | Declared name of the function/method to replace         |
| `content` | string? | The complete new declaration; omit to probe (read-only) |
| `params`  | int?    | Parameter count, to disambiguate overloads              |
| `line`    | int?    | Start line (1-based), final disambiguator               |

Behavior:

- Locating: candidates are found by `name`, filtered by `params` when given, then by `line` when given. A single survivor is replaced; multiple survivors or none abort with a listing of what exists.
- Probe mode: calling without `content` returns the current declaration (capped at 200 lines / 10 KB) without touching the file.
- Content contract: exactly one complete declaration, either standalone (`function foo() {}`, `foo = (a) => a` for const arrows) or method-shaped (`m(a) { ... }`). Leading modifiers (`export`, `default`, `const`, `declare`, ...) are tolerated and dropped; the file keeps its own modifiers. A truncated body is rejected with a clear error.
- Comments: leading comments attached to the old declaration are kept, unless the new content carries its own comment block above the declaration, which then replaces the old block.
- Formatting: the new body is re-indented to the old declaration's indentation; BOM and CRLF/LF endings are preserved.
- Safety: the result must parse in place (no new syntax errors) or the write is rejected. Writes are serialized through pi's per-file mutation queue.
- Renaming works: replacing `foo` with content declaring `bar` renames the declaration and says so in the reply.

Supported languages: TypeScript, TSX, JavaScript, JSX (and `.mts`/`.cts`/`.mjs`/`.cjs`).

## Design decisions

- Parser: `@ast-grep/napi`. One dependency covers all supported languages with shared tree-sitter grammars, and the tool only uses kind-based node queries, so none of ast-grep's rule DSL leaks into the design.
- Locating by name, with `params`/`line` as opt-in disambiguators. Names survive unrelated edits; line numbers shift. `line` is an exact 1-based match on the declaration start.
- Replacement spans come from the file's syntax tree, and content validation requires exactly one outermost declaration node. That rule is what catches truncated content: tree-sitter recovers a missing brace without an error node, but the fragment no longer parses as a declaration.
- Method-shaped content (`m(a) { ... }`) does not parse standalone, so it is re-parsed wrapped in a class body to validate it.

## Development

```sh
pnpm verify   # fmt:check + lint + tsc + tests
pnpm test     # vitest
```

Layout: `src/langs.ts` (language table), `src/locate.ts` (candidate search), `src/content.ts` (content validation), `src/replace.ts` (splice + re-parse check), `src/tool.ts` (tool definition and file IO), `src/text.ts` (pure text helpers).
