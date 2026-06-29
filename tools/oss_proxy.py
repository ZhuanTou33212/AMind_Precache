"""
AMiner OSS image proxy.

Redirected image requests arrive here from the browser extension. The proxy
serves cached images from the desktop app first, then falls back to OSS.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime
import json
import urllib.error
import urllib.parse
import urllib.request


DESKTOP_APP = "http://127.0.0.1:9800"
LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 9801

stats = {"hit": 0, "miss": 0, "error": 0, "total": 0}


class ProxyHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path in ("/", "/health"):
            self._json(stats)
            return

        if parsed.query.startswith("url="):
            oss_url = urllib.parse.unquote(parsed.query[4:])
        else:
            params = urllib.parse.parse_qs(parsed.query)
            oss_url = params.get("url", [""])[0]
        stats["total"] += 1

        if not oss_url:
            self.send_error(400, "Missing url parameter")
            return

        try:
            cached_list = self._desktop_images()
            for img in cached_list:
                if img.get("url") == oss_url:
                    img_hash = img["hash"]
                    data = urllib.request.urlopen(
                        f"{DESKTOP_APP}/api/image/{urllib.parse.quote(img_hash)}",
                        timeout=10,
                    ).read()
                    stats["hit"] += 1
                    self._serve(data, "HIT")
                    print(f"  [{datetime.now():%H:%M:%S}] HIT  {oss_url[:80]}")
                    return

            print(f"  [{datetime.now():%H:%M:%S}] MISS {oss_url[:80]}")
            data = urllib.request.urlopen(oss_url, timeout=15).read()
            stats["miss"] += 1
            self._serve(data, "MISS")
            self._cache_in_desktop(oss_url)
        except urllib.error.HTTPError as e:
            stats["error"] += 1
            self.send_error(e.code, f"Upstream error: {e.reason}")
        except Exception as e:
            stats["error"] += 1
            self.send_error(502, str(e))

    def _desktop_images(self):
        response = urllib.request.urlopen(f"{DESKTOP_APP}/api/images", timeout=3)
        data = json.loads(response.read())
        return data if isinstance(data, list) else []

    def _cache_in_desktop(self, oss_url):
        try:
            req = urllib.request.Request(
                f"{DESKTOP_APP}/api/cache",
                data=json.dumps({"url": oss_url, "questionNum": 0}).encode(),
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve(self, data, status):
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("X-Cache-Status", status)
        self.end_headers()
        self.wfile.write(data)


def main():
    print(f"  AMiner OSS Proxy starting on {LISTEN_HOST}:{LISTEN_PORT}")
    print(f"  Desktop app: {DESKTOP_APP}")
    print("  Press Ctrl+C to stop")
    print()

    try:
        response = urllib.request.urlopen(f"{DESKTOP_APP}/api/images", timeout=3)
        cached = json.loads(response.read())
        count = len(cached) if isinstance(cached, list) else "?"
        print(f"  Desktop app OK - {count} images cached")
    except Exception:
        print(f"  WARNING: Desktop app not reachable at {DESKTOP_APP}")

    print()

    server = HTTPServer((LISTEN_HOST, LISTEN_PORT), ProxyHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n  Shutting down. Stats: {json.dumps(stats)}")
        server.shutdown()


if __name__ == "__main__":
    main()
