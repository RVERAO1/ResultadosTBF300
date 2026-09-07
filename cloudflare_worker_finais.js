export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    if (url.pathname === '/' || url.pathname === '') return Response.json({ok:true,service:'TBF300 CBBOL Finals Proxy',event:582,status:'online'},{headers:cors});
    if (url.pathname === '/finais') {
      const categoria = Number(url.searchParams.get('categoria'));
      const allowed = new Set([2918,2919,2920,2921]);
      if (!allowed.has(categoria)) return Response.json({ok:false,error:'Categoria invalida'},{status:400,headers:cors});
      const target = new URL('https://restboliche.bigmidia.com/cbbol/api/evento-categoria-fase');
      target.searchParams.set('id_evento','582'); target.searchParams.set('id_categoria',String(categoria));
      target.searchParams.set('expand','eventoCategoriaPartidas,atleta1,atleta2'); target.searchParams.set('sort','num_ordem');
      const upstream = await fetch(target.toString(),{headers:{'Accept':'application/json'}});
      const body = await upstream.text();
      return new Response(body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
    }
    return Response.json({ok:false,error:'Endpoint not found'},{status:404,headers:cors});
  }
};
