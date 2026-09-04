import { useState, useEffect, useCallback } from 'react';
import { useSetRecoilState } from 'recoil';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Spinner } from '@librechat/client';
import { dataService, setTokenHeader, setEmbedMode } from 'librechat-data-provider';
import type { EmbedSessionAgent } from 'librechat-data-provider';
import { getResponseStatus } from '~/utils/errors';
import { useLocalize } from '~/hooks';
import store from '~/store';

export const EMBED_TOKEN_MESSAGE = 'gieschat-embed-token';
const tokenStorageKey = (key: string) => `embed:${key}`;

/** localStorage is partitioned inside a third-party frame and may throw outright; both are fine. */
const readStoredToken = (key: string): string | null => {
  try {
    return localStorage.getItem(tokenStorageKey(key));
  } catch {
    return null;
  }
};
const storeToken = (key: string, token: string) => {
  try {
    localStorage.setItem(tokenStorageKey(key), token);
  } catch {
    /* private mode or storage blocked: the session still works for this load */
  }
};

type Status = 'loading' | 'needs_login' | 'inactive' | 'error';

/**
 * Entry point for the iframe. Authenticates through the embed key instead of cookies
 * (none travel cross-site), then hands the token to AuthContext and lands on /c/new.
 * Illinois-only agents get a sign-in button that finishes SSO in a popup, which posts
 * the token back here.
 */
export default function EmbedRoute() {
  const { embedKey = '' } = useParams();
  const navigate = useNavigate();
  const localize = useLocalize();
  const setEmbed = useSetRecoilState(store.embed);
  const [status, setStatus] = useState<Status>('loading');
  const [agent, setAgent] = useState<EmbedSessionAgent | null>(null);

  const start = useCallback(
    async (bearer: string | null) => {
      setStatus('loading');
      setTokenHeader(bearer ?? undefined);
      try {
        const session = await dataService.startEmbedSession(embedKey);
        setAgent(session.agent);
        if (!session.token) {
          setTokenHeader(undefined);
          setStatus('needs_login');
          return;
        }
        storeToken(embedKey, session.token);
        setEmbed(session.agent);
        window.dispatchEvent(new CustomEvent('tokenUpdated', { detail: session.token }));
        navigate('/c/new', { replace: true });
      } catch (error) {
        setStatus(getResponseStatus(error) === 404 ? 'inactive' : 'error');
      }
    },
    [embedKey, navigate, setEmbed],
  );

  useEffect(() => {
    setEmbedMode(true);
    void start(readStoredToken(embedKey));
  }, [embedKey, start]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ type?: string; token?: string }>) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data?.type !== EMBED_TOKEN_MESSAGE || typeof event.data.token !== 'string') {
        return;
      }
      void start(event.data.token);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [start]);

  const openLogin = () => {
    const url = `/embed/${encodeURIComponent(embedKey)}/done`;
    const popup = window.open(url, 'gieschat-embed-login', 'popup,width=520,height=680');
    if (popup == null) {
      window.open(url, '_blank');
    }
  };

  return (
    <main
      role="main"
      className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-surface-primary p-6 text-center text-text-primary"
    >
      {status === 'loading' && <Spinner className="size-6" />}
      {status === 'needs_login' && (
        <>
          <h1 className="text-lg font-semibold">{agent?.name}</h1>
          <p className="max-w-sm text-sm text-text-secondary">
            {localize('com_ui_embed_login_intro')}
          </p>
          <Button onClick={openLogin}>{localize('com_ui_embed_login_button')}</Button>
          <p className="text-xs text-text-secondary">{localize('com_ui_embed_login_hint')}</p>
        </>
      )}
      {status === 'inactive' && (
        <>
          <p className="text-sm">{localize('com_ui_embed_inactive')}</p>
          <p className="text-xs text-text-secondary">{localize('com_ui_embed_inactive_hint')}</p>
        </>
      )}
      {status === 'error' && <p className="text-sm">{localize('com_ui_embed_error')}</p>}
    </main>
  );
}
