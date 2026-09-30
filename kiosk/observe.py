#!/usr/bin/env python3
"""Private, bounded diagnostics for the wall kiosk. No browser credentials are read."""

import argparse
import base64
import collections
import datetime
import hashlib
import json
import os
import re
import select
import signal
import socket
import struct
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.error import HTTPError
from urllib.request import urlopen

INTERVAL = 30
TIMEOUT = 1.5
MAX_FRAME = 256 * 1024
MAX_REQUESTS = 128
MAX_LOG_BYTES = 2 * 1024 * 1024
LOG_FILES = 4
ROUTES = frozenset(("auth", "calendars", "displays", "events", "lists", "mcp", "pair", "photos", "ready", "rewards", "settings", "tasklists", "tasks"))
RESOURCE_TYPES = frozenset(("Document", "Fetch", "XHR", "Image", "Script", "Stylesheet", "Other"))
EXCEPTIONS = frozenset(("Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "NetworkError", "DOMException"))
NETWORK_ERRORS = frozenset(("ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_TIMED_OUT", "ERR_TIMED_OUT", "ERR_INTERNET_DISCONNECTED", "ERR_NAME_NOT_RESOLVED", "ERR_ABORTED", "ERR_FAILED"))


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise TimeoutError("probe deadline")
    return seconds


def route_bucket(url, page_origin):
    """Only static API family names are retained; all path values and queries disappear."""
    if origin(url) != page_origin:
        return "other"
    path = urlsplit(url).path
    match = re.fullmatch(r"/api/([a-z-]+)(?:/.*)?", path)
    return "/api/" + match.group(1) if match and match.group(1) in ROUTES else "other"


def origin(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        return None
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


def ready_url(kiosk_url):
    parsed = urlsplit(kiosk_url)
    if not origin(kiosk_url):
        raise ValueError("invalid kiosk URL")
    return f"{parsed.scheme}://{parsed.netloc}/api/ready"


def classify(server, browser, page):
    if server in ("not_ready", "http_error"):
        return "server_unhealthy"
    if server != "healthy":
        return "server_unreachable"
    if browser != "healthy":
        return "browser_unreachable"
    if page == "healthy":
        return "healthy"
    if page == "timeout":
        return "renderer_unresponsive"
    return "page_unavailable"


class Journal:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / "observe.jsonl"

    def write(self, kind, **fields):
        record = {"ts": datetime.datetime.now(datetime.timezone.utc).isoformat(), "kind": kind, **fields}
        line = json.dumps(record, separators=(",", ":"), sort_keys=True) + "\n"
        if self.path.exists() and self.path.stat().st_size + len(line) > MAX_LOG_BYTES:
            for index in range(LOG_FILES - 1, 0, -1):
                older = self.directory / f"observe.jsonl.{index}"
                newer = self.path if index == 1 else self.directory / f"observe.jsonl.{index - 1}"
                if newer.exists():
                    newer.replace(older)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            os.fchmod(fd, 0o600)
            os.write(fd, line.encode())
        finally:
            os.close(fd)
        return record


class WebSocket:
    def __init__(self, url, timeout=TIMEOUT):
        parsed = urlsplit(url)
        if parsed.scheme != "ws" or parsed.hostname not in ("127.0.0.1", "localhost"):
            raise ValueError("CDP endpoint must be loopback ws")
        deadline = time.monotonic() + timeout
        self.sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout)
        try:
            key = base64.b64encode(os.urandom(16)).decode()
            path = parsed.path + ("?" + parsed.query if parsed.query else "")
            request = (f"GET {path} HTTP/1.1\r\nHost: {parsed.hostname}:{parsed.port}\r\n"
                       "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                       f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
            self.sock.settimeout(remaining(deadline))
            self.sock.sendall(request.encode())
            header = bytearray()
            while not header.endswith(b"\r\n\r\n"):
                if len(header) > 8192:
                    raise ValueError("oversized handshake")
                self.sock.settimeout(remaining(deadline))
                chunk = self.sock.recv(1)
                if not chunk:
                    raise ConnectionError("handshake closed")
                header.extend(chunk)
            if not header.startswith(b"HTTP/1.1 101 "):
                raise ConnectionError("handshake rejected")
        except Exception:
            self.sock.close()
            raise

    def close(self):
        self.sock.close()

    def send(self, command_id, method, params=None):
        payload = json.dumps({"id": command_id, "method": method, **({"params": params} if params else {})}).encode()
        self.send_frame(1, payload)

    def send_frame(self, opcode, payload):
        mask = os.urandom(4)
        n = len(payload)
        length = bytes([n]) if n < 126 else b"\x7e" + struct.pack(">H", n)
        self.sock.settimeout(TIMEOUT)
        self.sock.sendall(bytes([0x80 | opcode]) + bytes([length[0] | 0x80]) + length[1:] + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def read(self, deadline):
        self.sock.settimeout(max(0.001, deadline - time.monotonic()))
        def exact(n):
            data = bytearray()
            while len(data) < n:
                self.sock.settimeout(remaining(deadline))
                chunk = self.sock.recv(n - len(data))
                if not chunk:
                    raise ConnectionError("websocket closed")
                data.extend(chunk)
            return bytes(data)
        head = exact(2)
        opcode, n = head[0] & 15, head[1] & 127
        if n == 126:
            n = struct.unpack(">H", exact(2))[0]
        elif n == 127:
            n = struct.unpack(">Q", exact(8))[0]
        if n > MAX_FRAME:
            raise ValueError("oversized CDP frame")
        mask = exact(4) if head[1] & 128 else b""
        payload = exact(n)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        if opcode == 8:
            raise ConnectionError("websocket closed")
        if opcode == 9:
            self.send_frame(10, payload)
            return None
        if opcode == 1:
            message = json.loads(payload)
            if not isinstance(message, dict):
                raise ValueError("invalid CDP message")
            return message
        return None


def http_json(url):
    # The alarm bounds the whole local HTTP exchange, including a trickling body.
    def expired(_signum, _frame):
        raise TimeoutError("HTTP deadline")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, TIMEOUT)
    try:
        with urlopen(url, timeout=TIMEOUT) as response:
            if response.status != 200:
                raise ConnectionError("unexpected status")
            data = response.read(64 * 1024 + 1)
            if len(data) > 64 * 1024:
                raise ValueError("oversized response")
            return json.loads(data)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def browser_probe(base):
    try:
        info = http_json(base + "/json/version")
        if not isinstance(info, dict) or not isinstance(info.get("webSocketDebuggerUrl"), str):
            raise ValueError("invalid browser target")
        ws = WebSocket(info["webSocketDebuggerUrl"])
        try:
            ws.send(1, "Browser.getVersion")
            deadline = time.monotonic() + TIMEOUT
            while time.monotonic() < deadline:
                reply = ws.read(deadline)
                if reply and reply.get("id") == 1:
                    if "error" in reply:
                        return "unavailable", None
                    result = reply.get("result")
                    version = result.get("product", "") if isinstance(result, dict) else ""
                    if not isinstance(version, str):
                        version = ""
                    match = re.fullmatch(r"Chrome/([0-9.]+)", version)
                    return "healthy", match.group(1) if match else None
            return "timeout", None
        finally:
            ws.close()
    except (TimeoutError, socket.timeout):
        return "timeout", None
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return "unavailable", None


def server_probe(url):
    try:
        data = http_json(url)
        if not isinstance(data, dict):
            raise ValueError("invalid readiness response")
        if data.get("ready") is not True:
            return "not_ready", None, 200
        build = data.get("buildId")
        return "healthy", build if isinstance(build, str) and re.fullmatch(r"[a-zA-Z0-9._-]{1,80}", build) else None, 200
    except HTTPError as error:
        return "http_error", None, error.code if 100 <= error.code <= 599 else None
    except (TimeoutError, socket.timeout):
        return "timeout", None, None
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        return "unavailable", None, None


class PageProbe:
    def __init__(self, base, page_origin, journal):
        self.base = base
        self.page_origin = page_origin
        self.journal = journal
        self.ws = None
        self.target = None
        self.next_id = 1
        self.requests = collections.OrderedDict()
        self.event_window = time.monotonic()
        self.event_count = 0
        self.dropped = 0

    def close(self):
        self.flush_dropped()
        if self.requests:
            routes = collections.Counter(item[2] for item in self.requests.values())
            self.journal.write("tracking_reset", pending=len(self.requests),
                               oldest_ms=round((time.monotonic() - next(iter(self.requests.values()))[0]) * 1000),
                               routes=dict(routes))
        if self.ws:
            self.ws.close()
        self.ws = None
        self.target = None
        self.requests.clear()

    def connect(self):
        pages = http_json(self.base + "/json/list")
        if not isinstance(pages, list):
            raise ValueError("invalid target list")
        page = next((p for p in pages if isinstance(p, dict) and p.get("type") == "page"
                     and isinstance(p.get("webSocketDebuggerUrl"), str)
                     and origin(str(p.get("url", ""))) == self.page_origin), None)
        if not page:
            self.close()
            return False
        target = page["webSocketDebuggerUrl"]
        if self.ws and self.target == target:
            return True
        self.close()
        self.ws = WebSocket(target)
        self.target = target
        for method in ("Network.enable", "Runtime.enable"):
            self.next_id += 1
            self.ws.send(self.next_id, method)
        return True

    def log_event(self, kind, **fields):
        now = time.monotonic()
        if now - self.event_window >= 60:
            self.flush_dropped()
            self.event_window, self.event_count, self.dropped = now, 0, 0
        if self.event_count >= 60:
            self.dropped += 1
            return
        self.event_count += 1
        self.journal.write(kind, **fields)

    def flush_dropped(self):
        if self.dropped:
            self.journal.write("events_dropped", count=self.dropped)
            self.dropped = 0

    def event(self, message):
        method = message.get("method")
        params = message.get("params")
        if not isinstance(params, dict):
            return
        if method == "Network.requestWillBeSent":
            request_id = params.get("requestId")
            if isinstance(request_id, str):
                request = params.get("request")
                request = request if isinstance(request, dict) else {}
                resource_type = params.get("type")
                timestamp = params.get("timestamp")
                self.requests[request_id] = (time.monotonic(), float(timestamp) if isinstance(timestamp, (int, float)) else 0,
                                             route_bucket(str(request.get("url", "")), self.page_origin),
                                             resource_type if isinstance(resource_type, str) and resource_type in RESOURCE_TYPES else "Other", None)
                if len(self.requests) > MAX_REQUESTS:
                    self.requests.popitem(last=False)
        elif method == "Network.responseReceived":
            request_id = params.get("requestId")
            item = self.requests.get(request_id) if isinstance(request_id, str) else None
            if item:
                response = params.get("response")
                status = response.get("status") if isinstance(response, dict) else None
                self.requests[request_id] = (*item[:4], int(status) if isinstance(status, (int, float)) and 100 <= status <= 599 else None)
        elif method in ("Network.loadingFinished", "Network.loadingFailed"):
            request_id = params.get("requestId")
            item = self.requests.pop(request_id, None) if isinstance(request_id, str) else None
            if item:
                started, cdp_started, route, resource, status = item
                cdp_end = params.get("timestamp")
                elapsed = float(cdp_end) - cdp_started if isinstance(cdp_end, (int, float)) and cdp_started else time.monotonic() - started
                duration = min(3600000, max(0, round(elapsed * 1000)))
                if method == "Network.loadingFinished":
                    if (status is not None and status >= 400) or duration >= 2000:
                        self.log_event("request", route=route, resource=resource, status=status, duration_ms=duration)
                else:
                    raw = str(params.get("errorText", ""))
                    error = raw.removeprefix("net::")
                    self.log_event("request", route=route, resource=resource, error=error if error in NETWORK_ERRORS else "other", duration_ms=duration)
        elif method == "Runtime.exceptionThrown":
            detail = params.get("exceptionDetails")
            detail = detail if isinstance(detail, dict) else {}
            exception = detail.get("exception")
            kind = exception.get("className") if isinstance(exception, dict) else None
            self.log_event("exception", exception=kind if isinstance(kind, str) and kind in EXCEPTIONS else "other")

    def probe(self):
        try:
            if not self.connect():
                return "unavailable"
            self.next_id += 1
            probe_id = self.next_id
            self.ws.send(probe_id, "Runtime.evaluate", {"expression": "1+1", "returnByValue": True})
            deadline = time.monotonic() + TIMEOUT
            while time.monotonic() < deadline:
                message = self.ws.read(deadline)
                if not message:
                    continue
                if message.get("id") == probe_id:
                    outer = message.get("result")
                    inner = outer.get("result") if isinstance(outer, dict) else None
                    result = inner.get("value") if isinstance(inner, dict) else None
                    return "healthy" if result == 2 else "unavailable"
                self.event(message)
            self.close()  # A stale reply must never make a later probe appear healthy.
            return "timeout"
        except (TimeoutError, socket.timeout):
            self.close()
            return "timeout"
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            self.close()
            return "unavailable"

    def drain(self, until):
        if not self.ws:
            return
        try:
            while time.monotonic() < until:
                if not select.select([self.ws.sock], [], [], min(0.5, max(0, until - time.monotonic())))[0]:
                    continue
                message = self.ws.read(time.monotonic() + TIMEOUT)
                if message:
                    self.event(message)
        except (OSError, ValueError, TypeError, json.JSONDecodeError, TimeoutError):
            self.close()


def cpu_ticks(stat):
    fields = stat.rsplit(")", 1)[1].split()
    return int(fields[11]) + int(fields[12])


def process_metrics():
    """Bounded /proc sample. Command lines are inspected for role only, never logged."""
    processes = []
    if not Path("/proc").exists():
        return []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            if (entry / "comm").read_text().strip() != "chromium":
                continue
            cmdline = (entry / "cmdline").read_bytes()[:4096]
            role = "renderer" if b"--type=renderer" in cmdline else "browser" if b"--type=" not in cmdline else "other"
            status = (entry / "status").read_text()
            rss = re.search(r"^VmRSS:\s+(\d+)", status, re.M)
            threads = re.search(r"^Threads:\s+(\d+)", status, re.M)
            state = re.search(r"^State:\s+([A-Z])", status, re.M)
            wchan = (entry / "wchan").read_text().strip()
            wchan = wchan if re.fullmatch(r"[A-Za-z0-9_]{1,64}", wchan) else None
            ticks = cpu_ticks((entry / "stat").read_text())
            processes.append({"pid": int(entry.name), "role": role, "rss_kib": int(rss.group(1)) if rss else None,
                              "threads": int(threads.group(1)) if threads else None,
                              "state": state.group(1) if state else "?", "wchan": wchan, "cpu_ticks": ticks})
        except (OSError, ValueError, IndexError):
            continue
    processes.sort(key=lambda p: (p["role"], -int(p["rss_kib"] or 0)))
    return processes[:32]


def available_memory_kib():
    try:
        match = re.search(r"^MemAvailable:\s+(\d+)", Path("/proc/meminfo").read_text(), re.M)
        return int(match.group(1)) if match else None
    except OSError:
        return None


def sample(journal, page, cdp_base, server_url):
    started = time.monotonic()
    page.flush_dropped()
    server, build, server_status = server_probe(server_url)
    browser, version = browser_probe(cdp_base)
    if browser == "healthy":
        renderer = page.probe()
    else:
        page.close()
        renderer = "unavailable"
    record = journal.write("sample", verdict=classify(server, browser, renderer), server=server,
                           server_http_status=server_status, browser=browser, renderer=renderer, build=build, chromium=version,
                           duration_ms=round((time.monotonic() - started) * 1000),
                           pending_requests=len(page.requests),
                           oldest_request_ms=round((time.monotonic() - next(iter(page.requests.values()))[0]) * 1000) if page.requests else None,
                           processes=process_metrics(),
                           mem_available_kib=available_memory_kib(),
                           load1=round(os.getloadavg()[0], 2))
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--log-dir", default="/var/lib/familyos-observe")
    parser.add_argument("--cdp-base", default="http://127.0.0.1:9222")
    parser.add_argument("--server-url")
    parser.add_argument("--page-origin")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--read", type=int, metavar="N")
    args = parser.parse_args()
    if args.read is not None:
        if not 1 <= args.read <= 1000:
            parser.error("--read must be 1..1000")
        path = Path(args.log_dir) / "observe.jsonl"
        for line in collections.deque(path.open(encoding="utf-8"), maxlen=args.read):
            print(line, end="")
        return
    page_url = args.page_origin or Path("/boot/firmware/fullpageos.txt").read_text().strip()
    page_origin = origin(page_url)
    if not page_origin:
        parser.error("invalid kiosk page origin")
    server_url = args.server_url or ready_url(page_url)
    journal = Journal(args.log_dir)
    journal.write("start", schema=1, collector_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    page = PageProbe(args.cdp_base, page_origin, journal)
    try:
        while True:
            start = time.monotonic()
            record = sample(journal, page, args.cdp_base, server_url)
            if args.once:
                print(json.dumps(record, sort_keys=True))
                return
            page.drain(start + INTERVAL)
            remaining = start + INTERVAL - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
    finally:
        page.close()


if __name__ == "__main__":
    main()
