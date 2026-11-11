export interface SearchResult { url: string; title?: string; content?: string; published?: string }
export interface SearchProvider { name: string; search(query: string, opts?: { site?: string }): Promise<SearchResult[]> }
