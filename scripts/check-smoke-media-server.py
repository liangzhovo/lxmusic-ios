#!/usr/bin/env python3
"""Real loopback HTTP fixture checks; no simulator or music provider needed."""
import concurrent.futures
import functools
import http.server
import importlib.util
from pathlib import Path
import tempfile
import threading
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('media_fixture', Path(__file__).with_name('smoke-media-server.py'))
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
payload = bytes(range(256)) * 2048
with tempfile.TemporaryDirectory() as folder:
    Path(folder, 'tone.mp3').write_bytes(payload)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(module.MediaHandler, directory=folder))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f'http://127.0.0.1:{server.server_port}/tone.mp3'
    def read(range=None, method='GET'):
        headers = {'Range': range} if range else {}
        request = urllib.request.Request(url, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()
    try:
        status, headers, data = read()
        assert status == 200 and data == payload and headers['Accept-Ranges'] == 'bytes'
        assert headers['Content-Type'] == 'audio/mpeg'
        assert read(method='HEAD')[2] == b''
        for value, expected in [('bytes=0-1', payload[:2]), ('bytes=13-47', payload[13:48]),
                                ('bytes=-64', payload[-64:]), ('bytes=500000-', payload[500000:]),
                                ('bytes=524280-999999', payload[524280:])]:
            status, headers, data = read(value)
            assert status == 206 and data == expected and int(headers['Content-Length']) == len(expected), value
        for value in ['bytes=999999-', 'bytes=9-2', 'bytes=-0', 'bytes=0-1,5-9', 'bytes=-']:
            status, headers, data = read(value)
            assert status == 416 and data == b'' and headers['Content-Range'] == f'bytes */{len(payload)}', value
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(read, ['bytes=0-1', 'bytes=-64', None, 'bytes=32-63']))
        assert [r[0] for r in responses] == [206, 206, 200, 206]
        print('PASS media fixture: full GET, MIME, HEAD, 5 ranges, 5 invalid ranges, concurrent probes/download')
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
