$ErrorActionPreference = "Stop"

if ($args.Count -lt 1) {
    Write-Output "Usage: host_python '<Python Code>'"
    exit 1
}

$code = $args[0]
$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }

if ($env:MOXXY_INTERNAL_TOKEN) {
    $headers = @{
        "Content-Type" = "application/json"
        "X-Moxxy-Internal-Token" = $env:MOXXY_INTERNAL_TOKEN
    }
    $body = @{ code = $code } | ConvertTo-Json
    try {
        $resp = Invoke-RestMethod -Uri "$apiBase/host/execute_python" -Method Post -Body $body -Headers $headers
        if ($resp.success) {
            Write-Output $resp.output
            exit 0
        }
    } catch { }
}

# Fallback to local python
$python = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } else { "python3" }
& $python -c $code
