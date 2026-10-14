import { describe, expect, it } from 'vitest';

import { extractDeclaration } from './content.ts';
import { specForPath } from './langs.ts';

const ts = specForPath('a.ts')!;

function ok(content: string) {
  const checked = extractDeclaration(content, ts);
  if (!checked.ok) throw new Error(checked.error);
  return checked.decl;
}

describe('extractDeclaration', () => {
  it('accepts a plain function and returns its exact text', () => {
    const decl = ok('function foo(a: number) {\n  return a\n}');
    expect(decl.text).toBe('function foo(a: number) {\n  return a\n}');
    expect(decl.name).toBe('foo');
    expect(decl.params).toBe(1);
    expect(decl.leadComment).toBeNull();
  });

  it('tolerates export/default/const modifiers without including them', () => {
    expect(ok('export function foo() {}').text).toBe('function foo() {}');
    expect(ok('export default function foo() {}').text).toBe(
      'function foo() {}',
    );
    expect(ok('const f = (a, b) => a + b').text).toBe('f = (a, b) => a + b');
    expect(ok('declare function foo(): void;').name).toBe('foo');
  });

  it('accepts trailing semicolons and commas', () => {
    expect(ok('function foo() {};').text).toBe('function foo() {}');
    expect(ok('f = (a) => a,').text).toBe('f = (a) => a');
  });

  it('extracts method-shaped fragments via the class-body fallback', () => {
    const decl = ok('async m(a: number, b: number) {\n  return a + b\n}');
    expect(decl.text).toBe(
      'async m(a: number, b: number) {\n  return a + b\n}',
    );
    expect(decl.name).toBe('m');
    expect(decl.params).toBe(2);

    expect(ok('get label(): string { return "x" }').name).toBe('label');
    expect(ok('#priv() { return 1 }').name).toBe('#priv');
    expect(ok('fetch(id: number): Promise<void>;').name).toBe('fetch');
    expect(ok('declare function foo(): void;').name).toBe('foo');
  });

  it('captures comments above the declaration as leadComment', () => {
    const decl = ok('/** new doc */\nfunction foo() {}');
    expect(decl.leadComment).toBe('/** new doc */');
    expect(decl.text).toBe('function foo() {}');

    const withExport = ok('// note\nexport function foo() {}');
    expect(withExport.leadComment).toBe('// note');
    expect(withExport.text).toBe('function foo() {}');
  });

  it('rejects truncated declarations', () => {
    const checked = extractDeclaration(
      'function foo(a: number) {\n  return a\n',
      ts,
    );
    if (checked.ok)
      throw new Error(`expected failure, got: ${checked.decl.text}`);
    expect(checked.error).toMatch(/complete function declaration/);
  });

  it('rejects multiple declarations', () => {
    const checked = extractDeclaration('function a() {}\nfunction b() {}', ts);
    if (checked.ok)
      throw new Error(`expected failure, got: ${checked.decl.text}`);
    expect(checked.error).toMatch(/exactly one/);
  });

  it('rejects unexpected text before or after the declaration', () => {
    const before = extractDeclaration('const x = 1\nfunction foo() {}', ts);
    expect(before.ok).toBe(false);

    const after = extractDeclaration('function foo() {}\nconst y = 2', ts);
    expect(after.ok).toBe(false);
  });

  it('keeps the outer declaration when the content contains inner functions', () => {
    const decl = ok(
      'function foo() {\n  const inner = (x: number) => x\n  return inner(1)\n}',
    );
    expect(decl.name).toBe('foo');
    expect(decl.params).toBe(0);
  });
});
