import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const tables = {
  users:['id','username','username_key','password_hash','role','is_owner','active','created_at'],
  channels:['id','kind','name','hint','position'],
  site_settings:['id','name','tagline'],
  invites:['token_hash','expires_at','used'],
  owner_setup:['id','token_hash','expires_at'],
  sessions:['token_hash','user_id','csrf','expires_at'],
  messages:['id','client_id','name','text','timestamp','channel','user_id','deleted_at'],
  attachments:['id','request_hash','mime','width','height','size','animated','data','created_at','owner_id','filename'],
  profiles:['user_id','description','avatar_id'],
  message_attachments:['message_id','attachment_id','position'],
  soundboard:['id','channel','name','owner_id','data','created_at'],
  message_events:['seq','message_id','channel','kind'],
};
const keyColumns={channels:['id','kind'],message_attachments:['message_id','attachment_id'],messages:['id'],message_events:['seq'],users:['id'],site_settings:['id'],invites:['token_hash'],owner_setup:['id'],sessions:['token_hash'],attachments:['id'],profiles:['user_id'],soundboard:['id']};
const normalize=value=>value instanceof Uint8Array?Buffer.from(value).toString('base64'):value;
function digest(rows,columns){
  const hash=createHash('sha256');
  for(const row of rows){const value=JSON.stringify(columns.map(key=>normalize(row[key])));hash.update(String(Buffer.byteLength(value))).update(':').update(value);}
  return hash.digest('hex');
}
export async function migrateBackup({sqlitePath,databaseUrl,certificatePath,schema='progresso_gang'}) {
  if(!/^progresso_gang(?:_qa_[a-f0-9]+)?$/.test(schema)) throw Error('Esquema inválido.');
  const url=new URL(databaseUrl);
  if([...url.searchParams.keys()].some(key=>key.toLowerCase().startsWith('ssl')))throw Error('Configure o certificado fora da URL.');
  const source=new DatabaseSync(sqlitePath,{readOnly:true});
  const client=new pg.Client({connectionString:databaseUrl,ssl:{ca:readFileSync(certificatePath,'utf8'),rejectUnauthorized:true},connectionTimeoutMillis:8000});
  pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Número fora do limite seguro.');return n;});
  let connected=false;
  try {
    if(source.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||source.prepare('PRAGMA foreign_key_check').all().length)throw Error('A cópia de origem não passou na verificação.');
    await client.connect();connected=true;await client.query('BEGIN');
    await client.query(`SET LOCAL search_path TO ${schema}, pg_catalog`);
    for(const table of Object.keys(tables)) {
      const count=await client.query(`SELECT COUNT(*) AS n FROM ${table}`);
      if(count.rows[0].n!==0)throw Error('O destino não está vazio.');
    }
    for(const [table,columns] of Object.entries(tables)) {
      const order=keyColumns[table].join(',');
      const pgOrder=keyColumns[table].map(column=>['id','message_id','seq'].includes(column)&&['messages','message_events','message_attachments','site_settings','owner_setup'].includes(table)?column:column+' COLLATE "C"').join(',');
      let batch=[],bytes=0,offset=0;
      async function flush(){
        if(!batch.length)return;
        const params=[];
        const values=batch.map(row=>'('+columns.map(column=>{let v=row[column];if(v instanceof Uint8Array)v=Buffer.from(v);params.push(v);return '$'+params.length;}).join(',')+')').join(',');
        await client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES ${values}`,params);
        const actual=(await client.query(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${pgOrder} LIMIT $1 OFFSET $2`,[batch.length,offset])).rows;
        if(batch.length!==actual.length||digest(batch,columns)!==digest(actual,columns))throw Error('A conferência da cópia falhou: '+table);
        offset+=batch.length;batch=[];bytes=0;
      }
      const sourceColumns=new Set(source.prepare(`PRAGMA table_info(${table})`).all().map(column=>column.name));
      const selection=columns.map(column=>column==='filename'&&!sourceColumns.has(column)?"'' AS filename":column).join(',');
      for(const row of source.prepare(`SELECT ${selection} FROM ${table} ORDER BY ${order}`).iterate()) {
        const size=columns.reduce((total,column)=>total+(row[column] instanceof Uint8Array?row[column].byteLength:0),0);
        if(batch.length&&(batch.length>=25||bytes+size>8*1024*1024))await flush();
        batch.push(row);bytes+=size;
      }
      await flush();
    }
    for(const [table,column] of [['messages','id'],['message_events','seq']]) await client.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'),COALESCE(MAX(${column}),1),COUNT(*)>0) FROM ${table}`);
    await client.query('COMMIT');
  } catch(error) {if(connected)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {source.close();if(connected)await client.end();}
}
