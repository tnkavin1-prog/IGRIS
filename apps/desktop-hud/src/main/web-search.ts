/**
 * Live web search for the voice assistant.
 *
 * Grounding with Google Search is a billed Live/GenerateContent feature, so it
 * is rejected outright on free-tier API keys. That left the model with no way
 * to answer current-affairs questions except by driving Chrome to Google News,
 * which is slow and takes over the user's screen. This module performs the
 * lookup inside the HUD instead, using public RSS endpoints that need no API
 * key, and returns headlines, snippets, publishers and URLs for the model to
 * read out and cite.
 */

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
}

export interface WebSearchResponse {
  query: string;
  news: boolean;
  hits: WebSearchHit[];
  providers: string[];
  fetchedAt: string;
  /** Present when every provider failed, so the model can say so honestly. */
  error?: string;
}

const CACHE_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_SNIPPET = 320;
const cache = new Map<string, { at: number; value: WebSearchResponse }>();

const NEWS_HINT =
  /news|headline|current affair|breaking|today|latest|now|update|election|score|price|weather|stock|match|happening|cyclone|storm|flood|earthquake|summit|protest|verdict|resign|appointed|launch|announce/i;
const GENERIC_NEWS =
  /^(?:hey\s+|ok\s+)?(?:what(?:'s|s| is| are)?\s+)?(?:the\s+)?(?:today'?s?\s+)?(?:top\s+|latest\s+|current\s+)?(?:current\s+affairs?|news|headlines?|briefing|updates?)\b/i;
const WORLD_HINT = /\b(world|global|international|foreign)\b/i;
const INDIA_FEED = 'hl=en-IN&gl=IN&ceid=IN:en';
const TOP_STORIES_URL = `https://news.google.com/rss?${INDIA_FEED}`;
const WORLD_URL = `https://news.google.com/rss/headlines/section/topic/WORLD?${INDIA_FEED}`;

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
  };
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+|#39);/gi, (match, name) => named[String(name).toLowerCase()] ?? match);
}

/**
 * Google News descriptions are CDATA-wrapped HTML that is entity-escaped, so
 * decoding has to happen before tag stripping (and possibly in several passes).
 */
function cleanText(input: string, maxLength = Number.POSITIVE_INFINITY): string {
  let text = unwrapCdata(input);
  for (let pass = 0; pass < 3; pass++) {
    const next = decodeEntities(text).replace(/<[^>]*>/g, ' ');
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function unwrapCdata(value: string): string {
  const cdata = value.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1]! : value;
}

function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return undefined;
  const raw = unwrapCdata(match[1] ?? '').trim();
  return raw || undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Parse either RSS `<item>` or Atom `<entry>` records into search hits. */
function parseFeeds(xml: string, provider: string, limit: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  for (const block of blocks) {
    const body = block[1] ?? '';
    const rawTitle = readTag(body, 'title');
    let url = readTag(body, 'link');
    if (!url) {
      const href = body.match(/<link[^>]*href="([^"]+)"/i);
      url = href ? decodeEntities(href[1]!) : undefined;
    }
    if (!rawTitle || !url) continue;

    const rawSource = readTag(body, 'source');
    const source = rawSource ? cleanText(rawSource, 80) : provider;
    // Google News appends " - Publisher" to the headline; the source field
    // already carries it.
    let title = cleanText(rawTitle, 240);
    if (rawSource) title = title.replace(new RegExp(`\\s+-\\s+${escapeRegExp(source)}$`), '').trim();

    hits.push({
      title,
      url: decodeEntities(url),
      snippet: cleanText(readTag(body, 'description') ?? readTag(body, 'summary') ?? '', MAX_SNIPPET),
      source,
      publishedAt: readTag(body, 'pubDate') ?? readTag(body, 'published') ?? readTag(body, 'updated'),
    });
    if (hits.length >= limit * 2) break;
  }
  return hits;
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 GematronHUD/1.0',
        accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function dedupe(hits: WebSearchHit[], limit: number): WebSearchHit[] {
  const seen = new Set<string>();
  const out: WebSearchHit[] = [];
  for (const hit of hits) {
    const fingerprint = hit.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Search the live web. Current-affairs questions start from the top-stories
 * feed, because a keyword search for "today news" returns exam-prep listicles
 * rather than today's actual headlines.
 */
export async function webSearch(
  rawQuery: string,
  options: { limit?: number; news?: boolean } = {},
): Promise<WebSearchResponse> {
  const query = rawQuery.trim().slice(0, 300);
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 12);
  const news = options.news ?? NEWS_HINT.test(query);
  const fetchedAt = new Date().toISOString();

  if (!query) {
    return { query, news, hits: [], providers: [], fetchedAt, error: 'A search query is required.' };
  }

  const cacheKey = `${news ? 'news' : 'web'}:${limit}:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const encoded = encodeURIComponent(query);
  const newsSearchUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:7d`)}&${INDIA_FEED}`;
  const bingUrl = `https://www.bing.com/search?q=${encoded}&format=rss&count=${limit}`;
  const bing: [string, () => Promise<string | null>] = ['Bing', () => fetchText(bingUrl)];
  const newsSearch: [string, () => Promise<string | null>] = [
    'Google News',
    () => fetchText(newsSearchUrl),
  ];

  // A bare "what's the news today" has no topic to search for, so start from the
  // curated feed. A topical question searches the topic first and only falls
  // back to the feed when the search comes back thin.
  let plan: Array<[string, () => Promise<string | null>]>;
  if (!news) {
    plan = [bing, newsSearch];
  } else if (GENERIC_NEWS.test(query)) {
    plan = [['Google News top stories', () => fetchText(TOP_STORIES_URL)]];
    if (WORLD_HINT.test(query)) {
      plan.push(['Google News world', () => fetchText(WORLD_URL)]);
    }
    plan.push(bing);
  } else {
    plan = [newsSearch, bing];
    if (WORLD_HINT.test(query)) plan.push(['Google News world', () => fetchText(WORLD_URL)]);
  }

  const hits: WebSearchHit[] = [];
  const used: string[] = [];
  let budget = limit;
  for (let index = 0; index < plan.length && budget > 0; index++) {
    const [name, run] = plan[index]!;
    // The leading provider gets half the slots so the rest can widen coverage;
    // a topical query is not allowed to be drowned out by generic headlines.
    const take = index === 0 ? Math.max(3, Math.ceil(limit / 2)) : budget;
    const xml = await run();
    if (!xml || !/<(item|entry)[\s>]/i.test(xml)) continue;
    const parsed = parseFeeds(xml, name, limit).slice(0, take);
    if (parsed.length === 0) continue;
    used.push(name);
    hits.push(...parsed);
    budget = limit - dedupe(hits, limit).length;
  }

  if (hits.length < 3) {
    const top = await fetchText(TOP_STORIES_URL);
    if (top) {
      const parsed = parseFeeds(top, 'Google News top stories', limit);
      if (parsed.length > 0) {
        used.push('Google News top stories');
        hits.push(...parsed);
      }
    }
  }

  const value: WebSearchResponse = {
    query,
    news,
    hits: dedupe(hits, limit),
    providers: [...new Set(used)],
    fetchedAt,
    ...(hits.length === 0 ? { error: 'No live results were returned by the search providers.' } : {}),
  };
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}
