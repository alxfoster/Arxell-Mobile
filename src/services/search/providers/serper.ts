import type {SearchProvider, SearchHit, SearchOptions} from '../types';
import {fetchJson, requireKey} from './http';

interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
}

interface SerperResponse {
  organic?: SerperOrganicResult[];
}

/** Google Search results supplied by serper.dev. */
export class SerperProvider implements SearchProvider {
  readonly id = 'serper' as const;

  constructor(private getKey: () => string) {}

  async search(query: string, opts: SearchOptions): Promise<SearchHit[]> {
    const key = requireKey(this.getKey(), 'Serper');
    const data = await fetchJson<SerperResponse>(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': key,
        },
        body: JSON.stringify({q: query, num: opts.maxResults}),
      },
    );

    return (data.organic ?? []).slice(0, opts.maxResults).map(result => ({
      title: result.title ?? '',
      url: result.link ?? '',
      snippet: result.snippet ?? '',
      ...(result.date ? {publishedAt: result.date} : {}),
    }));
  }
}
