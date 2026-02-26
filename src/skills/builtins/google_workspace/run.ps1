$ErrorActionPreference = "Stop"

# Built-in Skill: google_workspace - Python-based Google APIs wrapper
# Uses venv; on Windows venv uses Scripts\python.exe

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $dir "google_workspace.py"
$venv = Join-Path $dir "venv"

function Ensure-Venv {
    if (-not (Test-Path $venvPython)) {
        Write-Warning "Setting up Google Workspace skill environment (first run)..."
        $py = $null
        if (Get-Command python -ErrorAction SilentlyContinue) { $py = "python" }
        elseif (Get-Command python3 -ErrorAction SilentlyContinue) { $py = "python3" }
        elseif (Get-Command py -ErrorAction SilentlyContinue) { $py = "py" }
        if (-not $py) {
            Write-Output "Error: Python is required. Install Python 3 from https://www.python.org/"
            exit 1
        }
        & $py -m venv $venv
        $pip = if (Test-Path (Join-Path $venv "Scripts\pip.exe")) {
            Join-Path $venv "Scripts\pip.exe"
        } else {
            Join-Path $venv "bin\pip"
        }
        & $pip install --quiet --upgrade pip 2>&1 | Out-Null
        & $pip install --quiet google-auth google-auth-oauthlib google-api-python-client 2>&1 | Out-Null
    }
}

if (-not $env:GOOGLE_CLIENT_ID -or -not $env:GOOGLE_CLIENT_SECRET -or -not $env:GOOGLE_REFRESH_TOKEN) {
    Write-Output "Error: Missing Google OAuth credentials in vault."
    Write-Output ""
    Write-Output "Required vault keys:"
    Write-Output "  - GOOGLE_CLIENT_ID"
    Write-Output "  - GOOGLE_CLIENT_SECRET"
    Write-Output "  - GOOGLE_REFRESH_TOKEN"
    Write-Output ""
    Write-Output "Setup instructions:"
    Write-Output "  1. Go to https://console.cloud.google.com/apis/credentials"
    Write-Output "  2. Create an OAuth 2.0 Client ID (Desktop application)"
    Write-Output "  3. Note your Client ID and Client Secret"
    Write-Output "  4. Run the setup script to obtain a refresh token:"
    Write-Output "     python $dir\setup_oauth.py --client-id YOUR_ID --client-secret YOUR_SECRET"
    Write-Output "  5. Store the credentials in your vault:"
    Write-Output '     <invoke name="manage_vault">["set", "GOOGLE_CLIENT_ID", "your_client_id"]</invoke>'
    Write-Output '     <invoke name="manage_vault">["set", "GOOGLE_CLIENT_SECRET", "your_client_secret"]</invoke>'
    Write-Output '     <invoke name="manage_vault">["set", "GOOGLE_REFRESH_TOKEN", "your_refresh_token"]</invoke>'
    Write-Output ""
    Write-Output "Required API scopes (enable in Google Cloud Console):"
    Write-Output "  - Gmail API"
    Write-Output "  - Google Drive API"
    Write-Output "  - Google Calendar API"
    Write-Output "  - Google Chat API"
    Write-Output "  - Google Docs API"
    Write-Output "  - Google Sheets API"
    exit 1
}

Ensure-Venv 2>&1 | Out-Null

# Resolve python path after venv is ensured
$venvPython = if (Test-Path (Join-Path $venv "Scripts\python.exe")) {
    Join-Path $venv "Scripts\python.exe"
} elseif (Test-Path (Join-Path $venv "bin\python3")) {
    Join-Path $venv "bin\python3"
} else {
    Join-Path $venv "Scripts\python.exe"  # fallback for Windows
}

if ($args.Count -eq 0) {
    & $venvPython $script
    exit $LASTEXITCODE
}

$service = $args[0]
$restArgs = $args[1..($args.Length)]

if (-not $service) {
    & $venvPython $script
    exit $LASTEXITCODE
}

# Handle stdin mode for large payloads
if ($env:MOXXY_ARGS_MODE -eq "stdin" -and $restArgs.Count -eq 0) {
    $inputJson = [System.Console]::In.ReadToEnd()
    if ($inputJson) {
        try {
            $arr = $inputJson | ConvertFrom-Json
            if ($arr -is [array]) {
                $service = $arr[0]
                $restArgs = $arr[1..($arr.Length)]
            } elseif ($arr) {
                $service = $arr
                $restArgs = @()
            }
        } catch {}
    }
    if ($service) {
        & $venvPython $script $service @restArgs
        exit $LASTEXITCODE
    }
}

& $venvPython $script $service @restArgs
exit $LASTEXITCODE
