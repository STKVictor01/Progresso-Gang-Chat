import {createClient} from '@supabase/supabase-js';

// A separate client per operation prevents one person's session from leaking to another.
export function createSupabaseAuth({url,publishableKey,secretKey,redirectTo,clientFactory=createClient,settingsFetch=fetch}) {
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
  const client=()=>clientFactory(url,publishableKey,options);
  const admin=()=>clientFactory(url,secretKey,options);
  const check=(result)=>{if(result.error)throw result.error;return result.data;};
  const credentials=data=>({user:data.user,accessToken:data.session?.access_token,refreshToken:data.session?.refresh_token,expiresAt:data.session?.expires_at});
  return {
    async assertConfirmation(){
      const response=await settingsFetch(url+'/auth/v1/settings',{headers:{apikey:publishableKey},signal:AbortSignal.timeout(5000)});
      if(!response.ok || (await response.json()).mailer_autoconfirm!==false)throw Error('Confirmação de e-mail obrigatória.');
    },
    async signIn(email,password){
      const api=client();const data=check(await api.auth.signInWithPassword({email,password}));
      if(!data.session?.access_token || !data.user?.email_confirmed_at){const error=Error('E-mail não confirmado.');error.status=403;throw error;}
      return credentials(data);
    },
    async verify(accessToken){return check(await client().auth.getUser(accessToken)).user;},
    async refresh(refreshToken){
      const data=check(await client().auth.refreshSession({refresh_token:refreshToken}));
      if(!data.session?.access_token || !data.session?.refresh_token || !data.user?.email_confirmed_at){const error=Error('Sessão inválida.');error.status=401;throw error;}
      return credentials(data);
    },
    async requestRecovery(email){check(await client().auth.resetPasswordForEmail(email,{redirectTo:redirectTo}));},
    async recoverPassword(tokenHash,password,authorize){
      const api=client();
      const data=check(await api.auth.verifyOtp({token_hash:tokenHash,type:'recovery'}));
      if(!data.session?.access_token || !data.user?.email_confirmed_at || !await authorize(data.user))throw Error('Recuperação inválida.');
      check(await api.auth.updateUser({password}));
      try{check(await api.auth.signOut({scope:'global'}));}catch{}
    },
    async signUp(email,password){
      const data=check(await client().auth.signUp({email,password,options:{emailRedirectTo:redirectTo}}));
      // A project with confirmation disabled must not silently admit unverified accounts.
      if(data.session || data.user?.email_confirmed_at)throw Error('Confirmação de e-mail obrigatória.');
    },
    async resend(email){check(await client().auth.resend({type:'signup',email,options:{emailRedirectTo:redirectTo}}));},
    async getUser(id){const result=await admin().auth.admin.getUserById(id);if(result.error?.status===404)return null;return check(result).user;},
    async importUser(user,email){
      return check(await admin().auth.admin.createUser({id:user.id,email,password_hash:user.password_hash,email_confirm:false})).user;
    },
    async changePassword(email,currentPassword,password,id){
      const api=client();const signed=check(await api.auth.signInWithPassword({email,password:currentPassword}));
      if(signed.user?.id!==id || !signed.user.email_confirmed_at)throw Error('Credenciais inválidas.');
      check(await api.auth.updateUser({password}));
      // A troca já ocorreu; a API encerrará todas as sessões locais mesmo se o Auth falhar ao revogar.
      try{check(await api.auth.signOut({scope:'global'}));}catch{}
    },
    async signOut(token){const result=await admin().auth.admin.signOut(token,'local');if(result.error)throw result.error;},
  };
}
