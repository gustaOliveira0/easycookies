@echo off
rem Dois cliques no Windows abrem o painel. Deixe esta janela aberta enquanto usa.
title Gerador de Presell de Cookies
cd /d "%~dp0"

set "NODE=node"
where node >nul 2>nul && goto versao
set "NODE=%ProgramFiles%\nodejs\node.exe"
if exist "%NODE%" goto versao

echo.
echo  O Node.js nao esta instalado. Tentando instalar agora, aguarde...
echo.
where winget >nul 2>nul || goto manual
winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
if exist "%NODE%" goto versao

:manual
echo.
echo  Nao consegui instalar sozinho. Vou abrir o site do Node.js:
echo  baixe a versao LTS, instale clicando em Next ate o fim
echo  e depois de dois cliques de novo neste arquivo.
echo.
start "" https://nodejs.org/pt
pause
exit /b 1

:versao
"%NODE%" -e "process.exit(parseInt(process.versions.node) < 18 ? 1 : 0)"
if errorlevel 1 goto antigo
"%NODE%" server.js
echo.
echo  O painel foi desligado.
pause
exit /b 0

:antigo
echo.
echo  Seu Node.js e muito antigo. Instale a versao LTS no site que vai abrir
echo  e depois de dois cliques de novo neste arquivo.
echo.
start "" https://nodejs.org/pt
pause
exit /b 1
