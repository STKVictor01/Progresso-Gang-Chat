// O cache guarda os bytes de uma versão específica do anexo.
export function createMediaCache({maxBytes=32*1024*1024,maxEntries=256,ttlMs=5*60*1000,now=Date.now}={}) {
  const entries=new Map();
  let bytes=0;
  function remove(key) { const entry=entries.get(key);if(entry){bytes-=entry.data.length;entries.delete(key);} }
  return {
    get(key) {
      const entry=entries.get(key);
      if(!entry)return undefined;
      if(entry.expires<=now()){remove(key);return undefined;}
      entries.delete(key);entries.set(key,entry);
      return entry.data;
    },
    set(key,data) {
      remove(key);
      if(!Buffer.isBuffer(data)||data.length>maxBytes||maxEntries<1)return;
      while(bytes+data.length>maxBytes || entries.size>=maxEntries)remove(entries.keys().next().value);
      entries.set(key,{data,expires:now()+ttlMs});bytes+=data.length;
    },
  };
}
