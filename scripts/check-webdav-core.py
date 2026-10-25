#!/usr/bin/env python3
"""Compile production Foundation code and exercise it against a local DAV server.
Never contacts a user server or uses real credentials; no Xcode claim is made.
"""
import base64, http.server, pathlib, subprocess, threading, urllib.parse, xml.sax.saxutils
ROOT = pathlib.Path(__file__).resolve().parent.parent
EXPECTED = 'Basic ' + base64.b64encode(b'test-user:test-only-not-a-real-secret').decode()
objects = {'/dav/music/song #%.mp3': b'A' * 120000}
lock = threading.Lock()
records = []
class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def log_message(self, *args): pass
    def path_decoded(self): return urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
    def reply(self, status, body=b'', headers=None):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)
    def auth(self):
        records.append((self.command, self.path_decoded(), self.headers.get('Depth'), self.headers.get('Overwrite')))
        if self.headers.get('Authorization') != EXPECTED:
            self.reply(401)
            return False
        return True
    def do_PROPFIND(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if not self.auth(): return
        if self.headers.get('Depth') != '1' or b'resourcetype' not in body: return self.reply(400)
        prefix = self.path_decoded()
        with lock: children = list(objects.items())
        rows=[]
        for p, value in children:
            if not p.startswith(prefix): continue
            if '/' in p[len(prefix):]: continue
            href=xml.sax.saxutils.escape(urllib.parse.quote(p))
            rows.append(f'<d:response><d:href>{href}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>{len(value)}</d:getcontentlength><d:getetag>&quot;v1&quot;</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>')
        self.reply(207, ('<d:multistatus xmlns:d="DAV:">'+''.join(rows)+'</d:multistatus>').encode(), {'Content-Type':'application/xml; charset=utf-8'})
    def do_GET(self):
        if not self.auth(): return
        path = self.path_decoded()
        if path == '/dav/redirect': return self.reply(302, headers={'Location':'/outside/capture'})
        with lock: data = objects.get(path)
        if data is None: return self.reply(404)
        self.reply(200,data)
    def do_HEAD(self): return self.do_GET()
    def do_PUT(self):
        body = self.rfile.read(int(self.headers.get('Content-Length',0)))
        if not self.auth(): return
        path=self.path_decoded()
        with lock:
            if self.headers.get('If-None-Match') != '*' or path in objects: return self.reply(412)
            objects[path]=body
        self.reply(201)
    def do_MOVE(self):
        if not self.auth(): return
        src=self.path_decoded()
        dst=urllib.parse.unquote(urllib.parse.urlsplit(self.headers.get('Destination','')).path)
        with lock:
            if src not in objects: return self.reply(404)
            if self.headers.get('Overwrite')!='F' or dst in objects: return self.reply(412)
            objects[dst]=objects.pop(src)
        self.reply(201)
    def do_DELETE(self):
        if not self.auth(): return
        path=self.path_decoded()
        # Client may only clean its own temporary name in this test.
        assert path.startswith('/dav/music/.lx-upload-') and path.endswith('.part'), path
        with lock: objects.pop(path, None)
        self.reply(204)
if __name__=='__main__':
    destination=ROOT/'build/checks/webdav-core-tests'
    destination.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['swiftc','-swift-version','5',str(ROOT/'ios/LxMusicMobile/LXWebDAVCore.swift'),str(ROOT/'scripts/tests/WebDAVCoreTests.swift'),'-o',str(destination)],check=True)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        subprocess.run([str(destination),f'http://127.0.0.1:{server.server_port}/dav/'],check=True,timeout=90)
        assert all(path != '/outside/capture' for _, path, _, _ in records), records
        assert objects['/dav/music/upload #%.flac']==b'B'*150000
        assert not any('.lx-upload-' in path for path in objects), objects.keys()
        assert sum(method=='GET' and path=='/dav/music/song #%.mp3' for method,path,*_ in records)==3, records
        print('PASS independent HTTP trace: no credential redirect, no staged upload leak, original conflict file intact')
    finally: server.shutdown();server.server_close()
