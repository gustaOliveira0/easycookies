#!/usr/bin/env node
/**
 * Gerador de Presell de Cookies
 * Servidor HTTP sem dependencias externas. Porta padrao: 7001.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const PORT     = process.env.PORT || 7001;
const RAIZ     = __dirname;
const DIR_SAI  = path.join(RAIZ, 'saidas');
const DIR_PUB  = path.join(RAIZ, 'public');

const IDIOMAS = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/idiomas.json'), 'utf8'));
const PAISES  = JSON.parse(fs.readFileSync(path.join(RAIZ, 'data/paises.json'), 'utf8'));

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

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const rota = decodeURIComponent(url.pathname);

  try {
    if (rota === '/' || rota === '/index.html') {
      return serveArquivo(res, path.join(DIR_PUB, 'index.html'));
    }

    if (rota === '/api/dados') {
      return json(res, 200, {
        paises: PAISES.paises,
        idiomasPorPais: PAISES.idiomasPorPais,
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

servidor.listen(PORT, () => {
  console.log(`Gerador de Presell de Cookies rodando em http://localhost:${PORT}`);
  console.log(`Saidas em: ${DIR_SAI}`);
});
