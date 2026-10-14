import { describe, expect, it } from 'vitest';

import { commentLineFor, specForPath } from './langs.ts';
import { locate } from './locate.ts';
import { attachedCommentStart, replaceFunction } from './replace.ts';
import { commonIndent, dedentLines, spliceSpan } from './text.ts';

const ts = specForPath('a.ts')!;

function replaceIn(
  source: string,
  name: string,
  declText: string,
  leadComment: null | string = null,
) {
  const located = locate(source, ts, { name });
  if (located.status !== 'unique')
    throw new Error(`expected unique candidate for ${name}`);
  return replaceFunction(source, ts, located.candidate, declText, leadComment);
}

describe('text helpers', () => {
  it('computes the common indent', () => {
    expect(commonIndent(['  a', '    b', ''])).toBe('  ');
    expect(commonIndent(['a', '  b'])).toBe('');
    expect(commonIndent([''])).toBe('');
  });

  it('dedents lines by their common indent', () => {
    expect(dedentLines(['  function f() {', '    return 1', '  }'])).toEqual([
      'function f() {',
      '  return 1',
      '}',
    ]);
    expect(dedentLines(['m() {', '  return 1', '}'])).toEqual([
      'm() {',
      '  return 1',
      '}',
    ]);
  });

  it('splices single- and multi-line spans', () => {
    const src = 'aaa\nbbb\nccc';
    expect(
      spliceSpan(src, { column: 1, line: 1 }, { column: 2, line: 1 }, 'X'),
    ).toBe('aaa\nbXb\nccc');
    expect(
      spliceSpan(src, { column: 0, line: 0 }, { column: 3, line: 2 }, 'x\ny'),
    ).toBe('x\ny');
  });
});

describe('attachedCommentStart', () => {
  const lines = ['// top', '', '/** doc */', '// note', 'function f() {}'];
  it('walks up through the attached comment block', () => {
    expect(attachedCommentStart(lines, 4, commentLineFor(ts))).toBe(2);
    expect(
      attachedCommentStart(['// a', 'function f() {}'], 1, commentLineFor(ts)),
    ).toBe(0);
    expect(
      attachedCommentStart(['function f() {}'], 0, commentLineFor(ts)),
    ).toBeNull();
  });

  it('stops at blank lines', () => {
    expect(
      attachedCommentStart(
        ['// top', '', '/** doc */', 'function f() {}'],
        3,
        commentLineFor(ts),
      ),
    ).toBe(2);
  });
});

describe('replaceFunction', () => {
  it('replaces a whole function declaration', () => {
    const src = 'function foo() {\n  return 1\n}\n\nconst after = 2\n';
    const result = replaceIn(src, 'foo', 'function foo() {\n  return 42\n}');
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toBe(
      'function foo() {\n  return 42\n}\n\nconst after = 2\n',
    );
    expect(result.replacedFrom).toBe(1);
    expect(result.replacedTo).toBe(3);
  });

  it('keeps the old attached comments when the content has none', () => {
    const src =
      '// detached\n\n/** old doc */\nfunction foo() {\n  return 1\n}\n';
    const result = replaceIn(src, 'foo', 'function foo() {\n  return 2\n}');
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toBe(
      '// detached\n\n/** old doc */\nfunction foo() {\n  return 2\n}\n',
    );
  });

  it('replaces the attached comment block when the content brings comments', () => {
    const src =
      '// detached\n\n/** old doc */\n// second line\nfunction foo() {\n  return 1\n}\n';
    const result = replaceIn(
      src,
      'foo',
      'function foo() {\n  return 2\n}',
      '/** new doc */',
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toBe(
      '// detached\n\n/** new doc */\nfunction foo() {\n  return 2\n}\n',
    );
  });

  it('re-indents column-0 method content to the declaration indent', () => {
    const src = 'class A {\n  m(a: number) {\n    return a\n  }\n}\n';
    const result = replaceIn(src, 'm', 'm(a: number) {\n  return a * 2\n}');
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toBe(
      'class A {\n  m(a: number) {\n    return a * 2\n  }\n}\n',
    );
  });

  it('replaces const arrow declarators, keeping const/export', () => {
    const src = 'export const f = (a: number) => a\n';
    const result = replaceIn(src, 'f', 'f = (a: number, b: number) => a + b');
    if (!result.ok) throw new Error(result.error);
    expect(result.source).toBe(
      'export const f = (a: number, b: number) => a + b\n',
    );
  });

  it('rejects content that does not parse in place', () => {
    const src = 'function foo() {\n  return 1\n}\n';
    const located = locate(src, ts, { name: 'foo' });
    if (located.status !== 'unique')
      throw new Error('expected unique candidate');
    // method-shaped content does not parse at top level
    const result = replaceFunction(
      src,
      ts,
      located.candidate,
      'bar() {\n  return 2\n}',
      null,
    );
    if (result.ok) throw new Error(`expected failure, got: ${result.source}`);
    expect(result.error).toMatch(/does not parse in place/);
  });
});
