# Cria um atalho "Painel de Atualizacao" na Area de Trabalho, apontando para o
# launcher painel-atualizacao.cmd, com o icone do app. Rode UMA vez:
#   powershell -ExecutionPolicy Bypass -File tools\criar-atalho-painel.ps1
# Depois e so clicar no icone da Area de Trabalho para abrir o painel.

$ErrorActionPreference = 'Stop'
$toolsDir = $PSScriptRoot
$cmd  = Join-Path $toolsDir 'painel-atualizacao.cmd'
$icon = Join-Path $toolsDir 'painel.ico'
$root = Split-Path -Parent $toolsDir

if (-not (Test-Path $cmd)) { throw "Nao encontrei o launcher: $cmd" }

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Painel de Atualizacao.lnk'

$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath       = $cmd
$lnk.WorkingDirectory = $root
$lnk.Description       = 'Abre o Painel de Atualizacao do BI de Credito Privado'
$lnk.WindowStyle      = 1
if (Test-Path $icon) { $lnk.IconLocation = "$icon,0" }
$lnk.Save()

Write-Host ""
Write-Host "Atalho criado na Area de Trabalho:" -ForegroundColor Green
Write-Host "  $lnkPath"
Write-Host ""
Write-Host "Clique nele para subir o servidor e abrir o painel automaticamente." -ForegroundColor Cyan
Write-Host "Dica: voce pode arrastar esse atalho para a barra de tarefas ou para o Menu Iniciar."
