import { load } from 'cheerio';
import { Agent, request } from 'undici';
import type { IncomingHttpHeaders } from 'http';
import type {
  WebsitePage,
  WebsiteSkipReason,
  AdminWebsitePreviewResponse,
} from 'librechat-data-provider';
import { createSSRFSafeUndiciConnect, isSSRFTarget, resolveHostnameSSRF } from '~/auth';

export const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 8_000;
/** Leaves room for Luna inside Azure's 230 s request limit. */
const CRAWL_DEADLINE_MS = 60_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** Google's limit; rules past it are ignored. */
const MAX_ROBOTS_BYTES = 512 * 1024;
/** Empty JS-rendered pages do not count toward `maxPages`, so fetches get their own cap. */
const FETCHES_PER_PAGE = 3;
const CONCURRENCY = 4;
const MAX_REDIRECTS = 5;
/** Site menus produce dozens of these; the reasons that explain a gap are always kept. */
const NOISY_REASONS = new Set<WebsiteSkipReason>(['outside', 'offsite']);
const MAX_NOISY_SKIPPED = 50;
const USER_AGENT = 'GiesChatBot/1.0 (+https://gieschat.azurewebsites.net)';
const NOT_HTML = /\.(pdf|docx?|pptx?|xlsx?|csv|zip|png|jpe?g|gif|svg|webp|mp3|mp4|mov)$/i;
const CHROME = 'script, style, noscript, svg, iframe, nav, header, footer, form';
const BLOCKS =
  'p, div, li, h1, h2, h3, h4, h5, h6, tr, td, th, dd, dt, pre, blockquote, section, article';

export type CrawlResult = AdminWebsitePreviewResponse;

export class WebsiteError extends Error {
  constructor(public readonly code: 'invalid_url' | 'blocked') {
    super(code);
  }
}

type Fetched =
  | { kind: 'page'; url: URL; html: string }
  | { kind: 'skip'; url: URL; reason: WebsiteSkipReason };

/** http(s) only; the fragment is dropped so `#top` links are not new pages. */
export function normalizeSiteUrl(raw: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  url.hash = '';
  return url;
}

const bareHost = (url: URL): string => url.host.toLowerCase().replace(/^www\./, '');

/** The folder a crawl stays in: `/readings/` for `/readings`, `/courses/` for `/courses/a.html`. */
export function scopePath(start: URL): string {
  const path = start.pathname;
  if (path.endsWith('/')) {
    return path;
  }
  const slash = path.lastIndexOf('/');
  return path.slice(slash + 1).includes('.') ? path.slice(0, slash + 1) : `${path}/`;
}

/** Same site (scheme and a leading `www.` ignored) and inside the start address's folder. */
export function isInScope(candidate: URL, start: URL): boolean {
  if (bareHost(candidate) !== bareHost(start)) {
    return false;
  }
  const scope = scopePath(start);
  return candidate.pathname.startsWith(scope) || `${candidate.pathname}/` === scope;
}

/**
 * `Disallow` prefixes for `User-agent: *`.
 * ponytail: prefix match only; `*`/`$` wildcards are not interpreted (treated as allowed).
 */
export function parseRobots(text: string): string[] {
  const disallow: string[] = [];
  let applies = false;
  let inAgentLines = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) {
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      applies = inAgentLines ? applies || value === '*' : value === '*';
      inAgentLines = true;
      continue;
    }
    inAgentLines = false;
    if (key === 'disallow' && applies && value) {
      disallow.push(value);
    }
  }
  return disallow;
}

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

const firstHeader = (headers: IncomingHttpHeaders, name: string): string => {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

function readPage(html: string, url: URL): { title: string; text: string; links: URL[] } {
  const $ = load(html);
  const title = $('title').first().text().trim() || url.pathname;
  const links = $('a[href]')
    .toArray()
    .flatMap((el) => {
      const link = normalizeSiteUrl($(el).attr('href') ?? '', url);
      return link ? [link] : [];
    });
  $(CHROME).remove();
  $('br').replaceWith('\n');
  $(BLOCKS).append('\n');
  const main = $('main').first();
  const root = main.length > 0 ? main : $('body');
  const text = root
    .text()
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title, text, links };
}

function get(url: URL, dispatcher: Agent) {
  return request(url, {
    dispatcher,
    method: 'GET',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain' },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
}

async function readCapped(
  body: AsyncIterable<Buffer>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    if (size + chunk.byteLength > maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - size));
      return { text: Buffer.concat(chunks).toString('utf8'), truncated: true };
    }
    size += chunk.byteLength;
    chunks.push(chunk);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

/**
 * Redirects are followed by hand and only within scope, so a redirect can never reach
 * another host (including a private IP literal, which a DNS-lookup guard cannot see).
 */
async function fetchPage(url: URL, start: URL, dispatcher: Agent): Promise<Fetched> {
  let current = url;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await get(current, dispatcher);
      const location = firstHeader(res.headers, 'location');
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        await res.body.dump();
        const next = normalizeSiteUrl(location, current);
        if (!next || !isInScope(next, start)) {
          return { kind: 'skip', url, reason: 'offsite' };
        }
        current = next;
        continue;
      }
      if (res.statusCode >= 400) {
        await res.body.dump();
        return { kind: 'skip', url, reason: 'error' };
      }
      if (!firstHeader(res.headers, 'content-type').includes('text/html')) {
        await res.body.dump();
        return { kind: 'skip', url, reason: 'not_html' };
      }
      const { text: html, truncated } = await readCapped(res.body, MAX_PAGE_BYTES);
      if (truncated) {
        res.body.destroy();
        return { kind: 'skip', url, reason: 'too_large' };
      }
      return { kind: 'page', url: current, html };
    }
    return { kind: 'skip', url, reason: 'error' };
  } catch {
    return { kind: 'skip', url, reason: 'error' };
  }
}

/** Follows same-site redirects (http→https, bare→www) so a non-canonical paste keeps its rules. */
async function fetchRobots(start: URL, dispatcher: Agent): Promise<string[]> {
  let current = new URL('/robots.txt', start);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await get(current, dispatcher);
      const location = firstHeader(res.headers, 'location');
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        await res.body.dump();
        const next = normalizeSiteUrl(location, current);
        if (!next || bareHost(next) !== bareHost(start)) {
          return [];
        }
        current = next;
        continue;
      }
      if (res.statusCode !== 200) {
        await res.body.dump();
        return [];
      }
      const { text, truncated } = await readCapped(res.body, MAX_ROBOTS_BYTES);
      if (truncated) {
        res.body.destroy();
      }
      return parseRobots(text);
    }
    return [];
  } catch {
    return [];
  }
}

const isDisallowed = (url: URL, disallow: string[]): boolean =>
  disallow.some((prefix) => url.pathname.startsWith(prefix));

/**
 * Breadth-first crawl from `rawUrl`, same site and folder only, up to `maxPages` pages.
 * Throws `WebsiteError` for a malformed or private address; everything else becomes a
 * `skipped` entry so the Test panel can say why a page is missing.
 */
export async function crawlSite(
  rawUrl: string,
  options: { maxPages?: number; allowedAddresses?: string[] | null; deadlineMs?: number } = {},
): Promise<CrawlResult> {
  const { maxPages = MAX_PAGES, allowedAddresses = null, deadlineMs = CRAWL_DEADLINE_MS } = options;
  const start = normalizeSiteUrl(rawUrl);
  if (!start) {
    throw new WebsiteError('invalid_url');
  }
  const port = start.port || (start.protocol === 'https:' ? '443' : '80');
  if (
    isSSRFTarget(start.hostname, allowedAddresses, port) ||
    (await resolveHostnameSSRF(start.hostname, allowedAddresses, port))
  ) {
    throw new WebsiteError('blocked');
  }

  const dispatcher = new Agent({ connect: createSSRFSafeUndiciConnect(allowedAddresses, port) });
  const skipped = new Map<string, WebsiteSkipReason>();
  let noisy = 0;
  const skip = (url: URL, reason: WebsiteSkipReason) => {
    if (skipped.has(url.href)) {
      return;
    }
    if (NOISY_REASONS.has(reason)) {
      if (noisy >= MAX_NOISY_SKIPPED) {
        return;
      }
      noisy += 1;
    }
    skipped.set(url.href, reason);
  };
  const toResult = (pages: WebsitePage[]): CrawlResult => ({
    url: start.href,
    pages,
    skipped: [...skipped].map(([url, reason]) => ({ url, reason })),
  });

  try {
    const disallow = await fetchRobots(start, dispatcher);
    if (isDisallowed(start, disallow)) {
      skip(start, 'robots');
      return toResult([]);
    }
    const pages: WebsitePage[] = [];
    const seen = new Set<string>([start.href]);
    const queue: URL[] = [start];
    const deadline = Date.now() + deadlineMs;
    const maxFetches = maxPages * FETCHES_PER_PAGE;
    let fetches = 0;
    while (
      queue.length > 0 &&
      pages.length < maxPages &&
      fetches < maxFetches &&
      (fetches === 0 || Date.now() < deadline)
    ) {
      const size = Math.min(CONCURRENCY, maxPages - pages.length, maxFetches - fetches);
      const batch = queue.splice(0, size);
      fetches += batch.length;
      const results = await Promise.all(batch.map((url) => fetchPage(url, start, dispatcher)));
      for (const result of results) {
        if (result.kind === 'skip') {
          skip(result.url, result.reason);
          continue;
        }
        if (pages.some((existing) => existing.url === result.url.href)) {
          continue;
        }
        const { title, text, links } = readPage(result.html, result.url);
        if (text) {
          pages.push({
            url: result.url.href,
            title,
            text,
            words: countWords(text),
            cleaned: false,
          });
        } else {
          skip(result.url, 'empty');
        }
        for (const link of links) {
          if (seen.has(link.href)) {
            continue;
          }
          seen.add(link.href);
          if (bareHost(link) !== bareHost(start)) {
            skip(new URL(link.origin), 'offsite');
          } else if (!isInScope(link, start)) {
            skip(link, 'outside');
          } else if (NOT_HTML.test(link.pathname)) {
            skip(link, 'not_html');
          } else if (isDisallowed(link, disallow)) {
            skip(link, 'robots');
          } else {
            queue.push(link);
          }
        }
      }
    }
    queue.forEach((url) => skip(url, 'limit'));
    return toResult(pages);
  } finally {
    await dispatcher.close();
  }
}
