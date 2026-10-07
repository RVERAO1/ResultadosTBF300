const DEFAULT = {revision:0,mode:'auto',message:'',messageMode:'append',overlayEnabled:false,overlayUrl:'',overlayFit:'contain',updatedAt:null};
const MAX_IMAGE = 1500 * 1024;
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)))}
async function sign(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))}
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
async function limitedBody(request,max){const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('too-large')}chunks.push(value)}const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result}
async function readJSON(request){return JSON.parse(new TextDecoder().decode(await limitedBody(request,8192)))}
function validatePatch(body){
  const patch={};
  if('mode' in body){if(!['auto','rodape','placar','oculto'].includes(body.mode))throw Error('Modo inválido.');patch.mode=body.mode}
  if('message' in body){if(typeof body.message!=='string'||body.message.length>400)throw Error('A mensagem deve ter até 400 caracteres.');patch.message=body.message.trim()}
  if('messageMode' in body){if(!['append','replace'].includes(body.messageMode))throw Error('Tipo de mensagem inválido.');patch.messageMode=body.messageMode}
  if('overlayEnabled' in body){if(typeof body.overlayEnabled!=='boolean')throw Error('Estado da imagem inválido.');patch.overlayEnabled=body.overlayEnabled}
  if('overlayFit' in body){if(!['contain','cover','fill'].includes(body.overlayFit))throw Error('Ajuste inválido.');patch.overlayFit=body.overlayFit}
  if('overlayUrl' in body){if(typeof body.overlayUrl!=='string'||body.overlayUrl.length>2048)throw Error('Endereço inválido.');if(body.overlayUrl){const url=new URL(body.overlayUrl);if(url.protocol!=='https:'||url.username||url.password)throw Error('Use uma URL HTTPS sem credenciais.')}patch.overlayUrl=body.overlayUrl}
  if(!Object.keys(patch).length)throw Error('Nenhuma alteração informada.');
  return patch;
}
export async function routeControl(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(!env.CONTROL)return reply({error:'Central não configurada.',...DEFAULT},503);
  return env.CONTROL.get(env.CONTROL.idFromName('circuito-transmissao')).fetch(request);
}
export class CentralControl {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.clients=new Map();this.rate=new Map()}
  async authorized(request){
    if(!this.env.CENTRAL_PASSWORD||this.env.CENTRAL_PASSWORD.length<16)return false;
    const token=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(token.length>512)return false;const [payload,signature,...rest]=token.split('.');
    if(!payload||!signature||rest.length)return false;
    if(!equal(await sign(this.env.CENTRAL_PASSWORD,payload),signature))return false;
    try{const data=JSON.parse(atob(payload));return data.aud==='tbf300-central'&&data.exp>Date.now()&&data.exp<=Date.now()+8*3600000}catch{return false}
  }
  async state(){return{...DEFAULT,...await this.ctx.storage.get('control')}}
  async fetch(request){
    const url=new URL(request.url);const path=url.pathname;
    try{
      if(path==='/api/control/state'&&request.method==='GET'){
        const state=await this.state();const client=url.searchParams.get('client');
        if(client&&/^[a-zA-Z0-9-]{8,64}$/.test(client)){
          for(const [id,info]of this.clients)if(Date.now()-info.at>60000)this.clients.delete(id);
          if(this.clients.size<30||this.clients.has(client))this.clients.set(client,{at:Date.now(),revision:Number(url.searchParams.get('revision'))||0,mode:url.searchParams.get('mode')||'',imageReady:url.searchParams.get('imageReady')==='1'});
        }
        return reply({...state,configured:!!this.env.CENTRAL_PASSWORD&&this.env.CENTRAL_PASSWORD.length>=16});
      }
      if(path==='/api/control/login'&&request.method==='POST'){
        if(!this.env.CENTRAL_PASSWORD||this.env.CENTRAL_PASSWORD.length<16)return reply({error:'Acesso bloqueado: cadastre CENTRAL_PASSWORD no Worker (mínimo 16 caracteres).'},503);
        const ip=await digest(request.headers.get('CF-Connecting-IP')||'unknown');const key=`login:${ip}`;
        const stored=await this.ctx.storage.get(key);const rate=stored&&stored.until>Date.now()?stored:{count:0,until:Date.now()+900000};
        if(rate.count>=5)return reply({error:'Muitas tentativas. Aguarde 15 minutos.'},429);
        rate.count++;await this.ctx.storage.put(key,rate);await this.ctx.storage.setAlarm(Date.now()+900000);
        const body=await readJSON(request);
        if(typeof body.password!=='string'||body.password.length>256||!equal(await digest(body.password),await digest(this.env.CENTRAL_PASSWORD)))return reply({error:'Senha incorreta.'},401);
        await this.ctx.storage.delete(key);
        const payload=btoa(JSON.stringify({aud:'tbf300-central',exp:Date.now()+8*3600000,nonce:crypto.randomUUID()}));
        return reply({token:`${payload}.${await sign(this.env.CENTRAL_PASSWORD,payload)}`,expiresIn:28800});
      }
      if(path==='/api/control/image'&&request.method==='GET'){
        const id=url.searchParams.get('v');if(!id||!/^[a-f0-9-]{36}$/.test(id))return reply({error:'Imagem não encontrada.'},404);
        const image=await this.ctx.storage.get(`image:${id}`);if(!image)return reply({error:'Imagem não encontrada.'},404);
        return new Response(image.bytes,{headers:{...cors,'Content-Type':image.type}});
      }
      if(!await this.authorized(request))return reply({error:'Autenticação necessária.'},401);
      if(path==='/api/control/status'&&request.method==='GET')return reply({state:await this.state(),clients:[...this.clients.values()].filter(info=>Date.now()-info.at<60000),now:Date.now()});
      if(path==='/api/control/state'&&request.method==='PUT'){
        const body=await readJSON(request);const patch=validatePatch(body);
        const state=await this.ctx.storage.transaction(async tx=>{
          const previous={...DEFAULT,...await tx.get('control')};
          if(body.revision!==previous.revision)return null;
          const next={...previous,...patch,revision:previous.revision+1,updatedAt:new Date().toISOString()};
          if(next.overlayEnabled&&!next.overlayUrl)throw Error('Envie uma imagem ou informe um endereço HTTPS antes de ligar o overlay.');
          await tx.put('control',next);return next;
        });
        return state?reply(state):reply({error:'Outro comando foi aplicado. Atualize o painel e tente novamente.'},409);
      }
      if(path==='/api/control/image'&&request.method==='POST'){
        const bytes=await limitedBody(request,MAX_IMAGE);const type=request.headers.get('Content-Type')||'';
        const png=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
        const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
        const webp=bytes.length>=12&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
        if(!(type==='image/png'&&png||type==='image/jpeg'&&jpeg||type==='image/webp'&&webp))return reply({error:'Use PNG, JPG ou WebP válido (até 1.500 KB). SVG não é permitido.'},400);
        if((await this.ctx.storage.list({prefix:'image:',limit:10})).size>=10)return reply({error:'Limite de 10 imagens enviadas. Use uma URL HTTPS para outras imagens.'},409);
        const id=crypto.randomUUID();const imageUrl=`${url.origin}/api/control/image?v=${id}`;
        await this.ctx.storage.put(`image:${id}`,{bytes:bytes.buffer,type});
        return reply({url:imageUrl});
      }
      return reply({error:'Endpoint não encontrado.'},404);
    }catch(error){return reply({error:error.message==='too-large'?'Arquivo ou comando excede o limite.':error instanceof SyntaxError?'JSON inválido.':error.message},400)}
  }
  async alarm(){const attempts=await this.ctx.storage.list({prefix:'login:'});const expired=[...attempts].filter(([,value])=>value.until<=Date.now()).map(([key])=>key);if(expired.length)await this.ctx.storage.delete(expired);if(attempts.size>expired.length)await this.ctx.storage.setAlarm(Date.now()+900000)}
}
