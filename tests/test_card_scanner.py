import re
import urllib.error
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


# ---------- serve --ocr-backend: same-origin proxy to a MiniCPM-OCR server ----------
import json
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from card_scanner.cli import make_server


class _FakeOCR(BaseHTTPRequestHandler):
    seen: list = []

    def _reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802
        self.seen.append(("GET", self.path, self.headers.get("Authorization"), None))
        self._reply(200, {"data": [{"id": "minicpm-ocr"}]})

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.seen.append(("POST", self.path, self.headers.get("Authorization"), body))
        if body.get("model") != "minicpm-ocr":
            return self._reply(404, {"error": "model not found"})
        self._reply(200, {"choices": [{"message": {"content": "王大明\nM: 0912-345-678"}, "finish_reason": "stop"}]})

    def log_message(self, *a):
        pass


def _start(server):
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return server


def test_serve_proxies_minicpm_and_keeps_key_server_side(tmp_path):
    _FakeOCR.seen = []
    backend = _start(ThreadingHTTPServer(("127.0.0.1", 0), _FakeOCR))
    (tmp_path / "index.html").write_text("ok", encoding="utf-8")
    url = f"http://127.0.0.1:{backend.server_address[1]}"
    app = _start(make_server("127.0.0.1", 0, str(tmp_path), url, "secret-key"))
    base = f"http://127.0.0.1:{app.server_address[1]}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        assert opener.open(base + "/index.html").read() == b"ok"
        models = json.loads(opener.open(base + "/minicpm/v1/models").read())
        assert models["data"][0]["id"] == "minicpm-ocr"
        req = urllib.request.Request(base + "/minicpm/v1/chat/completions", method="POST",
                                     data=json.dumps({"model": "minicpm-ocr", "messages": []}).encode(),
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer from-browser"})
        out = json.loads(opener.open(req).read())
        assert out["choices"][0]["message"]["content"].startswith("王大明")
        # the server-side key replaces whatever the browser sent
        assert [s[2] for s in _FakeOCR.seen] == ["Bearer secret-key", "Bearer secret-key"]
        assert _FakeOCR.seen[1][1] == "/v1/chat/completions"
        # backend errors are passed through; non-API paths are not proxied
        bad = urllib.request.Request(base + "/minicpm/v1/chat/completions", method="POST",
                                     data=json.dumps({"model": "other"}).encode(), headers={"Content-Type": "application/json"})
        with pytest.raises(urllib.error.HTTPError) as e:
            opener.open(bad)
        assert e.value.code == 404
        with pytest.raises(urllib.error.HTTPError) as e:
            opener.open(base + "/minicpm/admin")
        assert e.value.code == 404
    finally:
        app.shutdown()
        backend.shutdown()


def test_serve_without_backend_returns_404_for_proxy(tmp_path):
    app = _start(make_server("127.0.0.1", 0, str(tmp_path)))
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with pytest.raises(urllib.error.HTTPError) as e:
            opener.open(f"http://127.0.0.1:{app.server_address[1]}/minicpm/v1/models")
        assert e.value.code == 404
    finally:
        app.shutdown()
