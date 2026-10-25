#!/usr/bin/env python3
"""Regression checks for optional diagnostics; native success is not simulated."""
import ast
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
path = Path(__file__).with_name('run-ios-playback-smoke.py')
spec = importlib.util.spec_from_file_location('smoke_driver', path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

class SamplingTests(unittest.TestCase):
    def test_timeout_does_not_mask_playback_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(driver, 'OUT', Path(folder)), patch.object(driver, 'command', side_effect=subprocess.TimeoutExpired(['sample'], 15)):
            driver.sample_process('1234', Path(folder) / 'threads.txt')
            log = (Path(folder) / 'native-driver.log').read_text()
            self.assertIn('DIAGNOSTIC-ONLY', log)
            self.assertIn('TimeoutExpired', log)

    def test_missing_sampler_does_not_mask_playback_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(driver, 'OUT', Path(folder)), patch.object(driver, 'command', side_effect=FileNotFoundError('sample')):
            driver.sample_process('1234', Path(folder) / 'threads.txt')
            self.assertIn('FileNotFoundError', (Path(folder) / 'native-driver.log').read_text())

    def test_success_invokes_sample_with_a_deadline(self):
        with patch.object(driver, 'command', return_value='completed') as command:
            driver.sample_process('1234', Path('/tmp/threads.txt'))
            command.assert_called_once_with('/usr/bin/sample', '1234', '2', '-file', '/tmp/threads.txt', check=False, timeout=15)

    def test_invalid_pid_rejected(self):
        with self.assertRaises(ValueError):
            driver.sample_process('not-a-pid', Path('/tmp/threads.txt'))

    def test_sampler_failure_does_not_suppress_native_release_gate(self):
        tree = ast.parse(path.read_text())
        gates = [node for node in ast.walk(tree) if isinstance(node, ast.If) and isinstance(node.test, ast.Name) and node.test.id == 'native_failures']
        self.assertEqual(len(gates), 1)
        self.assertIsInstance(gates[0].body[0], ast.Raise)
        self.assertIn('device archive remains blocked', ast.unparse(gates[0]))
        self.assertIn('if len(inventory) != 54:', path.read_text())

class DriverFailureTests(unittest.TestCase):
    def test_command_timeout_retains_command_and_partial_output(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(driver, 'OUT', Path(folder)), patch.object(driver.subprocess, 'run', side_effect=subprocess.TimeoutExpired(['simctl', 'install'], 180, output=b'install is waiting')):
            with self.assertRaisesRegex(RuntimeError, 'Command timed out'):
                driver.command('simctl', 'install')
            log = (Path(folder) / 'native-driver.log').read_text()
            self.assertIn('$ simctl install', log)
            self.assertIn('install is waiting', log)
            self.assertIn('TIMEOUT after 180s', log)

    def test_command_nonzero_is_not_green_and_retains_exit(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(driver, 'OUT', Path(folder)), patch.object(driver.subprocess, 'run', return_value=subprocess.CompletedProcess(['test'], 7, 'failed')):
            with self.assertRaisesRegex(RuntimeError, 'Command failed'):
                driver.command('test')
            self.assertIn('EXIT 7', (Path(folder) / 'native-driver.log').read_text())

    def test_offline_requires_successful_completed_online_phase(self):
        for report in [None, {}, {'done': True}, {'success': True}, {'done': False, 'success': True}, {'done': True, 'success': False}, {'done': True, 'success': 'true'}]:
            self.assertFalse(driver.offline_prerequisite(report), report)
        self.assertTrue(driver.offline_prerequisite({'done': True, 'success': True}))

    def test_phone_creation_stops_only_preceding_owned_device(self):
        with patch.object(driver, 'simctl') as command:
            driver.prepare_next_device(None)
            command.assert_not_called()
            driver.prepare_next_device('owned-tablet-uuid')
            self.assertEqual(command.call_args_list[0].args, ('terminate', 'owned-tablet-uuid', driver.BUNDLE))
            self.assertEqual(command.call_args_list[1].args, ('shutdown', 'owned-tablet-uuid'))
            self.assertEqual(command.call_count, 2)
        source = path.read_text()
        self.assertLess(source.index('prepare_next_device(active_simulator)'), source.index("simctl('create'"))

class OwnedSimulatorLifecycleTests(unittest.TestCase):
    def lifecycle(self):
        from simulator_app_lifecycle import OwnedSimulatorApps
        from unittest.mock import Mock
        command = Mock(return_value='')
        return OwnedSimulatorApps(command, 'fixture.app'), command

    def test_first_launch_does_not_terminate_a_nonexistent_process(self):
        apps, command = self.lifecycle()
        apps.register('new-owned-device')
        apps.before_launch('new-owned-device')
        command.assert_not_called()

    def test_every_later_phase_still_terminates_before_launch(self):
        apps, command = self.lifecycle()
        apps.register('new-owned-device')
        for _ in range(3):
            apps.before_launch('new-owned-device')
        self.assertEqual(command.call_count, 2)
        command.assert_called_with('terminate', 'new-owned-device', 'fixture.app', check=False)

    def test_launch_uncertainty_cannot_skip_next_phase_cleanup(self):
        apps, command = self.lifecycle()
        apps.register('new-owned-device')
        apps.before_launch('new-owned-device')  # launch then fails or times out
        command.side_effect = RuntimeError('CoreSimulator terminate timed out')
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            apps.before_launch('new-owned-device')
        self.assertEqual(command.call_count, 1)

    def test_new_devices_do_not_share_launch_state(self):
        apps, command = self.lifecycle()
        apps.register('owned-tablet'); apps.before_launch('owned-tablet')
        apps.register('owned-phone'); apps.before_launch('owned-phone')
        command.assert_not_called()

    def test_unowned_or_duplicate_device_is_rejected(self):
        apps, command = self.lifecycle()
        with self.assertRaises(ValueError): apps.before_launch('user-device')
        apps.register('owned')
        with self.assertRaises(ValueError): apps.register('owned')
        with self.assertRaises(ValueError): apps.register('')
        command.assert_not_called()

    def test_both_drivers_use_tracking_and_keep_all_acceptance_gates(self):
        for filename in ['run-ios-playback-smoke.py', 'run-ios-library-smoke.py']:
            source = path.with_name(filename).read_text()
            self.assertIn('apps.register(simulator)', source)
            self.assertIn('apps.before_launch(simulator)', source)
            self.assertLess(source.index('apps.register(simulator)'), source.rindex('apps.before_launch(simulator)'))
        self.assertIn("'status': 'driver-failed'", path.read_text())
        self.assertIn('if len(inventory) != 54:', path.read_text())
        library = path.with_name('run-ios-library-smoke.py').read_text()
        self.assertIn("'full-restored'", library)
        self.assertIn("'offline'", library)
        self.assertIn("len(record['screenshots']) != 5", library)

if __name__ == '__main__':
    unittest.main(verbosity=2)
