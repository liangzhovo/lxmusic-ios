#!/usr/bin/env python3
"""Fail-closed parser, identity, diagnostics and simulator-only CI contracts."""
import importlib.util, pathlib, plistlib, shutil, struct, subprocess, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('sim_keychain', ROOT / 'scripts/verify-simulator-keychain.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

def fixture(identity=None, platform=7, with_xml=True, groups=None):
    identity = identity or module.TEAM + '.' + module.BUNDLE
    value = {'application-identifier': identity}
    if groups is not None: value['keychain-access-groups'] = groups
    xml = plistlib.dumps(value) if with_xml else b''
    segment_size = 152 if with_xml else 72
    end = 32 + 24 + segment_size + 16
    segment = struct.pack('<II16sQQQQiiII', 0x19, segment_size, b'__TEXT', 0, end+len(xml), 0, end+len(xml), 7, 5, int(with_xml), 0)
    if with_xml:
        segment += struct.pack('<16s16sQQIIIIIIII', b'__entitlements', b'__TEXT', end, len(xml), end, 0, 0, 0, 0, 0, 0, 0)
    commands = struct.pack('<IIIIII', 0x32, 24, platform, 15 << 16, 0, 0) + segment + struct.pack('<IIII', 0x1D, 16, end+len(xml), 8)
    return struct.pack('<IiiIIIII', 0xFEEDFACF, 0x100000C, 0, 2, 3, len(commands), 0, 0) + commands + xml + b'SIGNTEST'

class Checks(unittest.TestCase):
    def test_default_private_keychain_group(self):
        r = module.inspect(fixture())
        self.assertEqual(r['accessGroups'], [module.TEAM + '.' + module.BUNDLE])
    def test_explicit_matching_group(self):
        self.assertTrue(module.inspect(fixture(groups=[module.TEAM + '.' + module.BUNDLE]))['embeddedXML'])
    def test_foreign_and_wildcard_groups_rejected(self):
        for groups in [['*'], ['other.app'], []]:
            with self.assertRaises(ValueError): module.inspect(fixture(groups=groups))
    def test_wrong_app_identifier_rejected(self):
        with self.assertRaises(ValueError): module.inspect(fixture(identity='other.app'))
    def test_device_and_missing_entitlements_rejected(self):
        for raw in [fixture(platform=2), fixture(with_xml=False)]:
            with self.assertRaises(ValueError): module.inspect(raw)
    def test_truncated_and_malformed_commands_rejected(self):
        raw = fixture()
        for broken in [raw[:16], raw[:-1], raw[:36] + struct.pack('<I', 7) + raw[40:]]:
            with self.assertRaises(ValueError): module.inspect(broken)
    def test_simulator_only_signing_scope_and_all_gates_retained(self):
        workflow = (ROOT / '.github/workflows/ios-ipa.yml').read_text()
        simulator = workflow.split('- name: Build simulator app for real playback regression', 1)[1].split('- name:', 1)[0]
        self.assertIn('CODE_SIGN_IDENTITY="-"', simulator)
        self.assertIn('CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES', simulator)
        self.assertIn('verify-simulator-keychain.py', simulator)
        device = workflow.split('- name: Build unsigned Xcode archive', 1)[1].split('- name:', 1)[0]
        self.assertIn('CODE_SIGNING_ALLOWED=NO', device); self.assertIn('CODE_SIGNING_REQUIRED=NO', device)
        self.assertIn('DEVELOPMENT_TEAM="$IOS_TEAM_ID"', device)
        self.assertIn("assert len(images) == 54", workflow)
        self.assertIn('python3 scripts/run-ios-library-smoke.py', workflow)
        self.assertIn('ios_release_policy.py --publish', workflow)
    def test_diagnostics_execute_without_exposing_secrets(self):
        source = (ROOT / 'ios/LxMusicMobile/LXLibrarySupport.swift').read_text()
        block = source.split('struct LXKeychainFailure:', 1)[1].split('protocol LXSecretVault', 1)[0]
        swift = 'import Foundation\ntypealias OSStatus = Int32\nstruct LXKeychainFailure:' + block
        swift += '''
for operation in [LXKeychainFailure.Operation.read, .update, .add, .delete, .snapshot] {
  let error = LXKeychainFailure(operation: operation, status: -34018)
  assert(error.localizedDescription == "钥匙串操作失败（\\(operation.rawValue)，OSStatus=-34018）")
}
print("PASS fixed operation and numeric OSStatus only")
'''
        with tempfile.TemporaryDirectory() as tmp:
            file = pathlib.Path(tmp) / 'test.swift'; file.write_text(swift)
            compiler = shutil.which('swiftc'); self.assertIsNotNone(compiler)
            subprocess.run([compiler, str(file), '-o', tmp + '/test'], check=True, timeout=60)
            subprocess.run([tmp + '/test'], check=True, timeout=10)
        for operation in ['read', 'update', 'add', 'delete', 'snapshot']:
            self.assertIn('LXKeychainFailure(operation: .' + operation, source)
        self.assertIn('kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly', source)
        self.assertIn('kSecAttrSynchronizable as String: false', source)
        self.assertNotIn('UserDefaults', source.split('final class LXKeychainVault', 1)[1].split('final class LXOperationRegistry', 1)[0])

if __name__ == '__main__': unittest.main(verbosity=2)
