import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { extractDeclaration } from './content.ts';
import { specForPath } from './langs.ts';
import { applyReplaceFunction, type ReplaceFunctionInput } from './tool.ts';

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map(d => rm(d, { force: true, recursive: true })));
});

interface LangCase {
  readonly content: string;
  readonly file: string;
  readonly name: string;
  readonly paramsNum?: number;
  readonly src: string;
  readonly want: string;
}

async function replaceIn(
  src: string,
  fileName: string,
  input: Omit<ReplaceFunctionInput, 'path'>,
): Promise<string> {
  const sub = await mkdtemp(join(tmpdir(), 'pi-replace-lang-'));
  dirs.push(sub);
  const file = join(sub, fileName);
  await writeFile(file, src, 'utf-8');
  await applyReplaceFunction({ ...input, path: file }, sub);
  return readFile(file, 'utf-8');
}

const CASES: readonly LangCase[] = [
  {
    content: 'def add(a, b):\n    return a + b\n',
    file: 'a.py',
    name: 'add',
    src: '# detached\n\n# old doc\ndef add(a, b):\n    return a - b\n',
    want: '# detached\n\n# old doc\ndef add(a, b):\n    return a + b\n',
  },
  {
    // decorated function: the file keeps its decorator, the def is replaced
    content: 'def heavy(x):\n    return x * 2\n',
    file: 'b.py',
    name: 'heavy',
    src: 'def add(a, b):\n    return a - b\n\n\n@cache\ndef heavy(x):\n    return x\n',
    want: 'def add(a, b):\n    return a - b\n\n\n@cache\ndef heavy(x):\n    return x * 2\n',
  },
  {
    content: 'fn add(a: u32, b: u32) -> u32 {\n    a + b\n}\n',
    file: 'a.rs',
    name: 'add',
    src: '// doc\nfn add(a: u32, b: u32) -> u32 {\n    a - b\n}\n',
    want: '// doc\nfn add(a: u32, b: u32) -> u32 {\n    a + b\n}\n',
  },
  {
    content: 'func (t *T) Get() int {\n    return 2\n}\n',
    file: 'a.go',
    name: 'Get',
    src: 'package main\n\ntype T struct{}\n\nfunc (t *T) Get() int {\n    return 1\n}\n',
    want: 'package main\n\ntype T struct{}\n\nfunc (t *T) Get() int {\n    return 2\n}\n',
  },
  {
    // method-shaped content goes through the class-body wrap
    content: 'public int add(int a, int b) {\n    return a + b;\n}\n',
    file: 'A.java',
    name: 'add',
    src: 'class A {\n    public int add(int a, int b) {\n        return a - b;\n    }\n}\n',
    want: 'class A {\n    public int add(int a, int b) {\n        return a + b;\n    }\n}\n',
  },
  {
    content: 'int twice(int x) {\n    return x * 2;\n}\n',
    file: 'a.c',
    name: 'twice',
    src: 'static int counter = 0;\n\nint twice(int x) {\n    return x;\n}\n',
    want: 'static int counter = 0;\n\nint twice(int x) {\n    return x * 2;\n}\n',
  },
  {
    // pointer-returning declarator: name and params live below the surface
    content: 'char *fmt(const char *s, int n) {\n    return 0;\n}\n',
    file: 'fmt.c',
    name: 'fmt',
    src: 'char *fmt(const char *s, int n) {\n    return 0;\n}\n',
    want: 'char *fmt(const char *s, int n) {\n    return 0;\n}\n',
  },
  {
    // qualified C++ name `A::compute` is matched by its bare name
    content: 'int A::compute(int x) const {\n    return x * 2;\n}\n',
    file: 'a.cpp',
    name: 'compute',
    src: 'struct A {\n    int get() { return 1; }\n};\n\nint A::compute(int x) const {\n    return x;\n}\n',
    want: 'struct A {\n    int get() { return 1; }\n};\n\nint A::compute(int x) const {\n    return x * 2;\n}\n',
  },
  {
    content: 'public int Add(int a, int b) {\n    return a + b;\n}\n',
    file: 'A.cs',
    name: 'Add',
    src: 'class A {\n    public int Add(int a, int b) {\n        return a - b;\n    }\n}\n',
    want: 'class A {\n    public int Add(int a, int b) {\n        return a + b;\n    }\n}\n',
  },
  {
    content: 'def add(a, b)\n  a + b\nend\n',
    file: 'a.rb',
    name: 'add',
    src: '# doc\ndef add(a, b)\n  a - b\nend\n',
    want: '# doc\ndef add(a, b)\n  a + b\nend\n',
  },
  {
    content: '<?php\nfunction add($a, $b) {\n  return $a + $b;\n}\n',
    file: 'a.php',
    name: 'add',
    src: '<?php\nfunction add($a, $b) {\n  return $a - $b;\n}\n',
    want: '<?php\nfunction add($a, $b) {\n  return $a + $b;\n}\n',
  },
  {
    content: 'func add(_ a: Int, _ b: Int) -> Int {\n    return a + b\n}\n',
    file: 'a.swift',
    name: 'add',
    src: 'func add(_ a: Int, _ b: Int) -> Int {\n    return a - b\n}\n',
    want: 'func add(_ a: Int, _ b: Int) -> Int {\n    return a + b\n}\n',
  },
  {
    content: 'fun add(a: Int, b: Int): Int {\n    return a + b\n}\n',
    file: 'a.kt',
    name: 'add',
    src: 'fun add(a: Int, b: Int): Int {\n    return a - b\n}\n',
    want: 'fun add(a: Int, b: Int): Int {\n    return a + b\n}\n',
  },
  {
    // dotted Lua name `M.foo` matches the bare name `foo`
    content: 'function M.foo(x)\n  return x * 2\nend\n',
    file: 'a.lua',
    name: 'foo',
    src: '-- note\nfunction M.foo(x)\n  return x\nend\n',
    want: '-- note\nfunction M.foo(x)\n  return x * 2\nend\n',
  },
  {
    content: 'def add(a: Int, b: Int): Int = a + b\n',
    file: 'A.scala',
    name: 'add',
    src: 'object A {\n  def add(a: Int, b: Int): Int = a - b\n}\n',
    want: 'object A {\n  def add(a: Int, b: Int): Int = a + b\n}\n',
  },
  {
    content: 'add() {\n  echo new\n}\n',
    file: 'a.sh',
    name: 'add',
    src: 'add() {\n  echo old\n}\n',
    want: 'add() {\n  echo new\n}\n',
  },
  {
    // the type signature line above stays in the file
    content: 'add a b = a + b\n',
    file: 'a.hs',
    name: 'add',
    src: 'add :: Int -> Int -> Int\nadd a b = a - b\n',
    want: 'add :: Int -> Int -> Int\nadd a b = a + b\n',
  },
];

describe('replace_function across languages', () => {
  for (const c of CASES) {
    it(`replaces ${c.name} in ${c.file}`, async () => {
      const got = await replaceIn(c.src, c.file, {
        content: c.content,
        name: c.name,
        ...(c.paramsNum === undefined ? {} : { params_num: c.paramsNum }),
      });
      expect(got).toBe(c.want);
    });
  }

  it('disambiguates same-name Python declarations by params_num', async () => {
    const src =
      'class A:\n    def run(self):\n        pass\n\n\ndef run(x, y):\n    return x\n';
    const got = await replaceIn(src, 'c.py', {
      content: 'def run(x, y):\n    return x + y\n',
      name: 'run',
      params_num: 2,
    });
    expect(got).toBe(
      'class A:\n    def run(self):\n        pass\n\n\ndef run(x, y):\n    return x + y\n',
    );
  });
});

describe('extractDeclaration across languages', () => {
  it('tolerates Python decorators without keeping them', () => {
    const py = specForPath('a.py')!;
    const checked = extractDeclaration(
      '@cache\ndef foo(a):\n    return a\n',
      py,
    );
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.leadComment).toBeNull();
    expect(checked.decl.name).toBe('foo');
    expect(checked.decl.params).toBe(1);
    expect(checked.decl.text).toBe('def foo(a):\n    return a');
  });

  it('captures hash comments as leadComment', () => {
    const py = specForPath('a.py')!;
    const checked = extractDeclaration('# new\ndef foo():\n    pass\n', py);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.leadComment).toBe('# new');
  });

  it('captures dash comments as leadComment', () => {
    const lua = specForPath('a.lua')!;
    const checked = extractDeclaration('-- note\nfunction f()\nend\n', lua);
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.leadComment).toBe('-- note');
  });

  it('extracts C names through the declarator subtree', () => {
    const c = specForPath('a.c')!;
    const checked = extractDeclaration(
      'static char *fmt(const char *s, int n) {\n    return 0;\n}\n',
      c,
    );
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.name).toBe('fmt');
    expect(checked.decl.params).toBe(2);
  });

  it('counts Kotlin parameters via the container kind', () => {
    const kt = specForPath('a.kt')!;
    const checked = extractDeclaration(
      'fun add(a: Int, b: Int): Int {\n    return a + b\n}\n',
      kt,
    );
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.params).toBe(2);
  });

  it('counts Swift parameters spread as child nodes', () => {
    const swift = specForPath('a.swift')!;
    const checked = extractDeclaration(
      'func add(_ a: Int, _ b: Int) -> Int {\n    return a + b\n}\n',
      swift,
    );
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.params).toBe(2);
  });

  it('normalizes dotted Lua names', () => {
    const lua = specForPath('a.lua')!;
    const checked = extractDeclaration(
      'function M.foo(x)\n  return x\nend\n',
      lua,
    );
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.decl.name).toBe('foo');
  });
});
