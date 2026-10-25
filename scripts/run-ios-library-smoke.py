#!/usr/bin/env python3
"""Required actual simulator App tests for the Build88 production library.

Run this current-feature gate before the unchanged playback/visual suite so a
library failure does not repeat already-passing long regressions. Generate the
same synthetic tones independently; no existing screenshot/report is removed.
One new private simulator. Archive, reports and independent DAV trace must agree.
"""
from __future__ import annotations
import hashlib, json, math, os, re, shutil, struct, subprocess, sys, time, urllib.request, wave
from pathlib import Path
from simulator_app_lifecycle import OwnedSimulatorApps
from library_process_evidence import LibraryProcessEvidence

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'build/checks'
APP = ROOT / 'build/Simulator/Build/Products/Release-iphonesimulator/LxMusicMobile.app'
MEDIA = ROOT / 'build/smoke-http'
DAV = ROOT / 'build/library-dav-fixture'
BUNDLE = 'com.skyhc.lxmusic'
PHASES = ('online', 'full-restored', 'playlists-restored', 'ui-webdav', 'ui-downloads', 'ui-backup', 'cover-cd', 'cover-square', 'offline')
EXPECTED_CHECKS = {'online': 12, 'full-restored': 2, 'playlists-restored': 1, 'offline': 2,
                   'ui-webdav': 1, 'ui-downloads': 1, 'ui-backup': 1, 'cover-cd': 1, 'cover-square': 1}


def sha(path: Path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def cmd(*args: str, timeout=180, check=True):
    with (OUT / 'library-driver.log').open('a') as log:
        log.write('$ ' + ' '.join(map(str, args)) + '\n'); log.flush()
        result = subprocess.run(args, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        log.write(result.stdout + f'\nEXIT {result.returncode}\n')
    if check and result.returncode: raise RuntimeError(f'{args}: {result.stdout[-6000:]}')
    return result.stdout.strip()


def sim(*args: str, **kwargs): return cmd('/usr/bin/xcrun', 'simctl', *args, **kwargs)
def save(path: Path, value):
    temporary = path.with_suffix('.writing'); temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False)); temporary.replace(path)
# Local fixture control must not consult host proxy/PAC configuration.
CONTROL = urllib.request.build_opener(urllib.request.ProxyHandler({}))
def control(name: str):
    with CONTROL.open('http://127.0.0.1:18782/control/' + name, timeout=4) as response:
        return json.load(response)


def prepare_media():
    """Use the original playback fixture without first running its whole suite."""
    MEDIA.mkdir(parents=True, exist_ok=True)
    with wave.open(str(MEDIA / 'tone.wav'), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 440 * i / 16000)))
                                   for i in range(30 * 16000)))
    if not shutil.which('ffmpeg'):
        cmd('brew', 'install', 'ffmpeg', timeout=300)
    cmd('ffmpeg', '-v', 'error', '-y', '-i', str(MEDIA / 'tone.wav'), '-c:a', 'flac', str(MEDIA / 'tone.flac'))
    cmd('ffmpeg', '-v', 'error', '-y', '-i', str(MEDIA / 'tone.wav'), '-c:a', 'libmp3lame', '-b:a', '64k', str(MEDIA / 'tone.mp3'))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    if not APP.is_dir(): raise RuntimeError('Release simulator app is missing')
    prepare_media()
    for ext in ('mp3', 'flac'):
        if not (MEDIA / ('tone.' + ext)).is_file(): raise RuntimeError('Generated media prerequisite missing: ' + ext)
    audio = DAV / 'audio'; audio.mkdir(parents=True, exist_ok=True)
    for ext in ('mp3', 'flac'): shutil.copy2(MEDIA / ('tone.' + ext), audio / ('tone.' + ext))
    shutil.copy2(MEDIA / 'tone.mp3', audio / '蓝色 空间.mp3')
    # Valid initial MP3 frames, then padding; a large download fixture is needed
    # to pause after observable native progress, not by sleeping blindly.
    with (audio / 'slow-resume.mp3').open('wb') as handle:
        handle.write((MEDIA / 'tone.mp3').read_bytes()); handle.write(b'\0' * (8 * 1024 * 1024))
    simulator = None; server = None; reports = {}; failure = None; evidence = None
    apps = OwnedSimulatorApps(sim, BUNDLE)
    with (OUT / 'library-dav-server.log').open('w') as log:
        try:
            server = subprocess.Popen([sys.executable, '-u', str(ROOT / 'scripts/library-dav-fixture.py'), str(DAV)], cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 15
            last_probe = 'no response'
            while True:
                if server.poll() is not None:
                    raise RuntimeError(f'Library DAV fixture exited: code={server.returncode}; {last_probe}')
                try:
                    if control('health').get('ready'): break
                except (OSError, ValueError) as error:
                    last_probe = f'{type(error).__name__}: {error}'
                if time.monotonic() > deadline:
                    save(OUT / 'library-dav-startup.json', {'childAlive': server.poll() is None, 'lastProbe': last_probe, 'timeoutSeconds': 15})
                    raise RuntimeError('Library DAV fixture not ready: ' + last_probe)
                time.sleep(.2)
            runtime = next(r['identifier'] for r in json.loads(sim('list', 'runtimes', '-j'))['runtimes'] if r['isAvailable'] and 'iOS' in r['name'])
            model = next(d['identifier'] for d in json.loads(sim('list', 'devicetypes', '-j'))['devicetypes'] if 'iPad Pro' in d['name'] and '13' in d['name'])
            simulator = sim('create', 'LXBuild88-Library-' + os.environ.get('GITHUB_RUN_ID', 'local'), model, runtime)
            sim('boot', simulator); sim('bootstatus', simulator, '-b', timeout=240); sim('install', simulator, str(APP))
            apps.register(simulator)
            for phase in PHASES:
                if phase == 'offline':
                    # Actually remove the remote service; successful local playback
                    # cannot be an HTTP fixture accidentally returning cached bytes.
                    save(OUT / 'library-dav-trace.json', control('trace'))
                    save(OUT / 'library-dav-files.json', control('manifest'))
                    server.terminate(); server.wait(timeout=10); server = None
                apps.before_launch(simulator)
                data = Path(sim('get_app_container', simulator, BUNDLE, 'data'))
                raw_report = data / 'Documents/playback-smoke.json'
                raw_report.unlink(missing_ok=True)  # only this fresh CI simulator's report
                launched_at = time.time()
                output = sim('launch', '--stdout=' + str(OUT / f'library-{phase}.out'), '--stderr=' + str(OUT / f'library-{phase}.err'),
                             simulator, BUNDLE, '--lx-playback-smoke', '--lx-library=' + phase)
                evidence = LibraryProcessEvidence(OUT, simulator, BUNDLE, output, phase, launched_at)
                limit = 300 if phase == 'online' else 180 if phase == 'full-restored' else 90
                end = time.monotonic() + limit; last = None
                while time.monotonic() < end:
                    try:
                        last = json.loads(raw_report.read_text())
                        if last.get('phase') == 'library-' + phase:
                            if last.get('done'): break
                    except (OSError, ValueError): pass
                    evidence.observe(last)
                    time.sleep(.3)
                if not last or last.get('phase') != 'library-' + phase or not last.get('done'):
                    save(OUT / f'library-{phase}.json', last or {'done': False, 'success': False, 'error': 'Report not created'})
                    raise RuntimeError(f'Library App phase {phase} did not finish: {last}')
                save(OUT / f'library-{phase}.json', last)
                if not last.get('success') or len(last.get('checks', [])) != EXPECTED_CHECKS[phase] or not all(c.get('ok') for c in last.get('checks', [])):
                    raise RuntimeError(f'Library App phase {phase} failed: {json.dumps(last, ensure_ascii=False)}')
                reports[phase] = last
                if phase.startswith('ui-') or phase.startswith('cover-'):
                    shot = OUT / ('feature-library-' + phase + '.png')
                    sim('io', simulator, 'screenshot', '--type=png', str(shot))
                    if not shot.read_bytes().startswith(b'\x89PNG\r\n\x1a\n') or shot.stat().st_size < 1024: raise RuntimeError('Invalid feature screenshot')
            # Independent server/storage evidence, not merely the app's own flags.
            audit = json.loads((OUT / 'library-dav-trace.json').read_text())
            remote = json.loads((OUT / 'library-dav-files.json').read_text())
            if not any(e.get('validatedRange') and e.get('status') == 206 for e in audit): raise RuntimeError('Server saw no verified resume')
            moves = [e for e in audit if e['method'] == 'MOVE' and e['status'] in (201, 204)]
            if len(moves) < 2: raise RuntimeError('Missing actual music/backup WebDAV publications')
            if any('.lx-upload-' in name for name in remote): raise RuntimeError('Unfinished upload staging remains')
            if not any(p.startswith('published/') and r['sha256'] == sha(audio / 'tone.flac') for p, r in remote.items()): raise RuntimeError('Remote music content differs from source')
            if any(e['method'] == 'DELETE' and not Path(e['path']).name.startswith('.lx-upload-') for e in audit): raise RuntimeError('Attempted deletion outside owned staging')
            record = {'done': True, 'success': True, 'commit': os.environ['GITHUB_SHA'], 'run': os.environ['GITHUB_RUN_ID'],
                      'phases': list(reports), 'checks': sum(len(r['checks']) for r in reports.values()),
                      'network': {'verifiedResume': True, 'publishedMoves': len(moves), 'offlineServiceStopped': True},
                      'screenshots': [{'name': p.name, 'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(OUT.glob('feature-library-*.png'))]}
            if len(record['screenshots']) != 5: raise RuntimeError('Feature screenshot inventory mismatch')
            save(OUT / 'library-acceptance.json', record)
        except Exception as error:
            failure = error
            if evidence is not None:
                try: evidence.collect()
                except Exception as diagnostic_error:
                    print("DIAGNOSTIC-ONLY collection failed:", type(diagnostic_error).__name__, flush=True)
            save(OUT / 'library-acceptance.json', {'done': True, 'success': False, 'commit': os.environ.get('GITHUB_SHA'),
                                                'run': os.environ.get('GITHUB_RUN_ID'), 'completedPhases': list(reports), 'error': str(error)})
            raise
        finally:
            if server is not None:
                try: save(OUT / 'library-dav-trace.json', control('trace'))
                except Exception: pass
                server.terminate()
                try: server.wait(timeout=10)
                except subprocess.TimeoutExpired: server.kill(); server.wait()
            if simulator:
                # Only the simulator created in this invocation is touched.
                sim('terminate', simulator, BUNDLE, check=False); sim('shutdown', simulator, check=False); sim('delete', simulator, check=False)
    print('PASS actual App WebDAV playback/cache/download, encrypted full + playlist restore, cold offline restart and production UI/cover screenshots')


if __name__ == '__main__': main()
