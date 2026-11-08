"""Command line: build the static page, or serve it locally for use on this computer / the LAN.

`serve --ocr-backend URL` also proxies ``/minicpm/...`` to a MiniCPM-OCR server (llama-server,
Ollama or vLLM, OpenAI-compatible API). The page and the OCR API then share one origin, so the
browser needs no CORS setup, phones on the LAN can use a model running on this computer, and an
API key for the backend stays on the server.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import socket
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from .page import write_site

PROXY_PREFIX = "/minicpm/"
MAX_BODY = 40 * 1024 * 1024  # a base64 card photo is a few MB; refuse anything absurd


def _lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files, plus an optional reverse proxy for the OCR backend under /minicpm/."""

    backend: str | None = None
    backend_key: str | None = None
    timeout: float = 300.0

    def _proxy(self, method: str) -> None:
        if not self.backend:
            self.send_error(404, "OCR backend not configured (start serve with --ocr-backend)")
            return
        rest = self.path[len(PROXY_PREFIX):].lstrip("/")
        if not (rest.startswith("v1/") or rest in ("health", "v1")):
            self.send_error(404, "only the OpenAI-compatible /v1 API is proxied")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self.send_error(413, "request too large")
            return
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(self.backend.rstrip("/") + "/" + rest, data=body, method=method)
        req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))
        key = self.backend_key or None
        auth = self.headers.get("Authorization")
        if key:
            req.add_header("Authorization", f"Bearer {key}")
        elif auth:
            req.add_header("Authorization", auth)
        # the backend is usually on this machine: never route it through an HTTP(S)_PROXY
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(req, timeout=self.timeout) as resp:
                status, ctype, data = resp.status, resp.headers.get("Content-Type", "application/json"), resp.read()
        except urllib.error.HTTPError as e:
            status, ctype, data = e.code, e.headers.get("Content-Type", "text/plain"), e.read()
        except (urllib.error.URLError, OSError) as e:
            status, ctype, data = 502, "text/plain; charset=utf-8", f"OCR backend unreachable: {e}".encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # noqa: N802 (http.server naming)
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("POST")
        self.send_error(405)

    def log_message(self, fmt, *args):  # quieter: skip the per-file static noise
        if self.path.startswith(PROXY_PREFIX) or not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def make_server(host: str, port: int, directory: str, backend: str | None = None, backend_key: str | None = None):
    handler = type("BoundHandler", (Handler,), {"backend": backend, "backend_key": backend_key})
    return http.server.ThreadingHTTPServer((host, port), functools.partial(handler, directory=directory))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m card_scanner", description="名片 OCR 辨識資料庫")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="產生單一檔案的網頁(index.html)")
    b.add_argument("-o", "--out", default="dist", help="輸出資料夾(預設 dist)")
    s = sub.add_parser("serve", help="在本機啟動網頁伺服器")
    s.add_argument("--host", default="127.0.0.1", help="要讓同網段的手機使用請設 0.0.0.0")
    s.add_argument("--port", type=int, default=8780)
    s.add_argument("--ocr-backend", metavar="URL",
                   help="MiniCPM-OCR 伺服器(llama-server / Ollama / vLLM),例如 http://127.0.0.1:18499;網頁以 /minicpm 呼叫")
    s.add_argument("--ocr-api-key", metavar="KEY", help="後端需要的 API 金鑰(只留在伺服器,不會傳到瀏覽器)")
    args = ap.parse_args(argv)

    if args.cmd == "build":
        page = write_site(args.out)
        print(f"wrote {page}")
        return 0

    out = Path(tempfile.mkdtemp(prefix="card_scanner_"))
    write_site(out)
    with make_server(args.host, args.port, str(out), args.ocr_backend, args.ocr_api_key) as httpd:
        print(f"名片庫: http://{'127.0.0.1' if args.host in ('127.0.0.1', 'localhost') else args.host}:{args.port}/")
        if args.ocr_backend:
            print(f"MiniCPM-OCR 代理: /minicpm → {args.ocr_backend}(設定裡的伺服器網址填 /minicpm,開啟時會自動偵測)")
        if args.host == "0.0.0.0" and (ip := _lan_ip()):
            print(f"同網段的手機: http://{ip}:{args.port}/ (資料存在各自的瀏覽器裡,手機與電腦不共用)")
            if args.ocr_backend:
                print("注意:任何連得到這台電腦的人都能透過 /minicpm 使用辨識伺服器")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0
