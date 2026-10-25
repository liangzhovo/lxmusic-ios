#!/usr/bin/env python3
"""Loopback-only media fixture with byte ranges, HEAD and deterministic MIME types.

Serves generated test signals, never production music or credentials. AVFoundation
may probe the head and tail of a resource concurrently; plain http.server ignores
Range. Keep every request/status/range in the CI evidence log.
"""
from __future__ import annotations
import argparse
import functools
import http.server
from pathlib import Path
import re
import shutil
from typing import BinaryIO


class MediaHandler(http.server.SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    extensions_map = {'.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav'}

    def log_message(self, format: str, *args: object) -> None:
        super().log_message(format + ' Range=%s', *args, self.headers.get('Range', '-'))

    def send_head(self) -> BinaryIO | None:
        self.remaining: int | None = None
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            self.send_error(404, 'Generated media file not found')
            return None
        resource = path.open('rb')
        size = path.stat().st_size
        start, end = 0, size - 1
        raw = self.headers.get('Range')
        if raw:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', raw.strip())
            valid = bool(match and any(match.groups()))
            if valid and match:
                left, right = match.groups()
                if left:
                    start = int(left)
                    end = min(int(right), size - 1) if right else size - 1
                else:
                    length = int(right)
                    valid = length > 0
                    start = max(0, size - length)
                valid = valid and 0 <= start <= end < size
            if not valid:
                resource.close()
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return None
        length = end - start + 1
        self.send_response(206 if raw else 200)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store')
        if raw:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        resource.seek(start)
        self.remaining = length
        return resource

    def copyfile(self, source: BinaryIO, outputfile: BinaryIO) -> None:
        # A client may close after a short probe. This must not stop the server.
        try:
            if self.remaining is None:
                shutil.copyfileobj(source, outputfile)
            else:
                remaining = self.remaining
                while remaining:
                    data = source.read(min(65536, remaining))
                    if not data:
                        raise OSError('Fixture was truncated during the response')
                    outputfile.write(data)
                    remaining -= len(data)
        except (BrokenPipeError, ConnectionResetError):
            self.log_message('Client closed media probe')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--port', type=int, default=18779)
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    if not directory.is_dir():
        parser.error('directory must be a directory')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), functools.partial(MediaHandler, directory=str(directory)))
    print(f'MEDIA-FIXTURE {server.server_address} {directory}', flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
