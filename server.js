#!/usr/bin/env node
/**
 * Gerador de Presell de Cookies
 * Servidor HTTP sem dependencias externas. Porta padrao: 7001.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const os   = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');

const PORT     = process.env.PORT || 7001;
const HOST     = process.env.HOST;   // HOST=127.0.0.1 deixa o painel so para o proprio servidor (ex.: atras do nginx)
const SENHA    = process.env.SENHA || '';   // com SENHA, a API so responde a "Authorization: Bearer <senha>"
// Sites de outro endereco que podem usar a API (ex.: o painel publicado na Vercel), separados por virgula.
const ORIGENS  = (process.env.ORIGENS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
const RAIZ     = __dirname;
const DIR_SAI  = path.join(RAIZ, 'saidas');
const DIR_PUB  = path.join(RAIZ, 'public');

const IDIOMAS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/idiomas.json'), 'utf8'));
const PAISES  = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/paises.json'), 'utf8'));
const SEO     = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/seo.json'), 'utf8'));

const MIMES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
};
const EXT_POR_MIME = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp',
  'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico', 'image/avif': '.avif',
};

/* ---------------------------------------------------------------- utilidades */

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function slugLivre(base) {
  const b = slugify(base) || 'presell';
  let s = b, i = 2;
  while (fs.existsSync(path.join(DIR_SAI, s))) s = `${b}-${i++}`;
  return s;
}

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function lerCorpo(req, limiteMb = 40) {
  return new Promise((resolve, reject) => {
    const partes = []; let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limiteMb * 1024 * 1024) { reject(new Error('Corpo muito grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/** Converte uma dataURL em { buffer, ext }. */
function decodificaDataUrl(dataUrl) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const buf  = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { buffer: buf, ext: EXT_POR_MIME[mime] || '.img', mime };
}

/* ------------------------------------------------------------------ zip puro */

function crc32(buf) {
  let c, tabela = crc32.tabela;
  if (!tabela) {
    tabela = crc32.tabela = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tabela[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ tabela[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

/** Monta um .zip (deflate) a partir de [{ nome, dados }]. */
function montaZip(arquivos) {
  const locais = [], central = [];
  let deslocamento = 0;

  const agora = new Date();
  const horaDos = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const dataDos = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();

  for (const { nome, dados } of arquivos) {
    const nomeBuf = Buffer.from(nome, 'utf8');
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // versao necessaria
    local.writeUInt16LE(0x0800, 6);      // flag: nomes em utf-8
    local.writeUInt16LE(8, 8);           // metodo deflate
    local.writeUInt16LE(horaDos, 10); local.writeUInt16LE(dataDos, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nomeBuf, comprimido);

    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4); cab.writeUInt16LE(20, 6);
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(8, 10);
    cab.writeUInt16LE(horaDos, 12); cab.writeUInt16LE(dataDos, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(comprimido.length, 20);
    cab.writeUInt32LE(dados.length, 24);
    cab.writeUInt16LE(nomeBuf.length, 28);
    cab.writeUInt32LE(0, 42 - 4);        // offset do cabecalho local
    cab.writeUInt32LE(deslocamento, 42);
    central.push(cab, nomeBuf);

    deslocamento += local.length + nomeBuf.length + comprimido.length;
  }

  const corpoCentral = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(corpoCentral.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, corpoCentral, fim]);
}

/* ------------------------------------------------- geracao da pagina presell */

function blocoModal(id, rotulo, conteudo) {
  return `
                <div id="${id}">
                    <button class="faq-toggle" type="button">${esc(rotulo)}</button>
                    <div class="modal-overlay">
                        <div class="modal-content">
                            <div class="modal-header"><a href="#" class="modal-close">X</a></div>
                            <div class="modal-body"><div class="faq-content">${conteudo}</div></div>
                        </div>
                    </div>
                </div>`;
}

const CSS_MODAIS = `
        .glp-links { margin-top: 18px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .glp-links .faq-toggle {
            background: none; border: 0; padding: 0; margin: 0; color: #777; font-size: 13px;
            line-height: 1.5; cursor: pointer; text-decoration: none; font-family: inherit;
        }
        .glp-links .faq-toggle:hover, .glp-links .faq-toggle:focus { color: #555; outline: none; }
        .glp-links .modal-overlay {
            display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5);
            justify-content: center; align-items: center; z-index: 9999;
        }
        .glp-links .modal-content {
            background: #fff; border-radius: 8px; width: 90%; max-width: 700px; max-height: 80vh;
            overflow-y: scroll; overflow-x: hidden; box-shadow: 0 4px 15px rgba(0,0,0,.3);
            position: relative; scrollbar-gutter: stable; text-align: left;
        }
        .glp-links .modal-content::-webkit-scrollbar { width: 10px; }
        .glp-links .modal-content::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 8px; }
        .glp-links .modal-content::-webkit-scrollbar-thumb { background: #bbb; border-radius: 8px; }
        .glp-links .modal-content::-webkit-scrollbar-thumb:hover { background: #999; }
        .glp-links .modal-header {
            position: sticky; top: 0; background: #fff; border-bottom: 1px solid #eee;
            padding: 12px 20px; z-index: 10; display: flex; justify-content: flex-start;
        }
        .glp-links .modal-close { color: #007bff; text-decoration: none; font-weight: 600; font-size: 14px; cursor: pointer; }
        .glp-links .modal-close:hover { text-decoration: underline; }
        .glp-links .modal-body { padding: 20px; }
        .glp-links .faq-content h2 { font-size: 18px; margin: 14px 0 6px; font-weight: 600; }
        .glp-links .faq-content h3 { font-size: 16px; margin: 12px 0 6px; font-weight: 600; }
        .glp-links .faq-content p, .glp-links .faq-content li { margin: 0 0 12px; line-height: 1.5; font-size: 14px; }
        .glp-links .faq-content ul, .glp-links .faq-content ol { padding-left: 22px; }`;

const JS_MODAIS = `
    <script>
        document.querySelectorAll('.glp-links > div').forEach(function (caixa) {
            var abrir  = caixa.querySelector('.faq-toggle');
            var modal  = caixa.querySelector('.modal-overlay');
            var fechar = caixa.querySelector('.modal-close');
            if (!abrir || !modal || !fechar) return;
            abrir.addEventListener('click', function () {
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            });
            fechar.addEventListener('click', function (e) {
                e.preventDefault();
                modal.style.display = 'none';
                document.body.style.overflow = 'hidden';
            });
            modal.addEventListener('click', function (e) {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    document.body.style.overflow = 'hidden';
                }
            });
        });
    </script>`;

function geraHtml(cfg, arqs) {
  const t = IDIOMAS[cfg.idioma] || IDIOMAS.en;
  const link = esc(cfg.linkAfiliado);

  const tituloPopup = esc(cfg.tituloPopup || t.tituloPopup);
  const textoPopup  = esc(cfg.textoPopup  || t.textoPopup);
  const botaoOk     = esc(cfg.botaoOk     || t.botaoOk);
  const botaoNok    = esc(cfg.botaoNok    || t.botaoNok);

  const borda = (n) => (n && n !== '0' ? `border: ${n}px solid black;` : 'border: 0;');

  const links = [];
  if (cfg.politica) links.push(blocoModal('glp-privacy', t.linkPrivacidade, t.privacidade));
  if (cfg.termos)   links.push(blocoModal('glp-termos',  t.linkTermos,      t.termos));
  if (cfg.seo && cfg.seo.trim()) links.push(blocoModal('glp-faq', cfg.linkSeo || t.linkSeo, cfg.seo));

  const htmlLinks = links.length ? `\n            <div class="glp-links">${links.join('\n')}\n            </div>` : '';

  return `<!DOCTYPE html>
<html lang="${esc(cfg.idioma)}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${esc(cfg.metaDescricao)}">
    <meta name="robots" content="index, follow">
    <title>${esc(cfg.titulo)}</title>${arqs.favicon ? `
    <link rel="icon" href="${esc(arqs.favicon)}">` : ''}
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; }
        body { font-family: Arial, Helvetica, sans-serif; overflow: hidden; background: #f2f2f2; }

        .image-container {
            position: fixed; inset: 0; z-index: 1;
            filter: blur(${Number(cfg.blur) || 3}px);
            transform: scale(1.03);
        }
        .image-container picture { display: block; width: 100%; height: 100%; }
        .img-class { width: 100%; height: 100%; display: block; object-fit: cover; object-position: top center; }

        #popup-consent {
            position: fixed; inset: 0; z-index: 3;
            background-color: rgba(0, 0, 0, ${(Number(cfg.opacidadeFundo) || 50) / 100});
            display: flex; justify-content: center; align-items: center; padding: 16px;
        }
        .popup {
            background-color: #fff; padding: 30px; border-radius: 15px; text-align: center;
            box-shadow: 0 0 15px rgba(0, 0, 0, .8); position: relative;
            max-width: 400px; width: 90%; max-height: 92vh; overflow-y: auto;
        }
        .popup h1 { font-size: 1.4rem; color: #333; margin-bottom: 15px; }
        .popup p  { margin-bottom: 30px; font-size: 1rem; line-height: 1.5; color: #555; }

        #botao-aceita, #botao-nao-aceita {
            display: inline-block; padding: 10px 20px; border-radius: 5px; cursor: pointer;
            font-size: 1rem; margin: 5px; font-weight: bold; text-decoration: none;
        }
        #botao-aceita {
            background-color: ${esc(cfg.corBotaoOk)}; color: ${esc(cfg.corTextoOk)}; ${borda(cfg.bordaOk)}
        }
        #botao-nao-aceita {
            background-color: ${esc(cfg.corBotaoNok)}; color: ${esc(cfg.corTextoNok)}; ${borda(cfg.bordaNok)}
        }
        #botao-aceita:hover, #botao-nao-aceita:hover { filter: brightness(.85); }
${links.length ? CSS_MODAIS : ''}
    </style>
${cfg.tagGoogle || ''}
${cfg.rastreamento || ''}
</head>
<body>

    <div class="image-container">
      <picture>
        <source srcset="${esc(arqs.desktop)}" media="(min-width: 1025px)">
        <source srcset="${esc(arqs.tablet)}"  media="(min-width: 768px) and (max-width: 1024px)">
        <source srcset="${esc(arqs.mobile)}"  media="(max-width: 767px)">
        <img class="img-class" src="${esc(arqs.desktop)}" alt="${esc(cfg.titulo)}" fetchpriority="high">
      </picture>
    </div>

    <div id="popup-consent">
        <div class="popup">
            <h1 id="titulo-popup">${tituloPopup}</h1>
            <p id="texto-popup">${textoPopup}</p>
            <a id="botao-aceita" href="${link}" rel="nofollow noopener">${botaoOk}</a>
            <a id="botao-nao-aceita" href="${link}" rel="nofollow noopener">${botaoNok}</a>${htmlLinks}
        </div>
    </div>
${links.length ? JS_MODAIS : ''}
</body>
</html>
`;
}

/* ---------------------------------------------------------------- persistencia */

function listaPresells() {
  if (!fs.existsSync(DIR_SAI)) return [];
  return fs.readdirSync(DIR_SAI)
    .filter((d) => fs.existsSync(path.join(DIR_SAI, d, 'config.json')))
    .map((d) => {
      const cfg = JSON.parse(fs.readFileSync(path.join(DIR_SAI, d, 'config.json'), 'utf8'));
      return { slug: d, ...cfg };
    })
    .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}

function gera(dados) {
  const cfg = dados.config || {};
  if (!cfg.linkAfiliado || !/^https?:\/\//i.test(cfg.linkAfiliado)) {
    throw new Error('Link de afiliado invalido (precisa comecar com http:// ou https://)');
  }
  const imgs = dados.imagens || {};
  for (const k of ['desktop', 'tablet', 'mobile']) {
    if (!imgs[k]) throw new Error(`Falta a imagem de ${k}`);
  }

  const slug = slugLivre(cfg.titulo || `${cfg.pais || 'presell'}-${cfg.idioma || ''}`);
  const dir  = path.join(DIR_SAI, slug);
  fs.mkdirSync(dir, { recursive: true });

  const nomes = { desktop: 'w', tablet: 't', mobile: 'm', favicon: 'favicon' };
  const arqs  = {};
  for (const [chave, base] of Object.entries(nomes)) {
    if (!imgs[chave]) continue;
    const d = decodificaDataUrl(imgs[chave]);
    if (!d) throw new Error(`Arquivo invalido em ${chave}`);
    const nome = base + d.ext;
    fs.writeFileSync(path.join(dir, nome), d.buffer);
    arqs[chave] = nome;
  }

  const html = geraHtml(cfg, arqs);
  fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  fs.writeFileSync(path.join(dir, 'config.json'),
    JSON.stringify({ ...cfg, arquivos: arqs, criadoEm: new Date().toISOString() }, null, 1), 'utf8');

  return { slug };
}

function zipDePresell(slug) {
  const dir = path.join(DIR_SAI, slug);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  let prefixo = '';
  if (cfg.pastaPais) {
    prefixo = `${cfg.pais || 'site'}/`;
    if (cfg.pastaIdioma) prefixo += `${cfg.idioma}/`;
  }
  const arquivos = fs.readdirSync(dir)
    .filter((f) => f !== 'config.json')
    .map((f) => ({ nome: prefixo + f, dados: fs.readFileSync(path.join(dir, f)) }));
  return montaZip(arquivos);
}

/* ------------------------------------------------------------------ gera seo */

/** Moeda de cada pais atendido, para formatar o preco. */
const MOEDAS = {
  al: 'ALL', de: 'EUR', ad: 'EUR', ar: 'ARS', au: 'AUD', at: 'EUR', be: 'EUR', by: 'BYN',
  ba: 'BAM', br: 'BRL', bg: 'BGN', ca: 'CAD', cy: 'EUR', hr: 'EUR', dk: 'DKK', sk: 'EUR',
  si: 'EUR', es: 'EUR', us: 'USD', ee: 'EUR', fi: 'EUR', fr: 'EUR', gr: 'EUR', nl: 'EUR',
  hu: 'HUF', ie: 'EUR', is: 'ISK', il: 'ILS', it: 'EUR', lv: 'EUR', li: 'CHF', lt: 'EUR',
  lu: 'EUR', mk: 'MKD', mt: 'EUR', mx: 'MXN', md: 'MDL', mc: 'EUR', me: 'EUR', no: 'NOK',
  nz: 'NZD', pl: 'PLN', pt: 'EUR', gb: 'GBP', cz: 'CZK', ro: 'RON', ru: 'RUB', sm: 'EUR',
  rs: 'RSD', se: 'SEK', ch: 'CHF', ua: 'UAH', va: 'EUR',
};

/**
 * Extrai o numero do preco digitado, para o markup: "R$ 1.290,90" e "$1,290.90" viram
 * 1290.90, "29.99" vira 29.99 e "1.290" vira 1290. O separador decimal e o ultimo ponto
 * ou virgula seguido de uma ou duas casas; o resto e separador de milhar.
 */
function precoNumerico(preco) {
  const m = /\d[\d.,\s]*\d|\d/.exec(String(preco || ''));
  if (!m) return '';
  const bruto = m[0].replace(/\s/g, '');
  const decimal = /[.,](\d{1,2})$/.exec(bruto);
  if (!decimal) return bruto.replace(/[.,]/g, '');
  const inteiro = bruto.slice(0, -decimal[0].length).replace(/[.,]/g, '');
  return `${inteiro || '0'}.${decimal[1]}`;
}

/**
 * Frase do pais no idioma da pagina, ja com preposicao e artigo ("no Brasil", "in der Schweiz").
 * Usa a frase pronta do par pais+idioma; sem ela, encaixa o nome do ICU no padrao do idioma.
 */
function frasePais(pais, idioma) {
  const cod = String(pais || '').toLowerCase();
  if (!cod) return '';
  const pronta = (SEO.locais[idioma] || {})[cod];
  if (pronta) return pronta;
  let nome = cod.toUpperCase();
  try {
    nome = new Intl.DisplayNames([idioma, 'en'], { type: 'region' }).of(nome) || nome;
  } catch { /* ICU sem esse idioma: fica o codigo */ }
  return (SEO.padraoPais[idioma] || '{pais}').replace('{pais}', nome);
}

/** Formata o preco na moeda escolhida quando so vem numero; senao devolve o que foi digitado. */
function formataPreco(preco, pais, idioma, moedaEscolhida) {
  const bruto = String(preco || '').trim();
  if (!bruto) return '';
  const so = bruto.replace(/\s/g, '');
  if (!/^\d+([.,]\d{1,2})?$/.test(so)) return bruto;
  const valor = Number(so.replace(',', '.'));
  const moeda = String(moedaEscolhida || '').trim().toUpperCase()
    || MOEDAS[String(pais || '').toLowerCase()];
  if (!moeda) return bruto;
  try {
    return new Intl.NumberFormat(`${idioma}-${String(pais).toUpperCase()}`, {
      style: 'currency', currency: moeda,
    }).format(valor);
  } catch { return `${valor} ${moeda}`; }
}

/**
 * Monta o bloco de SEO (o conteudo do modal "Learn More"), o titulo da pagina e a meta
 * descricao a partir dos dados do produto. Tudo sai no idioma escolhido, com o pais
 * escrito nesse mesmo idioma.
 */
function geraSeo(d = {}) {
  const idioma = SEO.textos[d.idioma] ? d.idioma : 'en';
  const t      = SEO.textos[idioma];

  const produto  = String(d.produto || '').trim();
  const emPais   = frasePais(d.pais, idioma);
  const preco    = formataPreco(d.preco, d.pais, idioma, d.moeda);
  const garantia = String(d.garantia || '').trim();
  const desconto = String(d.desconto || '').replace(/\D/g, ''); // campo livre: fica so o numero

  if (!produto) throw new Error('Informe o nome do produto');

  const troca = (s) => esc(String(s)
    .replace(/\{produto\}/g, produto)
    .replace(/\{emPais\}/g, emPais)
    .replace(/\{preco\}/g, preco)
    .replace(/\{garantia\}/g, garantia)
    .replace(/\{desconto\}/g, desconto));

  // Preco: com valor quando informado, senao a frase generica; o desconto entra depois.
  const rPreco = [preco ? t.rPreco : t.rPrecoSem];
  if (desconto) rPreco.push(t.rDesconto);

  // Entrega: a frase base sempre, e o frete rapido por padrao; marcado, o gratis toma o lugar.
  const rEntrega = [emPais ? t.rEntrega : ''];
  rEntrega.push(d.freteGratis ? t.rFreteGratis : t.rFreteRapido);

  const faq = [
    [t.qProduto,  [t.rProduto]],
    [t.qPreco,    rPreco],
    [t.qGarantia, [garantia ? t.rGarantia : t.rGarantiaSem]],
    [t.qEntrega,  rEntrega],
    [t.qOnde,     [t.rOnde]],
  ];

  const linhas = [
    `<h2>${troca(t.tituloSobre)}</h2>`,
    `<p>${troca(t.sobre)}</p>`,
    `<h2>${troca(t.tituloFaq)}</h2>`,
  ];
  for (const [pergunta, respostas] of faq) {
    linhas.push(`<h3>${troca(pergunta)}</h3>`);
    linhas.push(`<p>${troca(respostas.filter(Boolean).join(' '))}</p>`);
  }

  // Titulo e meta vao para campos de texto, entao seguem sem escape de HTML.
  const simples = (str) => String(str)
    .replace(/\{produto\}/g, produto)
    .replace(/\{emPais\}/g, emPais)
    .replace(/\{preco\}/g, preco)
    .replace(/\{garantia\}/g, garantia)
    .replace(/\{desconto\}/g, desconto)
    .replace(/\s+/g, ' ')
    .trim();

  // Os mesmos dados do bloco acima entram no titulo e na meta, na ordem de apelo.
  const pedacos = [];
  if (preco) pedacos.push(preco);
  if (desconto) pedacos.push(simples(t.fDesconto));
  pedacos.push(simples(d.freteGratis ? t.fFreteGratis : t.fFreteRapido));
  if (garantia) pedacos.push(simples(t.fGarantia));

  // Titulo no formato "Produto OFICIAL BR: Economize ate 40% – Preco especial R$ 197 + 90 dias
  // de garantia". Cada parte so entra se o dado foi preenchido e se ainda couber.
  const sigla = (SEO.siglas[String(d.pais || '').toLowerCase()] || String(d.pais || '')).toUpperCase();
  // Garantia e frete vem em caixa de frase, porque a meta tambem os usa; no titulo sobem
  // de caixa, e em ingles sobe cada palavra, como manda o costume do idioma.
  const porPalavra = SEO.tituloEmMaiusculas.includes(idioma);
  const enfase = (str) => (porPalavra
    ? str.replace(/(^|[\s-])(\p{L})/gu, (todo, antes, letra) => antes + letra.toUpperCase())
    : str.charAt(0).toUpperCase() + str.slice(1));

  const caudas = [];
  if (desconto) caudas.push(simples(t.fEconomize));
  if (preco) caudas.push(`${simples(t.fPrecoEspecial)} ${preco}`);
  if (garantia) caudas.push(enfase(simples(t.fGarantia)));
  if (d.freteGratis) caudas.push(enfase(simples(t.fFreteGratis)));

  let titulo = [produto, t.fOficial, sigla].filter(Boolean).join(' ');
  let postos = 0; // o separador depende de quantas partes entraram, nao da posicao na lista
  for (const c of caudas) {
    const tentativa = `${titulo}${postos === 0 ? ': ' : postos === 1 ? ' – ' : ' + '}${c}`;
    if (tentativa.length > 110) continue;
    titulo = tentativa;
    postos++;
  }

  // A meta segue com o produto e o pais por extenso, e os mesmos dados em lista.
  const base = simples(t.base);
  const usados = [...pedacos];
  const montaMeta = () => `${base}: ${usados.join(', ')}. ${simples(t.cta)}`;
  let meta = montaMeta();
  while (usados.length > 1 && meta.length > 155) { usados.pop(); meta = montaMeta(); }

  return { seo: linhas.join('\n'), titulo, meta, markup: geraMarkup(d, { produto, meta, t }) };
}

/**
 * Esquema markup do produto (JSON-LD). So entra o que foi preenchido: sem preco nao ha
 * oferta, sem garantia nao ha WarrantyPromise, e o frete so aparece com valor conhecido.
 */
function geraMarkup(d, { produto, meta, t }) {
  const valor = precoNumerico(d.preco);
  const moeda = String(d.moeda || '').trim().toUpperCase()
    || MOEDAS[String(d.pais || '').toLowerCase()] || '';

  const json = { '@context': 'https://schema.org', '@type': 'Product', name: produto, description: meta };
  if (!valor || !moeda) return JSON.stringify(json, null, 2);

  const oferta = {
    '@type': 'Offer',
    priceCurrency: moeda,
    price: valor,
    itemCondition: 'https://schema.org/NewCondition',
    availability: 'https://schema.org/InStock',
  };
  if (d.linkAfiliado) oferta.url = String(d.linkAfiliado).trim();

  const desconto = String(d.desconto || '').replace(/\D/g, '');
  if (desconto) {
    oferta.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      priceType: 'https://schema.org/SalePrice',
      valueAddedTaxIncluded: true,
      name: t.fDesconto.replace('{desconto}', desconto),
    };
  }

  const garantia = String(d.garantia || '').replace(/\D/g, '');
  if (garantia) oferta.warranty = { '@type': 'WarrantyPromise', durationOfWarranty: `P${garantia}D` };

  oferta.seller = { '@type': 'Organization', name: `${produto} ${t.fLojaOficial}` };

  const frete = d.freteGratis ? '0' : precoNumerico(d.custoFrete);
  if (frete !== '') {
    oferta.shippingDetails = {
      '@type': 'OfferShippingDetails',
      shippingRate: { '@type': 'MonetaryAmount', value: frete, currency: moeda },
    };
  }

  json.offers = oferta;
  return JSON.stringify(json, null, 2);
}

/* ------------------------------------------------------------- captura do site */

/* Os prints saem do Chrome em modo headless, que ja esta na maquina: nenhuma janela
   abre e nenhuma dependencia entra no projeto. */
const PASTAS_WIN = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
const NAVEGADORES = [
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  '/usr/bin/chromium-browser', '/snap/bin/chromium', '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ...PASTAS_WIN.map((p) => path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  // Sem Chrome, o Edge (que vem no Windows) tira os mesmos prints.
  '/usr/bin/microsoft-edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ...PASTAS_WIN.map((p) => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
];

function achaNavegador() {
  const escolhido = process.env.CHROME || NAVEGADORES.find((c) => fs.existsSync(c));
  if (!escolhido) throw new Error('Chrome (ou Edge) nao encontrado. Instale o Google Chrome ou aponte a variavel CHROME para o executavel.');
  return escolhido;
}

const UA_TABLET  = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1';
const UA_CELULAR = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const TELAS = [
  { campo: 'desktop', largura: 1440, altura: 900,  ua: '' },
  { campo: 'tablet',  largura: 820,  altura: 1180, ua: UA_TABLET },
  { campo: 'mobile',  largura: 390,  altura: 844,  ua: UA_CELULAR },
];

function rodaNavegador(argumentos) {
  return new Promise((ok, erro) => {
    execFile(achaNavegador(), argumentos, { timeout: 60000 }, (e, saida, err) => {
      // O Chrome escreve avisos de GPU e de rede na saida de erro mesmo quando da certo.
      if (e && e.killed) return erro(new Error('O site demorou demais para carregar'));
      if (e && !/written to file/.test(String(err))) return erro(new Error('Falha ao abrir o site'));
      ok();
    });
  });
}

/** Um print de uma tela, devolvido como dataURL. */
async function print(url, tela, pasta) {
  const arquivo = path.join(pasta, tela.campo + '.png');
  const args = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--user-data-dir=' + path.join(pasta, 'perfil'),
    '--window-size=' + tela.largura + ',' + tela.altura,
    '--screenshot=' + arquivo,
  ];
  if (tela.ua) args.push('--user-agent=' + tela.ua);
  args.push(url);

  await rodaNavegador(args);
  if (!fs.existsSync(arquivo)) throw new Error('Nao consegui o print de ' + tela.campo);
  return 'data:image/png;base64,' + fs.readFileSync(arquivo).toString('base64');
}

/** Favicon declarado no HTML da pagina; sem declaracao, tenta o /favicon.ico. */
async function pegaFavicon(html, urlFinal) {
  const tenta = async (endereco) => {
    const r = await fetch(endereco, { redirect: 'follow' });
    if (!r.ok) return null;
    const tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!tipo.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return 'data:' + tipo + ';base64,' + buf.toString('base64');
  };

  try {
    const marcas = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
      .filter((tag) => /rel\s*=\s*["'][^"']*\bicon\b/i.test(tag));
    for (const tag of marcas) {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (!href) continue;
      const achado = await tenta(new URL(href[1], urlFinal).href).catch(() => null);
      if (achado) return achado;
    }
    return await tenta(new URL('/favicon.ico', urlFinal).href).catch(() => null);
  } catch { return null; }
}

/** Os tres prints e o favicon de um endereco. */
async function capturaSite(endereco) {
  let url;
  try { url = new URL(endereco); } catch { throw new Error('Endereco invalido'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Use um endereco http ou https');

  let resposta;
  try {
    resposta = await fetch(url.href, { redirect: 'follow' });
  } catch {
    throw new Error('Nao consegui abrir o site. Confira o endereco.');
  }
  if (resposta.status >= 400) throw new Error('O site respondeu ' + resposta.status + '.');
  const html = await resposta.text();

  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'presell-print-'));
  try {
    const imagens = {};
    for (const tela of TELAS) imagens[tela.campo] = await print(resposta.url, tela, pasta);
    imagens.favicon = await pegaFavicon(html, resposta.url);
    return imagens;
  } finally {
    fs.rmSync(pasta, { recursive: true, force: true });
  }
}

/* --------------------------------------------------------------------- rotas */

function serveArquivo(res, arquivo, download) {
  if (!fs.existsSync(arquivo) || !fs.statSync(arquivo).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nao encontrado');
  }
  const buf = fs.readFileSync(arquivo);
  const cabecalhos = {
    'Content-Type': MIMES[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  };
  if (download) cabecalhos['Content-Disposition'] = `attachment; filename="${download}"`;
  res.writeHead(200, cabecalhos);
  res.end(buf);
}

/** Compara a senha em tempo constante (o hash iguala os tamanhos). */
function senhaConfere(cabecalho) {
  const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest();
  return crypto.timingSafeEqual(hash(cabecalho), hash('Bearer ' + SENHA));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rota = decodeURIComponent(url.pathname);

  if (ORIGENS.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // As paginas em /p/ ficam abertas: sao as presells prontas, feitas para serem publicas.
  if (SENHA && (rota.startsWith('/api/') || rota.startsWith('/download/')) && !senhaConfere(req.headers.authorization)) {
    return json(res, 401, { ok: false, erro: 'Senha incorreta' });
  }

  try {
    if (rota === '/' || rota === '/index.html') {
      return serveArquivo(res, path.join(DIR_PUB, 'index.html'));
    }

    if (rota === '/api/dados') {
      return json(res, 200, {
        paises: PAISES.paises,
        idiomasPorPais: PAISES.idiomasPorPais,
        moedas: MOEDAS,
        textos: Object.fromEntries(Object.entries(IDIOMAS).map(([k, v]) => [k, {
          tituloPopup: v.tituloPopup, textoPopup: v.textoPopup,
          botaoOk: v.botaoOk, botaoNok: v.botaoNok, linkSeo: v.linkSeo,
        }])),
      });
    }

    if (rota === '/api/presells' && req.method === 'GET') {
      return json(res, 200, listaPresells());
    }

    if (rota === '/api/preview' && req.method === 'POST') {
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8'));
      const imgs  = corpo.imagens || {};
      // No preview as imagens entram inline (dataURL), sem gravar nada em disco.
      const html  = geraHtml(corpo.config || {}, {
        desktop: imgs.desktop || '', tablet: imgs.tablet || imgs.desktop || '',
        mobile:  imgs.mobile  || imgs.desktop || '', favicon: '',
      });
      const buf = Buffer.from(html, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': buf.length });
      return res.end(buf);
    }

    if (rota === '/api/capturar' && req.method === 'POST') {
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8'));
      return json(res, 200, { ok: true, imagens: await capturaSite(corpo.url) });
    }

    if (rota === '/api/seo' && req.method === 'POST') {
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8'));
      return json(res, 200, { ok: true, ...geraSeo(corpo) });
    }

    if (rota === '/api/gerar' && req.method === 'POST') {
      const corpo = JSON.parse((await lerCorpo(req)).toString('utf8'));
      const r = gera(corpo);
      return json(res, 200, { ok: true, ...r });
    }

    if (rota.startsWith('/api/presells/') && req.method === 'DELETE') {
      const slug = slugify(rota.slice('/api/presells/'.length));
      const dir  = path.join(DIR_SAI, slug);
      if (dir.startsWith(DIR_SAI) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      return json(res, 200, { ok: true });
    }

    if (rota.startsWith('/download/') && rota.endsWith('.zip')) {
      const slug = slugify(rota.slice('/download/'.length, -4));
      if (!fs.existsSync(path.join(DIR_SAI, slug))) { res.writeHead(404); return res.end('Nao encontrado'); }
      const buf = zipDePresell(slug);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${slug}.zip"`,
      });
      return res.end(buf);
    }

    if (rota.startsWith('/p/')) {
      const resto = rota.slice(3);
      const barra = resto.indexOf('/');
      const slug  = slugify(barra === -1 ? resto : resto.slice(0, barra));
      const rel   = barra === -1 ? 'index.html' : (resto.slice(barra + 1) || 'index.html');
      const alvo  = path.join(DIR_SAI, slug, rel);
      if (!path.resolve(alvo).startsWith(path.resolve(DIR_SAI))) { res.writeHead(403); return res.end('Proibido'); }
      if (barra === -1) { res.writeHead(302, { Location: `/p/${slug}/` }); return res.end(); }
      return serveArquivo(res, alvo);
    }

    const publico = path.join(DIR_PUB, rota.replace(/^\/+/, ''));
    if (path.resolve(publico).startsWith(path.resolve(DIR_PUB)) && fs.existsSync(publico)) {
      return serveArquivo(res, publico);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nao encontrado');
  } catch (erro) {
    console.error(erro);
    json(res, 400, { ok: false, erro: erro.message });
  }
});

/** Abre o painel no navegador padrao. SEM_NAVEGADOR=1 desliga. */
function abrePainel(url) {
  if (process.env.SEM_NAVEGADOR) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}

const ENDERECO = `http://localhost:${PORT}`;

servidor.on('error', (erro) => {
  if (erro.code !== 'EADDRINUSE') throw erro;
  // O painel ja esta aberto em outra janela: so mostra de novo.
  console.log(`O painel ja esta rodando em ${ENDERECO} (abrindo no navegador).`);
  abrePainel(ENDERECO);
  setTimeout(() => process.exit(0), 1500);
});

servidor.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  Gerador de Presell de Cookies rodando em ${ENDERECO}`);
  console.log(`  Presells salvas em: ${DIR_SAI}`);
  console.log('');
  console.log('  Deixe esta janela aberta enquanto usa o painel. Para desligar, feche-a.');
  console.log('');
  abrePainel(ENDERECO);
});
