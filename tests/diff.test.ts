import { describe, expect, it } from 'vitest';
import { parseDiff } from '../src/engine/diff';

describe('parseDiff', () => {
  it('parses a unified git diff with several files', () => {
    const diff = [
      'diff --git a/src/cart/service.ts b/src/cart/service.ts',
      'index 1111111..2222222 100644',
      '--- a/src/cart/service.ts',
      '+++ b/src/cart/service.ts',
      '@@ -10,7 +10,8 @@ export function total() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' return a;',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([
      { path: 'src/cart/service.ts', added: 2, deleted: 1 },
      { path: 'README.md', added: 1, deleted: 1 },
    ]);
  });

  it('does not mistake "--- " or "+++ " content lines inside a hunk for file headers', () => {
    const diff = [
      'diff --git a/notes.sql b/notes.sql',
      '--- a/notes.sql',
      '+++ b/notes.sql',
      '@@ -1,2 +1,2 @@',
      '--- drop the old table',
      '+++ keep the old table',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([{ path: 'notes.sql', added: 1, deleted: 1 }]);
  });

  it('reports new files under the new path and deleted files under the old one', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([
      { path: 'src/new.ts', added: 2, deleted: 0 },
      { path: 'src/gone.ts', added: 0, deleted: 2 },
    ]);
  });

  it('handles renames and binary files that have no hunks', () => {
    const diff = [
      'diff --git a/src/old-name.ts b/src/new-name.ts',
      'similarity index 100%',
      'rename from src/old-name.ts',
      'rename to src/new-name.ts',
      'diff --git a/logo.png b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');
    expect(parseDiff(diff).map((e) => e.path)).toEqual(['src/new-name.ts', 'logo.png']);
  });

  it('parses --numstat output including renames and binaries', () => {
    const text = '12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n4\t0\tsrc/{old => new}/b.ts\n';
    expect(parseDiff(text)).toEqual([
      { path: 'src/a.ts', added: 12, deleted: 3 },
      { path: 'assets/logo.png', added: 0, deleted: 0 },
      { path: 'src/new/b.ts', added: 4, deleted: 0 },
    ]);
  });

  it('parses --name-status output and plain path lists, with CRLF line endings', () => {
    expect(
      parseDiff('M\tsrc/a.ts\r\nA\tsrc/b.ts\r\nR100\tsrc/c.ts\tsrc/d.ts\r\n').map((e) => e.path),
    ).toEqual(['src/a.ts', 'src/b.ts', 'src/d.ts']);
    expect(parseDiff('src/a.ts\n\n# comment\nsrc/b.ts\n').map((e) => e.path)).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('returns nothing for empty input', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('   \n\n')).toEqual([]);
  });
});
