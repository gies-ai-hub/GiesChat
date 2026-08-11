# PowerPoint MCP Server (GiesChat fork)

Hosted PowerPoint deck generator for GiesChat. Users ask the model to build a
deck; the model drives this MCP server; the finished `.pptx` is downloaded to
the user's own computer via a one-time link. Registered in `librechat.yaml` as
`mcpServers.powerpoint`, reached over streamable-HTTP at
`https://pptx-mcp.azurewebsites.net/mcp`.

Design spec: `docs/superpowers/specs/2026-07-20-pptx-mcp-design.md` (local).

## Vendored upstream

Forked from **[GongRzhe/Office-PowerPoint-MCP-Server](https://github.com/GongRzhe/Office-PowerPoint-MCP-Server)**
at pinned commit **`3631ba2ec0c24504476f78bf74d329c9be11caaa`**.

The vendored tree (`ppt_mcp_server.py`, `tools/`, `utils/`) is patched in three
narrow places; everything else is upstream. To update: re-vendor at a new
commit and re-apply the patches below.

### The patches (why the fork exists)

1. **Per-user state** (`ppt_mcp_server.py` → `gies_state.py`). Upstream keeps one
   shared `presentations` dict plus a single `current_presentation_id` global and
   hands out sequential, guessable ids (`presentation_1`, ...). On a shared HTTP
   worker that lets one user read or overwrite another's deck. `ScopedPresentations`
   is a drop-in `MutableMapping` that routes every read/write to a per-user backing
   dict keyed by the authenticated user, and evicts idle decks after a TTL.

2. **Path sandbox** (`utils/presentation_utils.py` → `gies_sandbox.py`). Upstream
   passes model-supplied `file_path` straight to `python-pptx`, i.e. arbitrary file
   read/write on a public container. The sandbox reduces every path to its basename
   under `/tmp/decks/<sha1(user)>/`; the Gies template is the one read-only exception.

3. **Download URL** (`tools/presentation_tools.py` → `gies_downloads.py`).
   `save_presentation` mints an unguessable, TTL'd token and returns a
   `/download/<token>` URL instead of a server path, so the browser can fetch the
   deck with no auth headers.

4. **Deck preview** (`gies_preview.py`). `preview_presentation` renders the live
   deck to a static HTML page at `/preview/<token>` — same header-less token deal
   as `/download` — which GiesChat shows in its artifacts side panel. The token
   holds the `Presentation` object itself, so the page always matches the file
   that downloads. Every call also autosaves the deck, making a lost build
   recoverable with `open_presentation`.

5. **Slide editing** (`gies_edit.py`). `delete_slide` and `move_slide`, which
   `python-pptx` has no supported API for: both edit `prs.slides._sldIdLst`, and
   delete drops the relationship so the removed slide leaves the saved file.

The shim modules (`gies_auth.py`, `gies_sandbox.py`, `gies_state.py`,
`gies_downloads.py`, `gies_questions.py`, `gies_uploads.py`, `gies_preview.py`,
`gies_edit.py`, `gies_server.py`) are ours; `gies_server.py` is the container
entrypoint that wraps upstream's ASGI app with the auth middleware and the
download, upload, and preview routes.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | Listen port (App Service sets `WEBSITES_PORT` to match). |
| `PPTX_MCP_KEY` | — | Shared secret; requests without a matching `X-Gies-Key` get 401. **Required.** |
| `PUBLIC_URL` | — | Base URL used to build download links, e.g. `https://pptx-mcp.azurewebsites.net`. |
| `GIES_TEMPLATE_PATH` | `/app/templates/gies.pptx` | The one allowlisted read-only template. |
| `PPT_TEMPLATE_PATH` | `/app/templates` | Upstream template search dir. |
| `PPTX_SANDBOX_ROOT` | `/tmp/decks` | Per-user sandbox root. |
| `PPTX_STATE_TTL` | `7200` | Idle seconds before an in-RAM deck is evicted. |
| `PPTX_DOWNLOAD_TTL` | `86400` | Seconds a download link stays valid. |
| `PPTX_PREVIEW_TTL` | `7200` | Seconds a preview link stays valid. A live token pins its deck in RAM for this long. |

## Tests

```bash
python -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt
PPTX_MCP_KEY=testkey ./.venv/bin/python -m pytest tests/ -q
```

`test_e2e.py` boots the real server on a port and drives it with a real MCP
streamable-HTTP client: create-from-template → add slide → save → download →
reopen with `python-pptx`, plus a cross-user isolation check and a 401 check.

## Deployment

CI: `.github/workflows/pptx-mcp-deploy.yml` builds `infra/pptx-mcp/**` and
deploys to the `pptx-mcp` web app on push to `main`. It needs the GitHub secrets
`ACR_USERNAME`, `ACR_PASSWORD`, and `AZURE_WEBAPP_PPTX_PUBLISH_PROFILE`.

Hosting decision (per `illinois-azure-container-deploy`): **Web App for Containers**
on the existing shared plan `dl-appplan-01`, image in the existing `dlacrgieschat`
ACR under the per-app repository `gieschat/pptx-mcp` — no new registry, no
Container Apps.

### One-time provisioning runbook

Run once by someone with Azure access to `DL_ResourceGroup_01`. Not executed by CI.

```bash
RG=DL_ResourceGroup_01
PLAN=dl-appplan-01
ACR=dlacrgieschat
IMAGE=dlacrgieschat.azurecr.io/gieschat/pptx-mcp:latest
APP=pptx-mcp

# 1. First image (cloud build, no local Docker). CI rebuilds on every push after this.
az acr build -r "$ACR" -t gieschat/pptx-mcp:latest infra/pptx-mcp

# 2. Create the web app on the shared plan.
az webapp create -g "$RG" -p "$PLAN" -n "$APP" \
  --deployment-container-image-name "$IMAGE"

# 3. Wire registry credentials.
ACR_USER=$(az acr credential show -n "$ACR" --query username -o tsv)
ACR_PASS=$(az acr credential show -n "$ACR" --query "passwords[0].value" -o tsv)
az webapp config container set -g "$RG" -n "$APP" \
  --container-image-name "$IMAGE" \
  --container-registry-url "https://${ACR}.azurecr.io" \
  --container-registry-user "$ACR_USER" \
  --container-registry-password "$ACR_PASS"

# 4. Generate the shared secret and set app settings on BOTH apps.
KEY=$(openssl rand -hex 32)
az webapp config appsettings set -g "$RG" -n "$APP" --settings \
  WEBSITES_PORT=8000 PORT=8000 \
  PPTX_MCP_KEY="$KEY" \
  PUBLIC_URL=https://pptx-mcp.azurewebsites.net
# gieschat needs the SAME key so ${PPTX_MCP_KEY} in librechat.yaml resolves:
az webapp config appsettings set -g "$RG" -n gieschat --settings PPTX_MCP_KEY="$KEY"

# 5. Force HTTPS.
az webapp update -g "$RG" -n "$APP" --https-only true

# 6. Publish profile → GitHub secret for the deploy workflow.
az webapp deployment list-publishing-profiles -g "$RG" -n "$APP" --xml \
  | gh secret set AZURE_WEBAPP_PPTX_PUBLISH_PROFILE --repo gies-ai-experiments/GiesChat

# 7. Verify.
az webapp log tail -g "$RG" -n "$APP"
curl -sS -o /dev/null -w "%{http_code}\n" https://pptx-mcp.azurewebsites.net/download/nope   # expect 404
```

### Rotating `PPTX_MCP_KEY`

Set a new value on **both** `pptx-mcp` and `gieschat` (step 4). If they drift,
every PowerPoint request 401s.

## Constraints

- **Single instance only.** In-RAM presentation state and local sandbox disk both
  assume one worker. Do **not** enable autoscale or add a worker for this app
  without first moving state to Blob Storage plus a shared token store — see the
  spec's "Out of scope". `dl-appplan-01` has one worker and no autoscale today, so
  this holds.
- **Ephemeral by design.** A container restart drops in-flight decks and download
  tokens. A deck's useful life is the few minutes between "make it" and
  "downloaded", so this is accepted rather than backed by durable storage.
- **`templates/gies.pptx` is a placeholder** (a valid empty deck) until a real
  Illinois-branded template is supplied. Swapping it is a drop-in at the same path.
