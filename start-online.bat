@echo off
chcp 65001 >nul
title Zubcy online
cd /d "%~dp0"

rem ============================================================
rem  Зубцы — игра в интернете через туннель Tuna (tuna.am).
rem  Игра работает на этом компьютере, а Tuna даёт ей постоянную
rem  ссылку, по которой друзья заходят откуда угодно.
rem ============================================================

where node >nul 2>nul
if errorlevel 1 goto nonode
where tuna >nul 2>nul
if errorlevel 1 goto notuna

rem --- постоянный адрес Tuna: спрашиваем один раз и запоминаем в tuna-address.txt ---
set "ADDR="
if exist tuna-address.txt set /p ADDR=<tuna-address.txt
if defined ADDR goto haveaddr
echo.
echo  Откройте личный кабинет Tuna: https://my.tuna.am
echo  и найдите там свой постоянный поддомен,
echo  например: brave-otter-4821.ru.tuna.am
echo.
set /p ADDR=Вставьте его сюда и нажмите Enter:
if not defined ADDR goto end

:haveaddr
set "ADDR=%ADDR: =%"
set "ADDR=%ADDR:https://=%"
set "ADDR=%ADDR:http://=%"
if "%ADDR:~-1%"=="/" set "ADDR=%ADDR:~0,-1%"
echo %ADDR%| find "." >nul
if errorlevel 1 set "ADDR=%ADDR%.ru.tuna.am"
for /f "tokens=1 delims=." %%a in ("%ADDR%") do set "SUB=%%a"
> tuna-address.txt echo %ADDR%

rem --- вход в Tuna (нужен только в первый раз) ---
tuna whoami >nul 2>nul
if errorlevel 1 tuna login

echo.
echo  ============================================================
echo   Запускаем игру и туннель...
echo   Ссылка для друзей:  https://%ADDR%
echo   Компьютер не должен засыпать, а это окно — закрываться.
echo  ============================================================
echo.
start "" /b node server.js --open --public=https://%ADDR%
tuna http 3000 --subdomain=%SUB%
echo.
echo  Туннель остановлен.
echo  Если он не запустился из-за адреса — удалите файл tuna-address.txt
echo  и запустите start-online.bat ещё раз: адрес спросят заново.
goto end

:nonode
echo.
echo  Не найден Node.js - бесплатная программа, которая запускает игру.
echo  1. Откройте сайт https://nodejs.org и скачайте версию LTS.
echo  2. Установите её: везде нажимайте "Далее".
echo  3. Запустите этот файл ещё раз.
goto end

:notuna
echo.
echo  Не найдена программа Tuna - она выводит игру в интернет.
echo  Сначала зарегистрируйтесь на сайте https://my.tuna.am
echo.
set "ANS="
set /p ANS=Чтобы установить Tuna сейчас, напишите 1 и нажмите Enter:
if not "%ANS%"=="1" goto end
winget install --id yuccastream.tuna -e --accept-package-agreements --accept-source-agreements
echo.
echo  Если установка прошла успешно - закройте это окно
echo  и запустите start-online.bat ещё раз.
echo  Если не получилось - скачайте установщик вручную:
echo  https://releases.tuna.am/tuna/latest/tuna_x64.msi
goto end

:end
echo.
pause
