"""Deterministic checks for readiness harness cleanup ownership."""
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('readiness', Path(__file__).with_name('measure-readiness.py'))
readiness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readiness)


class OwnershipTests(unittest.TestCase):
    def test_only_successful_requested_admission_owns_cleanup_pid(self):
        fixture = Path('/fixture.md')
        response = {'pid': 123, 'results': [{'status': 'opened', 'canonical': str(fixture)}]}
        self.assertEqual(readiness.admitted_host_pid(response, 456, fixture), 123)
        for pid in (0, -1, True, '123', 456):
            with self.assertRaises(AssertionError):
                readiness.admitted_host_pid(dict(response, pid=pid), 456, fixture)
        for result in ({'status': 'error', 'canonical': str(fixture)},
                       {'status': 'opened', 'canonical': '/other.md'}):
            with self.assertRaises(AssertionError):
                readiness.admitted_host_pid(dict(response, results=[result]), 456, fixture)

    def test_trial_uses_disposable_completed_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            fixture = root / 'fixture.md'
            fixture.write_bytes(b'# Fixture\n')

            def launch(arguments, **kwargs):
                environment = kwargs['env']
                preferences = Path(environment['MM_LAUNCH_CHECK_PREFERENCES'])
                self.assertEqual(preferences.parent, root)
                self.assertEqual(json.loads(preferences.read_bytes()), {
                    'onboardingCompleted': True, 'authorTag': 'Readiness',
                    'uiLang': 'en', 'translationLanguage': None,
                })
                config = json.loads(environment['MM_LAUNCH_CHECK_READY_TRACE'])
                Path(config['output']).write_text(json.dumps({
                    'nonce': config['nonce'], 'target': str(fixture), 'pid': 123,
                    'session_id': '0', 'stage': 'document_layout_two_frames',
                }), encoding='utf-8')
                response = json.dumps({'pid': 123, 'results': [
                    {'status': 'opened', 'canonical': str(fixture)},
                ]}).encode()
                return SimpleNamespace(pid=456, returncode=0, poll=lambda: 0,
                                       communicate=lambda **_: (response, b''))

            with patch.object(readiness.subprocess, 'Popen', side_effect=launch), \
                    patch.object(readiness, 'stop') as stop:
                result = readiness.trial(Path('/unused'), fixture, root)
            self.assertEqual(result['host_pid'], 123)
            stop.assert_called_once_with(123)
            self.assertEqual(fixture.read_bytes(), b'# Fixture\n')


if __name__ == '__main__':
    unittest.main()
