import { useEffect } from 'react';
import { useAuthContext, useLocalize } from '~/hooks';
import { EMBED_TOKEN_MESSAGE } from './EmbedRoute';

/**
 * Where the SSO popup lands. It is a normal top-level page, so cookies work and
 * AuthContext signs it in (via /login when needed); it then posts the bearer token
 * to the frame that opened it and closes.
 */
export default function EmbedDone() {
  const localize = useLocalize();
  const { token, isAuthenticated } = useAuthContext();

  useEffect(() => {
    if (!isAuthenticated || !token || window.opener == null) {
      return;
    }
    window.opener.postMessage({ type: EMBED_TOKEN_MESSAGE, token }, window.location.origin);
    window.close();
  }, [isAuthenticated, token]);

  return (
    <main
      role="main"
      className="flex h-dvh items-center justify-center p-6 text-sm text-text-primary"
    >
      {isAuthenticated ? localize('com_ui_embed_done') : null}
    </main>
  );
}
