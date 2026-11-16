// Copia somente fontes publicáveis para um alvo descartável; nunca o checkout inteiro.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const git = process.platform === 'win32' && fs.existsSync('C:/Program Files/Git/cmd/git.exe')
  ? 'C:/Program Files/Git/cmd/git.exe' : 'git';
const allowed = relative => /^(?:AGENTS\.md|README\.md|SECURITY\.md|\.gitleaks\.toml|\.gitignore)$/.test(relative)
  || /^server\/[\w.-]+\.(?:js|mjs|json|py|txt)$/.test(relative)
  || /^client\/(?:src\/.+\.(?:ts|tsx|css|svg)|tests\/.+\.mjs|[\w.-]+\.(?:json|ts|js|html))$/.test(relative)
  || /^docs\/security-testing\.md$/.test(relative)
  || /^docs\/security\/strix-instructions\.md$/.test(relative);

function safeSource(relative) {
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw Error('Caminho de fonte inválido.');
  let source = root;
  for (const part of parts) {
    source = path.join(source, part);
    if (fs.lstatSync(source).isSymbolicLink()) throw Error('Links simbólicos não são permitidos no alvo.');
  }
  return source;
}

function main() {
  const scan = spawnSync(process.execPath, [path.join(root, 'scripts/check-secrets.cjs')], {
    cwd: root, stdio: 'inherit', windowsHide: true,
  });
  if (scan.error || scan.status !== 0) throw Error('Corrija a verificação de segredos antes de criar o alvo.');
  const files = [...new Set(execFileSync(git, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  }).split('\0').filter(relative => relative && allowed(relative)))].sort();
  if (!files.includes('server/security-lab.mjs') || !files.includes('server/package-lock.json')) {
    throw Error('Fontes do laboratório incompletas.');
  }
  const targets = path.join(root, '.tools/security/targets');
  execFileSync(git, ['check-ignore', '.tools/security/targets/probe'], { cwd: root, windowsHide: true });
  fs.mkdirSync(targets, { recursive: true });
  const target = fs.mkdtempSync(path.join(targets, 'chat-'));
  const manifest = {
    sourceRevision: execFileSync(git, ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    createdAt: new Date().toISOString(),
    note: 'Conteúdo atual dos arquivos listados; pode incluir alterações ainda sem commit.',
    files: [],
  };
  for (const relative of files) {
    const source = safeSource(relative);
    if (!fs.statSync(source).isFile()) throw Error('A fonte não é um arquivo regular.');
    const content = fs.readFileSync(source);
    const destination = path.resolve(target, relative);
    if (!destination.startsWith(target + path.sep)) throw Error('Destino fora do alvo.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, { flag: 'wx' });
    manifest.files.push({ path: relative, sha256: createHash('sha256').update(content).digest('hex') });
  }
  fs.writeFileSync(path.join(target, 'SECURITY-TARGET.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log(`Alvo descartável: ${target}`);
  console.log(`${files.length} arquivos; revise SECURITY-TARGET.json antes de fornecer o alvo ao Strix.`);
  console.log('Sem .git, .env, bancos, dados, logs, dependências, pastas duplicadas ou relatórios anteriores.');
}

try { main(); } catch {
  console.error('Não foi possível preparar o alvo. Confira o Gitleaks, o Git e os arquivos; nenhuma fonte original foi alterada.');
  process.exitCode = 1;
}
