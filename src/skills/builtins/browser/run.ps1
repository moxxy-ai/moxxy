$ErrorActionPreference = "Stop"

# Built-in Skill: browser - Interactive browser automation
# Actions: fetch, search (no bridge), navigate, snapshot, click, type, screenshot, scroll, evaluate, back, forward, tabs, close, wait

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridgePort = 18791
$bridgeUrl = "http://127.0.0.1:$bridgePort"
$pidFile = Join-Path $dir "bridge.pid"
$venvPython = if (Test-Path (Join-Path $dir "venv\Scripts\python.exe")) {
    Join-Path $dir "venv\Scripts\python.exe"
} elseif (Test-Path (Join-Path $dir "venv\bin\python3")) {
    Join-Path $dir "venv\bin\python3"
} else {
    $null
}

# Read action from args or stdin
$action = $null
$argsList = @()
if ($args.Count -gt 0) {
    $action = $args[0]
    $argsList = $args[1..($args.Length)]
} elseif ($env:MOXXY_ARGS_MODE -eq "stdin") {
    $inputJson = [System.Console]::In.ReadToEnd()
    if ($inputJson) {
        try {
            $arr = $inputJson | ConvertFrom-Json
            if ($arr -is [array] -and $arr.Count -gt 0) {
                $action = $arr[0]
                $argsList = @($arr[1..($arr.Length)])
            }
        } catch {}
    }
}

if (-not $action) {
    Write-Output "Usage: browser <action> [args...]"
    Write-Output "Actions: fetch, search, navigate, snapshot, click, type, screenshot, scroll, evaluate, back, forward, tabs, close, wait"
    exit 1
}

# --- fetch action: lightweight, no browser needed ---
if ($action -eq "fetch") {
    $url = $null
    if ($argsList.Count -gt 0) { $url = $argsList[0] }
    if (-not $url) {
        Write-Output "Error: fetch requires a URL argument"
        exit 1
    }
    $py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
    if (-not $py) {
        Write-Output "Error: Python is required for browser fetch"
        exit 1
    }
    & $py (Join-Path $dir "fetch.py") $url
    exit $LASTEXITCODE
}

# --- search action: web search via DuckDuckGo, no browser needed ---
if ($action -eq "search") {
    $query = $null
    if ($argsList.Count -gt 0) { $query = $argsList -join " " }
    if (-not $query) {
        Write-Output "Error: search requires a query argument"
        Write-Output "Usage: browser search <query>"
        exit 1
    }
    $py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
    if (-not $py) {
        Write-Output "Error: Python is required for browser search"
        exit 1
    }
    & $py (Join-Path $dir "fetch.py") "--search" $query
    exit $LASTEXITCODE
}

# --- All other actions: need the browser bridge ---

function Ensure-Venv {
    if (-not $script:venvPython -or -not (Test-Path $script:venvPython)) {
        $setupScript = Join-Path $dir "setup_browser.sh"
        if (Test-Path $setupScript) {
            Write-Warning "Setting up browser environment (first run)..."
            if (Get-Command bash -ErrorAction SilentlyContinue) {
                & bash $setupScript 2>&1 | Out-Null
            } else {
                # Fallback: setup without bash (Windows)
                $venvDir = Join-Path $dir "venv"
                $py = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { $null }
                if ($py) {
                    & $py -m venv $venvDir 2>&1 | Out-Null
                    $pip = Join-Path $venvDir "Scripts\pip.exe"
                    if (-not (Test-Path $pip)) { $pip = Join-Path $venvDir "bin\pip" }
                    if (Test-Path $pip) {
                        & $pip install --quiet playwright html2text 2>&1 | Out-Null
                        $playwright = Join-Path $venvDir "Scripts\playwright.exe"
                        if (-not (Test-Path $playwright)) { $playwright = Join-Path $venvDir "bin\playwright" }
                        if (Test-Path $playwright) { & $playwright install chromium 2>&1 | Out-Null }
                    }
                }
            }
        }
        $script:venvPython = if (Test-Path (Join-Path $dir "venv\Scripts\python.exe")) { Join-Path $dir "venv\Scripts\python.exe" } elseif (Test-Path (Join-Path $dir "venv\bin\python3")) { Join-Path $dir "venv\bin\python3" } else { $null }
        if (-not $script:venvPython) {
            Write-Output "Error: Browser venv not found and no setup script available"
            exit 1
        }
    }
}

function Start-Bridge {
    Ensure-Venv
    $bridgePy = Join-Path $dir "bridge.py"
    $proc = Start-Process -FilePath $script:venvPython -ArgumentList $bridgePy, "--port", $bridgePort, "--pid-file", $pidFile -WorkingDirectory $dir -PassThru -WindowStyle Hidden
    Set-Content -Path $pidFile -Value $proc.Id
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $r = Invoke-WebRequest -Uri "$bridgeUrl/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($r.StatusCode -eq 200) { return }
        } catch {}
    }
    Write-Output "Error: Browser bridge failed to start within 30 seconds"
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    exit 1
}

# Check if bridge is running
$bridgeUp = $false
try {
    $r = Invoke-WebRequest -Uri "$bridgeUrl/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $bridgeUp = ($r.StatusCode -eq 200)
} catch {}

if (-not $bridgeUp) {
    if (Test-Path $pidFile) {
        $oldPid = [int](Get-Content $pidFile -Raw)
        try {
            Get-Process -Id $oldPid -ErrorAction Stop | Out-Null
        } catch {
            Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Bridge
}

# Build JSON payload
$payload = @{ action = $action; args = @($argsList) } | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$bridgeUrl/action" -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 120
    if ($response.success) {
        if ($response.result) { Write-Output $response.result }
    } else {
        Write-Output "Error: $(if ($response.error) { $response.error } else { 'Unknown error' })"
        exit 1
    }
} catch {
    Write-Output "Error: Failed to communicate with browser bridge"
    Write-Output $_.Exception.Message
    exit 1
}
