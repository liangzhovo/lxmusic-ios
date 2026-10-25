#!/usr/bin/env python3
"""Compile production transfer engine and test real ranged HTTP and cancellation."""
import http.server, pathlib, subprocess, threading, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = b'A' * (4 * 1024 * 1024)
records = []
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def do_GET(self):
        path = self.path.split('?')[0]
        records.append((path, self.headers.get('Range'), self.headers.get('If-Range'), self.headers.get('Authorization')))
        if path == '/redirect':
            self.send_response(302); self.send_header('Location', '/capture'); self.send_header('Content-Length', '0'); self.end_headers(); return
        ranged = self.headers.get('Range')
        start = int(ranged.removeprefix('bytes=').removesuffix('-')) if ranged else 0
        use_range = bool(ranged) and path != '/ignore-range'
        body = DATA[start:] if use_range else DATA
        self.send_response(206 if use_range else 200)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', '"changed"' if path == '/changed-tag' and use_range else '"stable"')
        if use_range:
            first = start + 1 if path == '/bad-range' else start
            total = len(DATA) + 1 if path == '/bad-total' else len(DATA)
            self.send_header('Content-Range', f'bytes {first}-{len(DATA)-1}/{total}')
        self.end_headers()
        if path == '/truncated':
            self.wfile.write(body[:5000]); self.wfile.flush(); self.close_connection = True; return
        try:
            for i in range(0, len(body), 16384):
                self.wfile.write(body[i:i+16384]); self.wfile.flush()
                if path == '/slow': time.sleep(.005)
        except (BrokenPipeError, ConnectionResetError): pass
if __name__ == '__main__':
    binary = ROOT / 'build/checks/resume-tests'; binary.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['swiftc', '-swift-version', '5', str(ROOT/'ios/LxMusicMobile/LXWebDAVCore.swift'), str(ROOT/'ios/LxMusicMobile/LXResumableTransfer.swift'), str(ROOT/'scripts/tests/ResumableTransferTests.swift'), '-o', str(binary)], check=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler); threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        subprocess.run([str(binary), f'http://127.0.0.1:{server.server_port}'], check=True, timeout=90)
        captures = [row for row in records if row[0] == '/capture']; assert len(captures) == 1 and captures[0][3] is None, captures
        assert any(row[1] == 'bytes=65536-' and row[2] == '"stable"' for row in records), records
        print('PASS independent server trace: exact If-Range, no leaked credentials on public redirect')
    finally: server.shutdown(); server.server_close()
