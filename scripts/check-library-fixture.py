#!/usr/bin/env python3
"""Exercise the actual loopback DAV fixture before expensive simulator tests."""
import base64, hashlib, importlib.util, json, os, pathlib, socket, subprocess, sys, tempfile, threading, time
import urllib.error, urllib.request
from unittest.mock import patch
from xml.etree import ElementTree

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('library_fixture', ROOT / 'scripts/library-dav-fixture.py')
fixture = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixture)
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
count = 0

def check(condition, message):
    global count
    if not condition: raise AssertionError(message)
    count += 1; print('PASS ' + message, flush=True)

def main():
    with tempfile.TemporaryDirectory(prefix='lx-dav-fixture-') as temporary:
        root = pathlib.Path(temporary).resolve(); fixture.ROOT = root
        (root / 'audio').mkdir(); payload = b'ID3-synthetic-protocol-bytes' * 128
        song = root / 'audio/蓝色 空间.mp3'; song.write_bytes(payload)
        # The original HTTPServer consulted getfqdn before activation. A blocked
        # or broken resolver must not prevent a numeric-loopback fixture binding.
        with patch.object(socket, 'getfqdn', side_effect=RuntimeError('unexpected reverse DNS')):
            old_failed = False
            try:
                with fixture.ThreadingHTTPServer(('127.0.0.1', 0), fixture.Handler): pass
            except RuntimeError: old_failed = True
            check(old_failed, 'negative control: original HTTPServer depends on reverse DNS')
            server = fixture.LoopbackHTTPServer(('127.0.0.1', 0), fixture.Handler)
        check(server.server_name == '127.0.0.1', 'numeric-loopback server binds without reverse DNS')
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        def request(method, path, data=None, headers=None, auth=True):
            supplied = dict(headers or {})
            if auth: supplied['Authorization'] = fixture.AUTH
            req = urllib.request.Request(base + path, data=data, headers=supplied, method=method)
            try:
                with DIRECT.open(req, timeout=2) as response: return response.status, response.read(), dict(response.headers)
            except urllib.error.HTTPError as response:
                return response.code, response.read(), dict(response.headers)
        try:
            check(json.loads(request('GET', '/control/health', auth=False)[1]) == {'ready': True}, 'actual HTTP health response')
            check(request('GET', '/dav/audio/tone.mp3', auth=False)[0] == 401, 'missing credentials rejected')
            # macOS temporary directories may be reached through /var symlinks.
            # The executable canonicalizes ROOT; the imported test must do so too.
            with tempfile.TemporaryDirectory(prefix='lx-dav-alias-') as aliases:
                alias = pathlib.Path(aliases) / 'root'; alias.symlink_to(root, target_is_directory=True)
                fixture.ROOT = alias
                try:
                    check(request('PROPFIND', '/dav/audio/', b'', {'Depth': '1'})[0] == 400, 'negative control: noncanonical root fails containment safely')
                finally: fixture.ROOT = root
            status, raw, _ = request('PROPFIND', '/dav/audio/', b'', {'Depth': '1'})
            if status != 207 or not raw: raise AssertionError(f'Directory request failed before XML parsing: HTTP {status}, bytes={len(raw)}')
            xml = ElementTree.fromstring(raw)
            check(status == 207 and len(xml.findall('{DAV:}response')) == 2, 'actual XML directory listing with encoded unicode names')
            path = '/dav/audio/%E8%93%9D%E8%89%B2%20%E7%A9%BA%E9%97%B4.mp3'
            status, raw, headers = request('GET', path)
            check(status == 200 and raw == payload, 'encoded path returns exact protocol fixture bytes')
            etag = headers['ETag']
            status, raw, headers = request('GET', path, headers={'Range': 'bytes=13-', 'If-Range': etag})
            check(status == 206 and raw == payload[13:] and headers['Content-Range'].startswith('bytes 13-'), 'verified If-Range resumes exact remaining bytes')
            status, raw, _ = request('GET', path, headers={'Range': 'bytes=13-', 'If-Range': '"wrong"'})
            check(status == 200 and raw == payload, 'stale validator cannot be treated as valid partial content')
            check(request('MKCOL', '/dav/published/')[0] == 201, 'actual remote directory creation')
            stage = '/dav/published/.lx-upload-test'; final = '/dav/published/test.mp3'
            check(request('PUT', stage, payload, {'If-None-Match': '*'})[0] == 201, 'owned temporary upload created')
            check(request('PUT', stage, b'wrong', {'If-None-Match': '*'})[0] == 412, 'conditional upload does not overwrite existing bytes')
            check(request('GET', stage)[1] == payload, 'temporary upload can be independently read back')
            check(request('MOVE', stage, headers={'Destination': base + final, 'Overwrite': 'F'})[0] == 201, 'verified staging moves to final destination')
            check(request('DELETE', final)[0] == 403 and (root / 'published/test.mp3').read_bytes() == payload, 'final user data deletion rejected')
            request('PUT', stage, b'other', {'If-None-Match': '*'})
            check(request('MOVE', stage, headers={'Destination': base + final, 'Overwrite': 'F'})[0] == 412, 'no-overwrite MOVE collision remains failure')
            check(request('DELETE', stage)[0] == 204, 'owned temporary cleanup allowed')
            trace = json.loads(request('GET', '/control/trace')[1]); text = json.dumps(trace)
            check(any(row.get('validatedRange') and row['status'] == 206 for row in trace) and fixture.AUTH not in text, 'independent trace includes resume without credentials')
            check(request('GET', '/dav/%2e%2e/outside')[0] == 400, 'encoded parent traversal rejected')
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=3)
        # Exercise the same executable entry point, not just an imported handler.
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0)); port = reservation.getsockname()[1]
        with (root / 'child.log').open('wb') as log:
            child = subprocess.Popen([sys.executable, '-u', str(ROOT / 'scripts/library-dav-fixture.py'), str(root), '--port', str(port)], stdout=log, stderr=log)
            try:
                end = time.monotonic() + 5; ready = False
                while time.monotonic() < end and child.poll() is None:
                    try:
                        with DIRECT.open(f'http://127.0.0.1:{port}/control/health', timeout=.2) as response: ready = json.load(response).get('ready') is True
                        if ready: break
                    except OSError: time.sleep(.05)
                check(ready, 'real fixture subprocess starts and responds before the unchanged CI deadline')
            finally:
                child.terminate(); child.wait(timeout=3)
        check('startup: arguments and local root ready' in (root / 'child.log').read_text(), 'subprocess startup phase is observable')
        driver = (ROOT / 'scripts/run-ios-library-smoke.py').read_text()
        check('ProxyHandler({})' in driver and 'time.monotonic() + 15' in driver and "'timeoutSeconds': 15" in driver, 'direct loopback control and original startup deadline retained')
    print(f'{count} actual fixture protocol/startup checks passed; this is not App or audio acceptance.')

if __name__ == '__main__': main()
