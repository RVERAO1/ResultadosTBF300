const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '../rodape-scroll-circuito.html'), 'utf8');
const build = html.match(/const BUILD_ID="([^"]+)"/)[1];
const storage = new Map();
let now = 1000000;
function harness() {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {innerHTML:'',style:{},classList:{contains:()=>true,add:()=>{},toggle:()=>{}}});
    return nodes.get(key);
  };
  const context = {URLSearchParams, URL, Map, Number, String, Math, JSON,
    Date:{now:()=>now},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    document:{documentElement:{style:{setProperty:()=>{}}},body:node('body'),getElementById:node,querySelector:node},
    window:{location:{search:`?_build=${build}`,replace:()=>{throw Error('Unexpected redirect')}},requestAnimationFrame:f=>f()}
  };
  let script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  script = script.replace(/cycleStartedAt=Date\.now\(\);aplicarImagem\(\);[\s\S]*?window\.setInterval\(verificarVersao,60000\)/,
    `globalThis.test={detectarLinhaCompleta,normalizarAtletas,renderizarCategoriaTicker,
      confirmarLinha,aplicarCiclo,setResults:r=>resultadosAtuais=r,
      state:()=>({...estado,modoAtual,grupoAtual}),renderizarQuadros,
      setControl:c=>{controle={...controle,...c}},renderizarTicker,aplicarImagem};`);
  vm.runInNewContext(script, context);
  return {...context.test,nodes};
}
const categoria = i => ({key:['masculino-1','masculino-2','feminino'][i],nome:`Categoria ${i}`});
function results(dia=1, completa=1) {
  return [0,1,2].map(i=>({categoria:categoria(i),live:true,demo:false,consultaValida:true,listaCompleta:true,dia,
    atletas:Array.from({length:9},(_,j)=>({id:j+1,atleta:`Atleta ${j+1}`,posicao:j+1,dia,total:200,media:200,
      jogos:Array.from({length:dia===1?6:5},(_,k)=>({linha:k+(dia===1?1:7),pontos:k<completa?200:null}))}))}));
}
const t=harness();
assert.equal(t.detectarLinhaCompleta(results()).linha,1);
let r=results();r[1].atletas[8].jogos[0].pontos=null;
assert.equal(t.detectarLinhaCompleta(r).linha,1); // atleta sem qualquer linha é ausente
r[1].atletas[8].jogos[1].pontos=190;
assert.equal(t.detectarLinhaCompleta(r),null); // iniciou o dia, mas falta L1
r=results();r[2].consultaValida=false;assert.equal(t.detectarLinhaCompleta(r),null);
r=results();r[2].listaCompleta=false;assert.equal(t.detectarLinhaCompleta(r),null);
r=results();r[2].atletas=[];assert.equal(t.detectarLinhaCompleta(r),null);
r=results(2);r[0].atletas.push({...results()[0].atletas[0],dia:1});
assert.equal(t.detectarLinhaCompleta(r).linha,7); // não jogou no dia 2: não bloqueia
r=results(2);r[1]=results()[1];assert.equal(t.detectarLinhaCompleta(r),null);
r=results();t.setResults(r);t.confirmarLinha(r);t.aplicarCiclo();assert.equal(t.state().modoAtual,'rodape');
t.confirmarLinha(r);t.aplicarCiclo();assert.equal(t.state().modoAtual,'placar');
assert.equal(t.state().ultimaLinha,1);
now+=30000;t.aplicarCiclo();assert.equal(t.state().grupoAtual,1);
now+=30000;t.aplicarCiclo();t.renderizarQuadros();
assert.match(t.nodes.get('cards').innerHTML,/Atleta 9/);
assert.equal((t.nodes.get('cards').innerHTML.match(/7º ao 9º/g)||[]).length,3);
const restored=harness();restored.setResults(r);restored.aplicarCiclo();assert.equal(restored.state().grupoAtual,2);
now+=120000;t.aplicarCiclo();assert.equal(t.state().modoAtual,'rodape');
t.confirmarLinha(r);t.aplicarCiclo();assert.equal(t.state().modoAtual,'rodape');
r=results(1,2);t.setResults(r);t.confirmarLinha(r);t.confirmarLinha(r);t.aplicarCiclo();
assert.equal(t.state().ultimaLinha,2);assert.equal(t.state().modoAtual,'placar');
const ticker=t.renderizarCategoriaTicker({...results()[0],demo:true});assert.ok(!ticker.includes('undefined'));
assert.equal(t.normalizarAtletas(results()[0].atletas,1).length,9);
assert.match(html,/\.results-dock\{border-top:0\}/);
t.setControl({mode:'rodape'});t.aplicarCiclo();assert.equal(t.state().modoAtual,'rodape');
t.setControl({mode:'placar'});t.aplicarCiclo();assert.equal(t.state().modoAtual,'placar');
t.setControl({mode:'oculto'});t.aplicarCiclo();assert.equal(t.state().modoAtual,'rodape');
t.setControl({mode:'auto',message:'<script>alert(1)</script>',messageMode:'replace'});t.renderizarTicker();
assert.ok(t.nodes.get('groupA').innerHTML.includes('&lt;script&gt;'));
assert.ok(!t.nodes.get('groupA').innerHTML.includes('<script>'));
t.setControl({overlayEnabled:true,overlayUrl:'https://example.com/test.png'});t.aplicarImagem();
t.nodes.get('overlayImage').onload();assert.equal(t.nodes.get('overlayImage').style.display,'block');
t.setControl({overlayEnabled:false});t.aplicarImagem();assert.equal(t.nodes.get('overlayImage').style.display,'none');
t.setControl({overlayEnabled:true});t.aplicarImagem();assert.equal(t.nodes.get('overlayImage').style.display,'block');
console.log('OK: ausência, linha incompleta, falha API, lista truncada, dias 1/2, confirmação dupla, 3 minutos, paginação 30s, atleta 9, sincronização, recarga e sem repetição.');
