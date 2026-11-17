import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webSearch } from '../../../apps/desktop-hud/src/main/web-search.js';

const GOOGLE_NEWS_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
  <title>Quad announces maritime pact - The Hindu</title>
  <link>https://news.google.com/rss/articles/abc123</link>
  <pubDate>Mon, 17 Nov 2026 08:00:00 GMT</pubDate>
  <source url="https://www.thehindu.com">The Hindu</source>
  <description><![CDATA[<a href="https://news.google.com/rss/articles/abc123">Quad announces maritime pact</a>&nbsp;&nbsp;<font color="#6f6f6f">The Hindu</font>]]></description>
</item>
<item>
  <title>Cyclone Akvan alert for coastal states - NDTV</title>
  <link>https://news.google.com/rss/articles/def456</link>
  <pubDate>Mon, 17 Nov 2026 03:36:00 GMT</pubDate>
  <source url="https://www.ndtv.com">NDTV</source>
  <description><![CDATA[Andhra Pradesh &amp; Odisha on alert.]]></description>
</item>
</channel></rss>`;

const BING_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<item>
  <title>Bitcoin price today</title>
  <link>https://example.com/btc</link>
  <description>The live Bitcoin price is $64,958.15 &amp; rising.</description>
  <pubDate>Mon, 17 Nov 2026 12:48:00 GMT</pubDate>
</item>
</channel></rss>`;

function mockFetch(map: Record<string, string>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(map).find(([fragment]) => url.includes(fragment));
    if (!match) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(new Response(match[1], { status: 200 }));
  });
}

describe('webSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the top-stories feed for a bare current-affairs question', async () => {
    const fetchSpy = mockFetch({ 'news.google.com/rss?': GOOGLE_NEWS_XML });
    const result = await webSearch('what are the top news headlines today');

    expect(result.hits.length).toBeGreaterThan(0);
    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain('news.google.com/rss?');
    expect(result.providers[0]).toBe('Google News top stories');
    // The publisher is already in its own field, so the suffix is dropped.
    expect(result.hits[0]?.title).toBe('Quad announces maritime pact');
    expect(result.hits[0]?.source).toBe('The Hindu');
    expect(result.hits[0]?.publishedAt).toContain('17 Nov 2026');
  });

  it('strips escaped HTML out of snippets and decodes entities', async () => {
    mockFetch({ 'news.google.com/rss': GOOGLE_NEWS_XML });
    const result = await webSearch('quad summit manila coverage');
    const snippet = result.hits[0]?.snippet ?? '';

    expect(snippet).not.toContain('<a');
    expect(snippet).not.toContain('&nbsp;');
    expect(snippet).toContain('Quad announces maritime pact');
    expect(result.hits[1]?.snippet).toContain('Andhra Pradesh & Odisha');
  });

  it('searches the topic before the feed for a topical news query', async () => {
    const fetchSpy = mockFetch({ 'news.google.com/rss': GOOGLE_NEWS_XML });
    await webSearch('cyclone akvan odisha landfall');
    const firstUrl = fetchSpy.mock.calls[0]?.[0]?.toString() ?? '';

    expect(firstUrl).toContain('/rss/search');
    expect(firstUrl).toContain('when%3A7d');
  });

  it('falls back to the general web index for a non-news question', async () => {
    const fetchSpy = mockFetch({ 'bing.com/search': BING_XML });
    const result = await webSearch('radius of the earth in km');

    expect(fetchSpy.mock.calls[0]?.[0]?.toString()).toContain('bing.com/search');
    expect(result.news).toBe(false);
    expect(result.hits[0]?.title).toBe('Bitcoin price today');
  });

  it('reports an honest error instead of inventing results when every provider fails', async () => {
    mockFetch({});
    const result = await webSearch('nothing will answer this query');

    expect(result.hits).toEqual([]);
    expect(result.error).toMatch(/no live results/i);
    expect(result.providers).toEqual([]);
  });

  it('rejects an empty query without any network calls', async () => {
    const fetchSpy = mockFetch({});
    const result = await webSearch('   ');

    expect(result.error).toMatch(/query is required/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates identical headlines across providers', async () => {
    mockFetch({ 'news.google.com': GOOGLE_NEWS_XML, 'bing.com': GOOGLE_NEWS_XML });
    const result = await webSearch('duplicate headline check rss');
    const titles = result.hits.map((hit) => hit.title);

    expect(new Set(titles).size).toBe(titles.length);
  });
});
