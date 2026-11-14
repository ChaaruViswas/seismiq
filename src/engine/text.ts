/**
 * Failure-message intelligence: normalisation into stable fingerprints,
 * rule-based root-cause classification, and TF-IDF clustering.
 */
import type { FlakeCategory } from './types';

/**
 * Strip everything that varies between occurrences of the same failure
 * (numbers, ids, addresses, durations) while keeping what identifies it
 * (error type, wording, file paths).
 */
export function normalizeMessage(message: string): string {
  return message
    .slice(0, 2000)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?z?)?\b/g, '<date>')
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<time>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b0x[0-9a-f]+\b/g, '<hex>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<hex>')
    .replace(/\d+(?:\.\d+)?/g, '<n>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/** First line of a message, trimmed for display. */
export function headline(message: string, max = 140): string {
  const first = message.split('\n', 1)[0]!.trim();
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

const RULES: [FlakeCategory, RegExp][] = [
  [
    'infrastructure',
    /enospc|no space left|eai_again|getaddrinfo|failed to launch browser|service container|runner .*(lost|shutdown)|oomkilled|exit code 137|docker(?:: | )(?:error|daemon)|rate limit exceeded/i,
  ],
  ['timeout', /timed? ?out|timeout|deadline exceeded|exceeded \d+ ?ms/i],
  [
    'network',
    /econnrefused|econnreset|socket hang up|enotfound|epipe|network error|fetch failed|fetcherror|502 bad gateway|503 service/i,
  ],
  [
    'order-dependency',
    /duplicate key|unique constraint|already exists|leftover|previous test|shared state|not empty|state leak/i,
  ],
  [
    'resource',
    /eaddrinuse|emfile|enomem|heap limit|out of memory|too many open files|resource temporarily unavailable/i,
  ],
  [
    'concurrency',
    /\brace\b|deadlock|after tests are done|forget to wait|unhandled promise|act\(\)|called \d+ times|to be called|not wrapped in act|concurrent modification|stale element/i,
  ],
  ['time', /expected .*\d{4}-\d{2}-\d{2}|\bclock\b|timezone|\butc\b|\bdst\b|expired|midnight/i],
  ['assertion', /assert|expect(?:ed)?\b|to equal|to be\b|typeerror|rangeerror|referenceerror|received/i],
];

/** Best-guess root-cause family of a failure message. First matching rule wins. */
export function classifyMessage(message: string): FlakeCategory {
  for (const [category, pattern] of RULES) if (pattern.test(message)) return category;
  return 'unknown';
}

export const CATEGORY_LABEL: Record<FlakeCategory, string> = {
  timeout: 'Timeout',
  network: 'Network',
  concurrency: 'Async / race',
  'order-dependency': 'Order dependency',
  time: 'Time & date',
  resource: 'Resource exhaustion',
  infrastructure: 'Infrastructure',
  assertion: 'Assertion',
  unknown: 'Unclassified',
};

export const CATEGORY_ADVICE: Record<FlakeCategory, string> = {
  timeout:
    'Replace fixed sleeps with explicit waits on the condition, and check whether the awaited work is really slower in CI than locally.',
  network:
    'Stub the external call or wait for the dependency health check before the test starts; add a bounded retry at the client, not the test.',
  concurrency:
    'Await every promise the test starts, avoid asserting on call counts before the event loop settles, and remove shared mutable fixtures.',
  'order-dependency':
    'Give each test its own data (unique keys, transaction rollback) and reset shared stores in beforeEach — the test passes alone and fails after a neighbour.',
  time: 'Inject a clock and freeze it; never compare against the real current date or a timezone-dependent boundary.',
  resource:
    'Close servers, file handles and browsers in afterEach, and use an ephemeral port (0) instead of a fixed one.',
  infrastructure:
    'Not a test problem: the runner or a service container was unhealthy. Retry the job and alert the platform owner if it repeats.',
  assertion: 'A deterministic assertion failure — check the commits that touched the code under test.',
  unknown: 'No known pattern matched. Open the full log and compare a passing and a failing attempt.',
};

function tokenize(normalized: string): string[] {
  return normalized.match(/<[a-z]+>|[a-z_][a-z0-9_]{1,}/g) ?? [];
}

export interface TextCluster {
  /** Indices into the input array. */
  members: number[];
  /** Index of the member chosen as the cluster's representative. */
  leader: number;
}

/**
 * Cluster already-normalised documents.
 *
 * 1. Exact duplicates collapse first (cheap and by far the common case).
 * 2. The distinct fingerprints become TF-IDF vectors and are merged by leader
 *    clustering: a document joins the first cluster whose leader has cosine
 *    similarity ≥ `threshold`, otherwise it founds a new one.
 *
 * Deterministic: the result depends only on input order.
 */
export function clusterDocuments(normalized: readonly string[], threshold = 0.7): TextCluster[] {
  const byText = new Map<string, number[]>();
  normalized.forEach((doc, i) => {
    const list = byText.get(doc);
    if (list) list.push(i);
    else byText.set(doc, [i]);
  });
  const unique = [...byText.keys()];
  const tokens = unique.map(tokenize);

  const df = new Map<string, number>();
  for (const doc of tokens) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);

  const vectors = tokens.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1);
    const vec = new Map<string, number>();
    let norm = 0;
    for (const [term, count] of tf) {
      const weight = (1 + Math.log(count)) * (Math.log((1 + unique.length) / (1 + df.get(term)!)) + 1);
      vec.set(term, weight);
      norm += weight * weight;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [term, weight] of vec) vec.set(term, weight / norm);
    return vec;
  });

  const cosine = (a: Map<string, number>, b: Map<string, number>): number => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [term, weight] of small) {
      const other = large.get(term);
      if (other !== undefined) dot += weight * other;
    }
    return dot;
  };

  const leaders: number[] = [];
  const groups: number[][] = [];
  unique.forEach((_, u) => {
    let best = -1;
    let bestSim = threshold;
    for (let c = 0; c < leaders.length; c++) {
      const sim = cosine(vectors[u]!, vectors[leaders[c]!]!);
      if (sim >= bestSim) {
        bestSim = sim;
        best = c;
      }
    }
    if (best >= 0) groups[best]!.push(u);
    else {
      leaders.push(u);
      groups.push([u]);
    }
  });

  return groups.map((group) => {
    const members = group.flatMap((u) => byText.get(unique[u]!)!).sort((a, b) => a - b);
    // Representative: a member of the most frequent fingerprint in the group.
    const top = group.reduce((a, b) =>
      byText.get(unique[b]!)!.length > byText.get(unique[a]!)!.length ? b : a,
    );
    return { members, leader: byText.get(unique[top]!)![0]! };
  });
}
