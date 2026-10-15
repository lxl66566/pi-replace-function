import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  applyReplaceFunction,
  replaceFunctionToolDefinition,
  type ReplaceFunctionInput,
} from './tool.ts';

const dir = await mkdtemp(join(tmpdir(), 'pi-replace-function-'));
const dirs: string[] = [dir];

async function withFile(content: string, name = 'a.ts'): Promise<string> {
  const sub = await mkdtemp(join(tmpdir(), 'pi-replace-function-'));
  dirs.push(sub);
  const file = join(sub, name);
  await writeFile(file, content, 'utf-8');
  return file;
}

afterAll(async () => {
  await Promise.all(dirs.map(d => rm(d, { force: true, recursive: true })));
});

async function execute(input: ReplaceFunctionInput) {
  return applyReplaceFunction(input, dir);
}

function textOf(result: Awaited<ReturnType<typeof execute>>): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

describe('replace_function tool', () => {
  it('replaces a function in a real file', async () => {
    const file = await withFile(
      '/** doc */\nfunction foo(a: number) {\n  return a\n}\n',
    );
    const result = await execute({
      content: 'function foo(a: number) {\n  return a * 2\n}',
      name: 'foo',
      path: file,
    });
    expect(textOf(result)).toMatch(/Replaced foo/);
    expect(await readFile(file, 'utf-8')).toBe(
      '/** doc */\nfunction foo(a: number) {\n  return a * 2\n}\n',
    );
  });

  it('probes the current declaration when content is omitted', async () => {
    const file = await withFile('function foo() {\n  return 1\n}\n');
    const result = await execute({ name: 'foo', path: file });
    expect(textOf(result)).toMatch(/Found "foo"/);
    expect(textOf(result)).toContain('function foo() {');
    expect(await readFile(file, 'utf-8')).toBe(
      'function foo() {\n  return 1\n}\n',
    );
  });

  it('lists candidates instead of replacing on ambiguity', async () => {
    const file = await withFile(
      'function f(a) { return a }\nfunction f(a, b) { return a + b }\n',
    );
    await expect(
      execute({ content: 'function f() {}', name: 'f', path: file }),
    ).rejects.toThrow(/matches 2 declarations/);
    // params disambiguates
    const result = await execute({
      content: 'function f(a: number, b: number) {\n  return a + b\n}',
      name: 'f',
      params_num: 2,
      path: file,
    });
    expect(textOf(result)).toMatch(/Replaced f/);
    expect(await readFile(file, 'utf-8')).toBe(
      'function f(a) { return a }\nfunction f(a: number, b: number) {\n  return a + b\n}\n',
    );
  });

  it('rejects unsupported file types', async () => {
    const file = await withFile('defmodule M do\nend\n', 'a.ex');
    await expect(execute({ name: 'foo', path: file })).rejects.toThrow(
      /function-declaration languages/,
    );
  });

  it('notes renames and replaces attached comments', async () => {
    const file = await withFile(
      '/** old */\nfunction foo() {\n  return 1\n}\n',
    );
    const result = await execute({
      content: '/** new */\nfunction bar() {\n  return 2\n}',
      name: 'foo',
      path: file,
    });
    expect(textOf(result)).toMatch(/now named "bar"/);
    expect(textOf(result)).toMatch(/comment block/);
    expect(await readFile(file, 'utf-8')).toBe(
      '/** new */\nfunction bar() {\n  return 2\n}\n',
    );
  });

  it('preserves CRLF line endings', async () => {
    const file = await withFile('function foo() {\r\n  return 1\r\n}\r\n');
    await execute({
      content: 'function foo() {\n  return 2\n}',
      name: 'foo',
      path: file,
    });
    expect(await readFile(file, 'utf-8')).toBe(
      'function foo() {\r\n  return 2\r\n}\r\n',
    );
  });

  it('strips markdown code fences from content', async () => {
    const file = await withFile('function foo() {\n  return 1\n}\n');
    const prepared = replaceFunctionToolDefinition.prepareArguments?.({
      content: '```ts\nfunction foo() {\n  return 2\n}\n```',
      name: 'foo',
      path: file,
    });
    if (!prepared) throw new Error('prepareArguments missing');
    const result = await execute(prepared);
    expect(textOf(result)).toMatch(/Replaced foo/);
    expect(await readFile(file, 'utf-8')).toBe(
      'function foo() {\n  return 2\n}\n',
    );
  });

  it('treats null-valued arguments as omitted (strict structured output)', async () => {
    const file = await withFile('function foo() {\n  return 1\n}\n');
    const args = {
      content: 'null',
      line: null,
      name: 'foo',
      params_num: null,
      path: file,
    };
    const prepared = replaceFunctionToolDefinition.prepareArguments?.(args);
    if (!prepared) throw new Error('prepareArguments missing');
    // the input object is not mutated
    expect(args.content).toBe('null');
    // "null" content reads as omitted: the call probes instead of failing
    const result = await execute(prepared);
    expect(textOf(result)).toMatch(/Found "foo"/);
    expect(await readFile(file, 'utf-8')).toBe(
      'function foo() {\n  return 1\n}\n',
    );
  });

  it('rejects truncated content', async () => {
    const file = await withFile('function foo() {\n  return 1\n}\n');
    await expect(
      execute({
        content: 'function foo() {\n  return 2\n',
        name: 'foo',
        path: file,
      }),
    ).rejects.toThrow(/complete function declaration/);
  });

  it('replaces class methods, re-indenting column-0 content', async () => {
    const file = await withFile(
      'class A {\n  m(a: number) {\n    return a\n  }\n}\n',
    );
    await execute({
      content: 'm(a: number) {\n  return a * 2\n}',
      name: 'm',
      path: file,
    });
    expect(await readFile(file, 'utf-8')).toBe(
      'class A {\n  m(a: number) {\n    return a * 2\n  }\n}\n',
    );
  });
});
