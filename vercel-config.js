// Build da Vercel: grava public/config.js com o endereco do servidor (variavel API_URL).
const fs = require('fs');
const api = process.env.API_URL || '';
if (!api) console.warn('API_URL nao definida: o painel vai procurar a API no proprio endereco.');
fs.writeFileSync(__dirname + '/public/config.js', `window.API_URL = ${JSON.stringify(api)};\n`);
