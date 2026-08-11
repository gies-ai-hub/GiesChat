"""Static HTML preview of a deck, rendered from the live python-pptx object.

The panel in GiesChat is an iframe of this page, so the preview cannot disagree
with the file that downloads: both are read from the same object. Text is placed
at each shape's real position (python-pptx reports left/top/width/height in EMU),
scaled to percentages of the slide, so the preview shows layout rather than a
bullet list. Shapes with no text — pictures, charts, tables — draw as labelled
placeholder boxes.

The page is deliberately inert: no scripts, no external assets. Everything the
model wrote passes through html.escape first.
"""
import html
import os
import secrets
import time
from typing import Dict, List, Optional, Tuple

from starlette.requests import Request
from starlette.responses import HTMLResponse, PlainTextResponse

CARD_WIDTH_PX = 640

DESIGN_NOTE = "styled with your template on download"


def _geometry(slide, shape) -> Optional[Tuple[int, int, int, int]]:
    """Absolute EMU box for a shape, or None when it can't be resolved.

    A placeholder that inherits its position from the layout reports None for
    left/top/width/height, so fall back to the layout placeholder carrying the
    same idx before giving up.
    """
    box = (shape.left, shape.top, shape.width, shape.height)
    if None not in box:
        return box
    if not shape.is_placeholder:
        return None
    idx = shape.placeholder_format.idx
    for placeholder in slide.slide_layout.placeholders:
        if placeholder.placeholder_format.idx == idx:
            inherited = (placeholder.left, placeholder.top,
                         placeholder.width, placeholder.height)
            return inherited if None not in inherited else None
    return None


def _lines(shape) -> List[str]:
    if not shape.has_text_frame:
        return []
    return [p.text for p in shape.text_frame.paragraphs if p.text.strip()]


def _label(shape) -> str:
    kind = getattr(shape.shape_type, "name", None) or "shape"
    return str(kind).replace("_", " ").lower()


def _body(shape) -> str:
    lines = _lines(shape)
    if not lines:
        return '<span class="ph">%s</span>' % html.escape(_label(shape))
    return "<br>".join(html.escape(line) for line in lines)


def _render_slide(pres, slide, number: int, total: int) -> str:
    width_emu = pres.slide_width or 1
    height_emu = pres.slide_height or 1
    height_px = round(CARD_WIDTH_PX * height_emu / width_emu)

    positioned: List[str] = []
    loose: List[str] = []
    for shape in slide.shapes:
        box = _geometry(slide, shape)
        body = _body(shape)
        if box is None:
            loose.append('<div class="loose">%s</div>' % body)
            continue
        left, top, width, height = box
        style = (
            "left:%.2f%%;top:%.2f%%;width:%.2f%%;height:%.2f%%"
            % (left / width_emu * 100, top / height_emu * 100,
               width / width_emu * 100, height / height_emu * 100)
        )
        positioned.append('<div class="box" style="%s">%s</div>' % (style, body))

    return (
        '<figure class="slide">'
        '<div class="canvas" style="height:%dpx">%s</div>'
        '%s'
        '<figcaption>%d / %d</figcaption>'
        "</figure>"
    ) % (height_px, "".join(positioned),
         ('<div class="extra">%s</div>' % "".join(loose)) if loose else "",
         number, total)


def render_deck(pres, has_design: bool) -> str:
    total = len(pres.slides)
    cards = "".join(
        _render_slide(pres, slide, index + 1, total)
        for index, slide in enumerate(pres.slides)
    )
    note = ('<p class="note">%s</p>' % DESIGN_NOTE) if has_design else ""
    return PAGE % {"count": total, "note": note, "cards": cards,
                   "width": CARD_WIDTH_PX}


TOKEN_TTL_SECONDS = int(os.environ.get("PPTX_PREVIEW_TTL", str(2 * 60 * 60)))
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")

"""token -> (deck, has_design, expires_at).

The token holds the Presentation *object*, not an id to look up later: the tools
mutate that same object in place, so the page always renders the deck as it
stands, and the route needs no request context and no cross-module lookup. The
unguessable token is the credential, exactly as it is for /download.
"""
_tokens: Dict[str, Tuple[object, bool, float]] = {}

EXPIRED = "This preview link has expired — ask GiesChat to preview the deck again."


def _sweep() -> None:
    now = time.time()
    for token in [t for t, entry in _tokens.items() if entry[2] < now]:
        _tokens.pop(token, None)


def mint(pres, has_design: bool) -> str:
    _sweep()
    token = secrets.token_urlsafe(24)
    _tokens[token] = (pres, has_design, time.time() + TOKEN_TTL_SECONDS)
    return token


def preview_url(pres, has_design: bool) -> str:
    return "%s/preview/%s" % (PUBLIC_URL, mint(pres, has_design))


async def preview(request: Request):
    token = request.path_params["token"]
    entry = _tokens.get(token)
    if not entry or entry[2] < time.time():
        _tokens.pop(token, None)
        return PlainTextResponse(EXPIRED, status_code=404)
    pres, has_design, _ = entry
    return HTMLResponse(render_deck(pres, has_design))


FENCE = (
    "Deck preview ready. Post EXACTLY this artifact block so the slides open in "
    "the side panel, then ask the user to approve or name a change:\n"
    ':::artifact{identifier="deck-preview" type="application/vnd.external-url" '
    'title="<deck title>"}\n%s\n:::'
)


def register_preview_tools(app, presentations, get_current_presentation_id) -> None:
    from gies_auth import current_user
    from gies_uploads import has_design
    from utils import presentation_utils as ppt_utils

    @app.tool()
    def preview_presentation(presentation_id: Optional[str] = None) -> Dict:
        """Render the current deck and return a URL that shows it to the user.

        Call this after building or editing slides, before asking for approval.
        Each call returns a NEW url — always post the newest one."""
        pres_id = (presentation_id if presentation_id is not None
                   else get_current_presentation_id())
        if pres_id is None or pres_id not in presentations:
            return {"error": "No presentation is currently loaded or the specified ID is invalid"}
        pres = presentations[pres_id]
        autosave = ppt_utils.save_presentation(pres, "%s-autosave.pptx" % pres_id)
        url = preview_url(pres, has_design(current_user()))
        return {
            "preview_url": url,
            "autosave_path": autosave,
            "slide_count": len(pres.slides),
            "message": FENCE % url,
        }


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Deck preview</title><style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:16px; background:#f4f5f7; color:#1f2937;
         font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { display:flex; align-items:baseline; gap:10px; margin-bottom:12px; }
  header b { font-size:14px; }
  .note { margin:0; font-size:12px; color:#6b7280; }
  .slide { margin:0 0 14px; background:#fff; border:1px solid #e3e3e3;
           border-radius:6px; max-width:%(width)spx; position:relative;
           box-shadow:0 1px 2px rgba(0,0,0,.06); }
  .canvas { position:relative; overflow:hidden; }
  .box { position:absolute; overflow:hidden; padding:2px 4px; font-size:12px; }
  .box:first-child { font-weight:700; color:#13294b; font-size:15px; }
  .ph { display:inline-block; width:100%%; height:100%%; border:1px dashed #b9c7dc;
        border-radius:4px; color:#9ca3af; font-size:11px; text-align:center; }
  .extra { border-top:1px dashed #e3e3e3; padding:6px 8px; font-size:12px; color:#4b5563; }
  figcaption { position:absolute; right:8px; bottom:5px; font-size:10px; color:#9ca3af; }
  @media (prefers-color-scheme: dark) {
    body { background:#171717; color:#ececec; }
    .slide { background:#212121; border-color:#3a3a3a; }
    .box:first-child { color:#8ab4f8; }
    .extra { color:#cfcfcf; border-color:#3a3a3a; }
  }
</style></head><body>
<header><b>%(count)s slides</b>%(note)s</header>
%(cards)s
</body></html>"""
