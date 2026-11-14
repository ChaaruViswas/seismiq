/**
 * Static import-graph analysis for JavaScript/TypeScript sources. Pure
 * functions over a `path → source` map, so the same code runs in the CLI
 * (real files) and in unit tests (in-memory fixtures).
 */
import { classifyPath } from './repo';

const SOURCE_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

export const isSourceFile = (path: string) =>
  SOURCE_EXT.some((e) => path.endsWith(e)) && !path.endsWith('.d.ts');

export const isTestFile = (path: string) =>
  /(^|\/)__tests__\//.test(path) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)(e2e|tests?)\/.*\.[cm]?[jt]sx?$/.test(path);

/** Remove comments and blank out string contents that cannot be import specifiers. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Every module specifier a file imports, re-exports, requires or dynamically imports. */
export function extractImports(source: string): string[] {
  const code = stripComments(source);
  const specs = new Set<string>();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\w*${},\s]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"\n]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /\bnew\s+URL\s*\(\s*['"](\.{1,2}\/[^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const m of code.matchAll(pattern)) specs.add(m[1]!);
  }
  return [...specs];
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * Resolve a relative specifier the way bundlers do: exact file, then with each
 * source extension, then as a directory index. `./x.js` also resolves to
 * `./x.ts` (TypeScript's ESM convention). Bare specifiers (packages) return null.
 */
export function resolveImport(from: string, spec: string, exists: (path: string) => boolean): string | null {
  if (!spec.startsWith('.')) return null;
  const clean = spec.replace(/[?#].*$/, '');
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const base = normalize(`${dir}/${clean}`);
  if (exists(base)) return base;
  for (const ext of SOURCE_EXT) if (exists(base + ext)) return base + ext;
  const jsToTs = /\.([cm]?)js(x?)$/.exec(base);
  if (jsToTs) {
    const stemPath = base.slice(0, -jsToTs[0].length);
    for (const ext of [`.${jsToTs[1]}ts${jsToTs[2]}`, '.ts', '.tsx'])
      if (exists(stemPath + ext)) return stemPath + ext;
  }
  for (const ext of SOURCE_EXT) if (exists(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
}

/** `file → files it imports`, restricted to the given file set. */
export function buildImportGraph(sources: ReadonlyMap<string, string>): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const exists = (p: string) => sources.has(p);
  for (const [path, source] of sources) {
    if (!isSourceFile(path)) continue;
    const deps = new Set<string>();
    for (const spec of extractImports(source)) {
      const resolved = resolveImport(path, spec, exists);
      if (resolved && resolved !== path) deps.add(resolved);
    }
    graph.set(path, [...deps].sort());
  }
  return graph;
}

export interface ImpactedTestFile {
  test: string;
  /** Why it was selected. */
  reason: 'global' | 'changed' | 'imports';
  /** Import chain from the test file to a changed file (inclusive), for `imports`. */
  chain: string[];
}

export interface SelectionResult {
  tests: ImpactedTestFile[];
  allTests: string[];
  /** Set when a global file forced a full run. */
  globalPath: string | null;
  /** Changed paths that no test file reaches. */
  unreached: string[];
}

/**
 * Which test files must run for a set of changed paths? A test is selected if
 * it changed itself or if it transitively imports a changed file. A change to
 * a global file (manifest, lockfile, build or CI config) selects everything.
 */
export function selectTestFiles(
  graph: ReadonlyMap<string, string[]>,
  changed: readonly string[],
): SelectionResult {
  const allTests = [...graph.keys()].filter(isTestFile).sort();
  const globalPath = changed.find((p) => classifyPath(p) === 'global') ?? null;
  if (globalPath !== null) {
    return {
      tests: allTests.map((test) => ({ test, reason: 'global' as const, chain: [] })),
      allTests,
      globalPath,
      unreached: [],
    };
  }
  const changedSet = new Set(changed);
  const tests: ImpactedTestFile[] = [];
  for (const test of allTests) {
    if (changedSet.has(test)) {
      tests.push({ test, reason: 'changed', chain: [] });
      continue;
    }
    // Breadth-first search gives the shortest import chain to a changed file.
    const parent = new Map<string, string | null>([[test, null]]);
    const queue = [test];
    let hit: string | null = null;
    for (let i = 0; i < queue.length && hit === null; i++) {
      for (const dep of graph.get(queue[i]!) ?? []) {
        if (parent.has(dep)) continue;
        parent.set(dep, queue[i]!);
        if (changedSet.has(dep)) {
          hit = dep;
          break;
        }
        queue.push(dep);
      }
    }
    if (hit === null) continue;
    const chain: string[] = [];
    for (let at: string | null = hit; at !== null; at = parent.get(at) ?? null) chain.unshift(at);
    tests.push({ test, reason: 'imports', chain });
  }
  // Changed files that no test file can reach at all are worth flagging: nothing guards them.
  const reachable = new Set<string>();
  const stack = allTests.slice();
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (reachable.has(f)) continue;
    reachable.add(f);
    for (const dep of graph.get(f) ?? []) stack.push(dep);
  }
  const unreached = changed.filter((p) => !reachable.has(p) && classifyPath(p) !== 'docs');
  return { tests, allTests, globalPath: null, unreached };
}
