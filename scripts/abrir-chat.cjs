// Manual launcher: double-click the desktop shortcut after signing in to Windows.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const logs = path.join(root, 'server', 'logs');
fs.mkdirSync(logs, { recursive: true });
const log = message => fs.appendFileSync(path.join(logs, 'launcher.log'), `${new Date().toISOString()} ${message}\n`);
const setupFile=path.join(root,'server','data','owner-setup.json');
function setupToken() {
  try { const setup=JSON.parse(fs.readFileSync(setupFile,'utf8')); if(setup.expiresAt>Date.now() && /^[A-Za-z0-9_-]{43}$/.test(setup.token))return setup.token; } catch {}
  return '';
}
const background = process.argv.includes('--check');
const tailscale = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
const node = process.execPath;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (exe, args) => execFileSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 12000 });
async function healthy(url) { try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); return response.ok; } catch { return false; } }
async function wait(url, seconds=30) { for(let i=0;i<seconds*2;i++) { if(await healthy(url)) return; await delay(500); } throw Error(`O servico nao respondeu: ${url}. Consulte server/logs.`); }
function start(exe, args, directory, name, environment) {
  const out = fs.openSync(path.join(logs, `${name}.stdout.log`), 'a');
  const err = fs.openSync(path.join(logs, `${name}.stderr.log`), 'a');
  try {
    const child = spawn(exe, args, { cwd: directory, detached: true, windowsHide: true, stdio: ['ignore',out,err], env: environment });
    child.on('error', error => log(`${name}: ${error.message}`));
    child.unref(); log(`${name} iniciado: PID ${child.pid}`);
  } finally { fs.closeSync(out); fs.closeSync(err); }
}
// A backend started before an update keeps serving the old routes (for example, no /auth/login).
const REQUIRED_BACKEND_VERSION = 17;
function backendPid(health) {
  const lines=run('netstat.exe',['-ano','-p','TCP']).split(/\r?\n/);
  for(const line of lines) {
    const parts=line.trim().split(/\s+/);
    if(parts.length>=5 && /^(127\.0\.0\.1|0\.0\.0\.0):3001$/.test(parts[1]) && parts[2]==='0.0.0.0:0') {
      const pid=Number(parts[4]);return !health.pid || health.pid===pid ? pid : 0;
    }
  }
  return 0;
}
async function restartBackend(health,reason) {
  const pid=backendPid(health);
  if(!Number.isSafeInteger(pid) || pid<=0) throw Error('Uma versao antiga do chat esta aberta na porta 3001. Reinicie o PC e use o atalho novamente.');
  const image=run('tasklist.exe',['/FI',`PID eq ${pid}`,'/FO','CSV','/NH']);
  if(!/^"node(\.exe)?"/i.test(image.trim())) throw Error('A porta 3001 esta ocupada por outro programa.');
  log(`Reiniciando o backend (PID ${pid}): ${reason}.`);
  run('taskkill.exe',['/PID',String(pid),'/F']);
  for(let i=0;i<20;i++) { if(!await healthy('http://127.0.0.1:3001/health')) return; await delay(500); }
  throw Error('Nao foi possivel encerrar a versao antiga do chat. Reinicie o PC e use o atalho novamente.');
}
const lockFile = path.join(logs, 'launcher.lock');
let ownsLock = false;
async function lock() {
  for(let i=0;i<90;i++) {
    try { const fd=fs.openSync(lockFile,'wx'); fs.writeFileSync(fd,String(process.pid)); fs.closeSync(fd); ownsLock=true; return; }
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      const owner=Number(fs.readFileSync(lockFile,'utf8'));
      let alive=true;
      if (Number.isSafeInteger(owner) && owner > 0) {
        try { process.kill(owner,0); } catch { alive=false; }
      } else { alive=Date.now()-fs.statSync(lockFile).mtimeMs<120000; }
      if(!alive) { try { fs.unlinkSync(lockFile); } catch {} }
      else await delay(500);
    }
  }
  throw Error('Outra abertura esta em andamento. Tente novamente em alguns instantes.');
}
(async () => {
  try {
    await lock(); log('Conferindo os servicos.');
    let status;
    for(let i=0;i<20;i++) { status=JSON.parse(run(tailscale,['status','--json'])); if(status.BackendState==='Running') break; await delay(1500); }
    if(status.BackendState!=='Running') throw Error('Abra o Tailscale e conecte sua conta. Depois use o atalho novamente.');
    const host=status.Self.DNSName.replace(/\.$/,'');
    if(!/^[a-z0-9.-]+\.ts\.net$/i.test(host)) throw Error('O endereco privado do Tailscale ainda nao esta pronto.');
    const address='https://'+host;
    const environment={...process.env,PG_CHAT_HOST:host,LIVEKIT_URL:'wss://'+host+':8443'};
    if(!await healthy('http://127.0.0.1:7880/')) start('C:\\livekit\\livekit-server.exe',['--config','livekit.tailscale.yaml'],path.join(root,'server'),'livekit',environment);
    await wait('http://127.0.0.1:7880/');
    let health;
    try { health=await (await fetch('http://127.0.0.1:3001/health',{signal:AbortSignal.timeout(2000)})).json(); } catch {}
    if(health && health.application!=='progresso-gang-chat') throw Error('A porta 3001 esta ocupada por outro programa.');
    if(health && (!(health.version>=REQUIRED_BACKEND_VERSION) || !health.features?.includes('accounts'))) { await restartBackend(health,'atualizacao do chat'); health=undefined; }
    if(health && !setupToken()) {
      const account=await (await fetch('http://127.0.0.1:3001/auth/me',{signal:AbortSignal.timeout(3000)})).json();
      if(account.setupPending){await restartBackend(health,'renovacao da configuracao do administrador');health=undefined;}
    }
    if(!health) start(node,['index.js'],path.join(root,'server'),'backend',environment);
    await wait('http://127.0.0.1:3001/health');
    if(!await healthy('http://localhost:5173/')) start(node,['node_modules/vite/bin/vite.js','--port','5173','--strictPort'],path.join(root,'client'),'vite',environment);
    await wait('http://localhost:5173/');
    run(tailscale,['serve','--bg','--https=443','http://localhost:5173']);
    run(tailscale,['serve','--bg','--https=8443','http://127.0.0.1:7880']);
    await wait(address);
    await wait(address+'/api/auth/me');
    log('Pronto: '+address); console.log('Progresso Gang - Chat pronto: '+address);
    if(!background) {
      const token=setupToken();
      // Force a fresh page load even if the regular login is already open.
      const destination = token ? `${address}/?ativar=${Date.now()}#setup=${encodeURIComponent(token)}` : address;
      const result = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Start-Process -FilePath $env:PG_CHAT_OPEN_URL',
      ], {
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, PG_CHAT_OPEN_URL: destination },
      });
      await new Promise((resolve, reject) => {
        result.once('error', reject);
        result.once('exit', code => {
          if (code === 0) resolve();
          else reject(new Error('O Windows nao conseguiu abrir o navegador padrao.'));
        });
      });
    }
  } catch(error) {
    log('ERRO: '+error.message); console.error(error.message); process.exitCode=1;
    if(!background) { const file=path.join(logs,'COMO-ABRIR.txt');fs.writeFileSync(file,'Progresso Gang - Chat\r\n\r\n'+error.message+'\r\n\r\nConfira se o Tailscale esta conectado e tente o atalho novamente.\r\n');const viewer=spawn('notepad.exe',[file],{windowsHide:false,detached:true,stdio:'ignore'});viewer.unref(); }
  } finally { if(ownsLock) fs.unlinkSync(lockFile); }
})();
