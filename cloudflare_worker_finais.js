const API_BASE = "https://restboliche.bigmidia.com/cbbol/api";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, no-cache, must-revalidate"
};

const CATEGORIAS = {
  "masculino-1": { nome: "1ª Divisão Masculina", genero: 0, divisao: 1 },
  "masculino-2": { nome: "2ª Divisão Masculina", genero: 0, divisao: 2 },
  "feminino": { nome: "1ª Divisão Feminina", genero: 1, divisao: 1 }
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "") {
        return json({
          ok: true,
          service: "TBF300 Circuito MT Proxy",
          event: 589,
          status: "online",
          endpoints: [
            "/api/top?evento=589&categoria=masculino-1&dia=1&limite=5",
            "/api/top?evento=589&categoria=masculino-2&dia=1&limite=5",
            "/api/top?evento=589&categoria=feminino&dia=1&limite=5",
            "/api/categorias?evento=589"
          ]
        });
      }

      if (url.pathname === "/api/categorias") {
        return handleCategorias(url);
      }

      if (url.pathname === "/api/top") {
        return handleTop(url);
      }

      // Mantém compatibilidade com o worker antigo de finais.
      if (url.pathname === "/finais") {
        return handleFinais(url);
      }

      return json({ ok: false, error: "Endpoint not found" }, 404);
    } catch (erro) {
      return json({ status: "erro", mensagem: erro.message }, 500);
    }
  }
};

async function handleCategorias(url) {
  const evento = url.searchParams.get("evento") || "589";
  const categorias = await buscarCategorias(evento);

  return json({
    status: categorias.length > 0 ? "ok" : "aguardando",
    evento,
    categorias
  });
}

async function handleTop(url) {
  const evento = url.searchParams.get("evento") || "589";
  const categoriaChave = url.searchParams.get("categoria") || "masculino-1";
  const dia = url.searchParams.get("dia") || "1";
  const limite = Number(url.searchParams.get("limite") || url.searchParams.get("limit") || 5);
  const categoriaConfig = CATEGORIAS[categoriaChave];

  if (!categoriaConfig) {
    return json({
      status: "erro",
      mensagem: "Categoria não reconhecida.",
      categoria: categoriaChave,
      atletas: []
    }, 400);
  }

  const categorias = await buscarCategorias(evento);
  const categoriaApi = encontrarCategoria(categorias, categoriaConfig);

  if (!categoriaApi) {
    return json({
      status: "aguardando",
      mensagem: "Categoria ainda não encontrada no Boliche Brasil.",
      categoria: categoriaConfig.nome,
      evento,
      dia,
      atletas: [],
      atualizadoEm: new Date().toISOString()
    });
  }

  const ctg = categoriaApi.id;
  const tabelaUrl = `${API_BASE}/evento-atleta/tabela?id_evento=${encodeURIComponent(evento)}&dia=${encodeURIComponent(dia)}&ctg=${encodeURIComponent(ctg)}`;
  const dados = await fetchJson(tabelaUrl);
  const tabela = extrairTabela(dados);
  const atletas = normalizarTabela(tabela).slice(0, limite);

  return json({
    status: atletas.length > 0 ? "ok" : "aguardando",
    categoria: categoriaConfig.nome,
    evento,
    dia,
    ctg,
    url: tabelaUrl,
    atletas,
    atualizadoEm: new Date().toISOString()
  });
}

async function handleFinais(url) {
  const categoria = Number(url.searchParams.get("categoria"));
  const evento = url.searchParams.get("evento") || "582";

  if (!categoria) {
    return json({ ok: false, error: "Categoria invalida" }, 400);
  }

  const target = new URL(`${API_BASE}/evento-categoria-fase`);
  target.searchParams.set("id_evento", evento);
  target.searchParams.set("id_categoria", String(categoria));
  target.searchParams.set("expand", "eventoCategoriaPartidas,atleta1,atleta2");
  target.searchParams.set("sort", "num_ordem");

  const upstream = await fetch(target.toString(), { headers: { Accept: "application/json, text/plain, */*" } });
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

async function buscarCategorias(evento) {
  const url = `${API_BASE}/evento-categoria?id_evento=${encodeURIComponent(evento)}&sort=ordem&pageSize=100`;
  const dados = await fetchJson(url);

  if (Array.isArray(dados?.items)) return dados.items;
  if (Array.isArray(dados?.data)) return dados.data;
  if (Array.isArray(dados)) return dados;

  return [];
}

function encontrarCategoria(categorias, config) {
  return categorias.find(categoria => {
    const genero = Number(categoria.genero);
    const divisao = Number(categoria.divisao);
    const allevents = Number(categoria.allevents);
    const equipes = Number(categoria.equipes);

    return genero === config.genero &&
      divisao === config.divisao &&
      allevents === 1 &&
      equipes === 0;
  }) || categorias.find(categoria => {
    const descricao = String(categoria.descricao || "").toLowerCase();
    const genero = Number(categoria.genero);
    const divisao = Number(categoria.divisao);

    return genero === config.genero &&
      divisao === config.divisao &&
      descricao.includes(config.genero === 1 ? "femin" : "mascul");
  });
}

async function fetchJson(url) {
  const resposta = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "TBF300Sports-CloudflareWorker"
    }
  });

  if (!resposta.ok) {
    throw new Error(`Erro HTTP ${resposta.status} ao acessar Boliche Brasil`);
  }

  const texto = await resposta.text();

  try {
    return JSON.parse(texto);
  } catch (erro) {
    return parseXmlBasico(texto);
  }
}

function extrairTabela(dados) {
  if (!dados) return [];
  if (Array.isArray(dados)) return dados;
  if (Array.isArray(dados.tabela)) return dados.tabela;
  if (Array.isArray(dados.items)) return dados.items;
  if (Array.isArray(dados.data)) return dados.data;
  return [];
}

function normalizarTabela(tabela) {
  return tabela
    .map((item, index) => {
      const total = numero(item.pontos_serie || item.total || item.t || item.pontos);
      const linhas = numero(item.l || item.linhas || item.qtd_linhas);
      const media = numero(item.media || item.m) || (linhas > 0 ? total / linhas : 0);
      const maiorLinha = numero(item.maior_linha || item.maiorLinha || item.ml);

      return {
        posicao: numero(item.posicao || item.pos || index + 1),
        atleta: item.nome_evento || item.nome_completo || item.atleta || item.nome || "Atleta",
        linhas,
        total,
        media,
        maiorLinha,
        original: item
      };
    })
    .filter(item => item.atleta && item.atleta !== "Atleta")
    .filter(item => item.total > 0 || item.media > 0 || item.maiorLinha > 0)
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.media !== a.media) return b.media - a.media;
      return b.maiorLinha - a.maiorLinha;
    })
    .map((item, index) => ({ ...item, posicao: index + 1 }));
}

function numero(valor) {
  if (valor === null || valor === undefined) return 0;

  const convertido = Number(
    String(valor)
      .replace(",", ".")
      .replace(/[^\d.-]/g, "")
  );

  return Number.isFinite(convertido) ? convertido : 0;
}

function parseXmlBasico(xml) {
  if (!xml || typeof xml !== "string") return {};

  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const bloco = match[1];
    const obj = {};
    const campoRegex = /<([^\/][^>]*)>([\s\S]*?)<\/\1>/g;
    let campo;

    while ((campo = campoRegex.exec(bloco)) !== null) {
      obj[campo[1].trim()] = limparXml(campo[2]);
    }

    items.push(obj);
  }

  return { items };
}

function limparXml(valor) {
  return String(valor || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}
