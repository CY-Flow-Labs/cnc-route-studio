$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$baseUrl = 'http://127.0.0.1:4173/'
$port = 4173

$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    foreach ($listener in $listening) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)"
        if ($process.CommandLine -match 'vite(.|\s)*preview' -and $process.CommandLine -match '4173') {
            Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 500
}

$npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
Start-Process -FilePath $npmPath `
    -ArgumentList @('run', 'preview', '--', '--host', '127.0.0.1', '--port', "$port") `
    -WorkingDirectory $projectPath `
    -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $response = Invoke-WebRequest -Uri $baseUrl -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if (-not $ready) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show('CNC 模擬器啟動失敗，請確認 Node.js 與專案套件已安裝。', 'CNC 模擬器') | Out-Null
    exit 1
}

$cacheBuster = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
Start-Process "$baseUrl`?fresh=$cacheBuster"
