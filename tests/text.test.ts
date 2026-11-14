import { describe, expect, it } from 'vitest';
import { classifyMessage, clusterDocuments, headline, normalizeMessage } from '../src/engine/text';

describe('normalizeMessage', () => {
  it('replaces volatile tokens and keeps identifying ones', () => {
    const a = normalizeMessage(
      'Error: connect ECONNREFUSED 127.0.0.1:5432 after 3012ms (id 6f1c2a9e-1b2c-4d3e-8f90-123456789abc)',
    );
    const b = normalizeMessage(
      'Error: connect ECONNREFUSED 10.0.0.7:6379 after 87ms (id 00000000-aaaa-4bbb-8ccc-dddddddddddd)',
    );
    expect(a).toBe(b);
    expect(a).toContain('econnrefused');
  });
  it('keeps file paths but drops line numbers', () => {
    const a = normalizeMessage('TypeError: x is undefined\n    at load (src/cart/service.ts:88:13)');
    const b = normalizeMessage('TypeError: x is undefined\n    at load (src/cart/service.ts:91:7)');
    const c = normalizeMessage('TypeError: x is undefined\n    at load (src/orders/service.ts:88:13)');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it('normalises dates and clock times', () => {
    expect(normalizeMessage("expected '2026-03-01' to equal '2026-02-28'")).toBe(
      "expected '<date>' to equal '<date>'",
    );
    expect(normalizeMessage('clock read 00:00:00.004')).toBe('clock read <time>');
  });
});

describe('classifyMessage', () => {
  const cases: [string, string][] = [
    ['Error: Test timed out in 5000ms.', 'timeout'],
    ['TimeoutError: locator.click: Timeout 30000ms exceeded.', 'timeout'],
    ['Error: connect ECONNREFUSED 127.0.0.1:5432', 'network'],
    ['FetchError: request to http://localhost/api failed, reason: socket hang up', 'network'],
    ['Error: duplicate key value violates unique constraint "users_email_key"', 'order-dependency'],
    ['Error: listen EADDRINUSE: address already in use :::3000', 'resource'],
    [
      'Error: Cannot log after tests are done. Did you forget to wait for something async in your test?',
      'concurrency',
    ],
    ["AssertionError: expected '2026-03-01' to equal '2026-02-28'", 'time'],
    ['Error: ENOSPC: no space left on device, write', 'infrastructure'],
    ['Error: getaddrinfo EAI_AGAIN registry.internal.example.com', 'infrastructure'],
    ['AssertionError: expected 4 to equal 5', 'assertion'],
    ["TypeError: Cannot read properties of undefined (reading 'price')", 'assertion'],
    ['Segmentation fault', 'unknown'],
  ];
  it.each(cases)('%s → %s', (message, expected) => {
    expect(classifyMessage(message)).toBe(expected);
  });
});

describe('clusterDocuments', () => {
  it('groups identical and near-identical messages, keeps different ones apart', () => {
    const docs = [
      'error: connect econnrefused <ip>:<n>',
      'error: test timed out in <n>ms.',
      'error: connect econnrefused <ip>:<n>',
      'error: connect econnrefused <ip>:<n> (attempt <n>)',
      'typeerror: cannot read properties of undefined (reading price)',
      'error: test timed out in <n>ms.',
    ];
    const clusters = clusterDocuments(docs, 0.6);
    const sets = clusters.map((c) => c.members);
    expect(sets).toContainEqual([0, 2, 3]);
    expect(sets).toContainEqual([1, 5]);
    expect(sets).toContainEqual([4]);
    expect(clusters).toHaveLength(3);
  });
  it('assigns every document to exactly one cluster', () => {
    const docs = Array.from({ length: 50 }, (_, i) => `error number ${i % 7} in module_${i % 3}`);
    const seen = clusterDocuments(docs)
      .flatMap((c) => c.members)
      .sort((a, b) => a - b);
    expect(seen).toEqual(docs.map((_, i) => i));
  });
  it('handles no documents', () => {
    expect(clusterDocuments([])).toEqual([]);
  });
});

describe('headline', () => {
  it('takes the first line and truncates', () => {
    expect(headline('first\nsecond')).toBe('first');
    expect(headline('x'.repeat(200), 20)).toHaveLength(20);
  });
});
