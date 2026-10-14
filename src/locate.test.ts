import { describe, expect, it } from 'vitest';

import { specForPath } from './langs.ts';
import { listFunctions, locate } from './locate.ts';
const fixture = [
  "import path from 'node:path'",
  '',
  '/** module-level doc */',
  'export function greet(name: string, punct = "!") {',
  '  return "hi " + name + punct',
  '}',
  '',
  'function greet(name: string) {',
  '  return name',
  '}',
  '',
  'function* seq(n: number) {',
  '  yield n',
  '}',
  '',
  'const arrow = (a: number, b: number) => a + b',
  '',
  'let named = function inner(x: string) {',
  '  return x',
  '}',
  '',
  'class Greeter {',
  '  #secret() {',
  '    return 1',
  '  }',
  '',
  '  get label(): string {',
  '    return "g"',
  '  }',
  '',
  '  static async create(config: unknown): Promise<Greeter> {',
  '    return new Greeter()',
  '  }',
  '',
  '  handler = (a: string) => a.toUpperCase()',
  '',
  '  greet(who: string, ...rest: string[]) {',
  '    return who + rest.join("")',
  '  }',
  '}',
  '',
  'interface Api {',
  '  fetch(id: number): Promise<unknown>',
  '}',
  '',
  'const api = {',
  "  ping() { return 'pong' },",
  '}',
  '',
  'export default function main() {',
  '  const inner = () => {}',
  '  return inner',
  '}',
  '',
].join('\n');

const ts = specForPath('a.ts')!;

function names(source: string, name: string): number {
  return listFunctions(source, ts).filter(c => c.name === name).length;
}

describe('specForPath', () => {
  it('maps extensions to specs case-insensitively', () => {
    expect(specForPath('a.ts')?.lang).toBe('TypeScript');
    expect(specForPath('a.TSX')?.lang).toBe('Tsx');
    expect(specForPath('a.mjs')?.lang).toBe('JavaScript');
    for (const [path, lang] of [
      ['a.py', 'Python'],
      ['a.rs', 'Rust'],
      ['a.go', 'Go'],
      ['a.java', 'Java'],
      ['a.c', 'C'],
      ['a.hpp', 'Cpp'],
      ['a.cs', 'CSharp'],
      ['a.rb', 'Ruby'],
      ['a.php', 'Php'],
      ['a.swift', 'Swift'],
      ['a.kt', 'Kotlin'],
      ['a.lua', 'Lua'],
      ['a.scala', 'Scala'],
      ['a.sh', 'Bash'],
      ['a.hs', 'Haskell'],
    ] as const) {
      expect(specForPath(path)?.lang).toBe(lang);
    }
    expect(specForPath('a.ex')).toBeUndefined();
    expect(specForPath('noext')).toBeUndefined();
  });
});

describe('listFunctions', () => {
  it('collects every function-like declaration with params', () => {
    const all = listFunctions(fixture, ts);
    const byName = (name: string) => all.filter(c => c.name === name);

    expect(byName('greet').map(c => [c.kind, c.params])).toEqual([
      ['function_declaration', 2],
      ['function_declaration', 1],
      ['method_definition', 2],
    ]);
    expect(byName('seq')[0]?.kind).toBe('generator_function_declaration');
    expect(byName('arrow')[0]).toMatchObject({
      kind: 'variable_declarator',
      params: 2,
    });
    expect(byName('named')[0]).toMatchObject({
      kind: 'variable_declarator',
      params: 1,
    });
    expect(byName('#secret')[0]).toMatchObject({
      kind: 'method_definition',
      params: 0,
    });
    expect(byName('label')[0]).toMatchObject({
      kind: 'method_definition',
      params: 0,
    });
    expect(byName('create')[0]).toMatchObject({
      kind: 'method_definition',
      params: 1,
    });
    expect(byName('handler')[0]).toMatchObject({
      kind: 'public_field_definition',
      params: 1,
    });
    expect(byName('fetch')[0]).toMatchObject({
      kind: 'method_signature',
      params: 1,
    });
    expect(byName('ping')[0]).toMatchObject({
      kind: 'method_definition',
      params: 0,
    });
    expect(byName('main')[0]).toMatchObject({
      kind: 'function_declaration',
      params: 0,
    });
    expect(byName('inner')).toHaveLength(1);
  });

  it('ignores declarators without a function value', () => {
    expect(names('const data = { a: 1 }', 'data')).toBe(0);
    expect(names('const fn = (x: number) => x', 'fn')).toBe(1);
  });

  it('handles tsx and js sources', () => {
    const tsx = specForPath('a.tsx');
    if (!tsx) throw new Error('missing tsx spec');
    expect(listFunctions('const C = () => <div />', tsx)).toHaveLength(1);

    const js = specForPath('a.js');
    if (!js) throw new Error('missing js spec');
    const jsFns = listFunctions(
      'class A {\n  h = (a) => a\n  m(b) { return b }\n}\n',
      js,
    );
    expect(jsFns.map(c => [c.name, c.params])).toEqual([
      ['h', 1],
      ['m', 1],
    ]);
  });
});

describe('locate', () => {
  it('is unique when the name matches once', () => {
    const result = locate(fixture, ts, { name: 'arrow' });
    expect(result.status).toBe('unique');
  });

  it('disambiguates overloads by params and same-name by line', () => {
    expect(locate(fixture, ts, { name: 'greet' }).status).toBe('ambiguous');
    expect(locate(fixture, ts, { name: 'greet', params: 1 }).status).toBe(
      'unique',
    );
    // two declarations with 2 params remain: overload + method
    const still = locate(fixture, ts, { name: 'greet', params: 2 });
    expect(still.status).toBe('ambiguous');
    if (still.status !== 'ambiguous') throw new Error('expected ambiguous');
    expect(still.sameName).toHaveLength(2);
    expect(
      locate(fixture, ts, { line: 4, name: 'greet', params: 2 }).status,
    ).toBe('unique');
  });

  it('reports not-found with the full listing', () => {
    const result = locate(fixture, ts, { name: 'missing' });
    if (result.status !== 'not-found') throw new Error('expected not-found');
    expect(result.all.length).toBeGreaterThan(10);
  });
});
