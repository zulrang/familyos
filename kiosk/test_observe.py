import base64
import hashlib
import importlib.util
import json
import os
import socket
import struct
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location("observe", Path(__file__).with_name("observe.py"))
observe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observe)


def send_frame(sock, message):
    payload = json.dumps(message).encode()
    head = b"\x81" + (bytes([len(payload)]) if len(payload) < 126 else b"\x7e" + struct.pack(">H", len(payload)))
    sock.sendall(head + payload)


def read_frame(sock):
    head = sock.recv(2)
    if not head:
        return None
    n = head[1] & 127
    if n == 126:
        n = struct.unpack(">H", sock.recv(2))[0]
    mask = sock.recv(4)
    body = bytearray()
    while len(body) < n:
        chunk = sock.recv(n - len(body))
        if not chunk:
            return None
        body.extend(chunk)
    return json.loads(bytes(b ^ mask[i % 4] for i, b in enumerate(body)))


class FakeCDP(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    mode = "healthy"
    target_url = "http://familyos.local/rewards"
    ready_mode = "healthy"
    version_mode = "healthy"
    pages_mode = "healthy"

    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path == "/api/ready":
            if self.ready_mode == "http_error":
                self.send_error(503)
                return
            data = ["wrong shape"] if self.ready_mode == "malformed" else {"ready": self.ready_mode != "not_ready", "buildId": "build-123"}
        elif self.path == "/slow":
            self.send_response(200)
            self.send_header("Content-Length", "10")
            self.end_headers()
            try:
                for _ in range(10):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.05)
            except OSError:
                pass
            return
        elif self.path == "/json/version":
            data = ["wrong shape"] if self.version_mode == "malformed" else {"webSocketDebuggerUrl": f"ws://127.0.0.1:{self.server.server_port}/browser"}
        elif self.path == "/json/list":
            data = {"wrong": "shape"} if self.pages_mode == "malformed" else [17, {"type": "page", "url": self.target_url, "webSocketDebuggerUrl": f"ws://127.0.0.1:{self.server.server_port}/page"}]
        else:
            self.send_error(404)
            return
        raw = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_upgrade(self):
        self.close_connection = True
        key = self.headers["Sec-WebSocket-Key"]
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.send_response(101)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        if self.mode == "disconnect":
            return
        self.connection.settimeout(1)
        try:
            while True:
                command = read_frame(self.connection)
                if not command:
                    return
                method = command["method"]
                if method == "Browser.getVersion":
                    send_frame(self.connection, ["wrong shape"] if self.mode == "malformed_frame" else {"id": command["id"], "result": {"product": "Chrome/130.0.1"}})
                elif method == "Runtime.evaluate":
                    if self.mode == "malformed_frame":
                        send_frame(self.connection, ["wrong shape"])
                        continue
                    if self.mode == "stall":
                        time.sleep(0.5)
                        continue
                    if self.mode == "trickle":
                        try:
                            for part in (b"\x81", b"\x02", b"{", b"}"):
                                self.connection.sendall(part)
                                time.sleep(0.08)
                        except OSError:
                            pass
                        continue
                    send_frame(self.connection, {"id": command["id"], "result": {"result": {"value": 2}}})
                    send_frame(self.connection, {"method": "Runtime.exceptionThrown", "params": {"exceptionDetails": {"text": "SECRET exception", "url": "https://private.example/path?token=SECRET", "exception": {"className": "TypeError"}}}})
                    send_frame(self.connection, {"method": "Network.requestWillBeSent", "params": {"requestId": "SECRET-id", "timestamp": 1, "request": {"url": "http://familyos.local/api/rewards/SECRET?token=SECRET"}, "type": "Fetch"}})
                    send_frame(self.connection, {"method": "Network.loadingFailed", "params": {"requestId": "SECRET-id", "timestamp": 3, "errorText": "net::ERR_CONNECTION_RESET SECRET"}})
        except (OSError, BrokenPipeError):
            pass

    def handle_one_request(self):
        try:
            self.raw_requestline = self.rfile.readline(65537)
            if not self.raw_requestline or not self.parse_request():
                return
            if self.headers.get("Upgrade") == "websocket":
                self.do_upgrade()
            else:
                self.do_GET()
        except OSError:
            pass


class ObserveTests(unittest.TestCase):
    def test_timeout_recovery_disconnect_and_private_events(self):
        observe.TIMEOUT = 0.15
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCDP)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        with tempfile.TemporaryDirectory() as directory:
            journal = observe.Journal(directory)
            page = observe.PageProbe(base, observe.origin("http://familyos.local"), journal)
            try:
                FakeCDP.mode = "stall"
                stalled = observe.sample(journal, page, base, base + "/api/ready")
                self.assertEqual(stalled["verdict"], "renderer_unresponsive")
                self.assertEqual(stalled["browser"], "healthy")
                FakeCDP.mode = "healthy"
                recovered = observe.sample(journal, page, base, base + "/api/ready")
                self.assertEqual(recovered["verdict"], "healthy")
                page.drain(time.monotonic() + 0.1)
                data = Path(directory, "observe.jsonl").read_text()
                self.assertIn('"route":"/api/rewards"', data)
                self.assertIn('"exception":"TypeError"', data)
                self.assertNotIn("SECRET", data)
                self.assertNotIn("private.example", data)
                page.event({"method": "Network.requestWillBeSent", "params": {
                    "requestId": "SECRET-pending", "timestamp": 4,
                    "request": {"url": "http://familyos.local/api/rewards/SECRET?token=SECRET"},
                    "type": "Fetch"}})
                FakeCDP.mode = "stall"
                observe.sample(journal, page, base, base + "/api/ready")
                self.assertIn('"kind":"tracking_reset"', Path(directory, "observe.jsonl").read_text())
                self.assertIn('"pending":1', Path(directory, "observe.jsonl").read_text())
                FakeCDP.mode = "healthy"
                self.assertEqual(observe.sample(journal, page, base, base + "/api/ready")["renderer"], "healthy")
                page.event({"method": "Network.requestWillBeSent", "params": {
                    "requestId": "SECRET-browser-pending", "timestamp": 5,
                    "request": {"url": "http://familyos.local/api/events?secret=SECRET"}, "type": "Fetch"}})
                FakeCDP.mode = "disconnect"
                disconnected = observe.sample(journal, page, base, base + "/api/ready")
                self.assertEqual(disconnected["browser"], "unavailable")
                self.assertIn('"route"', Path(directory, "observe.jsonl").read_text())
                self.assertIn('"/api/events":1', Path(directory, "observe.jsonl").read_text())
            finally:
                page.close()
                server.shutdown()
                server.server_close()

    def test_rotation_and_classification(self):
        old = observe.MAX_LOG_BYTES
        observe.MAX_LOG_BYTES = 180
        try:
            with tempfile.TemporaryDirectory() as directory:
                journal = observe.Journal(directory)
                for number in range(30):
                    journal.write("sample", number=number)
                files = list(Path(directory).iterdir())
                self.assertLessEqual(len(files), observe.LOG_FILES)
                self.assertTrue(all((path.stat().st_mode & 0o077) == 0 for path in files))
                self.assertIn('"number":29', Path(directory, "observe.jsonl").read_text())
        finally:
            observe.MAX_LOG_BYTES = old
        self.assertEqual(observe.classify("unavailable", "healthy", "healthy"), "server_unreachable")
        self.assertEqual(observe.classify("healthy", "unavailable", "unavailable"), "browser_unreachable")
        self.assertEqual(observe.route_bucket("https://x/api/rewards/SECRET?key=SECRET", observe.origin("https://x")), "/api/rewards")
        self.assertEqual(observe.route_bucket("https://x/api/events?calendarId=SECRET", observe.origin("https://x")), "/api/events")
        self.assertEqual(observe.route_bucket("https://external.example/api/rewards/SECRET", observe.origin("https://x")), "other")
        self.assertEqual(observe.route_bucket("https://x/private/SECRET", observe.origin("https://x")), "other")
        self.assertEqual(observe.ready_url("http://127.0.0.1:3000/rewards?token=SECRET"), "http://127.0.0.1:3000/api/ready")
        self.assertEqual(observe.ready_url("http://mac.local:3000/"), "http://mac.local:3000/api/ready")
        self.assertEqual(observe.cpu_ticks("42 (chromium) S " + "0 " * 10 + "17 23 0"), 40)

    def test_deadlines_and_kiosk_target_selection(self):
        observe.TIMEOUT = 0.15
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCDP)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        with tempfile.TemporaryDirectory() as directory:
            page = observe.PageProbe(base, observe.origin("http://familyos.local"), observe.Journal(directory))
            try:
                FakeCDP.target_url = "https://accounts.google.com/private"
                self.assertEqual(page.probe(), "unavailable")
                FakeCDP.target_url = "http://familyos.local/rewards"
                FakeCDP.mode = "trickle"
                started = time.monotonic()
                self.assertEqual(page.probe(), "timeout")
                self.assertLess(time.monotonic() - started, 0.3)
                started = time.monotonic()
                with self.assertRaises((TimeoutError, socket.timeout)):
                    observe.http_json(base + "/slow")
                self.assertLess(time.monotonic() - started, 0.3)
            finally:
                FakeCDP.mode = "healthy"
                FakeCDP.target_url = "http://familyos.local/rewards"
                page.close()
                server.shutdown()
                server.server_close()

    def test_readiness_distinguishes_unhealthy_from_unreachable(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCDP)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}/api/ready"
        try:
            FakeCDP.ready_mode = "not_ready"
            self.assertEqual(observe.server_probe(base), ("not_ready", None, 200))
            self.assertEqual(observe.classify("not_ready", "healthy", "healthy"), "server_unhealthy")
            FakeCDP.ready_mode = "http_error"
            self.assertEqual(observe.server_probe(base), ("http_error", None, 503))
            self.assertEqual(observe.classify("http_error", "healthy", "healthy"), "server_unhealthy")
            FakeCDP.ready_mode = "malformed"
            self.assertEqual(observe.server_probe(base), ("unavailable", None, None))
        finally:
            FakeCDP.ready_mode = "healthy"
            server.shutdown()
            server.server_close()

    def test_malformed_cdp_shapes_do_not_stop_sampling(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCDP)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        with tempfile.TemporaryDirectory() as directory:
            journal = observe.Journal(directory)
            page = observe.PageProbe(base, observe.origin("http://familyos.local"), journal)
            try:
                FakeCDP.version_mode = "malformed"
                self.assertEqual(observe.sample(journal, page, base, base + "/api/ready")["browser"], "unavailable")
                FakeCDP.version_mode = "healthy"
                FakeCDP.pages_mode = "malformed"
                self.assertEqual(observe.sample(journal, page, base, base + "/api/ready")["renderer"], "unavailable")
                FakeCDP.pages_mode = "healthy"
                FakeCDP.mode = "malformed_frame"
                self.assertEqual(observe.browser_probe(base)[0], "unavailable")
                self.assertEqual(page.probe(), "unavailable")
                page.event({"method": "Network.loadingFailed", "params": {"requestId": []}})
                page.event({"method": "Runtime.exceptionThrown", "params": {"exceptionDetails": {"exception": {"className": []}}}})
            finally:
                FakeCDP.version_mode = "healthy"
                FakeCDP.pages_mode = "healthy"
                FakeCDP.mode = "healthy"
                page.close()
                server.shutdown()
                server.server_close()

    def test_event_limit_reports_suppressed_count_before_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = observe.Journal(directory)
            page = observe.PageProbe("http://127.0.0.1:1", observe.origin("http://familyos.local"), journal)
            for _ in range(65):
                page.event({"method": "Runtime.exceptionThrown", "params": {
                    "exceptionDetails": {"text": "SECRET", "exception": {"className": "TypeError"}}}})
            page.close()
            records = [json.loads(line) for line in Path(directory, "observe.jsonl").read_text().splitlines()]
            self.assertEqual(len([record for record in records if record["kind"] == "exception"]), 60)
            self.assertEqual(records[-1]["kind"], "events_dropped")
            self.assertEqual(records[-1]["count"], 5)
            self.assertNotIn("SECRET", Path(directory, "observe.jsonl").read_text())


if __name__ == "__main__":
    unittest.main()
