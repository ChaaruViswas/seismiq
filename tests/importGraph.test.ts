import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  extractImports,
  isTestFile,
  resolveImport,
  selectTestFiles,
} from '../src/engine/importGraph';

describe('extractImports', () => {
  it('finds every import form', () => {
    const src = `
      import a from './a';
      import { b, type B } from "./b";
      import * as c from './c';
      import type { D } from './d';
      import './side-effect';
      export { e } from './e';
      export * from './f';
      export * as g from './g';
      const h = require('./h');
      const i = await import('./i');
      const w = new Worker(new URL('./worker.ts', import.meta.url));
      import React from 'react';
    `;
    expect(extractImports(src).sort()).toEqual(
      [
        './a',
        './b',
        './c',
        './d',
        './e',
        './f',
        './g',
        './h',
        './i',
        './side-effect',
        './worker.ts',
        'react',
      ].sort(),
    );
  });
  it('ignores imports inside comments', () => {
    const src = `// import x from './commented';\n/* import y from './block'; */\nimport z from './real'; // trailing import q from './nope'`;
    expect(extractImports(src)).toEqual(['./real']);
  });
  it('does not treat a URL in a string as a comment', () => {
    expect(extractImports(`const u = 'http://example.com'; import a from './a';`)).toEqual(['./a']);
  });
});

describe('resolveImport', () => {
  const files = new Set([
    'src/a.ts',
    'src/lib/index.ts',
    'src/ui/Button.tsx',
    'src/util.js',
    'src/data.json',
  ]);
  const exists = (p: string) => files.has(p);
  it('resolves extensions, index files and parent directories', () => {
    expect(resolveImport('src/main.ts', './a', exists)).toBe('src/a.ts');
    expect(resolveImport('src/main.ts', './lib', exists)).toBe('src/lib/index.ts');
    expect(resolveImport('src/ui/Card.tsx', './Button', exists)).toBe('src/ui/Button.tsx');
    expect(resolveImport('src/ui/Card.tsx', '../a', exists)).toBe('src/a.ts');
    expect(resolveImport('src/main.ts', './data.json', exists)).toBe('src/data.json');
  });
  it('maps a .js specifier to its TypeScript source', () => {
    expect(resolveImport('src/main.ts', './a.js', exists)).toBe('src/a.ts');
    expect(resolveImport('src/main.ts', './util.js', exists)).toBe('src/util.js');
  });
  it('returns null for packages and missing files', () => {
    expect(resolveImport('src/main.ts', 'react', exists)).toBeNull();
    expect(resolveImport('src/main.ts', './missing', exists)).toBeNull();
  });
});

describe('isTestFile', () => {
  it('recognises the common conventions', () => {
    expect(isTestFile('src/a.test.ts')).toBe(true);
    expect(isTestFile('src/a.spec.tsx')).toBe(true);
    expect(isTestFile('src/__tests__/a.ts')).toBe(true);
    expect(isTestFile('tests/a.ts')).toBe(true);
    expect(isTestFile('e2e/flow.ts')).toBe(true);
    expect(isTestFile('src/a.ts')).toBe(false);
    expect(isTestFile('src/contest/a.ts')).toBe(false);
  });
});

describe('selectTestFiles', () => {
  const sources = new Map([
    ['src/core.ts', 'export const x = 1;'],
    ['src/cart.ts', `import { x } from './core'; export const cart = x;`],
    ['src/orders.ts', `import { cart } from './cart'; export const orders = cart;`],
    ['src/search.ts', 'export const search = 1;'],
    ['src/orphan.ts', 'export const orphan = 1;'],
    ['src/cart.test.ts', `import { cart } from './cart';`],
    ['src/orders.test.ts', `import { orders } from './orders';`],
    ['src/search.test.ts', `import { search } from './search';`],
  ]);
  const graph = buildImportGraph(sources);

  it('selects only tests that transitively import a changed file, with the shortest chain', () => {
    const result = selectTestFiles(graph, ['src/cart.ts']);
    expect(result.tests.map((t) => t.test)).toEqual(['src/cart.test.ts', 'src/orders.test.ts']);
    expect(result.tests[1]!.chain).toEqual(['src/orders.test.ts', 'src/orders.ts', 'src/cart.ts']);
    expect(result.allTests).toHaveLength(3);
  });
  it('selects through deep chains', () => {
    expect(selectTestFiles(graph, ['src/core.ts']).tests.map((t) => t.test)).toEqual([
      'src/cart.test.ts',
      'src/orders.test.ts',
    ]);
  });
  it('selects a test file that changed itself', () => {
    expect(selectTestFiles(graph, ['src/search.test.ts']).tests).toEqual([
      { test: 'src/search.test.ts', reason: 'changed', chain: [] },
    ]);
  });
  it('forces a full run for global files', () => {
    const result = selectTestFiles(graph, ['package-lock.json', 'src/search.ts']);
    expect(result.globalPath).toBe('package-lock.json');
    expect(result.tests).toHaveLength(3);
  });
  it('selects nothing for documentation, and flags untested code', () => {
    expect(selectTestFiles(graph, ['README.md']).tests).toEqual([]);
    expect(selectTestFiles(graph, ['README.md']).unreached).toEqual([]);
    expect(selectTestFiles(graph, ['src/orphan.ts']).unreached).toEqual(['src/orphan.ts']);
  });
  it('terminates on circular imports', () => {
    const cyclic = buildImportGraph(
      new Map([
        ['a.ts', `import './b';`],
        ['b.ts', `import './a'; import './c';`],
        ['c.ts', ''],
        ['a.test.ts', `import './a';`],
      ]),
    );
    expect(selectTestFiles(cyclic, ['c.ts']).tests.map((t) => t.test)).toEqual(['a.test.ts']);
  });
});
