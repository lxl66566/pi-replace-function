# pi-replace-function

A [pi](https://github.com/earendil-works/pi) extension that adds a `replace_function` tool: the agent names a function and provides only the new declaration, and the tool swaps the old one in place. This avoids the per-line hashes of hash-line edits (which pollute context and prompt caches) and the re-outputting of unchanged code in whole-region replacement — functions being the most common unit of change in real code.

## Install

```sh
pi install npm:pi-replace-function
```

Grammar packages ship prebuilt binaries, so no compiler toolchain is needed. If you manage pi extensions with pnpm, run `pnpm approve-builds` in `~/.pi/agent/npm` once: pnpm ≥ 10 blocks the tree-sitter grammar packages' build scripts by default.

## Supported languages

TypeScript, JavaScript (incl. TSX/JSX), Python, Rust, Go, Java, C, C++, C#, Ruby, PHP, Swift, Kotlin, Lua, Scala, Bash, Haskell. TS/TSX/JS grammars are built into ast-grep; the rest load at runtime from tree-sitter npm packages. Not supported: Elixir (its `def` is a macro call, no declaration node to target), Zig/Dart (no prebuilt grammars on all platforms).

## Usage

```
replace_function(path, name, content?, params_num?, line?)
```

- `path` — file path, relative to cwd or absolute (`~` expands)
- `name` — declared name of the function/method to replace
- `content` — complete new declaration; omit to probe (returns the current declaration, read-only)
- `params_num` — parameter count, disambiguates overloads
- `line` — 1-based declaration start line, final disambiguator

Candidates are located by `name`, filtered by `params_num` then `line` when given; a unique match is replaced, and zero or multiple matches abort with a listing of what exists. `content` must be exactly one complete declaration — leading modifiers and decorator lines are tolerated and dropped (the file keeps its own). Leading comments on the old declaration are kept unless the new content carries its own comment block. The new body is re-indented to the old declaration's indentation; BOM and CRLF/LF are preserved. The result must still parse in place or the write is rejected.

## Development

```sh
pnpm verify   # fmt:check + lint + tsc + tests
pnpm test     # vitest
```

For local development, put this directory under `~/.pi/agent/extensions/` or `.pi/extensions/` and run `pnpm install` — pi loads extensions with jiti, no build step (entry: `src/index.ts`).

Layout: `src/langs.ts` (language table + grammar registration), `src/locate.ts` (candidate search), `src/content.ts` (content validation), `src/replace.ts` (splice + re-parse check), `src/tool.ts` (tool definition and file IO), `src/text.ts` (text helpers).
