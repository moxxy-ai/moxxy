$ErrorActionPreference = "Stop"

# Read command from CLI arg or stdin (for large payloads exceeding OS limits)
$cmd = $null
if ($args.Count -ge 1) {
    $cmd = $args[0]
} elseif ($env:MOXXY_ARGS_MODE -eq "stdin") {
    $rawInput = $input | Out-String
    $arr = $rawInput | ConvertFrom-Json
    if ($arr -is [array] -and $arr.Count -gt 0) {
        $cmd = $arr[0]
    }
}

if (-not $cmd) {
    Write-Output "Usage: host_shell '<Bash Code>'"
    exit 1
}

$apiBase = if ($env:MOXXY_API_BASE) { $env:MOXXY_API_BASE } else { "http://127.0.0.1:17890/api" }
$headers = @{
    "Content-Type" = "application/json"
    "X-Moxxy-Internal-Token" = $env:MOXXY_INTERNAL_TOKEN
}

$body = @{ command = $cmd }
if ($env:AGENT_WORKSPACE) {
    $body.cwd = $env:AGENT_WORKSPACE
}
$bodyJson = $body | ConvertTo-Json

try {
    $resp = Invoke-RestMethod -Uri "$apiBase/host/execute_bash" -Method Post -Body $bodyJson -Headers $headers
    if ($resp.success) {
        Write-Output $resp.output
    } else {
        Write-Output "Error: $($resp.error ?? 'command failed')"
        if ($resp.output) { Write-Output $resp.output }
        exit 1
    }
} catch {
    Write-Output "Error: $($_.Exception.Message)"
    exit 1
}
