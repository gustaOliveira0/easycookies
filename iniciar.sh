#!/usr/bin/env bash
# Sobe o gerador na porta 7001 (ou a porta em $PORT).
cd "$(dirname "$0")"
exec node server.js
