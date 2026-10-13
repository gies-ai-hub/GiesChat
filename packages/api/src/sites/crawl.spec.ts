import http from 'http';
import type { AddressInfo } from 'net';
import {
  crawlSite,
  isInScope,
  scopePath,
  parseRobots,
  WebsiteError,
  normalizeSiteUrl,
} from './crawl';

type Route = { status?: number; type?: string; body?: string; location?: string };

let routes: Record<string, Route> = {};
let server: http.Server;
let base = '';
let allowed: string[] = [];

const page = (title: string, main: string, links: string[] = []) =>
  `<html><head><title>${title}</title></head><body>
    <nav>Home | Courses | Apply Now</nav>
    <main><h1>${title}</h1><p>${main}</p>${links.map((href) => `<a href="${href}">link</a>`).join('')}</main>
    <footer>© Board of Trustees</footer></body></html>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const route = routes[req.url ?? ''];
    if (!route) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(route.status ?? 200, {
      'content-type': route.type ?? 'text/html; charset=utf-8',
      ...(route.location ? { location: route.location } : {}),
    });
    res.end(route.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  allowed = [`127.0.0.1:${port}`];
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  routes = {};
});

describe('scope rules', () => {
  it('keeps the crawl inside the folder of the pasted address', () => {
    expect(scopePath(new URL('https://x.edu/readings/'))).toBe('/readings/');
    expect(scopePath(new URL('https://x.edu/readings'))).toBe('/readings/');
    expect(scopePath(new URL('https://x.edu/courses/badm350.html'))).toBe('/courses/');
    expect(scopePath(new URL('https://x.edu'))).toBe('/');
  });

  it('treats http/https and a leading www. as the same site', () => {
    const start = new URL('http://x.edu/readings/');
    expect(isInScope(new URL('https://www.x.edu/readings/week-5/'), start)).toBe(true);
    expect(isInScope(new URL('https://x.edu/readings'), start)).toBe(true);
    expect(isInScope(new URL('https://x.edu/schedule/'), start)).toBe(false);
    expect(isInScope(new URL('https://y.edu/readings/'), start)).toBe(false);
  });

  it('accepts only http(s) and drops the fragment', () => {
    expect(normalizeSiteUrl('ftp://x.edu/a')).toBeNull();
    expect(normalizeSiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSiteUrl('not a url')).toBeNull();
    expect(normalizeSiteUrl(' https://x.edu/a#top ')?.href).toBe('https://x.edu/a');
  });

  it('reads Disallow rules for every crawler only', () => {
    const rules = parseRobots(
      [
        'User-agent: Googlebot',
        'Disallow: /private/',
        '',
        'User-agent: *',
        'Disallow: /quiz/',
        'Disallow:',
      ].join('\n'),
    );
    expect(rules).toEqual(['/quiz/']);
  });
});

describe('crawlSite', () => {
  it('reads same-site pages under the start folder and says what it skipped', async () => {
    routes['/robots.txt'] = {
      type: 'text/plain',
      body: 'User-agent: *\nDisallow: /readings/quiz/',
    };
    routes['/readings/'] = {
      body: page('Readings', 'Read before Tuesday.', [
        '/readings/week-5/',
        '/readings/quiz/',
        '/readings/slides.pdf',
        '/schedule/',
        'https://youtube.com/watch?v=1',
      ]),
    };
    routes['/readings/week-5/'] = { body: page('Week 5', 'Platform Revolution, ch. 2–3.') };

    const result = await crawlSite(`${base}/readings/`, { allowedAddresses: allowed });

    expect(result.pages.map((p) => p.url)).toEqual([
      `${base}/readings/`,
      `${base}/readings/week-5/`,
    ]);
    const week5 = result.pages[1];
    expect(week5.title).toBe('Week 5');
    expect(week5.text).toContain('Platform Revolution');
    expect(week5.text).not.toContain('Apply Now');
    expect(week5.text).not.toContain('Board of Trustees');
    expect(week5.cleaned).toBe(false);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { url: `${base}/readings/quiz/`, reason: 'robots' },
        { url: `${base}/readings/slides.pdf`, reason: 'not_html' },
        { url: `${base}/schedule/`, reason: 'outside' },
        { url: 'https://youtube.com/', reason: 'offsite' },
      ]),
    );
  });

  it('follows a same-site redirect (missing trailing slash) and refuses an off-site one', async () => {
    routes['/readings'] = { status: 301, location: '/readings/' };
    routes['/readings/'] = { body: page('Readings', 'Overview.', ['/readings/away/']) };
    routes['/readings/away/'] = { status: 302, location: 'http://example.com/' };

    const result = await crawlSite(`${base}/readings`, { allowedAddresses: allowed });

    expect(result.pages.map((p) => p.url)).toEqual([`${base}/readings/`]);
    expect(result.skipped).toContainEqual({ url: `${base}/readings/away/`, reason: 'offsite' });
  });

  it('returns no pages when robots.txt blocks the start page', async () => {
    routes['/robots.txt'] = { type: 'text/plain', body: 'User-agent: *\nDisallow: /' };
    routes['/readings/'] = { body: page('Readings', 'Hidden.') };

    const result = await crawlSite(`${base}/readings/`, { allowedAddresses: allowed });

    expect(result.pages).toEqual([]);
    expect(result.skipped).toEqual([{ url: `${base}/readings/`, reason: 'robots' }]);
  });

  it('stops at maxPages and reports the rest as limit', async () => {
    routes['/s/'] = { body: page('Index', 'All weeks.', ['/s/1/', '/s/2/', '/s/3/']) };
    routes['/s/1/'] = { body: page('One', 'one') };
    routes['/s/2/'] = { body: page('Two', 'two') };
    routes['/s/3/'] = { body: page('Three', 'three') };

    const result = await crawlSite(`${base}/s/`, { allowedAddresses: allowed, maxPages: 2 });

    expect(result.pages).toHaveLength(2);
    expect(result.skipped.filter((s) => s.reason === 'limit').length).toBeGreaterThan(0);
  });

  it('skips pages over 2 MB and non-HTML responses', async () => {
    routes['/big/'] = { body: page('Index', 'x', ['/big/huge/', '/big/data/']) };
    routes['/big/huge/'] = { body: 'a'.repeat(2 * 1024 * 1024 + 10) };
    routes['/big/data/'] = { type: 'application/json', body: '{}' };

    const result = await crawlSite(`${base}/big/`, { allowedAddresses: allowed });

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { url: `${base}/big/huge/`, reason: 'too_large' },
        { url: `${base}/big/data/`, reason: 'not_html' },
      ]),
    );
  });

  it('refuses private addresses and bad input', async () => {
    await expect(crawlSite(`${base}/readings/`)).rejects.toMatchObject({ code: 'blocked' });
    await expect(crawlSite('ftp://x.edu/')).rejects.toBeInstanceOf(WebsiteError);
  });
});
