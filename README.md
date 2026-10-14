# pi-replace-function

A [pi](https://github.com/earendil-works/pi) extension that adds a `replace_function` tool: the agent names a function and provides only the new declaration, and the tool swaps the old one in place.

It targets two costs of editing code through an agent:

- hash-line edit formats attach a hash to every line, which pollutes context and prompt caches;
- whole-region replacement forces the agent to re-output code that did not change.

Functions are the most common unit of change in real code, so replacing one whole function by name captures most rewrite edits while the agent restates only what is new.

## Supported languages

TypeScript, JavaScript (incl. TSX/JSX), Python, Rust, Go, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Lua, Scala, Bash, Haskell.

ast-grep ships TS/TSX/JS grammars built in; the rest are registered at load time from tree-sitter npm packages (`tree-sitter-python`, `tree-sitter-rust`, …), which carry prebuilt grammar libraries for every major platform. No compiler toolchain is needed at install time. A language whose prebuild is missing on the current platform is simply reported as unsupported.

Not supported: Elixir (its `def` is a macro call, which has no declaration node to target), Zig/Dart (no prebuilt grammars on all platforms).

## Install

Requires pi with extension support. Put this directory under your user extensions directory (`~/.pi/agent/extensions/`) or your project extensions directory (`.pi/extensions/`), then install dependencies:

```sh
pnpm install
```

pi loads extensions with jiti, so no build step is needed. The entry point is `src/index.ts` (also declared in `package.json` under `pi.extensions` for package-style installs).

## Tool usage

```
replace_function(path, name, content?, params_num?, line?)
```

| Parameter    | Type    | Meaning                                                 |
| ------------ | ------- | ------------------------------------------------------- |
| `path`       | string  | File path, relative to cwd or absolute; `~` is expanded |
| `name`       | string  | Declared name of the function/method to replace         |
| `content`    | string? | The complete new declaration; omit to probe (read-only) |
| `params_num` | int?    | Parameter count, to disambiguate overloads              |
| `line`       | int?    | Start line (1-based), final disambiguator               |

Behavior:

- Locating: candidates are found by `name`, filtered by `params_num` when given, then by `line` when given. A single survivor is replaced; multiple survivors or none abort with a listing of what exists.
- Probe mode: calling without `content` returns the current declaration (capped at 200 lines / 10 KB) without touching the file.
- Content contract: exactly one complete declaration. A truncated body is rejected with a clear error. Leading modifiers (`export`, `const`, `declare`, …) and decorator/annotation/attribute lines (`@Override`, `#[derive]`, `[Route]`, `@cache`) are tolerated and dropped — the file keeps its own. Qualified names (`A::get`, `M.foo`) are matched by their bare name (`get`, `foo`).
- Method-shaped content: languages whose method syntax requires an enclosing type (TS/JS, Java, C#) re-parse the content wrapped in a `class Wrap { … }` body, so the agent can pass methods at column 0.
- Comments: leading comments attached to the old declaration are kept, unless the new content carries its own comment block above the declaration, which then replaces the old block. The comment syntax follows the language (`//`, `#`, `--`).
- Formatting: the new body is re-indented to the old declaration's indentation; BOM and CRLF/LF endings are preserved.
- Safety: the result must parse in place (no new syntax errors) or the write is rejected. Writes are serialized through pi's per-file mutation queue.
- Renaming works: replacing `foo` with content declaring `bar` renames the declaration and says so in the reply.

## Design decisions

- Parser: `@ast-grep/napi`. One dependency covers every supported language through shared tree-sitter grammars, and the tool only uses kind-based node queries, so none of ast-grep's rule DSL leaks into the design.
- Locating by name, with `params_num`/`line` as opt-in disambiguators. Names survive unrelated edits; line numbers shift. `line` is an exact 1-based match on the declaration start.
- Replacement spans come from the file's syntax tree, and content validation requires exactly one outermost declaration node. That rule is what catches truncated content: tree-sitter recovers a missing brace without an error node, but the fragment no longer parses as a declaration.
- Every kind and field listed in the language table (`src/langs.ts`) was verified against its grammar at runtime — ast-grep validates kind matchers per grammar and throws on unknown kinds, so the table cannot silently rot.

## Development

```sh
pnpm verify   # fmt:check + lint + tsc + tests
pnpm test     # vitest
```

Layout: `src/langs.ts` (language table + dynamic grammar registration), `src/locate.ts` (candidate search and name/param extraction), `src/content.ts` (content validation), `src/replace.ts` (splice + re-parse check), `src/tool.ts` (tool definition and file IO), `src/text.ts` (pure text helpers).
