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
from typing import List, Optional, Tuple

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
