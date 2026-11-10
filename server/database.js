import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import pg from 'pg';

function queryText(sql) {
  let n=0;
  return sql.replaceAll('?',()=>'$'+(++n)).replace('ORDER BY position,rowid','ORDER BY position,id');
}

export function sqliteDatabase(path) {
  const raw = new DatabaseSync(path);
  const context = new AsyncLocalStorage();
  let queue=Promise.resolve();
  async function exclusive(action) {
    if (context.getStore()) return action();
    let release;const previous=queue;queue=new Promise(resolve=>{release=resolve;});
    await previous;
    try { return await action(); } finally { release(); }
  }
  return {
    kind:'sqlite',
    exec:sql=>exclusive(()=>raw.exec(sql)),
    prepare:sql=>({
      get:(...args)=>exclusive(()=>raw.prepare(sql).get(...args)),
      all:(...args)=>exclusive(()=>raw.prepare(sql).all(...args)),
      run:(...args)=>exclusive(()=>raw.prepare(sql).run(...args)),
    }),
    transaction:fn=>exclusive(()=>context.run(true,async()=>{
      raw.exec('BEGIN IMMEDIATE');
      try { const result=await fn();raw.exec('COMMIT');return result; }
      catch(error) { raw.exec('ROLLBACK');throw error; }
    })),
    lock:async()=>{},
    close:()=>exclusive(()=>raw.close()),
  };
}

export function postgresDatabase(connectionString,certificatePath,schema='progresso_gang') {
  if (!/^progresso_gang(?:_qa_[a-f0-9]+)?$/.test(schema)) throw Error('Esquema inválido.');
  const url = new URL(connectionString);
  if ([...url.searchParams.keys()].some(key=>key.toLowerCase().startsWith('ssl'))) throw Error('Configure o certificado fora da URL do banco.');
  pg.types.setTypeParser(20,value=>{const number=Number(value);if(!Number.isSafeInteger(number))throw Error('Número fora do limite seguro.');return number;});
  const pool = new pg.Pool({connectionString,ssl:{ca:readFileSync(certificatePath,'utf8'),rejectUnauthorized:true},max:5,connectionTimeoutMillis:8000});
  const context = new AsyncLocalStorage(), initialized = new WeakSet();
  async function withClient(fn) {
    const existing=context.getStore();
    if(existing)return fn(existing);
    const client=await pool.connect();
    try {
      if(!initialized.has(client)){await client.query(`SET search_path TO ${schema}, pg_catalog`);initialized.add(client);}
      return await fn(client);
    } finally {client.release();}
  }
  const execute=(sql,args)=>withClient(client=>client.query(queryText(sql),args));
  return {
    kind:'postgres',
    exec:sql=>execute(sql,[]),
    prepare:sql=>({
      get:async(...args)=>(await execute(sql,args)).rows[0],
      all:async(...args)=>(await execute(sql,args)).rows,
      run:async(...args)=>{
        const insertMessage=/^INSERT INTO messages\(/i.test(sql);
        const result=await execute(sql+(insertMessage?' RETURNING id':''),args);
        return {changes:result.rowCount,lastInsertRowid:insertMessage?result.rows[0].id:undefined};
      },
    }),
    transaction:fn=>withClient(client=>context.run(client,async()=>{
      await client.query('BEGIN');
      try {const result=await fn();await client.query('COMMIT');return result;}
      catch(error){await client.query('ROLLBACK');throw error;}
    })),
    lock:key=>execute('SELECT pg_advisory_xact_lock(hashtext(?))',[key]),
    close:()=>pool.end(),
  };
}
