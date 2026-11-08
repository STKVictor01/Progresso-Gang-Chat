const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync,execFileSync} = require('node:child_process');
const root=path.resolve(__dirname,'..');
const local=path.join(root,'.tools','gitleaks',process.platform==='win32'?'gitleaks.exe':'gitleaks');
const binary=fs.existsSync(local)?local:'gitleaks';
const git=process.platform==='win32'&&fs.existsSync('C:\\Program Files\\Git\\cmd\\git.exe')?'C:\\Program Files\\Git\\cmd\\git.exe':'git';
const env={...process.env,Path:path.dirname(git)+path.delimiter+(process.env.Path||process.env.PATH||'')};
function scan(args){const result=spawnSync(binary,[...args,'--redact=100','--no-banner','--config',path.join(root,'.gitleaks.toml')],{cwd:root,env,stdio:'inherit',windowsHide:true});if(result.error){console.error('Instale o Gitleaks oficial ou coloque-o em .tools/gitleaks.');return 2;}return result.status??2;}
if(process.argv.includes('--staged'))process.exit(scan(['git','--staged',root]));
const history=scan(['git',root]);
// Only files eligible for publication. Private .env and chat databases stay on this PC.
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pg-secret-scan-'));
let working=2;
try{
  const files=execFileSync(git,['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
  for(const relative of new Set(files)){
    const source=path.resolve(root,relative),destination=path.resolve(temporary,relative);
    if(!source.startsWith(root+path.sep)||!destination.startsWith(temporary+path.sep))throw Error('Caminho inválido.');
    if(!fs.existsSync(source)||!fs.statSync(source).isFile())continue;
    fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);
  }
  working=scan(['dir',temporary]);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
process.exit(history||working);
