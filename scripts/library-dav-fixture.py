#!/usr/bin/env python3
"""Loopback-only WebDAV integration fixture; synthetic credentials/data only.

Implements the actual methods exercised by the app. Trace never includes
headers, credentials, URL queries, or bodies. Host verification independently
checks persisted upload bytes and conditional resume requests.
"""
from __future__ import annotations
import argparse, base64, faulthandler, hashlib, hmac, json, os, socketserver, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, quote
from xml.sax.saxutils import escape

AUTH = 'Basic ' + base64.b64encode(b'lx-ci:synthetic-local-password').decode()
TRACE: list[dict] = []
LOCK = threading.RLock()
OFFLINE = False
ROOT: Path


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args):
        pass
    def respond(self, status: int, body: bytes = b'', headers: dict | None = None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        for key, value in (headers or {}).items():
            self.send_header(key, str(value))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)
        self.close_connection = True
    def event(self, status: int, path: str, **fields):
        with LOCK:
            TRACE.append({'method': self.command, 'path': path, 'status': status, **fields})
            del TRACE[:-2000]
    def local(self, url: str | None = None):
        raw = urlsplit(url or self.path).path
        if not raw.startswith('/dav/'):
            return None
        parts = unquote(raw[5:]).rstrip('/').split('/') if raw[5:].rstrip('/') else []
        if any(not part or part in ('.', '..') or '\\' in part or '\0' in part for part in parts):
            return None
        path = ROOT.joinpath(*parts)
        if not path.resolve().is_relative_to(ROOT):
            return None
        return path, '/'.join(parts)
    def authorized(self):
        global OFFLINE
        if self.path.startswith('/control/'):
            return True
        if not hmac.compare_digest(self.headers.get('Authorization', ''), AUTH):
            self.event(401, '[unauthorized]')
            self.respond(401, b'Authentication required', {'WWW-Authenticate': 'Basic realm="LX fixture"'})
            return False
        if OFFLINE:
            self.event(503, '[offline]'); self.respond(503); return False
        return True
    def do_GET(self):
        global OFFLINE
        if self.path == '/control/health':
            self.respond(200, b'{"ready":true}'); return
        if self.path == '/control/trace':
            with LOCK: body = json.dumps(TRACE).encode()
            self.respond(200, body); return
        if self.path == '/control/manifest':
            records = {}
            for path in sorted(ROOT.rglob('*')):
                if path.is_file(): records[path.relative_to(ROOT).as_posix()] = {'size': path.stat().st_size, 'sha256': sha(path)}
            self.respond(200, json.dumps(records).encode()); return
        self.get_file()
    def do_HEAD(self):
        self.get_file()
    def get_file(self):
        if not self.authorized(): return
        value = self.local()
        if value is None: self.respond(400); return
        path, rel = value
        if not path.is_file(): self.event(404, rel); self.respond(404); return
        size = path.stat().st_size; etag = '"' + sha(path) + '"'
        start, status = 0, 200
        requested = self.headers.get('Range', '')
        if requested and self.headers.get('If-Range') == etag:
            import re
            match = re.fullmatch(r'bytes=(\d+)-', requested)
            if not match or int(match[1]) >= size:
                self.event(416, rel); self.respond(416, headers={'Content-Range': f'bytes */{size}'}); return
            start, status = int(match[1]), 206
        self.event(status, rel, start=start, size=size, validatedRange=bool(requested and status == 206))
        self.send_response(status)
        self.send_header('Content-Type', 'audio/flac' if path.suffix == '.flac' else 'audio/mpeg')
        self.send_header('Content-Length', str(size - start)); self.send_header('ETag', etag)
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Connection', 'close')
        if status == 206: self.send_header('Content-Range', f'bytes {start}-{size-1}/{size}')
        self.end_headers(); self.close_connection = True
        if self.command == 'HEAD': return
        try:
            with path.open('rb') as handle:
                handle.seek(start)
                while block := handle.read(65536):
                    self.wfile.write(block); self.wfile.flush()
                    if path.name.startswith('slow-'): time.sleep(.035)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def do_PROPFIND(self):
        if not self.authorized(): return
        value = self.local()
        if value is None: self.respond(400); return
        path, rel = value
        if not path.is_dir(): self.event(404, rel); self.respond(404); return
        if self.headers.get('Depth') != '1': self.respond(400); return
        length = int(self.headers.get('Content-Length', '0'))
        if length > 1024 * 1024: self.respond(413); return
        if length: self.rfile.read(length)
        rows = []
        for item in [path, *sorted(path.iterdir())]:
            relative = item.relative_to(ROOT).as_posix()
            if relative == '.': relative = ''
            href = '/dav/' + quote(relative, safe='/') + ('/' if item.is_dir() and relative else '')
            resource = '<d:collection/>' if item.is_dir() else ''
            properties = '' if item.is_dir() else f'<d:getcontentlength>{item.stat().st_size}</d:getcontentlength><d:getetag>{escape(chr(34) + sha(item) + chr(34))}</d:getetag>'
            rows.append(f'<d:response><d:href>{escape(href)}</d:href><d:propstat><d:prop><d:displayname>{escape(item.name)}</d:displayname><d:resourcetype>{resource}</d:resourcetype>{properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')
        self.event(207, rel)
        self.respond(207, ('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' + ''.join(rows) + '</d:multistatus>').encode(), {'Content-Type': 'application/xml; charset=utf-8'})
    def do_MKCOL(self):
        if not self.authorized(): return
        value = self.local()
        if value is None: self.respond(400); return
        path, rel = value
        if path.exists(): self.event(405, rel); self.respond(405); return
        if not path.parent.is_dir(): self.respond(409); return
        path.mkdir(); self.event(201, rel); self.respond(201)
    def do_PUT(self):
        if not self.authorized(): return
        value = self.local()
        if value is None: self.respond(400); return
        path, rel = value
        length = int(self.headers.get('Content-Length', '-1'))
        if not 0 <= length <= 128 * 1024 * 1024: self.respond(413); return
        if not path.parent.is_dir(): self.respond(409); return
        with LOCK:
            if path.exists() and self.headers.get('If-None-Match') == '*':
                self.event(412, rel); self.respond(412); return
            fresh = not path.exists()
            # Fixture intentionally keeps incomplete PUT bytes; the production
            # client must clean its own staging object on cancellation/failure.
            received = 0
            try:
                with path.open('wb') as handle:
                    while received < length:
                        block = self.rfile.read(min(65536, length - received))
                        if not block: break
                        handle.write(block); received += len(block)
            except (BrokenPipeError, ConnectionResetError): pass
        if received != length: self.event(400, rel, received=received); self.respond(400); return
        status = 201 if fresh else 204
        self.event(status, rel, received=received, sha256=sha(path))
        self.respond(status)
    def do_MOVE(self):
        if not self.authorized(): return
        source, target = self.local(), self.local(self.headers.get('Destination', ''))
        if source is None or target is None: self.respond(400); return
        path, rel = source; destination, final = target
        with LOCK:
            if not path.is_file(): self.respond(404); return
            if destination.exists() and self.headers.get('Overwrite') == 'F': self.event(412, rel); self.respond(412); return
            if not destination.parent.is_dir(): self.respond(409); return
            os.rename(path, destination)
        self.event(201, rel, destination=final, sha256=sha(destination)); self.respond(201)
    def do_DELETE(self):
        if not self.authorized(): return
        value = self.local()
        if value is None: self.respond(400); return
        path, rel = value
        # Tests fail loudly if client attempts to delete user/final material.
        if not path.name.startswith('.lx-upload-'): self.event(403, rel); self.respond(403); return
        existed = path.exists(); path.unlink(missing_ok=True)
        self.event(204 if existed else 404, rel); self.respond(204 if existed else 404)
    def do_POST(self):
        global OFFLINE
        if self.path == '/control/offline': OFFLINE = True; self.respond(200); return
        if self.path == '/control/online': OFFLINE = False; self.respond(200); return
        if self.path == '/control/clear':
            with LOCK: TRACE.clear()
            self.respond(200); return
        self.respond(404)


class LoopbackHTTPServer(ThreadingHTTPServer):
    """This private numeric-loopback fixture does not need reverse DNS."""
    def server_bind(self):
        if self.server_address[0] != '127.0.0.1':
            raise ValueError('Library fixture must bind numeric loopback only')
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def run():
    global ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=Path); parser.add_argument('--port', type=int, default=18782)
    args = parser.parse_args(); ROOT = args.root.resolve(); ROOT.mkdir(parents=True, exist_ok=True)
    print('Library fixture startup: arguments and local root ready', flush=True)
    faulthandler.enable()
    faulthandler.dump_traceback_later(5, repeat=True)
    try:
        with LoopbackHTTPServer(('127.0.0.1', args.port), Handler) as server:
            print('Loopback synthetic WebDAV fixture ready', flush=True)
            faulthandler.cancel_dump_traceback_later()
            server.serve_forever()
    finally:
        faulthandler.cancel_dump_traceback_later()


if __name__ == '__main__': run()
