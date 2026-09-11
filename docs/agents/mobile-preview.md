# Mobile admin preview from a remote PC

Use this when the agent runs on the household Mac and the user views the browser
on another computer. The working setup is a Next dev server on Mac loopback port
3001 and a temporary mobile frame/proxy on the Mac's LAN address, port 3002.

The browser's `localhost` is the user's PC. Opening a Mac loopback URL in the
browser does not forward that port. When both machines share a LAN, serve the
preview on the Mac's LAN address and give the user that URL.

## Start the isolated app

1. Work from the checkout containing the changes. Check existing listeners before
   choosing ports; leave production on 3000 running.
2. Use dependencies local to the checkout. An external `node_modules` symlink
   caused Turbopack to fail with “points out of the filesystem root.” Install
   with `pnpm install --frozen-lockfile`, or on macOS use `cp -cR` to clone a
   matching installation after removing only the symlink. Switching to Webpack
   also failed in this session with a `node:crypto` instrumentation build error;
   local dependencies with normal Turbopack worked.
3. Create a fresh temporary directory and start Next from the repo root:

   ```sh
   preview_dir=$(mktemp -d /tmp/familyos-mobile-preview.XXXXXX)
   mkdir -p "$preview_dir/data"
   FAMILYOS_DATA_DIR="$preview_dir/data" FAMILYOS_ADMIN_PIN=123456 \
     pnpm exec next dev -H 127.0.0.1 -p 3001
   ```

   Keep the process running. Record the temporary directory for the second
   process. The PIN is a demo credential; all preview writes must use this fresh
   data directory. The wrapper below automatically authenticates visitors, so
   use it only with isolated demo data on the trusted LAN, never production.

## Start the mobile frame

Find the Mac's current LAN address. `SSH_CONNECTION`, when set, contains
`client-IP client-port server-IP server-port`; the third field is the Mac's
address for that connection. Otherwise inspect the active network interface.
Verify the address instead of retaining one from a previous session.

Save the following as `preview.py` in the temporary directory. It renders a
390 × 844 iframe, authenticates with the demo PIN, and opens **New task**.
Cancel returns to the list, and the admin navigation reaches other editors.
This is a viewport preview, not iOS device emulation.

The proxy keeps the frame and app on the same origin, forwards cookies and admin
requests, and maps mutation Origin headers to the loopback upstream. It also
relays WebSocket upgrades and traffic. This is required: without it, this Next
version loaded HTML and scripts but stayed on “Checking access…” because the
development connection failed before the session check began.

```python
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error
import json
import os
import socket
import select

upstream = "http://127.0.0.1:3001"
html = """<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>FamilyOS mobile preview</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#e7ece8;font-family:system-ui;color:#263d36;display:flex;flex-direction:column;align-items:center;padding:24px;gap:14px}header{text-align:center}h1{font-size:18px;margin:0 0 6px}p{font-size:13px;margin:0}iframe{width:390px;height:844px;max-width:100%;border:1px solid #b6c8bd;border-radius:24px;background:#f6f8f5;box-shadow:0 12px 44px #263d3620;flex-shrink:0}
</style></head><body><header><h1>FamilyOS · Mobile preview</h1><p>390 × 844 · Temporary demo data · PIN 123456</p></header><iframe title="FamilyOS admin on mobile" src="/admin/tasks"></iframe><script>
const frame=document.querySelector("iframe");
frame.addEventListener("load",()=>{
 const doc=frame.contentDocument;
 const open=()=>{const button=[...doc.querySelectorAll("button")].find(b=>b.textContent.trim()==="New task");if(button){button.click();observer.disconnect();}};
 const observer=new MutationObserver(open);observer.observe(doc.body,{childList:true,subtree:true});open();
},{once:true});
</script></body></html>"""

class Preview(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            request=urllib.request.Request(upstream+"/admin/api/session",data=json.dumps({"pin":"123456"}).encode(),headers={"Content-Type":"application/json","Origin":upstream,"x-familyos-admin":"1"})
            with urllib.request.urlopen(request) as response:
                cookie=response.headers.get("Set-Cookie")
            self.send_response(200)
            self.send_header("Content-Type","text/html; charset=utf-8")
            if cookie:self.send_header("Set-Cookie",cookie)
            self.end_headers()
            self.wfile.write(html.encode())
        else:self.proxy()
    def do_POST(self):self.proxy()
    def do_DELETE(self):self.proxy()
    def websocket(self):
        # Relay the HTTP upgrade and then raw WebSocket traffic in both directions.
        with socket.create_connection(("127.0.0.1", 3001), timeout=10) as upstream_socket:
            headers = dict(self.headers.items())
            headers["Host"] = "127.0.0.1:3001"
            headers["Origin"] = upstream
            request = f"{self.command} {self.path} HTTP/1.1\r\n"
            request += "".join(f"{key}: {value}\r\n" for key, value in headers.items())
            upstream_socket.sendall((request + "\r\n").encode("latin-1"))
            upstream_socket.settimeout(None)
            peers = (self.connection, upstream_socket)
            while True:
                readable, _, _ = select.select(peers, [], [], 60)
                if not readable:
                    return
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    target = upstream_socket if source is self.connection else self.connection
                    target.sendall(data)

    def proxy(self):
        if self.headers.get("Upgrade", "").lower() == "websocket":
            self.websocket()
            return
        body=self.rfile.read(int(self.headers.get("Content-Length",0))) or None
        headers={k:v for k,v in self.headers.items() if k.lower() not in ("host","connection","accept-encoding","origin")}
        if self.headers.get("Origin"):headers["Origin"]=upstream
        req=urllib.request.Request(upstream+self.path,data=body,headers=headers,method=self.command)
        try: response=urllib.request.urlopen(req)
        except urllib.error.HTTPError as error:response=error
        with response:
            self.send_response(response.status)
            for k,v in response.headers.items():
                if k.lower() not in ("transfer-encoding","connection","content-length","content-encoding"):self.send_header(k,v)
            self.end_headers()
            self.wfile.write(response.read())
ThreadingHTTPServer((os.environ["PREVIEW_HOST"],3002),Preview).serve_forever()

```

In a second terminal/process, run it with the verified Mac address:

```sh
PREVIEW_HOST=<mac-lan-ip> python3 <temporary-directory>/preview.py
```

Bind to that specific LAN address. The upstream stays on loopback. If the
execution sandbox denies listening with `EPERM`, retry the server command using
the tool's normal sandbox escalation flow.

## Verify and show

- Check that both `http://<mac-lan-ip>:3002/` and
  `http://<mac-lan-ip>:3002/admin/tasks` return HTTP 200. A sandbox can also deny
  the verification request; retry with network access before assuming the
  server is down.
- Open `http://<mac-lan-ip>:3002/` using the available browser-opening tool and
  include the same clickable URL in the response. An opening result of
  `queued` does not prove the user can see the page.
- Verify the browser leaves “Checking access…” and reaches **New task**. HTTP
  200 alone is insufficient: the broken WebSocket proxy returned 200 for the
  document and scripts. Exercise Cancel, another editor, and Lock now → PIN
  unlock. Use a headless browser if available; otherwise ask the user to confirm
  that the controls are interactive.
- Keep both processes alive while the user explores. Report that this uses
  temporary data and provide the demo PIN if the gate appears.
- When finished, stop only the preview processes started for this task. Their
  data and wrapper live under the recorded temporary directory.

On 2026-09-11, the user confirmed LAN access; a subsequent browser test caught
and fixed the WebSocket-related loading freeze. The LAN URL was
`http://10.0.0.137:3002/`; that address is an example, not a persistent setting.

## When direct LAN access is unavailable

Use SSH forwarding from the **PC**, with the preview bound to Mac loopback:

```powershell
ssh -N -L 3002:127.0.0.1:3002 <mac-user>@<mac-host>
```

Then open `http://localhost:3002/` on the PC. Only the proxy port needs forwarding.
A shell running on the Mac cannot create the PC's local listener without access
to the PC. Check available forwarding tools before asking the user to run a
command; use direct LAN access when available.
