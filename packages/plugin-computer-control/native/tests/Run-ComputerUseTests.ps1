param(
  [string]$HelperPath = (Join-Path $PSScriptRoot 'moxxy-computer.exe'),
  [string]$FixturePath = (Join-Path $PSScriptRoot 'moxxy-computer-fixture.exe'),
  [string]$ReportDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('moxxy-computer-tests-' + [guid]::NewGuid())),
  [switch]$NonInteractive,
  [switch]$TestClipboard,
  [switch]$TestInstalledApps
)
$ErrorActionPreference = 'Stop'
if (-not $NonInteractive) {
  Write-Host 'Test controls ONLY its own windows. Do not use the mouse or keyboard during the test.'
  Write-Host 'Use Stop Computer Use to stop. No data is uploaded.'
  if ($TestClipboard) { Write-Host 'Clipboard test is enabled: non-text clipboard contents may be replaced.' }
  if ($TestInstalledApps) { Write-Host 'Installed-app test is enabled: a NEW Notepad window will receive test text and close without saving files.' }
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
function Request($peer, $method, $parameters, $version = 3) {
  $id = [guid]::NewGuid().ToString()
  $frame = @{ version=$version; id=$id; method=$method; params=$parameters } | ConvertTo-Json -Depth 20 -Compress
  $peer.StandardInput.WriteLine($frame); $peer.StandardInput.Flush()
  do {
    $read = $peer.StandardOutput.ReadLineAsync()
    if (-not $read.Wait(15000)) { throw "Helper response timeout for $method (operation not retried)" }
    if (-not $read.Result) { throw "Helper exited before response ($($peer.ExitCode))" }
    $response = $read.Result | ConvertFrom-Json
    if ($response.id -ne $id -or $response.version -ne 3) { throw 'Invalid protocol response' }
  } while ($response.event -eq 'control_state')
  return $response
}
function Call($method, $parameters) {
  $response = Request $script:helper $method $parameters
  if (-not $response.ok) { throw "$($response.error.code): $($response.error.message)" }
  return $response.result
}
function Check($condition, $message) { if (-not $condition) { throw $message } }
function Observe { return Call 'observe' @{ windowId=$script:windowId; maxNodes=128 } }
function Await-Action($receipt) {
  for ($i=0;$i -lt 8 -and $receipt.status -eq 'pending';$i++) {
    $receipt=Call 'action_status' @{actionId=$receipt.actionId;waitMs=500}
  }
  Check ($receipt.status -eq 'completed') ('UIA operation did not complete: '+($receipt | ConvertTo-Json -Compress))
}
function Accessible-Action($name,$action) {
  $observation=Observe
  $control=@($observation.elements | Where-Object name -eq $name)[0]
  Check ($null -ne $control -and $control.actions -contains $action) ('Action not advertised for '+$name+': '+$action)
  return Call 'action' @{windowId=$script:windowId;observationId=$observation.observationId;elementId=$control.elementId;action=$action}
}
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
function Focus-TestFixture($process) {
  # Simulate the user's window switch with real UIA, outside the backend under
  # test. Process launch alone is not a foreground guarantee after SendInput.
  $actor=Start-Process -FilePath $FixturePath -ArgumentList '--focus-test-window',([string]$process.Id) -PassThru
  try {
    if (-not $actor.WaitForExit(5000)) { $actor.Kill(); $actor.WaitForExit(); throw 'Test focus actor timed out' }
    Check ($actor.ExitCode -eq 0) 'Test fixture could not acquire real foreground focus'
  } finally { $actor.Dispose() }
}
function Test($name, [scriptblock]$work) {
  try { & $work; Record $name 'passed' } catch { Record $name 'failed' $_.Exception.Message }
}
$exitCode = 1
try {
  $script:helper = Start-Peer
  $status = Call 'status' @{}
  Check ($status.protocolVersion -eq 3 -and $status.architecture -eq 'x64') 'Wrong helper architecture/protocol'
  Test 'protocol rejects wrong version' {
    $response = Request $script:helper 'status' @{} 1
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
    Test 'maintenance lease excludes competing helpers without targeting a window' {
      try {
        $lease=Call 'maintenance' @{}
        Check ($lease.maintenanceReady) 'No maintenance lease acknowledgement'
        $other=Start-Peer
        try {
          $busy=Request $other 'maintenance' @{}
          Check (-not $busy.ok -and $busy.error.code -eq 'control-busy') 'Maintenance allowed competing desktop owner'
        } finally { $other.StandardInput.Close(); $other.WaitForExit(3000) | Out-Null }
      } finally {
        $script:helper.StandardInput.Close(); $script:helper.WaitForExit(3000) | Out-Null
        $script:helper=Start-Peer
      }
    }
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
    Test 'UIA invoke toggle selection and tree expansion affect real controls' {
      $before=(Fixture-State).saves
      Await-Action (Accessible-Action 'Save' 'invoke')
      Check ((Fixture-State).saves -eq $before+1) 'Invoke did not activate the real button'
      Await-Action (Accessible-Action 'Enable test option' 'toggle')
      Check ((Fixture-State).checked) 'Toggle did not change the real checkbox'
      Await-Action (Accessible-Action 'Second choice' 'select')
      Check ((Fixture-State).selectedItem -eq 1) 'Selection did not reach the real list item'
      Await-Action (Accessible-Action 'Test branch' 'expand')
      Check ((Fixture-State).expanded) 'Tree branch did not expand'
      Await-Action (Accessible-Action 'Test branch' 'collapse')
      Check (-not (Fixture-State).expanded) 'Tree branch did not collapse'
    }
    Test 'accessibility reads and selects real Unicode text without exposing protected text' {
      $before=Observe
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $value='Zażółć gęślą jaźń, gęślą'
      Call 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text=$value} | Out-Null
      $before=Observe
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $ref=@{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId}
      $read=Call 'read_text' ($ref+@{maxChars=100})
      Check ($read.text -eq $value -and -not $read.truncated) 'TextPattern did not return actual Unicode document text'
      $short=Call 'read_text' ($ref+@{maxChars=3})
      Check ($short.text -eq 'Zaż' -and $short.truncated) 'Text output did not report truncation'
      Call 'select_text' ($ref+@{text='gęślą';occurrence=2}) | Out-Null
      $state=Fixture-State
      Check ($state.selectionStart -eq $value.LastIndexOf('gęślą') -and $state.selectionEnd -eq $value.Length) 'Second occurrence was not selected in the actual EDIT'
      $before=Observe
      $secret=@($before.elements | Where-Object { $_.protected })[0]
      $denied=Request $script:helper 'read_text' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$secret.elementId;maxChars=100}
      Check (-not $denied.ok -and $denied.error.code -eq 'protected-element') 'Protected text read was not rejected'
    }
    Test 'inventory preserves unchanged window and observation identities' {
      $before=Observe
      $inventory=Call 'windows' @{}
      $target=@($inventory | Where-Object { $_.pid -eq $fixture.Id })[0]
      $previous=$script:windowId
      $script:windowId=$target.windowId
      Check ($previous -eq $target.windowId) 'Unchanged window received a new identity'
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      Call 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text='inventory retained'} | Out-Null
    }
    Test 'background UIA change does not steal foreground or require focus' {
      $before=Observe
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $otherPath=Join-Path $ReportDirectory 'other-fixture-state.json'
      $other=Start-Process -FilePath $FixturePath -ArgumentList ('"'+$otherPath+'"') -PassThru
      $fixtures.Add($other)
      try {
        Check ($other.WaitForInputIdle(10000)) 'Second fixture unavailable'
        Focus-TestFixture $other
        Start-Sleep -Milliseconds 250
        Check ((Get-Content -LiteralPath $otherPath -Raw | ConvertFrom-Json).foreground) 'Second fixture was not foreground'
        Call 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text='background updated'} | Out-Null
        Check ((Fixture-State).text -eq 'background updated') 'Background value not set'
        $image=Screenshot
        Check ($image.mode -eq 'window') 'Background capture used desktop fallback'
        Check ((Get-Content -LiteralPath $otherPath -Raw | ConvertFrom-Json).foreground) 'Automation stole foreground'
      } finally {
        $other.CloseMainWindow() | Out-Null
        $other.WaitForExit(3000) | Out-Null
        Call 'focus' @{windowId=$script:windowId} | Out-Null
      }
    }
    Test 'window-local crop retains source geometry' {
      $full=Screenshot
      $crop=Call 'screenshot' @{ windowId=$script:windowId; maxDim=1280; format='png'; quality=72; allowVisibleFallback=$false; region=@{x=20;y=30;width=200;height=100} }
      Check ($crop.width -eq 200 -and $crop.height -eq 100 -and $crop.source.x -eq $full.source.x+20 -and $crop.source.y -eq $full.source.y+30) 'Crop source mapping differs'
    }
    Test 'explicit pause stays paused on foreground and resumes only by user command' {
      try {
        $before=Observe
        $script:helper.StandardInput.WriteLine('{"version":3,"control":"pause"}'); $script:helper.StandardInput.Flush()
        $id=[guid]::NewGuid().ToString()
        $frame=@{version=3;id=$id;method='key';params=@{windowId=$script:windowId;observationId=$before.observationId;key='a';modifiers=@()}} | ConvertTo-Json -Compress -Depth 10
        $script:helper.StandardInput.WriteLine($frame); $script:helper.StandardInput.Flush()
        $read=$script:helper.StandardOutput.ReadLineAsync()
        Check ($read.Wait(5000)) 'No paused state'
        $state=$read.Result | ConvertFrom-Json
        Check ($state.id -eq $id -and $state.state -eq 'paused_by_user') 'Explicit pause was not honored'
        $pending=$script:helper.StandardOutput.ReadLineAsync()
        Check (-not $pending.Wait(1200)) 'Pause auto-resumed while target was foreground'
        $script:helper.StandardInput.WriteLine('{"version":3,"control":"resume"}'); $script:helper.StandardInput.Flush()
        Check ($pending.Wait(5000)) 'Resume could not reach blocked helper'
        $state=$pending.Result | ConvertFrom-Json
        Check ($state.state -in @('foreground','background')) 'Missing resumed state'
        $read=$script:helper.StandardOutput.ReadLineAsync()
        Check ($read.Wait(5000)) 'Missing paused operation result'
        $response=$read.Result | ConvertFrom-Json
        Check ($response.ok -and $response.result.status -eq 'needs_observation' -and $response.result.effect -eq 'none') 'Paused input was replayed'
      } finally {
        $script:helper.StandardInput.Close(); $script:helper.WaitForExit(3000) | Out-Null
        $script:helper=Start-Peer
        $inventory=Call 'windows' @{}
        $script:windowId=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0].windowId
        Call 'focus' @{windowId=$script:windowId} | Out-Null
      }
    }
    Test 'focus wait stays pending and returns observation-required after target resumes' {
      $before=Observe
      $otherPath=Join-Path $ReportDirectory 'focus-wait-fixture.json'
      $other=Start-Process -FilePath $FixturePath -ArgumentList ('"'+$otherPath+'"') -PassThru
      $fixtures.Add($other)
      try {
        Check ($other.WaitForInputIdle(10000)) 'Second fixture unavailable'
        Focus-TestFixture $other
        Start-Sleep -Milliseconds 250
        Check ((Get-Content -LiteralPath $otherPath -Raw | ConvertFrom-Json).foreground) 'Second fixture was not foreground'
        $id=[guid]::NewGuid().ToString()
        $frame=@{version=3;id=$id;method='key';params=@{windowId=$script:windowId;observationId=$before.observationId;key='a';modifiers=@()}} | ConvertTo-Json -Compress -Depth 10
        $script:helper.StandardInput.WriteLine($frame); $script:helper.StandardInput.Flush()
        $read=$script:helper.StandardOutput.ReadLineAsync()
        Check ($read.Wait(5000)) 'No waiting state event'
        $state=$read.Result | ConvertFrom-Json
        Check ($state.id -eq $id -and $state.event -eq 'control_state' -and $state.state -eq 'waiting_for_focus') 'Focus loss ended the operation instead of waiting locally'
        $pending=$script:helper.StandardOutput.ReadLineAsync()
        Check (-not $pending.Wait(1200)) 'Focus waiting ended prematurely'
        Check ((Get-Content -LiteralPath $otherPath -Raw | ConvertFrom-Json).text -eq '') 'Input leaked into another window'
        $other.CloseMainWindow() | Out-Null
        Check ($other.WaitForExit(3000)) 'Second fixture did not close'
        Check ($pending.Wait(5000)) 'Target focus did not resume waiting'
        $state=$pending.Result | ConvertFrom-Json
        Check ($state.state -eq 'foreground') 'Missing foreground resume state'
        $read=$script:helper.StandardOutput.ReadLineAsync()
        Check ($read.Wait(5000)) 'No resumed result'
        $response=$read.Result | ConvertFrom-Json
        Check ($response.id -eq $id -and $response.ok -and $response.result.status -eq 'needs_observation' -and -not $response.result.delivered) 'Waiting replayed stale input'
      } finally {
        if (-not $other.HasExited) { $other.CloseMainWindow() | Out-Null; $other.WaitForExit(3000) | Out-Null }
      }
    }
    Test 'observation supports a selected subtree and bounded element filters' {
      $observation=Observe
      $button=@($observation.elements | Where-Object { $_.name -eq 'Save' })[0]
      $subtree=Call 'observe' @{windowId=$script:windowId;maxNodes=32;root=@{observationId=$observation.observationId;elementId=$button.elementId}}
      Check ($subtree.elements.Count -eq 1 -and $subtree.elements[0].name -eq 'Save') 'Subtree did not stay inside requested control'
      $filtered=Call 'observe' @{windowId=$script:windowId;maxNodes=32;filter=@{nameIncludes='save';controlType=50000}}
      Check ($filtered.elements.Count -eq 1 -and $filtered.elements[0].name -eq 'Save') 'Observation ignored element filter'
      $stale=Request $script:helper 'observe' @{windowId=$script:windowId;maxNodes=32;root=@{observationId=$observation.observationId;elementId=$button.elementId}}
      Check (-not $stale.ok) 'Subtree accepted stale element reference'
    }
    # Physical input uses a separate path from semantic background operations.
    Test 'window-targeted typing reaches a non-text canvas but refuses protected focus' {
      $observation=Observe
      $canvas=@($observation.elements | Where-Object name -eq 'Canvas')[0]
      Call 'click' @{windowId=$script:windowId;observationId=$observation.observationId;elementId=$canvas.elementId;button='left';count=1} | Out-Null
      $observation=Observe
      Call 'type_window' @{windowId=$script:windowId;observationId=$observation.observationId;text='Zażółć'} | Out-Null
      Check ((Fixture-State).canvasText -eq 'Zażółć') 'Window-targeted typing did not reach the real canvas'
      $observation=Observe
      $secret=@($observation.elements | Where-Object protected)[0]
      $capture=Screenshot
      $x=[math]::Floor(($secret.bounds.x+10-$capture.source.x)*$capture.width/$capture.source.width)
      $y=[math]::Floor(($secret.bounds.y+10-$capture.source.y)*$capture.height/$capture.source.height)
      Call 'click' @{windowId=$script:windowId;captureId=$capture.captureId;x=$x;y=$y;button='left';count=1} | Out-Null
      $observation=Observe
      $denied=Request $script:helper 'type_window' @{windowId=$script:windowId;observationId=$observation.observationId;text='must not type'}
      Check (-not $denied.ok -and $denied.error.code -eq 'protected-element') 'Window typing accepted a password focus'
    }
    Test 'UIA set value preserves Polish and Unicode' {
      $observation = Observe
      $field = @($observation.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $text = 'Za' + [char]0x17C + [char]0xF3 + [char]0x142 + [char]0x107 + ' g' + [char]0x119 + [char]0x15B + 'l' + [char]0x105 + ' ja' + [char]0x17A + [char]0x144 + [char]0x0A + [char]::ConvertFromUtf32(0x1F600)
      Call 'set_value' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$field.elementId; text=$text } | Out-Null
      $actual=(Fixture-State).text.Replace("`r",'')
      Check ($actual -ceq $text) ("UIA text differs: actual="+($actual|ConvertTo-Json -Compress)+" expected="+($text|ConvertTo-Json -Compress))
      $field=@((Observe).elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      Check ($field.value.Replace("`r",'') -ceq $text) 'Observation omitted editable value'
    }
    $emoji=[char]::ConvertFromUtf32(0x1F600)
    $valueCases=@(
      @{name='511 units';text=('A'*511);expected=('A'*511)},
      @{name='512 units';text=('A'*512);expected=('A'*512)},
      @{name='513 units';text=(('A'*512)+'B');expected=('A'*512)},
      @{name='4000 units';text=('A'*4000);expected=('A'*512)},
      @{name='emoji crossing cutoff';text=(('A'*511)+$emoji+'B');expected=('A'*511)},
      @{name='emoji ending at cutoff';text=(('A'*510)+$emoji+'B');expected=(('A'*510)+$emoji)}
    )
    foreach ($case in $valueCases) {
      Test ('bounded observation preserves actual control value: '+$case.name) {
        $before=Observe
        $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
        Call 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text=$case.text} | Out-Null
        $after=Observe
        $actual=@($after.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
        Check ($actual.value -ceq $case.expected) 'Bounded observation changed text or split a surrogate pair'
        Check ((Fixture-State).text -ceq $case.text) 'Observation changed the real control text'
        Check ((Call 'status' @{}).ready) 'Helper did not survive bounded text observation'
      }
    }
    Test 'oversized text input remains rejected without changing the control' {
      $before=Observe
      $original=(Fixture-State).text
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      $denied=Request $script:helper 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text=('A'*4001)}
      Check (-not $denied.ok -and $denied.error.code -eq 'invalid-input') 'Oversized input was not rejected'
      Check ((Fixture-State).text -ceq $original) 'Oversized input changed the control'
      Check ((Call 'status' @{}).ready) 'Input rejection terminated the helper'
    }
    Test 'protected control has no value/name disclosure' {
      $observation=Observe
      $secret=@($observation.elements | Where-Object { $_.protected })[0]
      Check ($null -ne $secret -and $secret.name -eq '') 'Password leaked through accessibility'
      Check ($null -eq $secret.value) 'Password value leaked through accessibility'
      $response=Request $script:helper 'set_value' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$secret.elementId; text='not allowed' }
      Check (-not $response.ok) 'Protected field mutation accepted'
    }
    Test 'observed element click reaches button; stale reference rejected' {
      $savesBefore=(Fixture-State).saves
      $observation=Observe
      $button=@($observation.elements | Where-Object { $_.name -eq 'Save' })[0]
      $input=@{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 }
      Call 'click' $input | Out-Null
      Check ((Fixture-State).saves -eq $savesBefore+1) 'Button did not receive exactly one click'
      Check (-not (Request $script:helper 'click' $input).ok) 'Stale element accepted'
    }
    Test 'invented observation IDs are diagnosed without a focus-repair loop' {
      $observation=Observe
      foreach ($fake in @('unused','x','fresh')) {
        $invalid=Request $script:helper 'observe' @{windowId=$script:windowId;maxNodes=120;root=@{observationId=$fake;elementId='root'}}
        Check (-not $invalid.ok -and $invalid.error.code -eq 'unknown-observation') 'Invented reference was mistaken for a focus/geometry change'
        Check ($invalid.error.message.Contains('omit root')) 'Recovery did not explain how to get the first observation'
      }
      Check ((Observe).elements.Count -gt 0) 'Cannot recover with an unscoped observation'
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
    Test 'full and cropped screenshots map to the exact received canvas pixel' {
      foreach ($variant in @(@{maxDim=1280},@{maxDim=256},@{maxDim=256;region=@{x=10;y=40;width=500;height=440}})) {
        $parameters=@{windowId=$script:windowId;maxDim=$variant.maxDim;format='png';quality=72;allowVisibleFallback=$false}
        if ($variant.region) { $parameters.region=$variant.region }
        $capture=Call 'screenshot' $parameters
        $view=Observe
        $canvas=@($view.elements | Where-Object name -eq 'Canvas')[0]
        $point=Canvas-Point $capture 85 55
        $expectedX=$capture.source.x+[math]::Floor($point.x*$capture.source.width/$capture.width)-$canvas.bounds.x
        $expectedY=$capture.source.y+[math]::Floor($point.y*$capture.source.height/$capture.height)-$canvas.bounds.y
        Call 'click' @{windowId=$script:windowId;captureId=$capture.captureId;x=$point.x;y=$point.y;button='left';count=1} | Out-Null
        $state=Fixture-State
        Check ([math]::Abs($state.clickX-$expectedX) -le 1 -and [math]::Abs($state.clickY-$expectedY) -le 1) "Image point landed at wrong pixel: got $($state.clickX),$($state.clickY); expected $expectedX,$expectedY"
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
    Test 'semantic modal invocation returns a receipt without blocking observation or closure' {
      $observation=Observe
      $button=@($observation.elements | Where-Object { $_.name -eq 'Open modal' })[0]
      $clock=[Diagnostics.Stopwatch]::StartNew()
      $receipt=Call 'action' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; action='invoke' }
      Check ($clock.ElapsedMilliseconds -lt 2000) 'Invoke blocked the request loop until modal closure'
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
      Await-Action $receipt
      Start-Sleep -Milliseconds 200
      $script:windowId=$parent.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
      Check ((Observe).elements.Count -gt 2) 'Parent not usable after modal'
    }
    Test 'owned and nested dialogs expose their own controls and never wait on a disabled parent' {
      $mainId=$script:windowId
      $receipt=Accessible-Action 'Open editor' 'invoke'
      Start-Sleep -Milliseconds 300
      $inventory=Call 'windows' @{}
      $dialog=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy test editor' })[0]
      Check ($null -ne $dialog) 'Editor dialog did not open'
      try {
        $parentView=Observe
        # Store evidence before closure so a failing assertion does not strand the fixture.
        $parentBlocked=$parentView.blockingWindowId -eq $dialog.windowId
        $parentIsolated=@($parentView.elements | Where-Object { $_.windowId -ne $mainId }).Count -eq 0
        $ownerCorrect=$dialog.ownerWindowId -eq $mainId
        $blockedClock=[Diagnostics.Stopwatch]::StartNew()
        $blocked=Call 'focus' @{windowId=$mainId}
        Check ($blockedClock.ElapsedMilliseconds -lt 2000 -and $blocked.status -eq 'target_blocked' -and $blocked.blockingWindowId -eq $dialog.windowId -and -not $blocked.delivered) 'Disabled parent waited for focus or received input'
        $script:windowId=$dialog.windowId
        Call 'focus' @{windowId=$script:windowId} | Out-Null
        $view=Observe
        $field=@($view.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
        Check ($null -ne $field) 'Dialog edit field missing'
        Call 'set_value' @{windowId=$script:windowId;observationId=$view.observationId;elementId=$field.elementId;text='123'} | Out-Null
        $view=Observe
        $field=@($view.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
        $valueCorrect=$field.value -eq '123' -and $field.windowId -eq $dialog.windowId
        $nestedReceipt=Accessible-Action 'Nested editor' 'invoke'
        Start-Sleep -Milliseconds 300
        $inventory=Call 'windows' @{}
        $nested=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy nested editor' })[0]
        Check ($null -ne $nested) 'Nested dialog did not open'
        $nestedParentView=Observe
        $nestedCorrect=$nested.ownerWindowId -eq $dialog.windowId -and $nestedParentView.blockingWindowId -eq $nested.windowId
        $blocked=Call 'focus' @{windowId=$mainId}
        Check ($blocked.status -eq 'target_blocked' -and $blocked.blockingWindowId -eq $nested.windowId) 'Nested modal was not selected as the blocking target'
        $script:windowId=$nested.windowId
        Call 'focus' @{windowId=$script:windowId} | Out-Null
        $nestedView=Observe
        $nestedField=@($nestedView.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
        Call 'set_value' @{windowId=$script:windowId;observationId=$nestedView.observationId;elementId=$nestedField.elementId;text='255'} | Out-Null
        $nestedText=@((Observe).elements | Where-Object controlType -eq 50004)[0].value
        $close=Accessible-Action 'OK' 'invoke'; Await-Action $close; Await-Action $nestedReceipt
        $script:windowId=$dialog.windowId
        $freshParent=Observe
        $stale=Request $script:helper 'set_value' @{windowId=$nested.windowId;observationId=$nestedView.observationId;elementId=$nestedField.elementId;text='999'}
        Check (-not $stale.ok) 'Closed nested dialog accepted stale input'
        Check ($null -eq $freshParent.blockingWindowId -and $nestedText -eq '255') 'Nested dialog did not restore parent correctly'
      } finally {
        $script:windowId=$dialog.windowId
        Call 'focus' @{windowId=$script:windowId} | Out-Null
        $close=Accessible-Action 'OK' 'invoke'; Await-Action $close; Await-Action $receipt
        $script:windowId=$mainId
        Call 'focus' @{windowId=$script:windowId} | Out-Null
      }
      Check ($ownerCorrect -and $parentBlocked -and $parentIsolated -and $valueCorrect -and $nestedCorrect) 'Dialog ownership/observation contract is missing or incorrect'
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
      $frame=@{ version=3; id=[guid]::NewGuid().ToString(); method='drag'; params=@{ windowId=$script:windowId; captureId=$capture.captureId; from=$from; to=$to; durationMs=2000 } } | ConvertTo-Json -Depth 20 -Compress
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
    Test 'window movement rejects old image coordinates' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Move later')[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 } | Out-Null
      $capture=Screenshot
      Start-Sleep -Milliseconds 3300
      $response=Request $script:helper 'click' @{ windowId=$script:windowId; captureId=$capture.captureId; x=50; y=50; button='left'; count=1 }
      Check (-not $response.ok -and $response.error.code -eq 'stale-capture') 'Moved window accepted old coordinates'
    }
    Test 'focus theft rejects old observation' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Focus later')[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 } | Out-Null
      $observation=Observe
      Start-Sleep -Milliseconds 3300
      $response=Request $script:helper 'key' @{ windowId=$script:windowId; observationId=$observation.observationId; key='a'; modifiers=@() }
      Check (-not $response.ok -and $response.error.code -eq 'focus-changed') 'Input sent after focus theft'
    }
    Test 'recreated window rejects old identity' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Recreate later')[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 } | Out-Null
      Start-Sleep -Milliseconds 3300
      $response=Request $script:helper 'focus' @{ windowId=$script:windowId }
      Check (-not $response.ok -and $response.error.code -eq 'stale-window') 'Recreated window accepted old identity'
      $inventory=Call 'windows' @{}
      $target=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0]
      $script:windowId=$target.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
    }
    Test 'native popup menu has an actionable window identity' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Context menu')[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$button.elementId; button='left'; count=1 } | Out-Null
      Start-Sleep -Milliseconds 200
      $inventory=Call 'windows' @{}
      $menu=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.className -eq '#32768' })[0]
      $parent=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0]
      Check ($null -ne $menu) 'Native menu omitted from window inventory'
      $script:windowId=$menu.windowId
      Call 'focus' @{ windowId=$script:windowId } | Out-Null
      $observation=Observe; $item=@($observation.elements | Where-Object name -eq 'Choose test action')[0]
      Call 'click' @{ windowId=$script:windowId; observationId=$observation.observationId; elementId=$item.elementId; button='left'; count=1 } | Out-Null
      $script:windowId=$parent.windowId
      Check ((Fixture-State).menuPicks -eq 1) 'Context menu action not delivered'
    }
    if ($TestClipboard) {
      Test 'clipboard Unicode round trip' {
        $original=Request $script:helper 'clipboard' @{ windowId=$script:windowId; action='read' }
        try {
          $value='Clipboard '+[char]0x17C+[char]::ConvertFromUtf32(0x1F600)
          Call 'clipboard' @{ windowId=$script:windowId; action='write'; text=$value } | Out-Null
          Check ((Call 'clipboard' @{ windowId=$script:windowId; action='read' }).text -ceq $value) 'Clipboard mismatch'
        } finally {
          if ($original.ok) { Call 'clipboard' @{ windowId=$script:windowId; action='write'; text=$original.result.text } | Out-Null }
        }
      }
    } else { Record 'clipboard round trip' 'not-tested' 'Run with -TestClipboard only when clipboard content is disposable.' }
    Test 'changed control value rejects stale observation without overwriting user data' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Value later')[0]
      Call 'click' @{windowId=$script:windowId;observationId=$observation.observationId;elementId=$button.elementId;button='left';count=1} | Out-Null
      $before=Observe
      $field=@($before.elements | Where-Object { $_.controlType -eq 50004 -and -not $_.protected })[0]
      Start-Sleep -Milliseconds 3300
      $response=Request $script:helper 'set_value' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$field.elementId;text='Must not overwrite'}
      Check (-not $response.ok -and $response.error.code -eq 'stale-element') 'Changed value did not invalidate the element'
      Check ((Fixture-State).text -eq 'Changed by application') 'Stale operation overwrote application data'
    }
    Test 'minimized windows retain identity and require explicit restore' {
      $observation=Observe; $button=@($observation.elements | Where-Object name -eq 'Minimize')[0]
      Call 'click' @{windowId=$script:windowId;observationId=$observation.observationId;elementId=$button.elementId;button='left';count=1} | Out-Null
      Start-Sleep -Milliseconds 250
      $inventory=Call 'windows' @{}
      $target=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0]
      Check ($target.windowId -eq $script:windowId -and $target.state -eq 'minimized' -and $null -eq $target.bounds) 'Minimized window was exposed as a clickable offscreen target'
      Check (-not (Request $script:helper 'observe' @{windowId=$script:windowId;maxNodes=128}).ok) 'Minimized window accepted input preparation'
      Call 'restore' @{windowId=$script:windowId} | Out-Null
      Check ((Observe).elements.Count -gt 2) 'Restored window is not usable'
    }
    Test 'hard worker termination during drag releases only its held input' {
      Call 'focus' @{windowId=$script:windowId} | Out-Null
      $capture=Screenshot; $from=Canvas-Point $capture 60 60; $to=Canvas-Point $capture 200 90
      $frame=@{version=3;id=[guid]::NewGuid().ToString();method='drag';params=@{windowId=$script:windowId;captureId=$capture.captureId;from=$from;to=$to;durationMs=2000}} | ConvertTo-Json -Compress -Depth 20
      $script:helper.StandardInput.WriteLine($frame); $script:helper.StandardInput.Flush()
      Check ((Fixture-State).leftDown) 'Crash test never reached held mouse input'
      $script:helper.Kill(); Check ($script:helper.WaitForExit(3000)) 'Worker did not terminate'
      Start-Sleep -Milliseconds 500
      Check (-not (Fixture-State).leftDown) 'Hard worker termination left injected mouse button held'
    }
    Test 'changed control meaning invalidates its old reference without activation' {
      $script:helper=Start-Peer
      $inventory=Call 'windows' @{}
      $script:windowId=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0].windowId
      try {
        Call 'focus' @{windowId=$script:windowId} | Out-Null
        Await-Action (Accessible-Action 'Rename later' 'invoke')
        $before=Observe
        $save=@($before.elements | Where-Object name -eq 'Save')[0]
        Check ($null -ne $save) 'Rename test missed its original control'
        $saves=(Fixture-State).saves
        Start-Sleep -Milliseconds 3300
        $stale=Request $script:helper 'action' @{windowId=$script:windowId;observationId=$before.observationId;elementId=$save.elementId;action='invoke'}
        Check (-not $stale.ok -and $stale.error.code -eq 'stale-element') 'Renamed button retained an actionable old reference'
        Check ((Fixture-State).saves -eq $saves) 'Stale semantic action was executed'
      } finally { $script:helper.StandardInput.Close(); $script:helper.WaitForExit(3000) | Out-Null }
    }
    Test 'guardian panel exposes working accessible pause resume and stop buttons' {
      $script:helper=Start-Peer
      $inventory=Call 'windows' @{}
      $script:windowId=@($inventory | Where-Object { $_.pid -eq $fixture.Id -and $_.title -eq 'Moxxy Computer Use Test' })[0].windowId
      Call 'focus' @{windowId=$script:windowId} | Out-Null
      $workerId=$script:helper.Id
      $children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$workerId" | Where-Object Name -eq 'moxxy-computer.exe')
      Check ($children.Count -eq 1) 'Expected one independent guardian'
      $panelReport=Join-Path $ReportDirectory 'panel-result.txt'
      $probe=Start-Process -FilePath $FixturePath -ArgumentList '--panel-test',($children[0].ProcessId),('"'+$panelReport+'"') -PassThru
      try {
        Check ($probe.WaitForExit(15000)) 'Panel test timed out'
        $detail=Get-Content -LiteralPath $panelReport -Raw
        Check ($probe.ExitCode -eq 0 -and $detail -eq 'passed') ('Guardian panel accessibility/actions failed: '+$detail)
        Check ($script:helper.WaitForExit(3000)) 'Panel Stop left the worker running'
        Check ($script:helper.ExitCode -eq 20) 'Panel Stop was reported as a crash rather than an explicit user stop'
      } finally {
        if (-not $probe.HasExited) { $probe.Kill() }; $probe.Dispose()
        if (-not $script:helper.HasExited) {
          $script:helper.StandardInput.Close()
          if (-not $script:helper.WaitForExit(3000)) { $script:helper.Kill(); $script:helper.WaitForExit() }
        }
      }
    }
    if ($TestInstalledApps) {
      Test 'catalog launches a named installed application without desktop activation or shell text' {
        $script:helper=Start-Peer
        $catalog=Call 'app_catalog' @{query='';maxResults=64}
        Check ($catalog.unavailableSources.Count -eq 0 -and @($catalog.apps | Where-Object source -eq 'windows-shell').Count -gt 0) 'Windows installed-app catalog source unavailable'
        $apps=Call 'app_catalog' @{query='notepad';maxResults=64}
        Check ($apps.apps.Count -gt 0) 'Notepad absent from installed catalog'
        $app=@($apps.apps | Where-Object source -eq 'system')[0]
        if (-not $app) { $app=$apps.apps[0] }
        $before=@((Call 'windows' @{}).windowId)
        $oldPids=@(Get-Process -Name notepad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $opened=Call 'open' @{appId=$app.appId;instance='new';timeoutMs=8000}
        Check ($opened.status -eq 'opened' -and $opened.windows.Count -eq 1) 'Application launch did not resolve one window'
        $window=$opened.windows[0]
        Check ($before -notcontains $window.windowId -and $oldPids -notcontains $window.pid) 'New-instance request silently reused an old window'
        $process=Get-Process -Id $window.pid
        try {
          Check ($process.ProcessName -eq 'notepad') 'Catalog launched the wrong application'
          Write-Host 'Real Notepad: observe newly opened editor'
          $observation=Call 'observe' @{windowId=$window.windowId;maxNodes=128}
          $field=@($observation.elements | Where-Object { $_.controlType -in @(50004,50030) -and -not $_.protected -and $_.enabled })[0]
          Check ($null -ne $field) 'Notepad editor was not discovered'
          Write-Host 'Real Notepad: focus editor window'
          Call 'focus' @{windowId=$window.windowId} | Out-Null
          $observation=Call 'observe' @{windowId=$window.windowId;maxNodes=128}
          $field=@($observation.elements | Where-Object { $_.controlType -in @(50004,50030) -and -not $_.protected -and $_.enabled })[0]
          Write-Host 'Real Notepad: click editor control'
          Call 'click' @{windowId=$window.windowId;observationId=$observation.observationId;elementId=$field.elementId;button='left';count=1} | Out-Null
          $observation=Call 'observe' @{windowId=$window.windowId;maxNodes=128}
          $field=@($observation.elements | Where-Object elementId -eq $observation.focusedElementId)[0]
          Check ($null -ne $field) 'Notepad editor focus could not be observed'
          $expected='Za'+[char]0x17C+[char]0xF3+[char]0x142+[char]0x107+' g'+[char]0x119+[char]0x15B+'l'+[char]0x105+' ja'+[char]0x17A+[char]0x144+".`nTo jest test Moxxy na Windowsie.`nTrzecia linia: "+[char]0x2705
          Write-Host 'Real Notepad: type three lines'
          Call 'type' @{windowId=$window.windowId;observationId=$observation.observationId;elementId=$field.elementId;text=$expected} | Out-Null
          $observation=Call 'observe' @{windowId=$window.windowId;maxNodes=128}
          $field=@($observation.elements | Where-Object elementId -eq $observation.focusedElementId)[0]
          $read=Call 'read_text' @{windowId=$window.windowId;observationId=$observation.observationId;elementId=$field.elementId;maxChars=4000}
          Check ($read.text.Replace("`r",'') -ceq $expected) ('Real Notepad text mismatch: '+($read.text|ConvertTo-Json -Compress))
          $invalid=Request $script:helper 'open' @{appId='notepad.exe & echo unexpected';instance='new';timeoutMs=500}
          Check (-not $invalid.ok -and $invalid.error.code -eq 'unknown-app') 'Unresolved command text was accepted'
        } finally {
          # This verified new test process owns only our unsaved document.
          if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(3000) | Out-Null }
          $process.Dispose()
        }
      }
    } else { Record 'installed application launch' 'not-tested' 'Explicitly opt in with -TestInstalledApps; opens a new Notepad window.' }
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
  foreach ($name in @('Windows 10/11 agent benchmark 12x3','mixed monitor DPI')) {
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
