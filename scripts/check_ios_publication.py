#!/usr/bin/env python3
"""Checks for release validation / fail-closed branch selection, without writes."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

path = Path(__file__).with_name('publish_ios_release.py')
spec = importlib.util.spec_from_file_location('publish_ios_release', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicationTests(unittest.TestCase):
    def test_native_report_must_be_complete_and_successful(self):
        good = {'done': True, 'success': True, 'checks': [{'ok': True}] * 32}
        module.validate_report(good, 32, 'online')
        for bad in [dict(good, done=False), dict(good, success=False),
                    dict(good, checks=good['checks'][:-1]),
                    dict(good, checks=[{'ok': False}] + good['checks'][1:])]:
            with self.assertRaises(RuntimeError):
                module.validate_report(bad, 32, 'online')

    def test_burst_requires_both_formats_and_real_advance(self):
        checks = [{'name': f'{fmt}: real keyboard burst keeps only the latest seek target', 'ok': True,
                   'detail': {'requests': [8, 13, 8, 13, 8, 13], 'target': 13,
                              'uiAfterBurst': [13, 13.4], 'nativePosition': 14.0}}
                  for fmt in ('mp3', 'flac')]
        module.validate_bursts({'checks': checks})
        with self.assertRaises(RuntimeError):
            module.validate_bursts({'checks': checks[:1]})
        for field, value in [('nativePosition', 13), ('nativePosition', float('nan')),
                             ('uiAfterBurst', [13, 8]), ('target', 8), ('requests', [13])]:
            bad = copy.deepcopy(checks)
            bad[0]['detail'][field] = value
            with self.assertRaises(RuntimeError):
                module.validate_bursts({'checks': bad})

    def test_archive_paths_cannot_escape(self):
        for name in ['../bad', '/bad', 'safe/../../bad', 'a\\b']:
            with self.assertRaises(RuntimeError):
                module.safe_name(name)
        self.assertEqual(module.safe_name('normal/file.txt'), 'normal/file.txt')

    def test_snapshot_refuses_new_or_moved_branches(self):
        manifest = {'main_branch': 'master', 'old_branches': {'old': 'abc'}}
        module.validate_ref_snapshot(manifest, {'master': 'new', 'old': 'abc'}, {})
        module.validate_ref_snapshot(manifest, {'master': 'new'}, {'old': 'abc'})
        for live, archived in [({'master': 'new', 'old': 'changed'}, {}),
                               ({'master': 'new', 'old': 'abc', 'new-work': 'def'}, {}),
                               ({'master': 'new'}, {}), ({'master': 'new'}, {'old': 'wrong'})]:
            with self.assertRaises(RuntimeError):
                module.validate_ref_snapshot(manifest, live, archived)

    def test_changed_artifact_digest_is_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / 'ipa.zip'
            with zipfile.ZipFile(artifact, 'w') as archive:
                archive.writestr('BUILD-METADATA.txt', 'wrong')
            manifest = {'artifacts': {'ipa': {'sha256': '0' * 64}}}
            with self.assertRaisesRegex(RuntimeError, 'outer SHA256 mismatch'):
                module.verify_artifacts(manifest, {'ipa': artifact}, root / 'output')
            self.assertFalse((root / 'output').exists())

    def test_unsigned_pinned_manifest(self):
        manifest = json.loads((path.parent.parent / 'docs/releases/build87.json').read_text())
        self.assertEqual(manifest['build_commit'], 'a29a9d758fd601d42fd22a4a5e1d009537a2df73')
        self.assertEqual(manifest['run_id'], 35008293921)
        self.assertEqual(manifest['build'], '87')
        self.assertEqual(len(manifest['old_branches']), 6)
        self.assertNotIn(manifest['main_branch'], manifest['old_branches'])
        self.assertEqual(len(manifest['binaries']), 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
