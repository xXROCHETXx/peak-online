param(
    [ValidateRange(1024, 65535)][int]$Puerto = 8778,
    [string]$Pagina = 'https://xXROCHETXx.github.io/peak-online/',
    [switch]$NoAbrir,
    [switch]$Comprobar
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DnsRefreshTimeout = 1000
$runtime = Join-Path $PSScriptRoot 'host-server/runtime/dotnet.exe'
$app = Join-Path $PSScriptRoot 'host-server/app/photon-server.dll'
$webRoot = Join-Path $PSScriptRoot 'www'
$toolsDir = Join-Path $PSScriptRoot 'tools'
$logsDir = Join-Path $PSScriptRoot 'logs'
$cloudflared = Join-Path $toolsDir 'cloudflared.exe'
$expectedHash = '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2'
$serverProcess = $null
$tunnelProcess = $null
$pageUrl = $null
if (![Uri]::TryCreate($Pagina, [UriKind]::Absolute, [ref]$pageUrl) -or $pageUrl.Scheme -ne 'https') {
    throw 'La pagina debe tener una direccion HTTPS valida.'
}
foreach ($required in @($runtime, $app, (Join-Path $webRoot 'host.html'))) {
    if (!(Test-Path -LiteralPath $required)) { throw "Falta $required. Extrae el ZIP completo antes de abrir el iniciador." }
}
New-Item -ItemType Directory -Path $toolsDir, $logsDir -Force | Out-Null
# Reserve a dedicated loopback port. Never attach a public tunnel to an unrelated server.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Puerto)
try { $probe.Start() } catch { throw "El puerto $Puerto ya esta en uso. Cierra el otro iniciador o elige otro puerto." }
finally { $probe.Stop() }
if (!(Test-Path -LiteralPath $cloudflared)) {
    Write-Host 'Descargando el conector HTTPS oficial de Cloudflare (solo la primera vez)...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $temporary = Join-Path $toolsDir 'cloudflared.download'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.3/cloudflared-windows-amd64.exe' -OutFile $temporary
    if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
        throw 'La descarga no coincide con la firma SHA256 publicada. No se ejecutara.'
    }
    Move-Item -LiteralPath $temporary -Destination $cloudflared -Force
}
if ((Get-FileHash -LiteralPath $cloudflared -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'El conector HTTPS no coincide con la version verificada de este iniciador.'
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverLog = Join-Path $logsDir "$stamp-server.log"
$serverErrors = Join-Path $logsDir "$stamp-server-errors.log"
$tunnelLog = Join-Path $logsDir "$stamp-tunnel.log"
$tunnelErrors = Join-Path $logsDir "$stamp-tunnel-errors.log"
try {
    Write-Host 'Iniciando el servidor de tu grupo...'
    $arguments = '"' + $app + '" --root "' + $webRoot + '" --listen http://127.0.0.1:' + $Puerto
    $serverProcess = Start-Process -FilePath $runtime -ArgumentList $arguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrors
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        if ($serverProcess.HasExited) { throw "No pudo arrancar el servidor. Revisa $serverErrors" }
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Puerto/api/status" -TimeoutSec 2
            if ($status.mode -eq 'self-hosted' -and $status.cloud -eq $false) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    if (!$ready) { throw 'El servidor local no responde.' }
    Write-Host 'Creando tu enlace temporal HTTPS...'
    # Configuration is explicit so an existing Cloudflare account/config is not reused.
    $emptyConfig = Join-Path $toolsDir 'quick-tunnel.yml'
    Set-Content -LiteralPath $emptyConfig -Value '{}'
    $tunnelArguments = 'tunnel --config "' + $emptyConfig + '" --no-autoupdate --protocol http2 --url http://127.0.0.1:' + $Puerto
    $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList $tunnelArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrors
    $publicOrigin = $null
    for ($i = 0; $i -lt 120; $i++) {
        if ($tunnelProcess.HasExited) { throw "No pudo abrirse el tunel. Revisa $tunnelErrors" }
        $logText = (Get-Content -LiteralPath $tunnelLog, $tunnelErrors -Raw -ErrorAction SilentlyContinue) -join "`n"
        $match = [regex]::Match($logText, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success) { $publicOrigin = $match.Value; break }
        Start-Sleep -Milliseconds 500
    }
    if (!$publicOrigin) { throw 'No se pudo obtener una direccion publica. Revisa tu conexion e intenta de nuevo.' }
    Write-Host "Esperando a que responda tu direccion HTTPS: $publicOrigin"
    # A hostname can be printed before the connector is ready. Wait for public HTTPS.
    $publicReady = $false
    $lastPublicError = ''
    for ($i = 0; $i -lt 60; $i++) {
        if ($tunnelProcess.HasExited -or $serverProcess.HasExited) { throw 'Se interrumpio el inicio de la partida.' }
        try {
            $status = Invoke-RestMethod -Uri "$publicOrigin/api/status" -TimeoutSec 3
            if ($status.mode -eq 'self-hosted') { $publicReady = $true; break }
        } catch { $lastPublicError = $_.Exception.Message }
        Start-Sleep -Seconds 3
    }
    if (!$publicReady) { throw "El enlace publico no responde todavia. $lastPublicError" }
    if ($Comprobar) {
        # One-shot connectivity check; does not leave a public server running.
        $socket = [System.Net.WebSockets.ClientWebSocket]::new()
        $timeout = [System.Threading.CancellationTokenSource]::new(15000)
        try {
            $socket.Options.AddSubProtocol('GpBinaryV18')
            $socket.Options.SetRequestHeader('Origin', $publicOrigin)
            $socketUrl = [Uri]($publicOrigin.Replace('https://', 'wss://') + '/relay/master')
            $socket.ConnectAsync($socketUrl, $timeout.Token).GetAwaiter().GetResult()
            $bytes = New-Object byte[] 16
            $segment = [ArraySegment[byte]]::new($bytes)
            $received = $socket.ReceiveAsync($segment, $timeout.Token).GetAwaiter().GetResult()
            if ($received.Count -ne 3 -or $bytes[0] -ne 243) { throw 'Respuesta inesperada del servidor de juego.' }
            Write-Host "HTTPS y WSS: OK ($publicOrigin)"
        }
        finally { $socket.Dispose(); $timeout.Dispose() }
        return
    }
    $pageReady = $false
    try {
        $pageStatus = Invoke-WebRequest -UseBasicParsing -Uri $Pagina -Method Head -TimeoutSec 5
        $pageReady = $pageStatus.StatusCode -eq 200
    } catch { }
    if ($pageReady) {
        $link = $Pagina.Split('#')[0] + '#server=' + [Uri]::EscapeDataString($publicOrigin)
    } else {
        $link = $publicOrigin + '/host.html'
        Write-Host 'La pagina principal no responde. Abriendo tu enlace de partida.'
    }
    Set-Content -LiteralPath (Join-Path $PSScriptRoot 'Mi enlace.txt') -Value $link
    Write-Host ''
    Write-Host 'TU PARTIDA ESTA LISTA' -ForegroundColor Green
    Write-Host $link
    Write-Host ''
    Write-Host '1. Abre el enlace. Si aparece la pagina de entrada, pulsa Abrir PEAK.'
    Write-Host '2. Cuando cargue el menu, pulsa Host Game / Crear partida.'
    Write-Host '3. Pulsa Copiar enlace dentro de PEAK y envialo a tus amigos.'
    Write-Host 'Solo tu grupo usa este servidor. Manten esta ventana abierta.'
    Write-Host 'Pulsa Q para cerrar la partida y el tunel.'
    if (!$NoAbrir) { Start-Process $link }
    while (!$serverProcess.HasExited -and !$tunnelProcess.HasExited) {
        if (![Console]::IsInputRedirected -and [Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq 'Q') { break }
        Start-Sleep -Milliseconds 300
    }
    if ($serverProcess.HasExited -or $tunnelProcess.HasExited) { throw 'La conexion se interrumpio. Revisa los archivos de logs.' }
}
finally {
    # Only stop processes created by this invocation, never other hosts or a user's tunnel.
    if ($tunnelProcess -and !$tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -ErrorAction SilentlyContinue }
    if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue }
    Write-Host 'Tu servidor y su enlace temporal se han cerrado.'
}
