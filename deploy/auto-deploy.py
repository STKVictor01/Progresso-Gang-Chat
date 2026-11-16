#!/usr/bin/env python3
"""Publica a main aprovada pelo GitHub, sem executar migrações."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

REPO = 'STKVictor01/Progresso-Gang-Chat'
REMOTE = f'https://github.com/{REPO}.git'
STATE = Path('/var/lib/progresso-gang-auto-deploy')
MIRROR = STATE / 'source.git'
RELEASES = Path('/opt/progresso-gang-releases')
ENV_FILE = Path('/etc/progresso-gang/compose.env')
WORKFLOWS = {'.github/workflows/testes.yml', '.github/workflows/gitleaks.yml'}


def approved(runs, sha):
    """Usa apenas a execução push mais recente de cada fluxo para o commit exato."""
    latest = {}
    for run in runs:
        path = run.get('path')
        if (path not in WORKFLOWS or run.get('event') != 'push' or
                run.get('head_branch') != 'main' or run.get('head_sha') != sha or
                (run.get('head_repository') or {}).get('full_name', '').lower() != REPO.lower()):
            continue
        if path not in latest or run.get('id', 0) > latest[path].get('id', 0):
            latest[path] = run
    return (set(latest) == WORKFLOWS and all(
        run.get('status') == 'completed' and run.get('conclusion') == 'success'
        for run in latest.values()))


def run(*args, capture=False, env=None):
    result = subprocess.run(args, check=True, text=True, env=env,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def github_json(url):
    request = Request(url, headers={'Accept': 'application/vnd.github+json',
                                  'User-Agent': 'progresso-gang-deploy'})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def main_head():
    lines = run('git', 'ls-remote', '--heads', REMOTE, 'refs/heads/main', capture=True)
    sha = lines.split('\t')[0]
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise RuntimeError('A branch principal não pôde ser verificada.')
    return sha


def compose(release, path, *args):
    env = os.environ.copy()
    env['PG_RELEASE'] = release
    run('docker', 'compose', '--env-file', str(ENV_FILE), '-f',
        str(Path(path) / 'deploy/compose.yaml'), *args, env=env)


def write_atomic(path, text):
    fd, name = tempfile.mkstemp(prefix='.atualizacao-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def set_release(release):
    lines = ENV_FILE.read_text(encoding='utf-8').splitlines()
    if sum(line.startswith('PG_RELEASE=') for line in lines) != 1:
        raise RuntimeError('Configuração de versão inválida.')
    write_atomic(ENV_FILE, '\n'.join('PG_RELEASE=' + release if line.startswith('PG_RELEASE=') else line for line in lines) + '\n')


def healthy():
    for _ in range(24):
        try:
            statuses = [run('docker', 'inspect', '-f', '{{.State.Health.Status}}',
                            f'progresso-gang-{name}-1', capture=True)
                        for name in ('api', 'web', 'livekit')]
            with urlopen('http://127.0.0.1:3001/ready', timeout=5) as response:
                ready = json.load(response).get('ready') is True
            with urlopen('http://127.0.0.1:3001/auth/me', timeout=5) as response:
                auth = json.load(response).get('authMode') == 'supabase'
            with urlopen('http://127.0.0.1:9090/health', timeout=5) as response:
                web = response.status == 200
            if all(status == 'healthy' for status in statuses) and ready and auth and web:
                return True
        except (OSError, ValueError, subprocess.CalledProcessError):
            pass
        time.sleep(5)
    return False


def prepare(sha):
    release = RELEASES / sha
    if release.exists():
        if not (release / '.complete').is_file():
            raise RuntimeError('Versão incompleta já existe; exige revisão manual.')
        return release
    temporary = Path(tempfile.mkdtemp(prefix='.preparando-', dir=RELEASES))
    archive = subprocess.Popen(['git', '--git-dir', str(MIRROR), 'archive', sha], stdout=subprocess.PIPE)
    unpack = subprocess.run(['tar', '-x', '--no-same-owner', '-C', str(temporary)], stdin=archive.stdout)
    archive.stdout.close()
    if unpack.returncode or archive.wait():
        raise RuntimeError('Não foi possível preparar os arquivos da versão.')
    (temporary / '.complete').write_text(sha + '\n', encoding='utf-8')
    temporary.rename(release)
    return release


def main():
    marker = STATE / 'in-progress.json'
    if marker.exists():
        raise RuntimeError('Atualização interrompida; verifique a versão antes de continuar.')
    current = json.loads((STATE / 'current.json').read_text(encoding='utf-8'))
    sha = main_head()
    if sha == current['sha']:
        print('O site já está na versão principal.')
        return
    runs = github_json(f'https://api.github.com/repos/{REPO}/actions/runs?head_sha={sha}&per_page=100')
    if not approved(runs.get('workflow_runs', []), sha):
        print('Aguardando aprovação dos testes e da verificação de segredos.')
        return
    run('git', '--git-dir', str(MIRROR), 'fetch', '--no-tags', REMOTE,
        '+refs/heads/main:refs/remotes/origin/main')
    fetched = run('git', '--git-dir', str(MIRROR), 'rev-parse', 'refs/remotes/origin/main', capture=True)
    if fetched != sha:
        raise RuntimeError('A branch principal mudou; tentando novamente depois.')
    run('git', '--git-dir', str(MIRROR), 'merge-base', '--is-ancestor', current['sha'], sha)
    changed = run('git', '--git-dir', str(MIRROR), 'diff', '--name-only', current['sha'], sha, '--',
                  'supabase/migrations', 'deploy/compose.yaml', capture=True)
    if changed:
        raise RuntimeError('Mudança de banco ou infraestrutura requer revisão e publicação manual.')
    release = prepare(sha)
    run('docker', 'image', 'inspect', f"progresso-gang-api:{current['release']}",
        f"progresso-gang-web:{current['release']}", capture=True)
    compose(sha, release, 'build', 'api', 'web')
    if main_head() != sha:
        raise RuntimeError('A branch principal mudou durante a preparação.')
    write_atomic(marker, json.dumps(current) + '\n')
    try:
        compose(sha, release, 'up', '-d', '--no-build', '--no-deps', 'api', 'web')
        if not healthy():
            raise RuntimeError('A nova versão não passou nas verificações de disponibilidade.')
        set_release(sha)
        write_atomic(STATE / 'current.json', json.dumps({'sha': sha, 'release': sha, 'path': str(release)}) + '\n')
        marker.unlink()
        print('Atualização concluída:', sha[:12])
    except Exception:
        print('Falha na atualização; restaurando a versão anterior.', file=sys.stderr)
        set_release(current['release'])
        compose(current['release'], current['path'], 'up', '-d', '--no-build', '--no-deps', 'api', 'web')
        if healthy():
            write_atomic(STATE / 'current.json', json.dumps(current) + '\n')
            marker.unlink()
        else:
            print('Restauração precisa de atenção manual.', file=sys.stderr)
        raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Publicação automática interrompida:', error, file=sys.stderr)
        sys.exit(1)
