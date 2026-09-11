param(
  [string]$HelperPath = (Join-Path $PSScriptRoot 'moxxy-computer.exe'),
  [string]$FixturePath = (Join-Path $PSScriptRoot 'moxxy-computer-fixture.exe'),
  [string]$ReportDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('moxxy-computer-tests-' + [guid]::NewGuid())),
  [switch]$NonInteractive
)
$ErrorActionPreference = 'Stop'
if (-not $NonInteractive) {
  Write-Host 'Test controls ONLY its own windows. Do not use the mouse or keyboard during the test.'
  Write-Host 'Use Stop Computer Use to stop. No data is uploaded.'
  if ((Read-Host 'Type START to continue') -cne 'START') { return }
}
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$results = [Collections.Generic.List[object]]::new()
$peers = [Collections.Generic.List[Diagnostics.Process]]::new()
$fixtures = [Collections.Generic.List[Diagnostics.Process]]::new()
function Record($name, $status, $detail = '') {
  $results.Add([pscustomobject]@{ name=$name; status=$status; detail=$detail })
  Write-Host "$status : $name $detail"
}
function Start-Peer {
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = (Resolve-Path -LiteralPath $HelperPath).Path
  $info.Arguments = "--parent $PID"
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $info.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
  $peer = [Diagnostics.Process]::new(); $peer.StartInfo = $info
  if (-not $peer.Start()) { throw 'Helper did not start' }
  $peers.Add($peer)
  return $peer
}
function Request($peer, $method, $parameters, $version = 1) {
  $id = [guid]::NewGuid().ToString()
  $frame = @{ version=$version; id=$id; method=$method; params=$parameters } | ConvertTo-Json -Depth 20 -Compress
  $peer.StandardInput.WriteLine($frame); $peer.StandardInput.Flush()
  $read = $peer.StandardOutput.ReadLineAsync()
  if (-not $read.Wait(15000)) { throw 'Helper response timeout (operation not retried)' }
  if (-not $read.Result) { throw "Helper exited before response ($($peer.ExitCode))" }
  $response = $read.Result | ConvertFrom-Json
  if ($response.id -ne $id -or $response.version -ne 1) { throw 'Invalid protocol response' }
  return $response
}
function Call($method, $parameters) {
  $response = Request $script:helper $method $parameters
  if (-not $response.ok) { throw "$($response.error.code): $($response.error.message)" }
  return $response.result
}
function Check($condition, $message) { if (-not $condition) { throw $message } }
function Observe { return Call 'observe' @{ windowId=$script:windowId; maxNodes=128 } }
function Screenshot {
  return Call 'screenshot' @{ windowId=$script:windowId; maxDim=1280; format='png'; quality=72; allowVisibleFallback=$false }
}
function Canvas-Point($capture, $xOffset = 60, $yOffset = 60) {
  $observation=Observe
  $canvas=@($observation.elements | Where-Object { $_.name -eq 'Canvas' })[0]
  Check ($null -ne $canvas) 'Canvas not found in fixture'
  return @{ x=[math]::Floor(($canvas.bounds.x+$xOffset-$capture.source.x)*$capture.width/$capture.source.width);
    y=[math]::Floor(($canvas.bounds.y+$yOffset-$capture.source.y)*$capture.height/$capture.source.height) }
}
function Fixture-State {
  # Wait for real window messages to be processed, not for a model declaration.
  Start-Sleep -Milliseconds 200
  return Get-Content -LiteralPath $script:statePath -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Test($name, [scriptblock]$work) {
  try { & $work; Record $name 'passed' } catch { Record $name 'failed' $_.Exception.Message }
}
$exitCode = 1
try {
  $script:helper = Start-Peer
  $status = Call 'status' @{}
  Check ($status.protocolVersion -eq 1 -and $status.architecture -eq 'x64') 'Wrong helper architecture/protocol'
  Test 'protocol rejects wrong version' {
    $response = Request $script:helper 'status' @{} 2
    Check (-not $response.ok) 'Wrong version was accepted'
  }
  Test 'protocol rejects unknown parameters' {
    $response = Request $script:helper 'status' @{ unexpected=$true }
    Check (-not $response.ok) 'Unknown parameter was accepted'
  }
  if (-not $status.ready) {
    Record 'interactive desktop preflight' 'not-tested' 'Windows has no unlocked interactive desktop.'
    $exitCode = 2
  } else {
    $script:statePath = Join-Path $ReportDirectory 'fixture-state.json'
    $fixture = Start-Process -FilePath $FixturePath -ArgumentList ('"' + $script:statePath + '"') -PassThru
    $fixtures.Add($fixture)
    Check ($fixture.WaitForInputIdle(10000)) 'Fixture did not become responsive'
    $windows = Call 'windows' @{}
    $window = @($windows | Where-Object { $_.pid -eq $fixture.Id })
    Check ($window.Count -eq 1) 'Fixture window identity is ambiguous or absent'
    $script:windowId = $window[0].windowId
    Call 'focus' @{ windowId=$script:windowId } | Out-Null
    $observation = Observe
    Check ($observation.elements.Count -gt 2) 'UI Automation is unavailable'
    $image = Screenshot
    Add-Type -AssemblyName System.Drawing
    $stream = [IO.MemoryStream]::new([Convert]::FromBase64String($image.base64))
    $bitmap = [Drawing.Bitmap]::new($stream)
    try {
      $markers = 0
      for ($x=0; $x -lt $bitmap.Width; $x+=10) {
        for ($y=0; $y -lt $bitmap.Height; $y+=10) {
          $pixel=$bitmap.GetPixel($x,$y)
          if ($pixel.R -gt 240 -and $pixel.G -lt 20 -and $pixel.B -gt 240) { $markers++ }
        }
      }
      Check ($markers -gt 100) 'Capture did not contain fixture pixel markers'
    } finally { $bitmap.Dispose(); $stream.Dispose() }
    Record 'interactive desktop / UIA / image marker preflight' 'passed'
    Test 'window-local crop retains source geometry' {
      $full=Screenshot
      $crop=Call 'screenshot' @{ windowId=$script:windowId; maxDim=1280; format='png'; quality=72; allowVisibleFallback=$false; region=@{x=20;y=30;width=200;height=100} }
      Check ($crop.width -eq 200 -and $crop.height -eq 100 -and $crop.source.x -eq $full.source.x+20 -and $crop.source.y -eq $full.source.y+30) 'Crop source mapping differs'
    }
    Test 'UIA set value preserves Polish and Unicode' {
      $observation = Observe
      $field = @($observation.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $text = 'Za' + [char]0x17C + [char]0xF3 + [char]0x142 + [char]0x107 + ' g' + [char]0x119 + [char]0x15B + 'l' + [char]0x105 + ' ja' + [char]0x17A + [char]0x144 + [char]0x0A + [char]::ConvertFromUtf32(0x1F600)
      Call 'set_value' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$field.elementId; text=$text } | Out-Null
      $actual=(Fixture-State).text.Replace("`r",'')
      Check ($actual -ceq $text) ("UIA text differs: actual="+($actual|ConvertTo-Json -Compress)+" expected="+($text|ConvertTo-Json -Compress))
    }
    Test 'protected control has no value/name disclosure' {
      $observation=Observe
      $secret=@($observation.elements | Where-Object { $_.protected })[0]
      Check ($null -ne $secret -and $secret.name -eq '') 'Password leaked through accessibility'
      $response=Request $script:helper 'set_value' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$secret.elementId; text='not allowed' }
      Check (-not $response.ok) 'Protected field mutation accepted'
    }
    Test 'observed element click reaches button; stale reference rejected' {
      $observation=Observe
      $button=@($observation.elements | Where-Object { $_.name -eq 'Save' })[0]
      $input=@{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 }
      Call 'click' $input | Out-Null
      Check ((Fixture-State).saves -eq 1) 'Button did not receive click'
      Check (-not (Request $script:helper 'click' $input).ok) 'Stale element accepted'
    }
    Test 'SendInput typing and Ctrl+A affect the named focused control' {
      $observation=Observe
      $field=@($observation.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$field.elementId; button='left'; count=1 } | Out-Null
      $observation=Observe
      Call 'key' @{ windowId=$script:windowId; observationId=$observation.observationId; key='a'; modifiers=@('control') } | Out-Null
      $observation=Observe
      $field=@($observation.elements | Where-Object { $_.elementId -eq $observation.focusedElementId })[0]
      $typed='Moxxy '+[char]0x17C+[char]0xF3+[char]0x142+[char]0x107+"`n"+[char]::ConvertFromUtf32(0x1F600)
      Call 'type' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$field.elementId; text=$typed } | Out-Null
      $actual=(Fixture-State).text.Replace("`r",'')
      Check ($actual -ceq $typed) ("SendInput text differs: actual="+($actual|ConvertTo-Json -Compress)+" expected="+($typed|ConvertTo-Json -Compress))
    }
    Test 'mouse buttons reach the real canvas' {
      foreach ($button in @('left','right','middle')) {
        $before=(Fixture-State).$button
        $capture=Screenshot; $point=Canvas-Point $capture
        Call 'click' @{ windowId=$script:windowId; captureId=$capture.captureId; x=$point.x; y=$point.y; button=$button; count=1 } | Out-Null
        Check ((Fixture-State).$button -eq $before+1) "$button click missing"
      }
    }
    Test 'double click reaches the real canvas' {
      Start-Sleep -Milliseconds 600
      $before=(Fixture-State).doubleClicks
      $capture=Screenshot; $point=Canvas-Point $capture
      Call 'click' @{ windowId=$script:windowId; captureId=$capture.captureId; x=$point.x; y=$point.y; button='left'; count=2 } | Out-Null
      Check ((Fixture-State).doubleClicks -eq $before+1) 'Double click missing'
    }
    Test 'both scroll axes reach the real canvas' {
      $before=Fixture-State
      $capture=Screenshot; $point=Canvas-Point $capture
      Call 'scroll' @{ windowId=$script:windowId; captureId=$capture.captureId; x=$point.x; y=$point.y; deltaX=120; deltaY=-120 } | Out-Null
      $after=Fixture-State
      Check ($after.scrollX -eq $before.scrollX+120 -and $after.scrollY -eq $before.scrollY-120) 'Scroll messages missing'
    }
    Test 'drag reaches canvas and old capture is rejected' {
      Start-Sleep -Milliseconds 600
      $before=(Fixture-State).drags
      $capture=Screenshot; $from=Canvas-Point $capture 60 60; $to=Canvas-Point $capture 180 90
      $input=@{ windowId=$script:windowId; captureId=$capture.captureId; from=$from; to=$to; durationMs=400 }
      Call 'drag' $input | Out-Null
      Check ((Fixture-State).drags -eq $before+1) 'Drag did not reach target'
      Check (-not (Request $script:helper 'drag' $input).ok) 'Stale capture accepted'
    }
    Test 'desktop lease prevents concurrent control' {
      $other=Start-Peer
      $inventory=(Request $other 'windows' @{}).result
      $target=@($inventory | Where-Object { $_.pid -eq $fixture.Id })[0]
      $response=Request $other 'focus' @{ windowId=$target.windowId }
      Check (-not $response.ok -and $response.error.code -eq 'control-busy') 'Concurrent desktop control accepted'
      $other.StandardInput.Close(); Check ($other.WaitForExit(3000)) 'Second helper leaked'
    }
    Test 'modal can be observed and closed without blocking the helper' {
      $observation=Observe
      $button=@($observation.elements | Where-Object { $_.name -eq 'Open modal' })[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 } | Out-Null
      Start-Sleep -Milliseconds 250
      $inventory=Call 'windows' @{}
      $modal=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy test modal' })[0]
      $parent=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0]
      Check ($null -ne $modal -and $null -ne $parent) 'Modal/parent identity unavailable'
      $script:windowId=$modal.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
      $observation=Observe
      $ok=@($observation.elements | Where-Object { $_.name -eq 'OK' -and $_.controlType -eq 50000 })[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$ok.elementId; button='left'; count=1 } | Out-Null
      Start-Sleep -Milliseconds 200
      $script:windowId=$parent.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
      Check ((Observe).elements.Count -gt 2) 'Parent not usable after modal'
    }
    Test 'delayed control appears in fresh observations' {
      $until=[DateTime]::UtcNow.AddSeconds(3)
      do {
        $found=@((Observe).elements | Where-Object name -eq 'Delayed button')
        if ($found.Count) { break }
        Start-Sleep -Milliseconds 100
      } while ([DateTime]::UtcNow -lt $until)
      Check ($found.Count -eq 1) 'Delayed control absent'
    }
    Test 'cancellation during drag releases input and desktop lease' {
      Start-Sleep -Milliseconds 600
      $capture=Screenshot; $from=Canvas-Point $capture 60 60; $to=Canvas-Point $capture 200 90
      $frame=@{ version=1; id=[guid]::NewGuid().ToString(); method='drag'; params=@{ windowId=$script:windowId; captureId=$capture.captureId; from=$from; to=$to; durationMs=2000 } } | ConvertTo-Json -Depth 20 -Compress
      $script:helper.StandardInput.WriteLine($frame); $script:helper.StandardInput.Flush()
      Start-Sleep -Milliseconds 150
      $script:helper.StandardInput.Close()
      Check ($script:helper.WaitForExit(3000)) 'Cancelled helper did not exit'
      Check (-not (Fixture-State).leftDown) 'Mouse button remained held after cancellation'
      $script:helper=Start-Peer
      $inventory=Call 'windows' @{}
      $target=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0]
      $script:windowId=$target.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
      Check ((Observe).elements.Count -gt 2) 'Desktop lease not released on cancellation'
    }
    # Do not overwrite non-text clipboard formats on a user's workstation.
    Record 'clipboard round trip' 'not-tested' 'Requires an explicitly disposable clipboard; test does not overwrite user clipboard.'
    $exitCode=0
  }
} catch { Record 'test infrastructure/preflight' 'failed' $_.Exception.Message }
finally {
  foreach ($peer in $peers) {
    try { if (-not $peer.HasExited) { $peer.StandardInput.Close(); if (-not $peer.WaitForExit(3000)) { $peer.Kill(); $peer.WaitForExit() } } } catch {}
    $peer.Dispose()
  }
  foreach ($fixture in $fixtures) {
    try { if (-not $fixture.HasExited) { $fixture.CloseMainWindow() | Out-Null; if (-not $fixture.WaitForExit(3000)) { $fixture.Kill() } } } catch {}
    $fixture.Dispose()
  }
  foreach ($name in @('Windows 10/11 agent benchmark 12x3','mixed monitor DPI','focus theft','window recreation')) {
    Record $name 'not-tested' 'Required acceptance coverage not yet executed by this test runner.'
  }
  $report=@{ schemaVersion=1; os=[Environment]::OSVersion.VersionString; architecture=$env:PROCESSOR_ARCHITECTURE;
    helperSha256=(Get-FileHash -LiteralPath $HelperPath -Algorithm SHA256).Hash; tests=$results.ToArray(); releaseAccepted=$false }
  $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $ReportDirectory 'report.json') -Encoding UTF8
  $results.ToArray() | ConvertTo-Html -Title 'Moxxy Computer Use test report' | Set-Content -LiteralPath (Join-Path $ReportDirectory 'report.html') -Encoding UTF8
  Write-Host "Local report: $ReportDirectory"
}
if (@($results | Where-Object status -eq 'failed').Count -gt 0) { exit 1 }
exit $exitCode
