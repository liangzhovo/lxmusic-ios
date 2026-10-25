"""Bounded evidence for this driver's own simulator App, not a pass/fail substitute."""
from __future__ import annotations
import json
import os
from pathlib import Path
import re
import subprocess
import time


class LibraryProcessEvidence:
    def __init__(self, output: Path, simulator: str, bundle: str, launch: str, phase: str, started: float):
        match = re.fullmatch(re.escape(bundle) + r': (\d+)\s*', launch.strip())
        if not match or int(match.group(1)) < 2:
            raise RuntimeError('Cannot identify the simulator App process from its launch receipt')
        if not re.fullmatch(r'[0-9A-Fa-f-]{36}', simulator) or not re.fullmatch(r'[a-z-]+', phase):
            raise ValueError('Invalid owned simulator/phase')
        self.pid = int(match.group(1))
        self.output, self.simulator, self.phase, self.started = output, simulator, phase, started
        self.last_change = time.monotonic()
        self.signature = None
        self.sampled = False
        self.collected = False

    def alive(self):
        try:
            os.kill(self.pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            # Inability to inspect is not evidence that the process exited.
            return True

    def command(self, name, args, timeout):
        path = self.output / ('library-' + self.phase + '-' + name + '.log')
        try:
            with path.open('w') as log:
                result = subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, timeout=timeout, check=False)
                log.write('\nDIAGNOSTIC_EXIT=' + str(result.returncode) + '\n')
        except (OSError, subprocess.TimeoutExpired) as error:
            with path.open('a') as log:
                log.write('\nDIAGNOSTIC_UNAVAILABLE=' + type(error).__name__ + '\n')

    def observe(self, report):
        if report and report.get('done') and report.get('phase') == 'library-' + self.phase:
            return
        signature = json.dumps(report, sort_keys=True)
        if signature != self.signature:
            self.signature = signature
            self.last_change = time.monotonic()
        if not self.alive():
            (self.output / ('library-' + self.phase + '.json')).write_text(signature)
            try:
                self.collect()
            except Exception as error:
                print('DIAGNOSTIC-ONLY:', type(error).__name__, flush=True)
            raise RuntimeError('Library App process exited before its acceptance report completed; see process evidence')
        if not self.sampled and time.monotonic() - self.last_change >= 12:
            self.sampled = True
            self.command('process', ['/bin/ps', '-p', str(self.pid), '-o', 'pid=,stat=,%cpu=,rss=,etime=,comm='], 5)
            try:
                identity = subprocess.run(['/bin/ps', '-p', str(self.pid), '-o', 'comm='], text=True,
                                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=False)
                if identity.returncode == 0 and Path(identity.stdout.strip()).name == 'LxMusicMobile':
                    self.command('threads', ['/usr/bin/sample', str(self.pid), '2'], 8)
            except (OSError, subprocess.TimeoutExpired):
                pass

    def collect(self):
        if self.collected:
            return
        self.collected = True
        # No app files, Keychain, environment, request headers or user servers are read.
        summary = {'pid': self.pid, 'aliveAtCollection': self.alive(), 'phase': self.phase,
                   'sampleAttempted': self.sampled, 'crashReports': []}
        self.command('runtime', ['/usr/bin/xcrun', 'simctl', 'spawn', self.simulator, 'log', 'show',
                     '--last', '5m', '--style', 'compact', '--predicate',
                     'processIdentifier == ' + str(self.pid) + ' OR eventMessage CONTAINS "com.skyhc.lxmusic"'], 10)
        reports = Path.home() / 'Library/Logs/DiagnosticReports'
        for path in sorted(reports.glob('LxMusicMobile*'), key=lambda p: p.stat().st_mtime, reverse=True)[:10]:
            if path.suffix not in ('.ips', '.crash') or path.is_symlink():
                continue
            if path.stat().st_mtime < self.started or path.stat().st_size > 8 * 1024 * 1024:
                continue
            raw = path.read_text(errors='replace')
            exact_pid = re.search(r'"pid"\s*:\s*' + str(self.pid) + r'\b', raw) or re.search(r'^Process:\s+LxMusicMobile\s+\[' + str(self.pid) + r'\]', raw, re.M)
            if not exact_pid:
                continue
            target = 'library-' + self.phase + '-crash-' + str(len(summary['crashReports'])) + path.suffix
            (self.output / target).write_text(raw)
            summary['crashReports'].append(target)
        (self.output / ('library-' + self.phase + '-process.json')).write_text(json.dumps(summary, indent=2))
