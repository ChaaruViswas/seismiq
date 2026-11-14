/** Parse the textual forms a change can arrive in. */

export interface DiffEntry {
  path: string;
  added: number;
  deleted: number;
}

const stripPrefix = (p: string) => p.replace(/^"|"$/g, '').replace(/^[ab]\//, '');

/**
 * Accepts, auto-detected line by line:
 * - a unified diff (`git diff`, a `.patch` file),
 * - `git diff --numstat` output (`12<TAB>3<TAB>path`),
 * - `git diff --name-status` output (`M<TAB>path`, `R100<TAB>old<TAB>new`),
 * - a plain list of paths, one per line.
 *
 * Deleted files are reported under their old path, renames under the new one.
 */
export function parseDiff(text: string): DiffEntry[] {
  const entries = new Map<string, DiffEntry>();
  const touch = (path: string): DiffEntry => {
    let e = entries.get(path);
    if (!e) {
      e = { path, added: 0, deleted: 0 };
      entries.set(path, e);
    }
    return e;
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const isUnified = lines.some(
    (l) => l.startsWith('diff --git ') || l.startsWith('+++ ') || l.startsWith('@@ '),
  );

  if (isUnified) {
    let current: DiffEntry | null = null;
    let oldPath = '';
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
        current = m ? touch(m[2]!) : null;
        oldPath = m ? m[1]! : '';
        inHunk = false;
      } else if (line.startsWith('--- ') && !inHunk) {
        const p = line.slice(4).split('\t')[0]!.trim();
        if (p !== '/dev/null') oldPath = stripPrefix(p);
      } else if (line.startsWith('+++ ') && !inHunk) {
        const p = line.slice(4).split('\t')[0]!.trim();
        const path = p === '/dev/null' ? oldPath : stripPrefix(p);
        if (path) {
          // `diff --git` already registered the b/ path; a deletion moves it to the old path.
          if (current && current.path !== path && current.added === 0 && current.deleted === 0) {
            entries.delete(current.path);
          }
          current = touch(path);
        }
      } else if (line.startsWith('@@')) {
        inHunk = true;
      } else if (inHunk && current) {
        if (line.startsWith('+')) current.added++;
        else if (line.startsWith('-')) current.deleted++;
        else if (!line.startsWith(' ') && !line.startsWith('\\') && line !== '') inHunk = false;
      }
    }
    return [...entries.values()];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const numstat = /^(\d+|-)\s+(\d+|-)\s+(.+)$/.exec(line);
    if (numstat) {
      const e = touch(renameTarget(numstat[3]!));
      e.added += numstat[1] === '-' ? 0 : Number(numstat[1]);
      e.deleted += numstat[2] === '-' ? 0 : Number(numstat[2]);
      continue;
    }
    const nameStatus = /^([ACDMRTU])\d*\s+(.+)$/.exec(line);
    if (nameStatus) {
      const paths = nameStatus[2]!.split(/\t+/);
      touch(stripPrefix(paths[paths.length - 1]!.trim()));
      continue;
    }
    if (!/\s/.test(line)) touch(stripPrefix(line));
  }
  return [...entries.values()];
}

/** `src/{old => new}/file.ts` and `old.ts => new.ts` (numstat rename syntax) → the new path. */
function renameTarget(path: string): string {
  const braces = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (braces) return `${braces[1]}${braces[3]}${braces[4]}`.replace(/\/\//g, '/');
  const arrow = path.split(' => ');
  return stripPrefix(arrow[arrow.length - 1]!.trim());
}
