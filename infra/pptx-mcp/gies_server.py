"""Gies entrypoint: assemble the vendored MCP server behind auth + downloads.

Importing ppt_mcp_server runs upstream's module-level tool registration against
the per-user scoped state (wired in ppt_mcp_server.py), so `app` arrives fully
configured. We take its streamable-http ASGI app, mount the /download route,
wrap the whole thing in the shared-secret auth middleware, and serve it with
uvicorn. The MCP endpoint is served at /mcp (FastMCP default).
"""
import os
from urllib.parse import urlparse

import uvicorn
from starlette.routing import Route

from ppt_mcp_server import app
from gies_auth import AuthMiddleware
from gies_downloads import download
from gies_preview import preview
from gies_uploads import upload, design_upload

_PORT = int(os.environ.get("PORT", "8000"))
app.settings.host = "0.0.0.0"
app.settings.port = _PORT


def allow_public_host(settings, public_url):
    """Add the deployed hostname to the SDK's DNS-rebinding allowlist.

    The MCP SDK ships `allowed_hosts=['127.0.0.1:*', 'localhost:*', '[::1]:*']`,
    so anything served under a real hostname answers 421 "Invalid Host header"
    before the MCP handshake starts. Local dev never trips it, which is why this
    only ever fails once deployed. Protection stays on - we widen it by exactly
    the one host we actually serve.
    """
    host = urlparse(public_url).netloc
    if not host:
        return
    if host not in settings.allowed_hosts:
        settings.allowed_hosts = [*settings.allowed_hosts, host]
    origin = public_url.rstrip("/")
    if origin not in settings.allowed_origins:
        settings.allowed_origins = [*settings.allowed_origins, origin]


allow_public_host(app.settings.transport_security, os.environ.get("PUBLIC_URL", ""))

assert hasattr(app, "streamable_http_app"), "mcp version lacks streamable_http_app()"
_starlette = app.streamable_http_app()
_starlette.router.routes.append(Route("/download/{token}", download, methods=["GET"]))
# Deck preview: same header-less deal as /download — the token is the credential.
_starlette.router.routes.append(Route("/preview/{token}", preview, methods=["GET"]))
_starlette.router.routes.append(Route("/upload/{token}", upload, methods=["POST", "OPTIONS"]))
# Composer attachments: posted by LibreChat's backend, so this route keeps header
# auth rather than joining the token-authenticated /upload exemption.
_starlette.router.routes.append(Route("/design", design_upload, methods=["POST"]))

asgi = AuthMiddleware(_starlette, exempt_prefixes=("/download", "/upload", "/preview"))

if __name__ == "__main__":
    uvicorn.run(asgi, host="0.0.0.0", port=_PORT)
