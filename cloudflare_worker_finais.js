import { routeControl } from "./central-control.js";
export { CentralControl } from "./central-control.js";
const API_BASE = "https://restboliche.bigmidia.com/cbbol/api";
const EVENTO_PADRAO = "590";
const DIAS_EVENTO = [1, 2];
const CACHE_TTL_MS = 5000;
const FETCH_TIMEOUT_MS = 20000;
const memoria = new Map();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, no-cache, must-revalidate"
};

const CATEGORIAS = {
  "masculino-1": { nome: "Divisão A Masculina", genero: 0, divisao: 1 },
  "masculino-2": { nome: "Divisão B Masculina", genero: 0, divisao: 2 },
  "feminino": { nome: "Categoria Feminina", genero: 1, divisao: 1 }
};

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/api/control/')) return routeControl(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/" || url.pathname === "") {
        return json({
          ok: true,
          service: "TBF300 Circuito MT Proxy",
          event: Number(EVENTO_PADRAO),
          stage: 3,
          location: "Campo Novo dos Parecis",
          dates: ["2026-10-10", "2026-10-11"],
          status: "online",
          endpoints: [
            `/api/top?evento=${EVENTO_PADRAO}&categoria=masculino-1&dia=auto&limite=5`,
            `/api/top?evento=${EVENTO_PADRAO}&categoria=masculino-2&dia=auto&limite=5`,
            `/api/top?evento=${EVENTO_PADRAO}&categoria=feminino&dia=auto&limite=5`,
            `/api/categorias?evento=${EVENTO_PADRAO}`
          ]
        });
      }

      if (url.pathname === "/api/categorias") return handleCategorias(url);
      if (url.pathname === "/api/top") return handleTop(url);
      if (url.pathname === "/finais") return handleFinais(url);

      return json({ ok: false, error: "Endpoint not found" }, 404);
    } catch (erro) {
      return json({ status: "erro", mensagem: mensagemErro(erro) }, 500);
    }
  }
};

async function handleCategorias(url) {
  const evento = url.searchParams.get("evento") || EVENTO_PADRAO;
  const categorias = await buscarCategorias(evento);

  return json({
    status: categorias.length > 0 ? "ok" : "aguardando",
    evento,
    categorias
  });
}

async function handleTop(url) {
  const evento = url.searchParams.get("evento") || EVENTO_PADRAO;
  const categoriaChave = url.searchParams.get("categoria") || "masculino-1";
  const diaSolicitado = String(url.searchParams.get("dia") || "auto").toLowerCase();
  const limiteSolicitado = url.searchParams.get("limite") || url.searchParams.get("limit") || 5;
  const limite = limiteSolicitado === 'todos' ? Infinity : limitar(limiteSolicitado, 1, 500);
  const categoriaConfig = CATEGORIAS[categoriaChave];

  if (!categoriaConfig) {
    return json({
      status: "erro",
      mensagem: "Categoria não reconhecida.",
      categoria: categoriaChave,
      atletas: []
    }, 400);
  }

  const dias = resolverDias(diaSolicitado);
  if (!dias) {
    return json({
      status: "erro",
      mensagem: "Dia inválido. Use 1, 2 ou auto.",
      categoria: categoriaConfig.nome,
      atletas: []
    }, 400);
  }

  const categorias = await buscarCategorias(evento);
  const categoriaApi = encontrarCategoria(categorias, categoriaConfig);

  if (!categoriaApi) {
    return json({
      status: "aguardando",
      mensagem: "As categorias do evento 590 ainda não foram publicadas no Boliche Brasil.",
      categoria: categoriaConfig.nome,
      evento,
      diaSolicitado,
      diasConsultados: dias,
      atletas: [],
      atualizadoEm: new Date().toISOString()
    });
  }

  const consultas = await Promise.all(dias.map(dia => consultarDia(evento, categoriaApi.id, dia)));
  const consolidado = consolidarDias(consultas);
  const atletas = consolidado.atletas.slice(0, limite);
  const inscritosEncontrados = Math.max(0, ...consultas.map(consulta => consulta.quantidadeTabela));

  return json({
    status: atletas.length > 0 ? "ok" : "aguardando",
    mensagem: atletas.length > 0
      ? undefined
      : inscritosEncontrados > 0
        ? "Inscritos e divisões encontrados; resultados oficiais ainda não lançados."
        : "Resultados oficiais ainda não disponíveis.",
    categoria: categoriaConfig.nome,
    evento,
    diaSolicitado,
    dia: consolidado.dia,
    diasConsultados: dias,
    ctg: categoriaApi.id,
    inscritosEncontrados,
    resultadosValidos: consolidado.atletas.length,
    progresso: consolidado.progresso,
    consultas: consultas.map(resumirConsulta),
    atletas,
    atualizadoEm: new Date().toISOString()
  });
}

async function consultarDia(evento, categoriaId, dia) {
  const tabelaUrl = `${API_BASE}/evento-atleta/tabela?id_evento=${encodeURIComponent(evento)}&dia=${dia}&ctg=${encodeURIComponent(categoriaId)}`;

  try {
    const dados = await fetchJson(tabelaUrl);
    const tabela = extrairTabela(dados);
    const atletas = normalizarTabela(tabela, dia);

    return {
      dia,
      url: tabelaUrl,
      quantidadeTabela: tabela.length,
      atletas,
      erro: null
    };
  } catch (erro) {
    return {
      dia,
      url: tabelaUrl,
      quantidadeTabela: 0,
      atletas: [],
      erro: mensagemErro(erro)
    };
  }
}

function consolidarDias(consultas) {
  const dia1 = consultas.find(consulta => consulta.dia === 1);
  const dia2 = consultas.find(consulta => consulta.dia === 2);

  if (dia2?.atletas.length) {
    const atletas = dia1?.atletas.length
      ? mesclarAtletas(dia1.atletas, dia2.atletas)
      : ordenarAtletas(dia2.atletas);

    return {
      dia: 2,
      atletas,
      progresso: calcularProgresso(atletas)
    };
  }

  if (dia1?.atletas.length) {
    const atletas = ordenarAtletas(dia1.atletas);
    return {
      dia: 1,
      atletas,
      progresso: calcularProgresso(atletas)
    };
  }

  const consultaValida = consultas
    .filter(consulta => consulta.atletas.length)
    .sort((a, b) => b.dia - a.dia)[0];
  const atletas = consultaValida ? ordenarAtletas(consultaValida.atletas) : [];

  return {
    dia: consultaValida?.dia || null,
    atletas,
    progresso: calcularProgresso(atletas)
  };
}

function mesclarAtletas(atletasDia1, atletasDia2) {
  const atletas = new Map();

  for (const atleta of atletasDia1) atletas.set(chaveAtleta(atleta), atleta);
  for (const atleta of atletasDia2) atletas.set(chaveAtleta(atleta), atleta);

  return ordenarAtletas([...atletas.values()]);
}

function chaveAtleta(atleta) {
  if (atleta.id) return `id:${atleta.id}`;
  return `nome:${semAcentos(atleta.atleta).toLowerCase().replace(/\s+/g, " ").trim()}`;
}

function ordenarAtletas(atletas) {
  return [...atletas]
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.media !== a.media) return b.media - a.media;
      return b.maiorLinha - a.maiorLinha;
    })
    .map((atleta, index) => ({ ...atleta, posicao: index + 1 }));
}

function calcularProgresso(atletas) {
  return {
    atletasComResultado: atletas.length,
    maiorNumeroDeLinhas: atletas.reduce((maior, atleta) => Math.max(maior, atleta.linhas), 0)
  };
}

function resumirConsulta(consulta) {
  return {
    dia: consulta.dia,
    registrosRecebidos: consulta.quantidadeTabela,
    resultadosValidos: consulta.atletas.length,
    erro: consulta.erro
  };
}

async function handleFinais(url) {
  const categoria = Number(url.searchParams.get("categoria"));
  const evento = url.searchParams.get("evento") || "582";

  if (!categoria) return json({ ok: false, error: "Categoria invalida" }, 400);

  const target = new URL(`${API_BASE}/evento-categoria-fase`);
  target.searchParams.set("id_evento", evento);
  target.searchParams.set("id_categoria", String(categoria));
  target.searchParams.set("expand", "eventoCategoriaPartidas,atleta1,atleta2");
  target.searchParams.set("sort", "num_ordem");

  const upstream = await fetchComTimeout(target.toString());
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
    const descricao = semAcentos(String(categoria.descricao || "")).toLowerCase();
    const genero = Number(categoria.genero);
    const divisao = Number(categoria.divisao);

    return genero === config.genero &&
      divisao === config.divisao &&
      descricao.includes(config.genero === 1 ? "femin" : "mascul");
  });
}

function resolverDias(valor) {
  if (valor === "auto") return [...DIAS_EVENTO];
  const dia = Number(valor);
  return DIAS_EVENTO.includes(dia) ? [dia] : null;
}

async function fetchJson(url) {
  const agora = Date.now();
  const cache = memoria.get(url);
  if (cache && cache.expiraEm > agora) return cache.valor;

  const resposta = await fetchComTimeout(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "TBF300Sports-CloudflareWorker"
    }
  });

  if (!resposta.ok) {
    throw new Error(`Erro HTTP ${resposta.status} ao acessar Boliche Brasil`);
  }

  const texto = await resposta.text();
  let dados;

  try {
    dados = JSON.parse(texto);
  } catch (erro) {
    dados = parseXmlBasico(texto);
  }

  memoria.set(url, { valor: dados, expiraEm: agora + CACHE_TTL_MS });
  return dados;
}

async function fetchComTimeout(url, opcoes = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, { ...opcoes, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
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

function normalizarTabela(tabela, dia) {
  return tabela
    .map((item, index) => {
      const pontosAtuais = numero(item.pontos_serie ?? item.total ?? item.t ?? item.pontos);
      const temAnterior = item.anterior !== null && item.anterior !== undefined && item.anterior !== "";
      const totalAnterior = temAnterior ? numero(item.anterior) : 0;
      const total = temAnterior ? totalAnterior + pontosAtuais : pontosAtuais;
      const jogos = normalizarJogos(item, dia);
      const linhas = numero(item.l ?? item.qtd_linhas) || jogos.filter(jogo => jogo.pontos > 1).length;
      const media = numero(item.media ?? item.m) || (linhas > 0 ? total / linhas : 0);
      const maiorLinha = numero(item.maior_linha ?? item.maiorLinha ?? item.ml);

      return {
        id: numero(item.id),
        posicao: numero(item.posicao || item.pos || index + 1),
        atleta: item.nome_evento || item.nome_completo || item.atleta || item.nome || "Atleta",
        dia,
        linhas,
        total,
        media,
        maiorLinha,
        jogos,
        pontosDia: pontosAtuais,
        totalAnterior,
        temResultado: temResultadoOficial(item, pontosAtuais)
      };
    })
    .filter(item => item.atleta && item.atleta !== "Atleta")
    .filter(item => item.temResultado)
    .map(item => {
      const { temResultado, ...atleta } = item;
      return atleta;
    });
}

function temResultadoOficial(item, pontosAtuais) {
  if (pontosAtuais > 1) return true;
  const linhas = extrairLinhas(item.linhas);
  return linhas.some(linha => numero(linha.v ?? linha.valor ?? linha.pontos) > 1);
}

function extrairLinhas(valor) {
  if (Array.isArray(valor)) return valor;
  if (typeof valor !== "string" || !valor.trim()) return [];

  try {
    const linhas = JSON.parse(valor);
    return Array.isArray(linhas) ? linhas : [];
  } catch (erro) {
    return [];
  }
}

function normalizarJogos(item, dia) {
  const inicio = dia === 2 ? 7 : 1;
  const quantidade = dia === 2 ? 5 : 6;
  const linhasRecebidas = extrairLinhas(item.linhas);

  return Array.from({ length: quantidade }, (_, indice) => {
    const numeroLinha = inicio + indice;
    const linhaRecebida = linhasRecebidas[indice];
    const valorRecebido = linhaRecebida && typeof linhaRecebida === "object"
      ? linhaRecebida.v ?? linhaRecebida.valor ?? linhaRecebida.pontos ?? linhaRecebida.score
      : linhaRecebida;
    const valorCampo = item[`l${numeroLinha}`] ??
      item[`L${numeroLinha}`] ??
      item[`linha${numeroLinha}`] ??
      item[`linha_${numeroLinha}`] ??
      item[`l${indice + 1}`] ??
      item[`L${indice + 1}`];
    const pontos = numero(valorRecebido ?? valorCampo);

    return {
      linha: numeroLinha,
      pontos: pontos > 1 ? pontos : null
    };
  });
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

function limitar(valor, minimo, maximo) {
  const convertido = Number(valor);
  if (!Number.isFinite(convertido)) return minimo;
  return Math.max(minimo, Math.min(maximo, convertido));
}

function semAcentos(valor) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function mensagemErro(erro) {
  if (erro?.name === "AbortError") return "Tempo limite ao consultar o Boliche Brasil.";
  return erro?.message || "Erro desconhecido.";
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
