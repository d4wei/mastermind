"""Deterministic checks for readiness harness cleanup ownership."""
import importlib.util
from pathlib import Path
import unittest

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


if __name__ == '__main__':
    unittest.main()
