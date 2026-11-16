import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('auto_deploy', Path(__file__).with_name('auto-deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

SHA = 'a' * 40


def workflow(path, **overrides):
    result = {'path': path, 'event': 'push', 'head_branch': 'main', 'head_sha': SHA,
              'head_repository': {'full_name': deploy.REPO}, 'id': 1,
              'status': 'completed', 'conclusion': 'success'}
    result.update(overrides)
    return result


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.runs = [workflow(path) for path in deploy.WORKFLOWS]

    def test_requires_both_approved_for_exact_push(self):
        self.assertTrue(deploy.approved(self.runs, SHA))
        self.assertFalse(deploy.approved(self.runs[:1], SHA))
        for change in ({'event': 'pull_request'}, {'head_sha': 'b' * 40},
                       {'head_branch': 'outra'}, {'status': 'in_progress'},
                       {'conclusion': 'failure'}, {'head_repository': {'full_name': 'other/repo'}}):
            self.assertFalse(deploy.approved([dict(self.runs[0], **change), self.runs[1]], SHA))

    def test_newest_failure_or_pending_is_not_hidden_by_previous_success(self):
        for change in ({'conclusion': 'failure'}, {'status': 'in_progress', 'conclusion': None}):
            self.assertFalse(deploy.approved(self.runs + [dict(self.runs[0], id=2, **change)], SHA))

    def test_failed_health_restores_previous_release(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            old = {'sha': 'b' * 40, 'release': 'anterior', 'path': '/previous'}
            (state / 'current.json').write_text(json.dumps(old), encoding='utf-8')
            def command(*args, capture=False, **kwargs):
                if 'rev-parse' in args:
                    return SHA
                return '' if capture else None
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'main_head', return_value=SHA), \
                 patch.object(deploy, 'github_json', return_value={'workflow_runs': self.runs}), \
                 patch.object(deploy, 'run', side_effect=command), patch.object(deploy, 'prepare', return_value=state), \
                 patch.object(deploy, 'compose') as compose, patch.object(deploy, 'healthy', side_effect=[False, True]), \
                 patch.object(deploy, 'set_release') as set_release:
                with self.assertRaisesRegex(RuntimeError, 'não passou'):
                    deploy.main()
                self.assertEqual(compose.call_args_list[-1].args[:2], ('anterior', '/previous'))
                set_release.assert_called_once_with('anterior')
                self.assertEqual(json.loads((state / 'current.json').read_text()), old)
                self.assertFalse((state / 'in-progress.json').exists())

    def test_database_changes_stop_before_build(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            (state / 'current.json').write_text(json.dumps({'sha': 'b' * 40}), encoding='utf-8')
            def command(*args, capture=False, **kwargs):
                if 'rev-parse' in args:
                    return SHA
                return 'supabase/migrations/new.sql' if 'diff' in args else None
            with patch.object(deploy, 'STATE', state), patch.object(deploy, 'main_head', return_value=SHA), \
                 patch.object(deploy, 'github_json', return_value={'workflow_runs': self.runs}), \
                 patch.object(deploy, 'run', side_effect=command), patch.object(deploy, 'compose') as compose:
                with self.assertRaisesRegex(RuntimeError, 'banco ou infraestrutura'):
                    deploy.main()
                compose.assert_not_called()


if __name__ == '__main__':
    unittest.main()
