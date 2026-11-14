import type { Analysis } from '../engine/results';
import type { Dataset } from '../engine/types';

export type WorkerRequest =
  | { id: number; type: 'demo'; seed: number; endTime: number }
  | { id: number; type: 'reports'; reports: { name: string; xml: string }[]; name: string }
  | { id: number; type: 'dataset'; dataset: Dataset };

export type WorkerResponse =
  | { id: number; ok: true; dataset: Dataset; analysis: Analysis }
  | { id: number; ok: false; error: string };
