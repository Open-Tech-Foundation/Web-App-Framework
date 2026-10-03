export interface SearchOptions {
  limit?: number;
  maxSectionsPerPage?: number;
  signal?: AbortSignal;
}
export interface SearchResult {
  url: string;
  title: string;
  text: string;
  section: string;
  excerpt: string;
  highlights: [number, number][];
  meta: Record<string, string>;
  anchors: { id: string; text: string; pos: number }[];
  score: number;
}
export interface SearchResponse {
  results: SearchResult[];
  total: number;
  partial: boolean;
}
export interface SearchClient {
  preload(): Promise<void>;
  query(query: string, options?: SearchOptions): Promise<SearchResponse>;
}
export function createSearch(options?: { base?: string }): SearchClient;
export function tokenize(text: string): string[];
export function excerptParts(excerpt: string, highlights?: [number, number][]): { text: string; match: boolean }[];
