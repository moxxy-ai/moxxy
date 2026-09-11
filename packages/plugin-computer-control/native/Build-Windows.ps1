param([string]$BuildDirectory = (Join-Path $PSScriptRoot 'build'))
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path $PSScriptRoot
cmake -S $PSScriptRoot -B $BuildDirectory -A x64
if ($LASTEXITCODE -ne 0) { throw 'Native configure failed' }
cmake --build $BuildDirectory --config Release
if ($LASTEXITCODE -ne 0) { throw 'Native build failed' }
ctest --test-dir $BuildDirectory -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'Native tests failed' }
cmake --install $BuildDirectory --config Release --prefix $packageRoot
if ($LASTEXITCODE -ne 0) { throw 'Native staging failed' }
$executable = Join-Path $packageRoot 'bin/win32-x64/moxxy-computer.exe'
$manifest = @{ protocolVersion=2; architecture='x64'; sha256=(Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant() }
$json = $manifest | ConvertTo-Json -Compress
[IO.File]::WriteAllText(($executable+'.json'), $json, [Text.UTF8Encoding]::new($false))
