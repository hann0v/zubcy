@echo off
chcp 65001 >nul
title Zubcy
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Не найден Node.js - бесплатная программа, которая запускает игру.
  echo  1. Откройте сайт https://nodejs.org и скачайте версию LTS.
  echo  2. Установите её: везде нажимайте "Далее".
  echo  3. Запустите этот файл ещё раз.
  echo.
  pause
  exit /b
)
node server.js --open
pause
