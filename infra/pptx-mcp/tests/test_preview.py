import importlib

import httpx
import pytest
from pptx import Presentation
from pptx.util import Inches
from starlette.applications import Starlette
from starlette.routing import Route

import gies_preview as gp


def _module(name):
    """Resolve a gies module through sys.modules, never a stale reference.

    tests/test_e2e.py deletes and re-imports the whole stack, so a module-level
    `import gies_state` here can end up pointing at the pre-teardown object while
    the code under test resolves the new one.
    """
    return importlib.import_module(name)


@pytest.fixture(autouse=True)
def _reset(monkeypatch, tmp_path):
    gp._tokens.clear()
    state = _module("gies_state")
    state._store.clear()
    state._current.clear()
    _module("gies_uploads")._attached.clear()
    _module("gies_auth")._user.set("alice")
    monkeypatch.setattr(gp, "PUBLIC_URL", "http://t")
    # SANDBOX_ROOT is read at import time, so setenv would be ignored here.
    monkeypatch.setattr(_module("gies_sandbox"), "SANDBOX_ROOT", tmp_path)
    yield


def _deck(titles):
    """A deck using the built-in 'Title and Content' layout, one slide per title."""
    pres = Presentation()
    for title in titles:
        slide = pres.slides.add_slide(pres.slide_layouts[1])
        slide.shapes.title.text = title
        slide.placeholders[1].text_frame.text = f"body of {title}"
    return pres


def _png():
    """Smallest valid 1x1 PNG, as a file-like object python-pptx accepts."""
    import io, base64
    data = base64.b64decode(
        b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    return io.BytesIO(data)


def test_one_card_per_slide_numbered_from_one():
    html = gp.render_deck(_deck(["Alpha", "Beta", "Gamma"]), False)
    assert html.count('class="slide"') == 3
    assert "1 / 3" in html and "2 / 3" in html and "3 / 3" in html
    assert "0 / 3" not in html


def test_slide_text_is_rendered_and_escaped():
    html = gp.render_deck(_deck(["<script>alert(1)</script>"]), False)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_shape_without_text_renders_a_placeholder_box():
    pres = Presentation()
    slide = pres.slides.add_slide(pres.slide_layouts[6])   # blank
    slide.shapes.add_picture(_png(), Inches(1), Inches(1), Inches(2), Inches(2))
    html = gp.render_deck(pres, False)
    assert 'class="ph"' in html
    assert "picture" in html


def test_positions_come_from_the_real_geometry():
    pres = Presentation()
    slide = pres.slides.add_slide(pres.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(0), Inches(0), Inches(5), Inches(1))
    box.text_frame.text = "top left"
    html = gp.render_deck(pres, False)
    assert "left:0.00%" in html
    assert "top:0.00%" in html


def test_design_note_only_when_a_template_was_uploaded():
    assert "styled with your template" not in gp.render_deck(_deck(["A"]), False)
    assert "styled with your template" in gp.render_deck(_deck(["A"]), True)


def _client():
    app = Starlette(routes=[Route("/preview/{token}", gp.preview)])
    return httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://t")


class _App:
    """Collects the functions register_preview_tools decorates."""

    def __init__(self):
        self.tools = {}

    def tool(self, *a, **k):
        def wrap(fn):
            self.tools[fn.__name__] = fn
            return fn
        return wrap


def _tools():
    state = _module("gies_state")
    app = _App()
    gp.register_preview_tools(app, state.ScopedPresentations(),
                              state.get_current_presentation_id)
    return app.tools


@pytest.mark.asyncio
async def test_preview_renders_the_live_deck():
    url = gp.preview_url(_deck(["Alpha", "Beta"]), False)
    assert url.startswith("http://t/preview/")
    async with _client() as c:
        r = await c.get(url.replace("http://t", ""))
    assert r.status_code == 200
    assert "Alpha" in r.text and "1 / 2" in r.text
    assert r.headers["content-type"].startswith("text/html")


@pytest.mark.asyncio
async def test_preview_reflects_edits_made_after_minting():
    pres = _deck(["Alpha", "Beta"])
    url = gp.preview_url(pres, False).replace("http://t", "")
    pres.slides[0].shapes.title.text = "Rewritten"
    async with _client() as c:
        r = await c.get(url)
    assert "Rewritten" in r.text and ">Alpha<" not in r.text


@pytest.mark.asyncio
async def test_design_note_rides_on_the_token():
    url = gp.preview_url(_deck(["Alpha"]), True).replace("http://t", "")
    async with _client() as c:
        r = await c.get(url)
    assert gp.DESIGN_NOTE in r.text


@pytest.mark.asyncio
async def test_unknown_token_404():
    async with _client() as c:
        r = await c.get("/preview/nope")
    assert r.status_code == 404 and "expired" in r.text


@pytest.mark.asyncio
async def test_expired_token_404(monkeypatch):
    monkeypatch.setattr(gp, "TOKEN_TTL_SECONDS", -1)
    url = gp.preview_url(_deck(["Alpha"]), False).replace("http://t", "")
    async with _client() as c:
        r = await c.get(url)
    assert r.status_code == 404 and "expired" in r.text


@pytest.mark.asyncio
async def test_a_token_only_ever_renders_its_own_deck():
    mine = gp.preview_url(_deck(["Mine"]), False).replace("http://t", "")
    gp.preview_url(_deck(["Theirs"]), False)
    async with _client() as c:
        r = await c.get(mine)
    assert "Mine" in r.text and "Theirs" not in r.text


def test_expired_tokens_are_swept_on_mint(monkeypatch):
    monkeypatch.setattr(gp, "TOKEN_TTL_SECONDS", -1)
    gp.preview_url(_deck(["Alpha"]), False)
    assert len(gp._tokens) == 1
    gp.preview_url(_deck(["Beta"]), False)
    assert len(gp._tokens) == 1


def test_tool_returns_url_and_autosaves():
    import os
    state = _module("gies_state")
    state.ScopedPresentations()["deck-1"] = _deck(["Alpha", "Beta"])
    result = _tools()["preview_presentation"]("deck-1")
    assert result["preview_url"].startswith("http://t/preview/")
    assert result["slide_count"] == 2
    assert result["autosave_path"].endswith(".pptx")
    assert os.path.exists(result["autosave_path"])
    assert result["message"].startswith("Deck preview ready")
    assert ':::artifact{identifier="deck-preview"' in result["message"]


def test_tool_errors_when_no_deck_is_loaded():
    assert "error" in _tools()["preview_presentation"]()
