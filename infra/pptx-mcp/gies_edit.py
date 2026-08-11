"""Delete and reorder slides — the two structural edits python-pptx omits.

Both operate on `prs.slides._sldIdLst`, the ordered list of slide-id elements in
the presentation part. Deleting also has to drop the relationship: leaving it
behind keeps the slide part inside the saved .pptx, so the file still carries a
slide the deck no longer shows.

Editing in place is what makes "change slide 7" cheap — the alternative is
rebuilding the whole deck for a one-slide change.
"""
from typing import Dict, Optional

NO_DECK = "No presentation is currently loaded or the specified ID is invalid"


def _out_of_range(index: int, count: int) -> bool:
    return index < 0 or index >= count


def delete(pres, index: int) -> None:
    slide_ids = pres.slides._sldIdLst
    entry = list(slide_ids)[index]
    pres.part.drop_rel(entry.rId)
    slide_ids.remove(entry)


def move(pres, from_index: int, to_index: int) -> None:
    slide_ids = pres.slides._sldIdLst
    entry = list(slide_ids)[from_index]
    slide_ids.remove(entry)
    slide_ids.insert(to_index, entry)


def register_edit_tools(app, presentations, get_current_presentation_id) -> None:
    def _resolve(presentation_id: Optional[str]):
        pres_id = (presentation_id if presentation_id is not None
                   else get_current_presentation_id())
        if pres_id is None or pres_id not in presentations:
            return None
        return presentations[pres_id]

    @app.tool()
    def delete_slide(slide_index: int, presentation_id: Optional[str] = None) -> Dict:
        """Remove one slide. slide_index is 0-based: the user's "slide 7" is 6."""
        pres = _resolve(presentation_id)
        if pres is None:
            return {"error": NO_DECK}
        count = len(pres.slides)
        if _out_of_range(slide_index, count):
            return {"error": "Invalid slide index: %d. Available slides: 0-%d"
                             % (slide_index, count - 1)}
        delete(pres, slide_index)
        return {"message": "Deleted slide %d." % slide_index,
                "slide_count": len(pres.slides)}

    @app.tool()
    def move_slide(from_index: int, to_index: int,
                   presentation_id: Optional[str] = None) -> Dict:
        """Move one slide to another position. Both indices are 0-based.

        To insert a new slide in the middle: add_slide (it appends), then move it."""
        pres = _resolve(presentation_id)
        if pres is None:
            return {"error": NO_DECK}
        count = len(pres.slides)
        if _out_of_range(from_index, count) or _out_of_range(to_index, count):
            return {"error": "Invalid slide index. Available slides: 0-%d" % (count - 1)}
        move(pres, from_index, to_index)
        return {"message": "Moved slide %d to position %d." % (from_index, to_index),
                "slide_count": len(pres.slides)}
