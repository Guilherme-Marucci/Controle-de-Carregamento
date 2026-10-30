@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Carga3D - Inicializador Automatico

echo ============================================================================
echo   CARGA3D - SISTEMA DE GESTAO DE CARREGAMENTO E VISUALIZACAO 3D
echo ============================================================================
echo.

:: Posiciona no diretorio onde o .bat esta localizado
cd /d "%~dp0"

if not exist "package.json" (
    echo [ERRO] Arquivo package.json nao encontrado em: "%CD%"
    pause
    exit /b 1
)

:: 1. Verifica se o Node.js esta instalado
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERRO] Node.js nao encontrado no PATH do Windows.
    echo Instale o Node.js 22+ em https://nodejs.org/ e tente novamente.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js detectado: %NODE_VER%

:: 2. Garante que o arquivo .env local exista a partir do .env-example
if not exist ".env" (
    if exist ".env-example" (
        echo [INFO] Criando arquivo .env a partir de .env-example...
        copy /y ".env-example" ".env" >nul
    )
)

:: 3. Verifica e instala dependencias se node_modules nao existir
if not exist "node_modules" (
    echo.
    echo [INFO] Dependencias nao encontradas. Executando instalacao inicial...
    call npm.cmd install
    if !ERRORLEVEL! neq 0 (
        echo [ERRO] Falha ao instalar dependencias via npm.cmd install.
        pause
        exit /b 1
    )
)

:: 4. Inicializa/atualiza o banco de dados local D1 (.wrangler/state)
echo.
echo [INFO] Preparando banco de dados local D1...
node scripts/init-local-db.mjs
if %ERRORLEVEL% neq 0 (
    echo [AVISO] Nao foi possivel executar init-local-db isoladamente. O servidor tentara novamente.
)

:: 5. Agenda abertura automatica do navegador apos 4 segundos em background
echo.
echo [INFO] Iniciando servidor em http://127.0.0.1:5173/ ...
echo [DICA] Pressione CTRL+C a qualquer momento para encerrar o servidor.
echo ============================================================================
echo.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://127.0.0.1:5173/"

:: 6. Inicia o servidor local (node scripts/run-framework.mjs dev)
node scripts/run-framework.mjs dev

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERRO] O servidor encerrou com codigo de erro %ERRORLEVEL%.
    pause
)

endlocal

