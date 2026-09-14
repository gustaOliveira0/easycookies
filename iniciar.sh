#!/usr/bin/env bash
# Sobe o painel na porta 7001 (ou a porta em $PORT) e abre no navegador.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

abre() { command -v open >/dev/null && open "$1" || xdg-open "$1" >/dev/null 2>&1; }

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)'; then
  echo
  echo "  Falta instalar o Node.js (versao 18 ou mais nova)."
  echo "  Vou abrir o site: baixe a versao LTS, instale e depois abra este arquivo de novo."
  echo
  abre "https://nodejs.org/pt"
  read -rp "  Pressione Enter para fechar..."
  exit 1
fi

node server.js
