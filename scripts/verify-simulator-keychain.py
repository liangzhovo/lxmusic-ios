#!/usr/bin/env python3
"""Read the built simulator Mach-O, not a source entitlements file.

Xcode embeds simulated iOS entitlements in __TEXT; its macOS ad-hoc code
signature is a separate object. This checks only CI's simulator app. The device
Archive/IPA stays unsigned with its existing identity and validation policy.
"""
from __future__ import annotations
import hashlib, json, os, plistlib, struct, subprocess, sys
from pathlib import Path

BUNDLE = 'com.skyhc.lxmusic'
TEAM = 'LW54AZ8PXT'

def require(condition, message):
    if not condition: raise ValueError(message)

def inspect(raw: bytes) -> dict:
    require(len(raw) >= 32, 'Truncated simulator Mach-O')
    magic, cpu, subtype, kind, count, command_bytes, flags, reserved = struct.unpack_from('<IiiIIIII', raw)
    end = 32 + command_bytes
    require(magic == 0xFEEDFACF and cpu == 0x100000C and kind == 2 and 0 < count <= 10000 and end <= len(raw),
            'Expected a thin arm64 simulator executable')
    offset = 32; platform = None; entitlements = None; signature = False; der = None
    for _ in range(count):
        require(offset + 8 <= end, 'Truncated load command')
        command, size = struct.unpack_from('<II', raw, offset)
        require(size >= 8 and size % 4 == 0 and offset + size <= end, 'Invalid load command size')
        if command == 0x32:
            require(size >= 24 and platform is None, 'Invalid build-version command')
            platform = struct.unpack_from('<I', raw, offset + 8)[0]
        if command == 0x1D:
            require(size == 16, 'Invalid signature command')
            start, length = struct.unpack_from('<II', raw, offset + 8)
            require(start >= end and length > 0 and start + length <= len(raw), 'Invalid signature bounds')
            signature = True
        if command == 0x19:
            require(size >= 72, 'Invalid segment command')
            sections = struct.unpack_from('<I', raw, offset + 64)[0]
            require(72 + 80 * sections == size, 'Invalid section count')
            for i in range(sections):
                section = offset + 72 + 80 * i
                name = raw[section:section+16].split(b'\0', 1)[0]
                segment = raw[section+16:section+32].split(b'\0', 1)[0]
                if segment != b'__TEXT' or name not in (b'__entitlements', b'__ents_der'): continue
                length = struct.unpack_from('<Q', raw, section + 40)[0]
                start = struct.unpack_from('<I', raw, section + 48)[0]
                require(start >= end and 0 < length <= 1024 * 1024 and start + length <= len(raw), 'Invalid entitlement section bounds')
                content = raw[start:start+length]
                if name == b'__entitlements':
                    require(entitlements is None, 'Duplicate simulated entitlements')
                    entitlements = plistlib.loads(content.rstrip(b'\0'))
                else:
                    require(der is None, 'Duplicate simulated DER entitlements')
                    der = hashlib.sha256(content).hexdigest()
        offset += size
    require(offset == end and platform == 7, 'Not an iOS Simulator executable')
    require(signature, 'Simulator app lacks its normal ad-hoc signature')
    require(isinstance(entitlements, dict), 'Built simulator app lacks embedded iOS entitlements')
    identity = TEAM + '.' + BUNDLE
    require(entitlements.get('application-identifier') == identity, 'Simulator application identifier mismatch')
    groups = entitlements.get('keychain-access-groups', [identity])
    require(isinstance(groups, list) and groups and set(groups) == {identity}, 'Unexpected simulator Keychain groups')
    require(entitlements.get('com.apple.developer.team-identifier', TEAM) == TEAM, 'Simulator team mismatch')
    return {'platform': 'iOS Simulator', 'applicationIdentifier': identity, 'accessGroups': groups,
            'embeddedXML': True, 'embeddedDERSHA256': der, 'executableSHA256': hashlib.sha256(raw).hexdigest()}

def main():
    root = Path(__file__).resolve().parent.parent
    require(len(sys.argv) == 2, 'Expected built simulator .app path')
    app = Path(sys.argv[1]).resolve()
    expected = root / 'build/Simulator/Build/Products/Release-iphonesimulator/LxMusicMobile.app'
    require(app == expected.resolve(), 'Refusing a non-CI-simulator application path')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    require(info.get('CFBundleIdentifier') == BUNDLE and info.get('CFBundleExecutable') == 'LxMusicMobile', 'Simulator bundle mismatch')
    require(info.get('DTPlatformName') == 'iphonesimulator', 'Refusing a device archive')
    result = inspect((app / 'LxMusicMobile').read_bytes())
    # Verification only. Never re-sign or alter an existing app here.
    subprocess.run(['/usr/bin/codesign', '--verify', '--strict', str(app)], check=True, timeout=30)
    result.update(done=True, success=True, commit=os.environ['GITHUB_SHA'], run=os.environ['GITHUB_RUN_ID'], deviceArchiveUnchanged=True)
    out = root / 'build/checks/simulator-keychain.json'
    out.write_text(json.dumps(result, indent=2) + '\n')
    print('PASS built simulator identity, embedded iOS Keychain access and ad-hoc signature; device signing unchanged')

if __name__ == '__main__': main()
