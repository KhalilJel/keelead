export interface SearchResult {
  leads: Array<{ source: string; [key: string]: unknown }>;
  partial: boolean;
  completedSources: number;
  cached: boolean;
}
export class SearchError extends Error { code: string; status: number; constructor(code: string, status?: number); }
export function parseSearch(input: unknown): { query: string; count: number; location?: string; industry?: string };
export function createSearchRunner(options?: { workerPath?: string; execArgv?: string[]; budgetMs?: number; maxConcurrent?: number }): (input: unknown) => Promise<SearchResult>;
export const search: (input: unknown) => Promise<SearchResult>;
