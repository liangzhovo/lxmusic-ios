#!/usr/bin/env python3
"""Publish a pinned, already-tested iOS build, then archive/remove obsolete refs.

This is repository maintenance, not a replacement for ios-ipa.yml. It never
rebuilds, resigns, relaxes native checks, force-updates a ref or reads a PAT.
The GitHub Actions job supplies its normal scoped GITHUB_TOKEN via GH_TOKEN.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import struct
import subprocess
import zipfile
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
            f'Unsafe archive member: {name}')
    return name


def zip_members(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, f'ZIP CRC failed: {path.name}')
        names = [safe_name(n) for n in archive.namelist() if not n.endswith('/')]
        require(len(names) == len(set(names)), f'Duplicate ZIP members: {path.name}')
        return {n: archive.read(n) for n in names}


def read_json(data: bytes) -> dict:
    value = json.loads(data)
    require(isinstance(value, dict), 'JSON report is not an object')
    return value


def validate_report(report: dict, count: int, name: str, structured: bool = True) -> None:
    require(report.get('done') is True and report.get('success') is True, f'{name}: did not pass')
    checks = report.get('checks', [])
    require(isinstance(checks, list) and len(checks) == count, f'{name}: incomplete checks')
    if structured:
        require(all(isinstance(c, dict) and c.get('ok') is True for c in checks), f'{name}: failed check')
    else:
        require(all(isinstance(c, str) and c for c in checks), f'{name}: missing theme checks')


def validate_bursts(online: dict) -> dict:
    result = {}
    for fmt in ('mp3', 'flac'):
        name = f'{fmt}: real keyboard burst keeps only the latest seek target'
        matches = [c for c in online['checks'] if c['name'] == name]
        require(len(matches) == 1 and matches[0]['ok'] is True, f'Missing {fmt} native burst')
        detail = matches[0]['detail']
        require(detail.get('requests') == [8, 13, 8, 13, 8, 13] and detail.get('target') == 13,
                f'{fmt}: wrong burst inputs or final target')
        ui = detail.get('uiAfterBurst')
        require(isinstance(ui, list) and bool(ui) and all(isinstance(p, (float, int))
                and math.isfinite(p) and p >= 12.25 for p in ui), f'{fmt}: stale UI target returned')
        position = detail.get('nativePosition')
        require(isinstance(position, (float, int)) and math.isfinite(position) and position > 13.25,
                f'{fmt}: native playback did not advance')
        result[fmt] = detail
    return result


def valid_png(data: bytes, name: str) -> None:
    require(data.startswith(b'\x89PNG\r\n\x1a\n') and len(data) > 1024, f'Invalid PNG: {name}')
    require(min(struct.unpack('>II', data[16:24])) >= 600, f'Unexpected PNG size: {name}')


def verify_artifacts(manifest: dict, paths: dict[str, Path], destination: Path) -> dict:
    """Pure file validation also exercised locally; no network or GitHub writes."""
    payloads = {}
    for kind, specification in manifest['artifacts'].items():
        require(kind in paths, f'Missing artifact: {kind}')
        path = paths[kind]
        require(digest(path.read_bytes()) == specification['sha256'], f'{kind}: outer SHA256 mismatch')
        payloads[kind] = zip_members(path)

    ipa, archive, ui, playback = (payloads[k] for k in ('ipa', 'archive', 'ui', 'playback'))
    for name in ('BUILD-METADATA.txt', 'SHA256SUMS.txt'):
        require(ipa[name] == archive[name], f'Mismatched {name} in binary artifacts')
    metadata = dict(line.split('=', 1) for line in ipa['BUILD-METADATA.txt'].decode().splitlines())
    require(metadata == {'commit': manifest['build_commit'], 'run': str(manifest['run_id']),
                         'version': manifest['version'], 'build': manifest['build'], 'signing': 'unsigned'},
            'Binary metadata does not match the successful source/run/version/signing')
    checksums = {line.split()[1]: line.split()[0] for line in ipa['SHA256SUMS.txt'].decode().splitlines()}
    require(checksums == manifest['binaries'], 'Unexpected binary checksum manifest')
    binaries = {}
    for name, expected in manifest['binaries'].items():
        source = ipa if name.endswith('.ipa') else archive
        require(name in source and digest(source[name]) == expected, f'{name}: binary SHA256 mismatch')
        binaries[name] = source[name]
    ipa_name = next(n for n in binaries if n.endswith('.ipa'))
    archive_name = next(n for n in binaries if n.endswith('.xcarchive.zip'))
    with zipfile.ZipFile(io.BytesIO(binaries[ipa_name])) as app_zip:
        app_prefix = 'Payload/LxMusicMobile.app/'
        info = plistlib.loads(app_zip.read(app_prefix + 'Info.plist'))
        require(info['CFBundleIdentifier'] == 'com.skyhc.lxmusic' and
                info['CFBundleShortVersionString'] == manifest['version'] and
                info['CFBundleVersion'] == manifest['build'] and
                info['MinimumOSVersion'] == '15.0' and sorted(info['UIDeviceFamily']) == [1, 2],
                'IPA platform/version metadata is inconsistent')
        require(not any('_CodeSignature' in n or n.endswith('embedded.mobileprovision')
                        for n in app_zip.namelist()), 'Unexpected signing in unsigned release')
        require(len(app_zip.read(app_prefix + 'main.jsbundle')) > 1024, 'Missing production JS bundle')
        with zipfile.ZipFile(io.BytesIO(binaries[archive_name])) as archive_zip:
            base = 'LxMusicMobile-unsigned.xcarchive/'
            properties = plistlib.loads(archive_zip.read(base + 'Info.plist'))['ApplicationProperties']
            require(properties['CFBundleIdentifier'] == info['CFBundleIdentifier'] and
                    properties['CFBundleVersion'] == manifest['build'] and
                    properties['CFBundleShortVersionString'] == manifest['version'] and
                    properties['Architectures'] == ['arm64'] and not properties.get('SigningIdentity'),
                    'Archive platform/version/signing metadata is inconsistent')
            prefix = base + 'Products/Applications/LxMusicMobile.app/'
            ipa_files = {n[len(app_prefix):] for n in app_zip.namelist()
                         if n.startswith(app_prefix) and not n.endswith('/')}
            archive_files = {n[len(prefix):] for n in archive_zip.namelist()
                             if n.startswith(prefix) and not n.endswith('/')}
            require(ipa_files == archive_files, 'IPA/archive application file sets differ')
            for name in ipa_files:
                require(app_zip.read(app_prefix + name) == archive_zip.read(prefix + name),
                        f'IPA/archive application bytes differ: {name}')

    reports = {}
    for name, count, structured in [('playback-online', 32, True), ('playback-offline', 11, True),
                                    ('system-theme', 8, False), ('system-theme-restart', 2, False)]:
        filename = name + '.json'
        require(ui[filename] == playback[filename], f'{name}: evidence artifacts disagree')
        report = read_json(ui[filename])
        validate_report(report, count, name, structured)
        reports[name] = report
    bursts = validate_bursts(reports['playback-online'])
    for iteration in range(3):
        for resource in ('remote', 'cache'):
            name = f'repeated remote/cache transition {iteration} {resource}'
            require(any(c['name'] == name and c['ok'] is True
                        for c in reports['playback-online']['checks']), f'Missing transition {name}')
    require(ui['UI-MANIFEST.json'] == playback['UI-MANIFEST.json'], 'UI manifests disagree')
    inventory = read_json(ui['UI-MANIFEST.json'])
    require(inventory['commit'] == manifest['build_commit'] and
            str(inventory['run']) == str(manifest['run_id']) and inventory['count'] == 54,
            'UI evidence belongs to a different commit/run or is incomplete')
    records = inventory['screenshots']
    require(len(records) == 54 and len({r['image'] for r in records}) == 54, 'Duplicate/missing captures')
    actual_images = {n for n in ui if n.startswith('ui-') and n.endswith('.png')}
    require(actual_images == {r['image'] for r in records}, 'Unexpected UI screenshot file set')
    for record in records:
        image = record['image']
        require(digest(ui[image]) == record['sha256'] and len(ui[image]) == record['bytes'],
                f'{image}: screenshot bytes changed')
        valid_png(ui[image], image)
        require(read_json(ui[record['report']]).get('success') is True, f'{image}: runtime check failed')
    features = ['feature-theme-await-light.png', 'feature-theme-await-dark.png',
                'feature-theme-await-fixed-dark.png']
    for name in features:
        valid_png(ui[name], name)

    summary = {'verified': True, 'repository': manifest['repository'], 'compiled_metadata': metadata,
               'original_run_number': manifest['run_number'], 'binaries': checksums,
               'online_checks': 32, 'offline_checks': 11, 'keyboard_bursts': bursts,
               'system_theme': reports['system-theme'], 'system_theme_restart': reports['system-theme-restart'],
               'ui_count': 54, 'feature_count': 3,
               'feature_sha256': {n: digest(ui[n]) for n in features},
               'original_artifact_sha256': {k: v['sha256'] for k, v in manifest['artifacts'].items()},
               'scope': 'Pinned successful macOS/Xcode/iOS Simulator build; unsigned, not physical-device or TestFlight validation'}
    destination.mkdir(parents=True, exist_ok=True)
    for name, data in binaries.items():
        (destination / name).write_bytes(data)
    for name in ('BUILD-METADATA.txt', 'SHA256SUMS.txt'):
        (destination / name).write_bytes(ipa[name])
    (destination / 'BUILD87-VERIFICATION.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
    shutil.copyfile(paths['ui'], destination / 'build87-ui-evidence.zip')
    return summary


def api(endpoint: str, method: str = 'GET', payload: dict | None = None, missing: bool = False):
    args = ['gh', 'api', '--method', method, endpoint]
    if payload is not None:
        args += ['--input', '-']
    process = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                             text=True, capture_output=True, timeout=180, check=False)
    if process.returncode:
        if missing and '(HTTP 404)' in process.stderr:
            return None
        raise RuntimeError(f'GitHub {method} {endpoint} failed: {process.stderr[-1500:]}')
    return json.loads(process.stdout) if process.stdout.strip() else None


def ref(root: str, kind: str, name: str):
    return api(f'{root}/git/ref/{kind}/{quote(name, safe="")}', missing=True)


def ensure_tag(root: str, name: str, commit: str) -> None:
    tag = ref(root, 'tags', name)
    if tag is None:
        api(root + '/git/refs', 'POST', {'ref': 'refs/tags/' + name, 'sha': commit})
        tag = ref(root, 'tags', name)
    require(tag is not None and tag['object']['type'] == 'commit' and tag['object']['sha'] == commit,
            f'Tag {name} does not point to the expected commit; it will not be overwritten')


def all_pages(endpoint: str) -> list:
    result = []
    for page in range(1, 101):
        values = api(f'{endpoint}?per_page=100&page={page}')
        require(isinstance(values, list), f'Expected paginated array: {endpoint}')
        result.extend(values)
        if len(values) < 100:
            return result
    raise RuntimeError('Pagination exceeded the maintenance safety limit')


def validate_ref_snapshot(manifest: dict, live: dict[str, str], archived: dict[str, str]) -> None:
    expected = manifest['old_branches']
    require(not set(live).difference({manifest['main_branch'], *expected}),
            'Unexpected new branch appeared; no wildcard branch cleanup is allowed')
    for name, sha in expected.items():
        if name in live:
            require(live[name] == sha, f'Branch {name} changed after review; stopping cleanup')
        else:
            require(archived.get(name) == sha, f'Branch {name} vanished without its expected archive tag')


def guard_main(manifest: dict, commit: str) -> None:
    root = 'repos/' + manifest['repository']
    repository = api(root)
    require(repository['default_branch'] == manifest['main_branch'], 'Default branch changed')
    current = ref(root, 'heads', manifest['main_branch'])
    require(current is not None and current['object']['sha'] == commit, 'Mainline moved; re-review before maintenance')


def publish(manifest: dict, assets: Path) -> dict:
    root = 'repos/' + manifest['repository']
    ensure_tag(root, manifest['tag'], manifest['build_commit'])
    endpoint = root + '/releases/tags/' + quote(manifest['tag'], safe='')
    release = api(endpoint, missing=True)
    if release is None:
        release = api(root + '/releases', 'POST', {
            'tag_name': manifest['tag'], 'target_commitish': manifest['build_commit'],
            'name': manifest['release_name'], 'body': (ROOT / manifest['notes']).read_text(),
            'draft': True, 'prerelease': False})
    require(release['tag_name'] == manifest['tag'], 'Release tag changed')
    local = {p.name: p for p in assets.iterdir() if p.is_file()}
    existing = {a['name']: a for a in all_pages(root + f'/releases/{release["id"]}/assets')}
    require(not set(existing).difference(local), 'Existing release has unexpected assets; refusing to replace it')
    for name, path in local.items():
        sha = 'sha256:' + digest(path.read_bytes())
        if name in existing:
            item = existing[name]
            require(item['state'] == 'uploaded' and item['size'] == path.stat().st_size and item.get('digest') == sha,
                    f'Existing release asset differs: {name}; no clobber is permitted')
            continue
        command = ['gh', 'release', 'upload', manifest['tag'], str(path), '--repo', manifest['repository']]
        process = subprocess.run(command, text=True, capture_output=True, timeout=240, check=False)
        require(process.returncode == 0, f'Asset upload failed: {name}: {process.stderr[-1500:]}')
    uploaded = {a['name']: a for a in all_pages(root + f'/releases/{release["id"]}/assets')}
    require(set(uploaded) == set(local), 'Release asset set is incomplete')
    for name, path in local.items():
        require(uploaded[name]['state'] == 'uploaded' and uploaded[name]['size'] == path.stat().st_size and
                uploaded[name].get('digest') == 'sha256:' + digest(path.read_bytes()), f'Uploaded digest differs: {name}')
    api(root + f'/releases/{release["id"]}', 'PATCH', {
        'name': manifest['release_name'], 'body': (ROOT / manifest['notes']).read_text(),
        'draft': False, 'prerelease': False, 'make_latest': 'true'})
    final = api(endpoint)
    require(final['draft'] is False and final['published_at'] is not None, 'Release was not published')
    require(api(root + '/releases/latest')['id'] == final['id'], 'New release was not marked latest')
    return {'id': final['id'], 'url': final['html_url'], 'tag': manifest['tag'],
            'compiled_commit': manifest['build_commit'],
            'assets': {n: {'bytes': a['size'], 'digest': a['digest'], 'url': a['browser_download_url']}
                       for n, a in uploaded.items()}}


def cleanup(manifest: dict, main_commit: str) -> dict:
    root = 'repos/' + manifest['repository']
    guard_main(manifest, main_commit)
    old = manifest['old_branches']
    require(manifest['main_branch'] not in old, 'Cleanup must not include the main branch')
    branches = {b['name']: b['commit']['sha'] for b in all_pages(root + '/branches')}
    archived = {}
    for name in old:
        found = ref(root, 'tags', manifest['archive_prefix'] + name)
        if found and found['object']['type'] == 'commit':
            archived[name] = found['object']['sha']
    validate_ref_snapshot(manifest, branches, archived)
    # The promotion merge explicitly retains every former head in history.
    for sha in [manifest['old_main'], *old.values()]:
        process = subprocess.run(['git', 'merge-base', '--is-ancestor', sha, main_commit], cwd=ROOT, check=False)
        require(process.returncode == 0, f'History is not retained for {sha}; branch deletion stopped')
    snapshots = {manifest['main_branch']: manifest['old_main'], **old}
    for name, sha in snapshots.items():
        ensure_tag(root, manifest['archive_prefix'] + name, sha)
    deleted = []
    for name, sha in old.items():
        guard_main(manifest, main_commit)
        current = ref(root, 'heads', name)
        if current is not None:
            require(current['object']['sha'] == sha, f'Branch {name} moved; not deleting it')
            api(root + '/git/refs/heads/' + quote(name, safe=''), 'DELETE')
        require(ref(root, 'heads', name) is None, f'Branch deletion not confirmed: {name}')
        deleted.append(name)
    remaining = [b['name'] for b in all_pages(root + '/branches')]
    require(remaining == [manifest['main_branch']], f'Unexpected remaining branches: {remaining}')
    return {'remaining': remaining, 'removed': deleted,
            'archive_tags': {manifest['archive_prefix'] + n: sha for n, sha in snapshots.items()}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest', default='docs/releases/build87.json')
    parser.add_argument('--verify-only', metavar='ARTIFACT_DIRECTORY')
    args = parser.parse_args()
    manifest = json.loads((ROOT / args.manifest).read_text())
    work = ROOT / 'build/publication'
    work.mkdir(parents=True, exist_ok=True)
    report = {'release': None, 'cleanup': None, 'success': False}
    try:
        if args.verify_only:
            paths = {k: Path(args.verify_only) / ('build87-' + k + '.zip') for k in manifest['artifacts']}
        else:
            require(os.environ.get('GITHUB_REPOSITORY') == manifest['repository'], 'Unexpected executing repository')
            require(os.environ.get('GITHUB_REF') == 'refs/heads/' + manifest['main_branch'], 'Not running on mainline')
            current = os.environ['GITHUB_SHA']
            guard_main(manifest, current)
            changed = subprocess.check_output(['git', 'diff', '--name-only', manifest['build_commit'], current],
                                              cwd=ROOT, text=True).splitlines()
            allowed_scripts = {'scripts/publish_ios_release.py', 'scripts/check_ios_publication.py'}
            require(all(p == 'README.md' or p.startswith(('docs/', '.github/')) or p in allowed_scripts for p in changed),
                    'Application source changed after the tested commit; do not relabel the old binary as new code')
            root = 'repos/' + manifest['repository']
            run = api(root + f'/actions/runs/{manifest["run_id"]}')
            require(run['head_sha'] == manifest['build_commit'] and run['status'] == 'completed' and
                    run['conclusion'] == 'success' and run['run_number'] == manifest['run_number'] and
                    run['path'] == '.github/workflows/ios-ipa.yml', 'Pinned native workflow did not succeed')
            paths = {}
            for kind, item in manifest['artifacts'].items():
                resource = root + f'/actions/artifacts/{item["id"]}'
                remote = api(resource)
                require(remote['name'] == item['name'] and remote['expired'] is False and
                        remote['workflow_run']['head_sha'] == manifest['build_commit'] and
                        remote['workflow_run']['id'] == manifest['run_id'] and
                        remote['digest'] == 'sha256:' + item['sha256'], f'Artifact identity mismatch: {kind}')
                path = work / (kind + '.zip')
                with path.open('wb') as output:
                    process = subprocess.run(['gh', 'api', resource + '/zip'], stdout=output,
                                             stderr=subprocess.PIPE, timeout=240, check=False)
                require(process.returncode == 0, f'Could not download verified {kind} artifact')
                paths[kind] = path
        assets = work / 'assets'
        summary = verify_artifacts(manifest, paths, assets)
        shutil.copyfile(ROOT / manifest['porting_notes'], assets / 'IOS_IPADOS_PORT.md')
        report['verification'] = summary
        if not args.verify_only:
            guard_main(manifest, os.environ['GITHUB_SHA'])
            report['release'] = publish(manifest, assets)
            # Save publication success even if branch housekeeping subsequently fails.
            (work / 'RESULT.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
            report['cleanup'] = cleanup(manifest, os.environ['GITHUB_SHA'])
        report['success'] = True
        print(json.dumps({k: v for k, v in report.items() if k != 'verification'}, indent=2, ensure_ascii=False))
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        (work / 'RESULT.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
