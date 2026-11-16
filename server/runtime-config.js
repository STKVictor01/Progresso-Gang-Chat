import { existsSync } from 'node:fs';

export function runtimeConfig(env, defaultCertificate) {
  const production=env.NODE_ENV==='production';
  const certificatePath=env.PG_CHAT_CA_CERT || defaultCertificate;
  let livekitInternalUrl;
  if(env.LIVEKIT_INTERNAL_URL){
    let internal;try{internal=new URL(env.LIVEKIT_INTERNAL_URL);}catch{throw Error('Endereço interno do LiveKit inválido.');}
    if(internal.protocol!=='ws:' || internal.hostname!=='127.0.0.1' || !internal.port || internal.pathname!=='/' || internal.username || internal.password || internal.search || internal.hash)throw Error('O LiveKit interno deve usar loopback.');
    livekitInternalUrl=internal.origin;
  }
  let supabaseAuth;
  if(env.PG_CHAT_AUTH==='supabase'){
    let url,site;try{url=new URL(env.SUPABASE_URL);site=new URL(env.PG_CHAT_SITE_ORIGIN);}catch{throw Error('Configure o endereço do Supabase e do site.');}
    if(url.protocol!=='https:'||url.origin!==env.SUPABASE_URL||site.protocol!=='https:'||site.origin!==env.PG_CHAT_SITE_ORIGIN||!env.SUPABASE_PUBLISHABLE_KEY||!env.SUPABASE_SECRET_KEY)throw Error('Configuração segura do Supabase Auth incompleta.');
    supabaseAuth={url:url.origin,publishableKey:env.SUPABASE_PUBLISHABLE_KEY,secretKey:env.SUPABASE_SECRET_KEY,redirectTo:site.origin};
  }else if(env.PG_CHAT_AUTH && env.PG_CHAT_AUTH!=='local')throw Error('Modo de autenticação inválido.');
  if(production) {
    if(env.PG_CHAT_DATABASE!=='postgres' || !env.DATABASE_URL) throw Error('Produção exige PostgreSQL configurado.');
    if(!certificatePath || !existsSync(certificatePath)) throw Error('Produção exige o certificado CA do banco.');
    let site,live;
    try {site=new URL(env.PG_CHAT_SITE_ORIGIN);live=new URL(env.LIVEKIT_URL);} catch {throw Error('Configure as URLs HTTPS do site e WSS do LiveKit.');}
    if(site.protocol!=='https:' || site.origin!==env.PG_CHAT_SITE_ORIGIN || site.username || site.password || live.protocol!=='wss:' || live.username || live.password || live.pathname!=='/' || live.search || live.hash) throw Error('As URLs de produção são inválidas.');
    if(!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || env.LIVEKIT_API_SECRET.length<32 || env.LIVEKIT_API_KEY==='SUBSTITUIR')throw Error('Configure credenciais seguras para o LiveKit.');
    const musicMaxRooms=Number(env.PG_CHAT_MUSIC_MAX_ROOMS || 2);
    if(!Number.isInteger(musicMaxRooms)||musicMaxRooms<1||musicMaxRooms>10)throw Error('Limite de salas de música inválido.');
    return {certificatePath,allowedOrigins:[site.origin],trustProxy:'loopback',musicMaxRooms,supabaseAuth,livekitInternalUrl};
  }
  return {certificatePath,livekitInternalUrl,...(supabaseAuth?{allowedOrigins:[new URL(env.PG_CHAT_SITE_ORIGIN).origin],supabaseAuth}:{})};
}
