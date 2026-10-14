import { apiBaseUrl, buildLoginRedirectUrl } from 'librechat-data-provider';

export const REDIRECT_PARAM = 'redirect_to';
export const SESSION_KEY = 'post_login_redirect_to';

/** Matches `/login` as a full path segment, with optional basename prefix (e.g. `/librechat/login/2fa`) */
const LOGIN_PATH_RE = /(?:^|\/)login(?:\/|$)/;

/** Validates that a redirect target is a safe relative path (not an absolute or protocol-relative URL) */
export function isSafeRedirect(url: string): boolean {
  if (!url.startsWith('/') || url.startsWith('//')) {
    return false;
  }
  const path = url.split('?')[0].split('#')[0];
  return !LOGIN_PATH_RE.test(path);
}

/**
 * Resolves the post-login redirect from URL params and sessionStorage,
 * cleans up both sources, and returns the validated target (or null).
 */
export function getPostLoginRedirect(searchParams: URLSearchParams): string | null {
  const urlRedirect = searchParams.get(REDIRECT_PARAM);
  const storedRedirect = sessionStorage.getItem(SESSION_KEY);

  const target = urlRedirect ?? storedRedirect;

  if (storedRedirect) {
    sessionStorage.removeItem(SESSION_KEY);
  }

  if (target == null || !isSafeRedirect(target)) {
    return null;
  }

  return target;
}

export function persistRedirectToSession(value: string): void {
  if (isSafeRedirect(value)) {
    sessionStorage.setItem(SESSION_KEY, value);
  }
}

/** Plain "opened the app" locations: a signed-out visitor sees the public welcome page there. */
const DEFAULT_ENTRY_PATHS = new Set(['/', '/c/new']);

/**
 * Where a signed-out visitor is sent: the welcome page when they just opened the app (or are on it),
 * otherwise `/login?redirect_to=…` so a deep link survives sign-in. Returns a router path (no base).
 */
export function signedOutRedirect(
  pathname: string = window.location.pathname,
  search: string = window.location.search,
  hash: string = window.location.hash,
): string {
  const base = apiBaseUrl();
  const path =
    base && (pathname === base || pathname.startsWith(`${base}/`))
      ? pathname.slice(base.length) || '/'
      : pathname;
  if (path === '/welcome' || (DEFAULT_ENTRY_PATHS.has(path) && !search && !hash)) {
    return '/welcome';
  }
  return buildLoginRedirectUrl(pathname, search, hash);
}
