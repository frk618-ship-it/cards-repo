"""Build the single-file card scanner page: web/template.html with the CSS and JS inlined.

One self-contained file, so it can be hosted anywhere static (GitHub Pages, an intranet web
server, a shared drive) or simply opened from disk.
"""

from __future__ import annotations

from pathlib import Path

WEB = Path(__file__).with_name("web")
# load order matters: app.js uses the globals the others define
SCRIPTS = ["parser.js", "search.js", "store.js", "imaging.js", "ocr.js", "camera.js", "app.js"]


def render_page() -> str:
    html = (WEB / "template.html").read_text(encoding="utf-8")
    css = (WEB / "style.css").read_text(encoding="utf-8")
    js = "\n".join(f"/* ---- {name} ---- */\n" + (WEB / name).read_text(encoding="utf-8") for name in SCRIPTS)
    if "</script" in js.lower():
        raise ValueError("inline script must not contain '</script'")
    html = html.replace("/*__CSS__*/", css, 1)
    return html.replace("/*__JS__*/", js, 1)


def write_site(out_dir: str | Path) -> Path:
    """Write ``index.html`` to `out_dir`."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    page = out_dir / "index.html"
    page.write_text(render_page(), encoding="utf-8")
    return page
