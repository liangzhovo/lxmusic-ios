#!/usr/bin/env python3
"""Mandatory Apple host execution of production crypto/restore and HTTP tests."""
import hashlib, json, os, pathlib, platform, re, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'build/checks'; OUT.mkdir(parents=True, exist_ok=True)
if platform.system() != 'Darwin':
    raise SystemExit('This gate requires the real Apple SDK; non-Apple is NOT success.')
entries = [('webdav-core', r'WebDAV core: (\d+) assertions passed', 50), ('resumable-transfer', r'(\d+) resumable transfer assertions passed', 19),
           ('portable-backup', r'(\d+) Apple SDK encrypted-backup/restore assertions passed', 30)]
reports = []
try:
    fixture_check = subprocess.run([sys.executable, 'scripts/check-library-fixture.py'], cwd=ROOT,
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    (OUT / 'library-fixture.log').write_text(fixture_check.stdout)
    print(fixture_check.stdout, flush=True)
    if fixture_check.returncode: raise RuntimeError('Actual loopback WebDAV fixture integration failed')
    project_check = subprocess.run(['bundle', 'exec', 'ruby', 'scripts/check-native-project-paths.rb'], cwd=ROOT,
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    (OUT / 'library-native-project-paths.log').write_text(project_check.stdout)
    print(project_check.stdout, flush=True)
    if project_check.returncode: raise RuntimeError('Resolved Xcode application source paths failed verification')
    for name, pattern, minimum in entries:
        result = subprocess.run([sys.executable, str(ROOT / f'scripts/check-{name}.py')], cwd=ROOT, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=240)
        path = OUT / f'library-native-{name}.log'; path.write_text(result.stdout)
        print(result.stdout, flush=True)
        if result.returncode: raise RuntimeError(f'Real Apple SDK native test failed: {name}')
        matches = re.findall(pattern, result.stdout)
        if not matches or int(matches[-1]) < minimum: raise RuntimeError(f'Native assertion inventory mismatch: {name}')
        reports.append({'name': name, 'assertions': int(matches[-1]), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'log': path.name})
    report = {'done': True, 'success': True, 'host': 'Darwin', 'commit': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'], 'executed': reports}
except BaseException as error:
    report = {'done': True, 'success': False, 'host': platform.system(), 'commit': os.environ.get('GITHUB_SHA'), 'run': os.environ.get('GITHUB_RUN_ID'), 'executed': reports, 'error': str(error)}
    (OUT / 'library-native.json').write_text(json.dumps(report, indent=2)); raise
(OUT / 'library-native.json').write_text(json.dumps(report, indent=2))
print('PASS Apple native library, cryptography, integrity, crash rollback and real HTTP transfer gates')
