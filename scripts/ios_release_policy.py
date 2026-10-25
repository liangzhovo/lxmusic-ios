#!/usr/bin/env python3
"""Validate and publish NEW unsigned iOS releases, without modifying old ones.

Only an IPA, an xcarchive ZIP and SHA256SUMS.txt are user-facing assets. Existing
native/simulator checks remain in ios-ipa.yml; this is an additional binary and
publication gate, not a replacement for them. All reports stay in Actions.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import subprocess
import struct
import zipfile

BUNDLE = 'com.skyhc.lxmusic'
TEAM = 'LW54AZ8PXT'
MIN_OS = '15.0'
REPOSITORY = 'skyhc/lx-music-mobile'
PROVENANCE = 'LX-BUILD.json'
ARCHIVE_ROOT = 'LxMusicMobile-unsigned.xcarchive/'
APP_ROOT = 'Payload/LxMusicMobile.app/'


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def expected_metadata(package: dict, commit: str, run: str) -> dict:
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None, 'Missing full source commit')
    require(run.isdecimal(), 'Missing workflow run ID')
    version, build = str(package['version']), str(package['versionCode'])
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?', version) is not None, 'Invalid version')
    require(build.isdecimal(), 'Invalid build number')
    return {'commit': commit, 'run': run, 'version': version, 'build': build, 'signing': 'unsigned'}


def binary_names(metadata: dict) -> tuple[str, str]:
    version, build = metadata['version'], metadata['build']
    return (f'lx-music-mobile-v{version}-build{build}-ios-unsigned.ipa',
            f'LX-Music-v{version}-build{build}.xcarchive.zip')


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def check_info(info: dict, metadata: dict) -> None:
    require(info.get('CFBundleIdentifier') == BUNDLE and
            info.get('CFBundleShortVersionString') == metadata['version'] and
            info.get('CFBundleVersion') == metadata['build'] and
            info.get('MinimumOSVersion') == MIN_OS and
            sorted(info.get('UIDeviceFamily', [])) == [1, 2], 'Compiled app platform/version mismatch')


def stamp_archive(build: Path, metadata: dict) -> None:
    app = build / ARCHIVE_ROOT / 'Products/Applications/LxMusicMobile.app'
    check_info(plistlib.loads((app / 'Info.plist').read_bytes()), metadata)
    require(not (app / '_CodeSignature').exists() and not (app / 'embedded.mobileprovision').exists(),
            'Refusing to change a signed app')
    # Executed before the existing archive-to-Payload copy. Both output packages
    # then contain the exact same source/run marker inside their app bundles.
    (app / PROVENANCE).write_text(json.dumps(metadata, sort_keys=True) + '\n', encoding='utf-8')


def checked_zip(path: Path) -> zipfile.ZipFile:
    archive = zipfile.ZipFile(path)
    try:
        names = archive.namelist()
        require(len(names) == len(set(names)), f'Duplicate ZIP members: {path.name}')
        for name in names:
            pure = PurePosixPath(name)
            require(not pure.is_absolute() and '..' not in pure.parts and '\\' not in name and
                    pure.as_posix() == name.rstrip('/'),
                    f'Unsafe ZIP member: {path.name}')
        require(archive.testzip() is None, f'ZIP CRC failed: {path.name}')
        return archive
    except BaseException:
        archive.close()
        raise


def notes_for_release(text: str, metadata: dict) -> str:
    # Build87 is historical and handled by its already-published pinned workflow.
    # This path must not replace that release with a freshly-built artifact.
    require(int(metadata['build']) >= 88, 'New publication policy requires a new build number (88 or later)')
    text = text.strip() + '\n'
    headings = re.findall(r'^#{1,6}\s+.*$', text, re.M)
    require(headings == ['## 更新日志', '## 系统要求'], 'Release body must contain only 更新日志 and 系统要求')
    require(text.startswith('## 更新日志\n'), 'Unexpected text before changelog')
    changes, requirements = text.split('## 系统要求\n', 1)
    require(changes.removeprefix('## 更新日志\n').strip() != '' and requirements.strip() != '', 'Empty release section')
    require('iOS' in requirements and 'iPadOS' in requirements and MIN_OS in requirements,
            'System requirements must match the compiled iOS/iPadOS deployment target')
    require('未签名' in requirements or 'unsigned' in requirements.lower(), 'Unsigned requirement must be explicit')
    require(not re.search(r'<\s*(script|iframe|object|embed)\b', text, re.I), 'Unexpected active content in notes')
    return text


def verify_executable(raw: bytes) -> None:
    require(len(raw) >= 32, 'Truncated Mach-O executable')
    magic, cpu, subtype, kind, commands, command_bytes, flags, reserved = struct.unpack_from('<IiiIIIII', raw)
    require(magic == 0xFEEDFACF and cpu == 0x100000C and kind == 2 and 0 < commands <= 10000 and
            32 + command_bytes <= len(raw), 'Package must contain an arm64 Mach-O application')
    offset = 32; device_platform = False
    for _ in range(commands):
        require(offset + 8 <= 32 + command_bytes, 'Malformed Mach-O command')
        command, size = struct.unpack_from('<II', raw, offset)
        require(size >= 8 and size % 4 == 0 and offset + size <= 32 + command_bytes, 'Malformed Mach-O command length')
        require(command != 0x1D, 'Unsigned application unexpectedly contains LC_CODE_SIGNATURE')
        if command == 0x32:
            require(size >= 24, 'Malformed Mach-O build version')
            platform_id, minimum = struct.unpack_from('<II', raw, offset + 8)
            require(platform_id == 2 and minimum == (15 << 16), 'Executable is not the matching iOS-device deployment target')
            device_platform = True
        offset += size
    require(offset == 32 + command_bytes and device_platform, 'Missing iOS device build metadata')


def verify_acceptance(root: Path, build: Path, metadata: dict) -> dict:
    checks = build / 'checks'
    def report(name, source=False):
        value = json.loads((checks / name).read_text())
        require(value.get('done') is True and value.get('success') is True, 'Acceptance report not successful: ' + name)
        if source:
            require(value.get('commit') == metadata['commit'] and str(value.get('run')) == metadata['run'], 'Acceptance source/run mismatch: ' + name)
        return value
    # Original native suites retain their own assertions and inventory.
    for name in ['playback-online.json', 'playback-offline.json', 'system-theme.json', 'system-theme-restart.json']:
        report(name)
    original = json.loads((checks / 'UI-MANIFEST.json').read_text())
    require(original.get('commit') == metadata['commit'] and str(original.get('run')) == metadata['run'] and
            original.get('count') == len(original.get('screenshots', [])) == 54, 'Original 54-image gate missing or from other source')
    require(len({e['image'] for e in original['screenshots']}) == 54 and len({e['report'] for e in original['screenshots']}) == 54, 'Duplicate original visual evidence')
    for item in original['screenshots']:
        path = checks / item['image']
        require(path.name == item['image'] and sha256(path) == item['sha256'] and path.stat().st_size == item['bytes'], 'Original screenshot integrity mismatch')
        require(item['report'] == Path(item['report']).name, 'Unsafe evidence path')
        report(item['report'])
    native = report('library-native.json', True)
    require(native.get('host') == 'Darwin' and [e['name'] for e in native['executed']] == ['webdav-core', 'resumable-transfer', 'portable-backup'], 'Actual Apple native library tests missing')
    for item, minimum in zip(native['executed'], [50, 19, 30]):
        require(item['log'] == Path(item['log']).name and item['assertions'] >= minimum and sha256(checks / item['log']) == item['sha256'], 'Native test execution evidence mismatch')
    library = report('library-acceptance.json', True)
    phases = {'online':12, 'full-restored':2, 'playlists-restored':1, 'ui-webdav':1, 'ui-downloads':1, 'ui-backup':1, 'cover-cd':1, 'cover-square':1, 'offline':2}
    require(set(library['phases']) == set(phases) and library['checks'] == sum(phases.values()), 'Incomplete actual App library acceptance')
    for phase, count in phases.items():
        value = report('library-' + phase + '.json')
        require(value['phase'] == 'library-' + phase and len(value['checks']) == count and all(c.get('ok') is True for c in value['checks']), 'Missing actual App library assertions')
    require(len(library.get('screenshots', [])) == 5, 'Missing new production UI/cover images')
    require(len({e['name'] for e in library['screenshots']}) == 5, 'Duplicate new visual evidence')
    for item in library['screenshots']:
        path = checks / item['name']
        require(path.name == item['name'] and path.name.startswith('feature-library-') and sha256(path) == item['sha256'] and path.stat().st_size == item['bytes'], 'Feature screenshot integrity mismatch')
    require(library.get('network', {}).get('verifiedResume') is True and library['network'].get('offlineServiceStopped') is True and library['network'].get('publishedMoves', 0) >= 2, 'Independent network/backup/download evidence missing')
    # The same checked-out source must still supply all application code and tests.
    source = root / 'lx-build-source.zip'
    with checked_zip(source) as archive:
        require(archive.comment.decode('ascii') == metadata['commit'], 'Build source snapshot commit differs')
        count = 0
        for item in archive.infolist():
            name = item.filename
            if item.is_dir(): continue
            if name.startswith(('src/', 'scripts/', 'ios/LxMusicMobile/')) or name in ['package.json', 'package-lock.json', 'index.js']:
                require((root / name).is_file() and (root / name).read_bytes() == archive.read(name), 'Build source changed during validation: ' + name)
                count += 1
        require(count > 500, 'Incomplete source snapshot')
    result = {'done': True, 'success': True, 'commit': metadata['commit'], 'run': metadata['run'], 'originalScreenshots':54,
              'libraryPhases':sorted(phases), 'newScreenshots':5, 'sourceFiles':count, 'physicalDeviceTested':False}
    (checks / 'BUILD88-ACCEPTANCE.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def verify_binaries(build: Path, metadata: dict) -> dict:
    ipa_name, archive_name = binary_names(metadata)
    files = {name: build / name for name in (ipa_name, archive_name)}
    require(all(path.is_file() for path in files.values()), 'Both IPA and xcarchive are required')
    expected_sums = {name: sha256(path) for name, path in files.items()}
    sums = {}
    for line in (build / 'SHA256SUMS.txt').read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})\s+\*?([^/\\\s]+)', line)
        require(match is not None and match[2] not in sums, 'Invalid or duplicate checksum line')
        sums[match[2]] = match[1]
    require(sums == expected_sums, 'Checksum text must match exactly the two binary packages')
    actual_metadata = dict(line.split('=', 1) for line in
                           (build / 'BUILD-METADATA.txt').read_text(encoding='utf-8').splitlines())
    require(actual_metadata == metadata, 'Build metadata is inconsistent with the source/run')
    with checked_zip(files[ipa_name]) as ipa, checked_zip(files[archive_name]) as archive:
        info = plistlib.loads(ipa.read(APP_ROOT + 'Info.plist'))
        check_info(info, metadata)
        prefix = ARCHIVE_ROOT + 'Products/Applications/LxMusicMobile.app/'
        archive_info = plistlib.loads(archive.read(ARCHIVE_ROOT + 'Info.plist'))['ApplicationProperties']
        require(archive_info.get('CFBundleIdentifier') == BUNDLE and
                archive_info.get('CFBundleVersion') == metadata['build'] and
                archive_info.get('CFBundleShortVersionString') == metadata['version'] and
                archive_info.get('Architectures') == ['arm64'] and
                archive_info.get('Team') == TEAM and not archive_info.get('SigningIdentity'),
                'Archive identity/platform/signing metadata mismatch')
        ipa_files = {n[len(APP_ROOT):] for n in ipa.namelist() if n.startswith(APP_ROOT) and not n.endswith('/')}
        archive_files = {n[len(prefix):] for n in archive.namelist() if n.startswith(prefix) and not n.endswith('/')}
        require(ipa_files == archive_files, 'IPA and archive have different application file sets')
        require(not any('_CodeSignature' in n.split('/') or n.endswith('embedded.mobileprovision') for n in ipa_files),
                'Unexpected signing files in unsigned package')
        require(ipa.getinfo(APP_ROOT + 'main.jsbundle').file_size > 1024, 'Missing production JavaScript bundle')
        require(json.loads(ipa.read(APP_ROOT + PROVENANCE)) == metadata, 'In-app source/run marker differs')
        verify_executable(ipa.read(APP_ROOT + 'LxMusicMobile'))
        for name in sorted(ipa_files):
            with ipa.open(APP_ROOT + name) as left, archive.open(prefix + name) as right:
                while True:
                    a, b = left.read(1024 * 1024), right.read(1024 * 1024)
                    require(a == b, f'IPA/archive application bytes differ: {name}')
                    if not a:
                        break
    result = {'binary_validation': True, 'metadata': metadata, 'binaries': expected_sums,
              'release_assets': [ipa_name, archive_name, 'SHA256SUMS.txt'],
              'scope': 'Binary/ZIP/source marker validation; native UI and runtime tests are separate mandatory workflow gates.'}
    (build / 'checks').mkdir(parents=True, exist_ok=True)
    (build / 'checks/release-validation.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result


def gh_api(endpoint: str, method: str = 'GET', payload: dict | None = None, allow_missing: bool = False):
    args = ['gh', 'api', '--method', method, endpoint]
    if payload is not None:
        args += ['--input', '-']
    result = subprocess.run(args, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True, timeout=180, check=False)
    if result.returncode:
        if allow_missing and 'HTTP 404' in result.stderr:
            return None
        raise RuntimeError(f'GitHub {method} failed for the requested release; HTTP/CLI operation did not succeed')
    return json.loads(result.stdout) if result.stdout.strip() else None


def release_inventory(release: dict, local: dict[str, Path]) -> dict:
    assets = release.get('assets', [])
    require(isinstance(assets, list), 'Invalid release asset listing')
    existing = {a['name']: a for a in assets}
    require(len(existing) == len(assets) and not set(existing).difference(local), 'Unexpected/duplicate release assets; refusing deletion')
    for name, remote in existing.items():
        require(remote.get('state') == 'uploaded' and remote.get('size') == local[name].stat().st_size and
                remote.get('digest') == 'sha256:' + sha256(local[name]),
                f'Existing release asset differs; refusing overwrite: {name}')
    return existing


def publish(root: Path, build: Path, metadata: dict, verified: dict) -> dict:
    tag = f"v{metadata['version']}-ios-build{metadata['build']}"
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'Wrong target repository')
    require(os.environ.get('GITHUB_REF') in ['refs/heads/master', 'refs/tags/' + tag], 'Ref does not match permitted master/version build')
    verify_acceptance(root, build, metadata)
    notes = notes_for_release((root / 'docs/releases' / f"BUILD{metadata['build']}.md").read_text(encoding='utf-8'), metadata)
    local = {name: build / name for name in verified['release_assets']}
    require(set(local) == {*binary_names(metadata), 'SHA256SUMS.txt'}, 'Publication allowlist changed')
    # Publish the already validated master artifact, rather than rebuilding for
    # a release tag. GITHUB_TOKEN-created tags do not trigger another push run.
    current = gh_api(f'repos/{REPOSITORY}/git/ref/heads/master')['object']
    require(current.get('type') == 'commit' and current.get('sha') == metadata['commit'], 'Master changed while this build ran; refusing stale publication')
    run = gh_api(f"repos/{REPOSITORY}/actions/runs/{metadata['run']}")
    require(run.get('head_sha') == metadata['commit'] and run.get('path') == '.github/workflows/ios-ipa.yml' and
            run.get('event') in ['push', 'workflow_dispatch'], 'Publication workflow/source identity mismatch')
    tag_result = gh_api(f'repos/{REPOSITORY}/git/ref/tags/{tag}', allow_missing=True)
    if tag_result is None:
        gh_api(f'repos/{REPOSITORY}/git/refs', 'POST', {'ref': 'refs/tags/' + tag, 'sha': metadata['commit']})
        tag_result = gh_api(f'repos/{REPOSITORY}/git/ref/tags/{tag}')
    tag_ref = tag_result['object']
    for _ in range(5):
        if tag_ref.get('type') == 'commit':
            break
        require(tag_ref.get('type') == 'tag', 'Unexpected Git tag object')
        tag_ref = gh_api(f"repos/{REPOSITORY}/git/tags/{tag_ref['sha']}")['object']
    require(tag_ref.get('type') == 'commit' and tag_ref.get('sha') == metadata['commit'],
            'Release tag moved or points to a different source commit')
    endpoint = f'repos/{REPOSITORY}/releases/tags/{tag}'
    release = gh_api(endpoint, allow_missing=True)
    title = f"LX Music iOS / iPadOS v{metadata['version']} · Build{metadata['build']} (unsigned)"
    if release is None:
        release = gh_api(f'repos/{REPOSITORY}/releases', 'POST', {
            'tag_name': tag, 'target_commitish': metadata['commit'], 'name': title,
            'body': notes, 'draft': True, 'prerelease': False, 'generate_release_notes': False})
    require(release.get('tag_name') == tag and release.get('body') == notes, 'Existing release tag/notes differ; refusing replacement')
    existing = release_inventory(release, local)
    for name, file in local.items():
        if name in existing:
            continue
        require(release.get('draft') is True, 'An already-published release is missing assets; refusing to mutate it')
        result = subprocess.run(['gh', 'release', 'upload', tag, str(file), '--repo', REPOSITORY],
                                text=True, capture_output=True, timeout=600, check=False)
        require(result.returncode == 0, f'Upload failed: {name}')
    release = gh_api(endpoint)
    existing = release_inventory(release, local)
    require(set(existing) == set(local), 'Release upload is incomplete')
    if release.get('draft'):
        release = gh_api(f"repos/{REPOSITORY}/releases/{release['id']}", 'PATCH', {'draft': False})
    require(release.get('draft') is False, 'Release did not become public')
    return {'tag': tag, 'release': release['html_url'], 'assets': sorted(local)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--stamp-archive', action='store_true')
    parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    build = root / 'build'
    package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    metadata = expected_metadata(package, os.environ.get('GITHUB_SHA', ''), os.environ.get('GITHUB_RUN_ID', ''))
    # Stamp and verify the exact checked-out commit, not a filename or a tag label.
    checked_out = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    require(checked_out == metadata['commit'], 'Checkout differs from the requested build source')
    if args.stamp_archive:
        stamp_archive(build, metadata)
        print('Source/run provenance embedded in the unsigned archive before IPA packaging.')
        return
    report = verify_binaries(build, metadata)
    if args.publish:
        result = publish(root, build, metadata, report)
        (build / 'checks/publication.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print('Verified release published with IPA, xcarchive ZIP and one checksum text.')
    else:
        verify_acceptance(root, build, metadata)
        print('Full native/library acceptance, source consistency, ZIP CRC, SHA256 and application byte equivalence verified.')


if __name__ == '__main__':
    main()
