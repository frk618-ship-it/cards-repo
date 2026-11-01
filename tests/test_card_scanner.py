import re
import shutil
import subprocess
from pathlib import Path

import pytest

from card_scanner.cli import main
from card_scanner.page import SCRIPTS, WEB, render_page

ROOT = Path(__file__).resolve().parents[1]


def test_render_page_inlines_everything():
    html = render_page()
    assert "/*__CSS__*/" not in html and "/*__JS__*/" not in html
    assert html.count("<script>") == 1
    for name in SCRIPTS:
        assert f"/* ---- {name} ---- */" in html
    assert 'id="q"' in html and 'id="rail"' in html and 'id="dlg-edit"' in html
    for url in re.findall(r"https://cdn\.jsdelivr\.net/npm/[^'\"]+", html):
        assert re.search(r"@\d+\.\d+\.\d+/", url), url  # only pinned CDN versions


def test_cli_build(tmp_path, capsys):
    assert main(["build", "-o", str(tmp_path / "out")]) == 0
    assert (tmp_path / "out" / "index.html").read_text(encoding="utf-8") == render_page()
    assert "wrote" in capsys.readouterr().out


def test_dist_is_up_to_date():
    """dist/index.html is committed for direct download; rebuild with `python -m card_scanner build`."""
    assert (ROOT / "dist" / "index.html").read_text(encoding="utf-8") == render_page()


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_parser_and_search_js():
    r = subprocess.run(["node", "--test", str(ROOT / "tests" / "js" / "card_scanner.test.cjs")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr


def test_sources_exist():
    for name in SCRIPTS + ["template.html", "style.css"]:
        assert (WEB / name).is_file()
