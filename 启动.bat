@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo 需要先安装 Node.js 18+：https://nodejs.org & pause & exit /b)
where pnpm >nul 2>nul && (set PM=pnpm) || (set PM=npm)
if not exist node_modules call %PM% install
start "" http://localhost:5188
call %PM% run dev
