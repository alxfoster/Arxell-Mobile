import {SerperProvider} from '../serper';

const okJson = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });

describe('SerperProvider', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('posts the query and normalizes organic results', async () => {
    (global.fetch as jest.Mock).mockReturnValue(
      okJson({
        organic: [
          {
            title: 'Apple',
            link: 'https://www.apple.com/',
            snippet: 'Apple designs consumer electronics.',
            date: '2026-01-01',
          },
        ],
      }),
    );

    const provider = new SerperProvider(() => 'secret-key');
    const hits = await provider.search('apple inc', {maxResults: 3});

    expect(global.fetch).toHaveBeenCalledWith(
      'https://google.serper.dev/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': 'secret-key',
        },
        body: JSON.stringify({q: 'apple inc', num: 3}),
        signal: expect.anything(),
      }),
    );
    expect(hits).toEqual([
      {
        title: 'Apple',
        url: 'https://www.apple.com/',
        snippet: 'Apple designs consumer electronics.',
        publishedAt: '2026-01-01',
      },
    ]);
  });

  it('limits results and tolerates optional fields', async () => {
    (global.fetch as jest.Mock).mockReturnValue(
      okJson({
        organic: [
          {title: 'One', link: 'https://example.com/1'},
          {title: 'Two', link: 'https://example.com/2'},
        ],
      }),
    );

    const provider = new SerperProvider(() => 'key');
    await expect(provider.search('q', {maxResults: 1})).resolves.toEqual([
      {
        title: 'One',
        url: 'https://example.com/1',
        snippet: '',
      },
    ]);
  });

  it('returns [] when organic results are absent', async () => {
    (global.fetch as jest.Mock).mockReturnValue(okJson({}));
    const provider = new SerperProvider(() => 'key');
    await expect(provider.search('q', {maxResults: 3})).resolves.toEqual([]);
  });

  it('throws before making a request when no key is set', async () => {
    const provider = new SerperProvider(() => '');
    await expect(provider.search('q', {maxResults: 3})).rejects.toThrow(
      /key not set/i,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws on a non-ok response', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(''),
    });
    const provider = new SerperProvider(() => 'key');
    await expect(provider.search('q', {maxResults: 3})).rejects.toThrow(
      /failed/i,
    );
  });
});
