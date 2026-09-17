$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $projectPath '一鍵開啟CNC模擬器.ps1'
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'CNC 雙程式路線模擬器.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'pwsh.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = $projectPath
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$shortcut.Description = '一鍵開啟 CNC 雙程式路線模擬器'
$shortcut.Save()
Write-Output $shortcutPath
