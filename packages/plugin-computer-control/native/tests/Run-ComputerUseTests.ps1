param(
  [string]$HelperPath = (Join-Path $PSScriptRoot 'moxxy-computer.exe'),
  [string]$FixturePath = (Join-Path $PSScriptRoot 'moxxy-computer-fixture.exe'),
  [string]$ReportDirectory = (Join-Path ([IO.Path]::GetTempPath()) ('moxxy-computer-tests-' + [guid]::NewGuid())),
  [switch]$NonInteractive,
  [switch]$TestClipboard,
  [switch]$TestInstalledApps
)
$ErrorActionPreference = 'Stop'
$ProtocolVersion = 5
if (-not $NonInteractive) {
  Write-Host 'Test controls ONLY its own windows. Do not use the mouse or keyboard during the test.'
  Write-Host 'Use Stop Computer Use to stop. No data is uploaded.'
  if ($TestClipboard) { Write-Host 'Clipboard test is enabled: text on the clipboard is replaced for a moment and put back.' }
  if ($TestInstalledApps) { Write-Host 'Installed-app test is enabled: a NEW Notepad window will receive test text and close without saving files.' }
  if ((Read-Host 'Type START to continue') -cne 'START') { return }
}
New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$results = [Collections.Generic.List[object]]::new()
$peers = [Collections.Generic.List[Diagnostics.Process]]::new()
$fixtures = [Collections.Generic.List[Diagnostics.Process]]::new()
$script:events = [Collections.Generic.List[object]]::new()
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
  Add-Member -InputObject $peer -NotePropertyName PendingRead -NotePropertyValue $null -Force
  $peers.Add($peer)
  return $peer
}
# One read is outstanding at a time. A read that timed out is kept and answered by
# the next call, so no line is lost and the stream is never read twice at once.
function Read-Frame($peer, $timeout = 20000) {
  if ($null -eq $peer.PendingRead) { $peer.PendingRead = $peer.StandardOutput.ReadLineAsync() }
  if (-not $peer.PendingRead.Wait($timeout)) { return $null }
  $line = $peer.PendingRead.Result
  $peer.PendingRead = $null
  if ($null -eq $line) { throw "Helper exited before answering ($($peer.ExitCode))" }
  return $line | ConvertFrom-Json
}
function Send($peer, $method, $parameters, $version = $ProtocolVersion) {
  $id = [guid]::NewGuid().ToString()
  $frame = @{ version=$version; id=$id; method=$method; params=$parameters } | ConvertTo-Json -Depth 20 -Compress
  $peer.StandardInput.WriteLine($frame); $peer.StandardInput.Flush()
  return $id
}
function Control($peer, $command) {
  $peer.StandardInput.WriteLine((@{ version=$ProtocolVersion; control=$command } | ConvertTo-Json -Compress)); $peer.StandardInput.Flush()
}
# Events (state changes, cursor moves, preview frames) arrive between responses; they are kept for the tests that look at them.
function Await($peer, $id, $timeout = 25000) {
  $until = [DateTime]::UtcNow.AddMilliseconds($timeout)
  while ([DateTime]::UtcNow -lt $until) {
    $frame = Read-Frame $peer 500
    if ($null -eq $frame) { continue }
    if ($frame.version -ne $ProtocolVersion) { throw 'Invalid protocol response' }
    if ($frame.PSObject.Properties['event']) { $script:events.Add($frame); continue }
    if ($frame.id -ne $id) { throw 'Response does not match the request' }
    return $frame
  }
  throw 'Helper response timeout (operation not retried)'
}
function Request($peer, $method, $parameters, $version = $ProtocolVersion) {
  return Await $peer (Send $peer $method $parameters $version)
}
function Call($method, $parameters) {
  $response = Request $script:helper $method $parameters
  if (-not $response.ok) { throw "$($response.error.code): $($response.error.message)" }
  return $response.result
}
function Check($condition, $message) { if (-not $condition) { throw $message } }
function Look([switch]$AnyWindow) {
  $parameters = @{ app=$script:app; screenshot=$true }
  if (-not $AnyWindow) { $parameters.window_id = $script:windowId }
  $script:state = Call 'get_app_state' $parameters
  return $script:state
}
function Find($state, $title, $role = $null) {
  return @($state.tree.elements | Where-Object { $_.PSObject.Properties['title'] -and $_.title -eq $title -and (-not $role -or $_.role -eq $role) })[0]
}
function Field($state) {
  return @($state.tree.elements | Where-Object { $_.role -eq 'Edit' -and -not $_.PSObject.Properties['secure'] })[0]
}
function Act($action) {
  $result = Call 'act' @{ app=$script:app; action=$action; allowed=@($script:app) }
  if ($result.PSObject.Properties['state']) { $script:state = $result.state }
  return $result
}
function Delivered($result, $what) {
  Check ($result.result.outcome -eq 'delivered') ($what + ' was not delivered: ' + ($result.result | ConvertTo-Json -Compress))
}
function Chord($key, $modifiers = @()) { return @{ modifiers=@($modifiers); key=$key } }
function Middle($element, $dx = 0, $dy = 0) {
  return @{ x=[math]::Floor($element.frame.x + $element.frame.width / 2 + $dx); y=[math]::Floor($element.frame.y + $element.frame.height / 2 + $dy) }
}
# A fixture rewrites its report while the test reads it, so a bare Get-Content
# races the writer and fails with "being used by another process", or catches a
# half-written file. Every state read goes through this retry.
function Read-StateFile($path) {
  $until=[DateTime]::UtcNow.AddSeconds(2)
  do {
    try {
      $raw=Get-Content -LiteralPath $path -Raw -Encoding UTF8
      if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $snapshot=$raw | ConvertFrom-Json
        if ($null -ne $snapshot) { return $snapshot }
      }
    } catch { $readError=$_.Exception.Message }
    Start-Sleep -Milliseconds 10
  } while ([DateTime]::UtcNow -lt $until)
  throw "Fixture did not publish a complete JSON report at ${path}: $readError"
}
function Fixture-State {
  # Wait for real window messages to be processed, not for a model declaration.
  Start-Sleep -Milliseconds 250
  return Read-StateFile $script:statePath
}
function Close-Peer($peer) {
  try {
    if (-not $peer.HasExited) { $peer.StandardInput.Close(); if (-not $peer.WaitForExit(3000)) { $peer.Kill(); $peer.WaitForExit() } }
  } catch { }
}
# A new helper knows no windows: find the fixture's main window again and look at it.
function Attach {
  # A test that failed half-way may have left its helper holding the desktop.
  if ($script:helper) { Close-Peer $script:helper }
  $script:helper = Start-Peer
  $listed = Call 'list_apps' @{ query='moxxy-computer-fixture'; limit=20 }
  $row = @($listed.apps | Where-Object id -eq $script:app)[0]
  Check ($null -ne $row -and $row.running) 'The fixture is not listed as a running app'
  $main = @($row.windows | Where-Object title -eq 'Moxxy Computer Use Test')
  Check ($main.Count -eq 1) 'The fixture window is ambiguous or absent'
  $script:windowId = $main[0].id
  return Look
}
function Test($name, [scriptblock]$work) {
  try { & $work; Record $name 'passed' }
  catch [System.PlatformNotSupportedException] { Record $name 'not-tested' $_.Exception.Message }
  catch { Record $name 'failed' $_.Exception.Message }
}
$exitCode = 1
try {
  $script:helper = Start-Peer
  $status = Call 'status' @{}
  Check ($status.permissions.accessibility -and $status.permissions.screenRecording) 'Status does not follow the shared contract'
  Test 'protocol rejects wrong version' {
    $response = Request $script:helper 'status' @{} 4
    Check (-not $response.ok) 'Wrong version was accepted'
  }
  Test 'protocol rejects unknown parameters and unknown methods' {
    $response = Request $script:helper 'status' @{ unexpected=$true }
    Check (-not $response.ok) 'Unknown parameter was accepted'
    $response = Request $script:helper 'observe' @{}
    Check (-not $response.ok -and $response.error.code -eq 'unsupported_action') 'A removed method was accepted'
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
        } finally { Close-Peer $other }
      } finally {
        Close-Peer $script:helper
        $script:helper=Start-Peer
      }
    }
    $script:statePath = Join-Path $ReportDirectory 'fixture-state.json'
    $fixture = Start-Process -FilePath $FixturePath -ArgumentList ('"' + $script:statePath + '"') -PassThru
    $fixtures.Add($fixture)
    Check ($fixture.WaitForInputIdle(10000)) 'Fixture did not become responsive'
    Start-Sleep -Milliseconds 500
    $resolved = (Call 'resolve_apps' @{ names=@('moxxy-computer-fixture', 'no such application 4711') }).apps
    Check ($resolved[0].status -eq 'resolved' -and $resolved[1].status -eq 'not_found') ('App names were not resolved: ' + ($resolved | ConvertTo-Json -Compress))
    $script:app = $resolved[0].id
    Close-Peer $script:helper
    $state = Attach
    Check ($state.tree.elements.Count -gt 5) 'UI Automation is unavailable'
    Check ($state.PSObject.Properties['screenshot'] -and $state.screenshot.mediaType -eq 'image/jpeg') ('No window picture: ' + $state.screenshotUnavailable)
    Add-Type -AssemblyName System.Drawing
    $stream = [IO.MemoryStream]::new([Convert]::FromBase64String($state.screenshot.base64))
    $bitmap = [Drawing.Bitmap]::new($stream)
    try {
      Check ($bitmap.Width -eq $state.screenshot.width -and $bitmap.Height -eq $state.screenshot.height) 'Reported picture size is wrong'
      $markers = 0
      for ($x=0; $x -lt $bitmap.Width; $x+=10) {
        for ($y=0; $y -lt $bitmap.Height; $y+=10) {
          $pixel=$bitmap.GetPixel($x,$y)
          if ($pixel.R -gt 200 -and $pixel.G -lt 90 -and $pixel.B -gt 200) { $markers++ }
        }
      }
      Check ($markers -gt 100) 'Capture did not contain fixture pixel markers'
    } finally { $bitmap.Dispose(); $stream.Dispose() }
    Record 'interactive desktop / UIA / image marker preflight' 'passed'

    Test 'app state lists indexed elements and never the value of a protected field' {
      $state = Look
      $save = Find $state 'Save' 'Button'
      Check ($null -ne $save -and $save.index -ge 0 -and $save.frame.width -gt 0) 'The Save button is not listed with an index and a frame'
      $secure = @($state.tree.elements | Where-Object { $_.PSObject.Properties['secure'] })
      Check ($secure.Count -eq 1 -and -not $secure[0].PSObject.Properties['value']) 'The protected field is missing or shows its value'
      Check (($state | ConvertTo-Json -Depth 20) -notmatch 'fixture-secret') 'Protected text leaked into the state'
      $again = Look
      Check ((Find $again 'Save' 'Button').index -eq $save.index) 'An unchanged element received a new index'
    }
    Test 'click by element index reaches the real button and returns the fresh state' {
      $before=(Fixture-State).saves
      $result = Act @{ action='click'; element_index=(Find (Look) 'Save' 'Button').index; mouse_button='left'; click_count=1 }
      Delivered $result 'Click'
      Check ($result.result.method -eq 'input') 'A click must report how it was delivered'
      Check ($result.PSObject.Properties['state'] -and $result.state.tree.elements.Count -gt 5) 'No fresh state came back with the action'
      Check ((Fixture-State).saves -eq $before+1) 'The click did not reach the real button'
      Check (@($script:events | Where-Object { $_.event -eq 'cursor' -and $null -ne $_.cursor -and $_.cursor.phase -eq 'delivered' -and $_.cursor.x -ge 0 -and $_.cursor.x -le 1 }).Count -gt 0) 'The agent cursor was not reported'
    }
    Test 'unknown index and ungranted app are refused without input' {
      $before=(Fixture-State).saves
      $result = Act @{ action='click'; element_index=987654; mouse_button='left'; click_count=1 }
      Check ($result.result.outcome -eq 'blocked' -and $result.result.code -eq 'stale_state') 'An invented index was not refused as stale'
      $denied = Request $script:helper 'act' @{ app=$script:app; action=@{ action='click'; element_index=0; mouse_button='left'; click_count=1 }; allowed=@() }
      Check (-not $denied.ok -and $denied.error.code -eq 'app_not_allowed') 'An app outside the grant list was acted on'
      Check ((Fixture-State).saves -eq $before) 'A refused action reached the application'
    }
    Test 'set value keeps Polish and Unicode text and refuses a protected field' {
      $value='Zażółć gęślą jaźń, gęślą ✅'
      $result = Act @{ action='set_value'; element_index=(Field (Look)).index; value=$value }
      Delivered $result 'Set value'
      Check ((Fixture-State).text -ceq $value) 'The value did not arrive unchanged'
      Check ((Field $script:state).value -ceq $value) 'The fresh state does not show the new value'
      $secure = @($script:state.tree.elements | Where-Object { $_.PSObject.Properties['secure'] })[0]
      $refused = Act @{ action='set_value'; element_index=$secure.index; value='not allowed' }
      Check ($refused.result.outcome -eq 'unsupported') 'A protected field was changed'
    }
    Test 'text selection finds the right repeat and places the caret' {
      $value='Zażółć gęślą jaźń, gęślą ✅'
      $index=(Field (Look)).index
      Delivered (Act @{ action='select_text'; element_index=$index; text='gęślą'; prefix=', '; selection_type='text' }) 'Selection'
      $state=Fixture-State
      Check ($state.selectionStart -eq $value.LastIndexOf('gęślą') -and $state.selectionEnd -eq $value.LastIndexOf('gęślą')+5) 'The second repeat was not selected'
      Delivered (Act @{ action='select_text'; element_index=$index; text='jaźń'; selection_type='cursor_before' }) 'Caret placement'
      $state=Fixture-State
      Check ($state.selectionStart -eq $value.IndexOf('jaźń') -and $state.selectionEnd -eq $state.selectionStart) 'The caret was not placed before the text'
      $missing = Act @{ action='select_text'; element_index=$index; text='not in the field'; selection_type='text' }
      Check ($missing.result.outcome -ne 'delivered') 'Missing text was reported as selected'
    }
    Test 'typing and key chords reach the focused control' {
      $index=(Field (Look)).index
      Delivered (Act @{ action='set_value'; element_index=$index; value='' }) 'Clearing'
      Delivered (Act @{ action='type_text'; element_index=$index; text="Zażółć`nlinia 2" }) 'Typing'
      Check ((Fixture-State).text.Replace("`r",'') -ceq "Zażółć`nlinia 2") 'Typed text differs'
      Delivered (Act @{ action='press_key'; chord=(Chord 'a' @('ctrl')); repeat=1 }) 'Select all'
      Delivered (Act @{ action='type_text'; text='replaced' }) 'Typing into the focus'
      Check ((Fixture-State).text -ceq 'replaced') 'Ctrl+A followed by typing did not replace the text'
      Delivered (Act @{ action='press_key'; chord=(Chord 'backspace'); repeat=3 }) 'Repeated key'
      Check ((Fixture-State).text -ceq 'repla') 'A repeated key was not pressed three times'
      $bad = Request $script:helper 'act' @{ app=$script:app; action=@{ action='press_key'; chord=(Chord 'no_such_key'); repeat=1 }; allowed=@($script:app) }
      Check (-not $bad.ok -and $bad.error.code -eq 'invalid_key') 'An unknown key was accepted'
    }
    if ($TestClipboard) {
      Test 'paste goes through the clipboard and puts the old text back' {
        Set-Clipboard -Value 'user clipboard text'
        $index=(Field (Look)).index
        Delivered (Act @{ action='set_value'; element_index=$index; value='' }) 'Clearing'
        Delivered (Act @{ action='paste'; element_index=$index; text='wklejone ✅'; format='text' }) 'Paste'
        Check ((Fixture-State).text -ceq 'wklejone ✅') 'Pasted text differs'
        Check ((Get-Clipboard -Raw) -ceq 'user clipboard text') 'The clipboard was not restored'
      }
    } else { Record 'paste through the clipboard' 'not-tested' 'Explicitly opt in with -TestClipboard.' }
    Test 'secondary actions toggle, select, expand and collapse real controls' {
      $do = { param($title, $name)
        $element = Find (Look) $title
        Check ($null -ne $element -and $element.PSObject.Properties['actions'] -and $element.actions -contains $name) ('Action not listed for ' + $title + ': ' + $name)
        Delivered (Act @{ action='perform_secondary_action'; element_index=$element.index; secondary_action=$name }) ($name + ' on ' + $title)
      }
      & $do 'Enable test option' 'toggle'
      Check ((Fixture-State).checked) 'Toggle did not change the real checkbox'
      Check ((Find (Look) 'Enable test option').states -contains 'checked') 'The state does not show the box as checked'
      & $do 'Second choice' 'select'
      Check ((Fixture-State).selectedItem -eq 1) 'Selection did not reach the real list item'
      & $do 'Test branch' 'expand'
      Check ((Fixture-State).expanded) 'Tree branch did not expand'
      & $do 'Test branch' 'collapse'
      Check (-not (Fixture-State).expanded) 'Tree branch did not collapse'
      $guessed = Act @{ action='perform_secondary_action'; element_index=(Find (Look) 'Save' 'Button').index; secondary_action='expand' }
      Check ($guessed.result.outcome -eq 'unsupported') 'A guessed action was tried'
    }
    Test 'points of the screenshot reach the exact canvas pixel with every button' {
      $canvas = Find (Look) 'Canvas'
      Check ($null -ne $canvas) 'Canvas not found in fixture'
      $before=Fixture-State
      $point = Middle $canvas -100 -20
      Delivered (Act (@{ action='click'; mouse_button='left'; click_count=1 } + $point)) 'Left click'
      Delivered (Act (@{ action='click'; mouse_button='right'; click_count=1 } + $point)) 'Right click'
      Delivered (Act (@{ action='click'; mouse_button='middle'; click_count=1 } + $point)) 'Middle click'
      $after=Fixture-State
      Check ($after.left -eq $before.left+1 -and $after.right -eq $before.right+1 -and $after.middle -eq $before.middle+1) 'A mouse button did not reach the canvas'
      $expectedX = [math]::Floor($canvas.frame.width / 2) - 100
      Check ([math]::Abs($after.clickX - $expectedX) -le 3) ('The click landed at ' + $after.clickX + ' instead of ' + $expectedX)
      Delivered (Act (@{ action='click'; mouse_button='left'; click_count=2 } + $point)) 'Double click'
      Check ((Fixture-State).doubleClicks -eq $before.doubleClicks+1) 'Double click did not reach the canvas'
      $outside = Act @{ action='click'; mouse_button='left'; click_count=1; x=50000; y=50000 }
      Check ($outside.result.outcome -eq 'blocked' -and $outside.result.code -eq 'point_outside_frame') 'A point outside the picture was accepted'
    }
    Test 'scrolling in both axes reaches the canvas' {
      $canvas = Find (Look) 'Canvas'
      $before=Fixture-State
      Delivered (Act (@{ action='scroll'; direction='down'; pages=1 } + (Middle $canvas))) 'Scroll down'
      Delivered (Act (@{ action='scroll'; direction='right'; pages=1 } + (Middle $canvas))) 'Scroll right'
      $after=Fixture-State
      Check ($after.scrollY -lt $before.scrollY -and $after.scrollX -gt $before.scrollX) 'The wheel did not reach the canvas in both axes'
    }
    Test 'drag along a path and a press-move-release gesture both reach the canvas' {
      $canvas = Find (Look) 'Canvas'
      $before=(Fixture-State).drags
      $from = Middle $canvas -150 -30; $over = Middle $canvas 0 20; $to = Middle $canvas 120 -10
      Delivered (Act @{ action='drag'; path=@(@($from.x,$from.y), @($over.x,$over.y), @($to.x,$to.y)); duration_ms=400; mouse_button='left' }) 'Drag'
      Check ((Fixture-State).drags -eq $before+1) 'The drag did not reach the canvas'
      $hover = Act (@{ action='mouse'; event='move'; mouse_button='left' } + $to)
      Check ($hover.result.outcome -eq 'unsupported') 'A move without a pressed button was accepted'
      Delivered (Act (@{ action='mouse'; event='down'; mouse_button='left' } + $from)) 'Press'
      Check ((Fixture-State).leftDown) 'The button is not held after event down'
      Delivered (Act (@{ action='mouse'; event='move'; mouse_button='left' } + $over)) 'Move'
      Delivered (Act (@{ action='mouse'; event='up'; mouse_button='left' } + $to)) 'Release'
      $after=Fixture-State
      Check ($after.drags -eq $before+2 -and -not $after.leftDown) 'The gesture did not end as a drag with the button released'
    }
    Test 'a batch runs its steps in order and stops at the first one that is not delivered' {
      $index=(Field (Look)).index
      $batch = Call 'batch' @{ app=$script:app; allowed=@($script:app); actions=@(
        @{ action='click'; element_index=$index; mouse_button='left'; click_count=1 },
        @{ action='press_key'; chord=(Chord 'a' @('ctrl')); repeat=1 },
        @{ action='type_text'; text='batch' },
        @{ action='wait'; duration_s=0.2 }) }
      Check ($batch.results.Count -eq 4 -and @($batch.results | Where-Object outcome -ne 'delivered').Count -eq 0) ('Batch steps failed: ' + ($batch.results | ConvertTo-Json -Compress))
      Check ($batch.PSObject.Properties['state'] -and (Fixture-State).text -ceq 'batch') 'The batch did not type into the field or returned no state'
      $stopped = Call 'batch' @{ app=$script:app; allowed=@($script:app); actions=@(
        @{ action='click'; element_index=987654; mouse_button='left'; click_count=1 },
        @{ action='type_text'; text='must not be typed' }) }
      Check ($stopped.results.Count -eq 1 -and $stopped.results[0].outcome -eq 'blocked') 'The batch went on after a refused step'
      Check ((Fixture-State).text -ceq 'batch') 'A step after the refused one was run'
    }
    Test 'zoom and the full-screen picture show granted apps only' {
      $state = Look
      $zoomed = Call 'zoom' @{ app=$script:app; region=@(0, 0, 200, 100); allowed=@($script:app) }
      Check ($zoomed.mediaType -eq 'image/jpeg' -and $zoomed.width -gt 0 -and $zoomed.height -gt 0) 'Zoom returned no picture'
      $outside = Request $script:helper 'zoom' @{ app=$script:app; region=@(0, 0, 90000, 100); allowed=@($script:app) }
      Check (-not $outside.ok -and $outside.error.code -eq 'point_outside_frame') 'A region outside the screenshot was accepted'
      $none = Request $script:helper 'screenshot' @{ allowed=@() }
      Check (-not $none.ok -and $none.error.code -eq 'app_not_allowed') 'A full-screen picture was taken without any granted app'
      $screen = Call 'screenshot' @{ allowed=@($script:app) }
      Check ($screen.width -gt 0 -and $screen.height -gt 0) 'No full-screen picture'
      $part = Call 'zoom' @{ region=@(0, 0, [math]::Min(300, $screen.width), [math]::Min(200, $screen.height)); allowed=@($script:app) }
      Check ($part.width -gt 0) 'Zoom into the full-screen picture returned nothing'
      $stream = [IO.MemoryStream]::new([Convert]::FromBase64String($screen.base64))
      $bitmap = [Drawing.Bitmap]::new($stream)
      try {
        $markers = 0; $lit = 0
        for ($x=0; $x -lt $bitmap.Width; $x+=10) {
          for ($y=0; $y -lt $bitmap.Height; $y+=10) {
            $pixel=$bitmap.GetPixel($x,$y)
            if ($pixel.R -gt 200 -and $pixel.G -lt 90 -and $pixel.B -gt 200) { $markers++ }
            if ($pixel.R + $pixel.G + $pixel.B -gt 60) { $lit++ }
          }
        }
        Check ($markers -gt 50) 'The granted app is not visible in the full-screen picture'
        Check ($lit -lt ($bitmap.Width * $bitmap.Height / 100) * 0.7) 'The rest of the screen was not hidden'
      } finally { $bitmap.Dispose(); $stream.Dispose() }
    }
    Test 'the live preview sends pictures only while someone watches' {
      Look | Out-Null
      $script:events.Clear()
      Check ((Call 'preview.start' @{ fps=5 }).started) 'Preview did not start'
      Delivered (Act @{ action='click'; element_index=(Find $script:state 'Save' 'Button').index; mouse_button='left'; click_count=1 }) 'Click during preview'
      Start-Sleep -Milliseconds 1500
      Call 'status' @{} | Out-Null
      $frames = @($script:events | Where-Object { $_.event -eq 'preview_frame' })
      Check ($frames.Count -gt 0) 'No preview frame arrived'
      $pictures = @($frames | Where-Object { $_.PSObject.Properties['image'] })
      Check ($pictures.Count -gt 0 -and $pictures[0].image.mediaType -eq 'image/jpeg' -and $pictures[0].image.width -le 960) ('Preview frames carry no picture: ' + (@($frames | Where-Object { -not $_.PSObject.Properties['image'] } | Select-Object -First 3) | ConvertTo-Json -Compress -Depth 4))
      Check ((Call 'preview.stop' @{}).stopped) 'Preview did not stop'
      Start-Sleep -Milliseconds 600
      Call 'status' @{} | Out-Null
      $script:events.Clear()
      Start-Sleep -Milliseconds 1500
      Call 'status' @{} | Out-Null
      Check (@($script:events | Where-Object { $_.event -eq 'preview_frame' }).Count -eq 0) 'Preview frames kept coming after stop'
    }
    Test 'a dialog that covers the window becomes the state, and closing it gives the window back' {
      $before = Look
      $result = Act @{ action='click'; element_index=(Find $before 'Open modal' 'Button').index; mouse_button='left'; click_count=1 }
      Delivered $result 'Opening the dialog'
      Check ($result.state.tree.window -eq 'Moxxy test modal') ('The state after the click is not the dialog: ' + $result.state.tree.window)
      $ok = Find $result.state 'OK' 'Button'
      Check ($null -ne $ok) 'The dialog button is not listed'
      $closed = Act @{ action='click'; element_index=$ok.index; mouse_button='left'; click_count=1 }
      Delivered $closed 'Closing the dialog'
      Check ($closed.state.tree.window -eq 'Moxxy Computer Use Test') ('The state after closing is not the main window: ' + $closed.state.tree.window)
      Check ((Find (Look) 'Save' 'Button').index -eq (Find $before 'Save' 'Button').index) 'The main window lost its indices while the dialog was open'
    }
    Test 'a control that appears later is in the next state' {
      Start-Sleep -Milliseconds 1700
      Check ($null -ne (Find (Look) 'Delayed button')) 'Dynamically added control not observed'
    }
    Test 'a moved window refuses points and indices of the old state' {
      $state = Look
      $canvas = Find $state 'Canvas'
      $before=Fixture-State
      Delivered (Act @{ action='click'; element_index=(Find $state 'Move later' 'Button').index; mouse_button='left'; click_count=1 }) 'Arming the move'
      Start-Sleep -Milliseconds 3400
      $stale = Act (@{ action='click'; mouse_button='left'; click_count=1 } + (Middle $canvas))
      Check ($stale.result.outcome -eq 'blocked' -and $stale.result.code -eq 'stale_state') ('A point of the old picture was used: ' + ($stale.result | ConvertTo-Json -Compress))
      Check ((Fixture-State).left -eq $before.left) 'The refused click reached the canvas'
      Check ($stale.PSObject.Properties['state']) 'No fresh state came back with the refusal'
      Delivered (Act (@{ action='click'; mouse_button='left'; click_count=1 } + (Middle (Find $script:state 'Canvas')))) 'Click on the fresh state'
      Check ((Fixture-State).left -eq $before.left+1) 'The click on the fresh state did not reach the canvas'
    }
    Test 'a second helper cannot control the desktop at the same time' {
      $other=Start-Peer
      try {
        $busy=Request $other 'get_app_state' @{ app=$script:app; screenshot=$false }
        Check (-not $busy.ok -and $busy.error.code -eq 'control-busy') 'Concurrent desktop control accepted'
      } finally { Close-Peer $other }
    }
    Test 'pause holds an action, and resuming does nothing but report it' {
      try {
        $before=(Fixture-State).saves
        $index=(Find (Look) 'Save' 'Button').index
        Control $script:helper 'pause'
        $id = Send $script:helper 'act' @{ app=$script:app; action=@{ action='click'; element_index=$index; mouse_button='left'; click_count=1 }; allowed=@($script:app) }
        $paused = $null
        for ($i=0; $i -lt 10 -and $null -eq $paused; $i++) {
          $frame = Read-Frame $script:helper 5000
          if ($null -eq $frame) { break }
          if ($frame.PSObject.Properties['event'] -and $frame.event -eq 'control_state') { $paused = $frame }
        }
        Check ($null -ne $paused -and $paused.id -eq $id -and $paused.event -eq 'control_state' -and $paused.state -eq 'paused_by_user') 'Explicit pause was not honored'
        # Cursor and preview events may still arrive; an answer to the held request may not.
        $until=[DateTime]::UtcNow.AddMilliseconds(1200)
        while ([DateTime]::UtcNow -lt $until) {
          $frame = Read-Frame $script:helper 200
          Check ($null -eq $frame -or $frame.PSObject.Properties['event']) ('Pause ended by itself: ' + ($frame | ConvertTo-Json -Compress -Depth 6))
        }
        Check ((Fixture-State).saves -eq $before) 'Input was sent while paused'
        Control $script:helper 'resume'
        $response = Await $script:helper $id
        Check ($response.ok -and $response.result.result.outcome -eq 'blocked' -and $response.result.result.code -eq 'user_intervened') ('The paused action was not reported as interrupted: ' + ($response.result.result | ConvertTo-Json -Compress))
        Check ((Fixture-State).saves -eq $before) 'The paused click was replayed after resume'
        Delivered (Act @{ action='click'; element_index=$index; mouse_button='left'; click_count=1 }) 'Click after resume'
        Check ((Fixture-State).saves -eq $before+1) 'Control did not come back after resume'
      } finally { Close-Peer $script:helper; Attach | Out-Null }
    }
    Test 'take over releases held input, hides the cursor and pauses' {
      try {
        $canvas = Find (Look) 'Canvas'
        Delivered (Act (@{ action='mouse'; event='down'; mouse_button='left' } + (Middle $canvas))) 'Press'
        Check ((Fixture-State).leftDown) 'The button is not held before the take over'
        $script:events.Clear()
        Control $script:helper 'takeover'
        Start-Sleep -Milliseconds 400
        Check (-not (Fixture-State).leftDown) 'The held button was not released when the user took over'
        $id = Send $script:helper 'act' @{ app=$script:app; action=@{ action='click'; element_index=(Find $script:state 'Save' 'Button').index; mouse_button='left'; click_count=1 }; allowed=@($script:app) }
        $seen = @()
        for ($i=0; $i -lt 10; $i++) {
          $frame = Read-Frame $script:helper 3000
          if ($null -eq $frame) { break }
          $seen += $frame
          if ($frame.PSObject.Properties['event'] -and $frame.event -eq 'control_state') { break }
        }
        Check (@($seen | Where-Object { $_.PSObject.Properties['event'] -and $_.event -eq 'cursor' -and $null -eq $_.cursor }).Count -gt 0) 'The cursor was not hidden'
        Check (@($seen | Where-Object { $_.PSObject.Properties['event'] -and $_.event -eq 'control_state' -and $_.state -eq 'paused_by_user' }).Count -eq 1) 'Take over did not pause the next action'
        Control $script:helper 'resume'
        $response = Await $script:helper $id
        Check ($response.ok -and $response.result.result.code -eq 'user_intervened') 'The action held by the take over was not reported as interrupted'
      } finally { Close-Peer $script:helper; Attach | Out-Null }
    }
    Test 'closing the connection during a drag releases the button and the desktop' {
      $canvas = Find (Look) 'Canvas'
      $from = Middle $canvas -150 -30; $to = Middle $canvas 120 20
      Send $script:helper 'act' @{ app=$script:app; allowed=@($script:app); action=@{ action='drag'; path=@(@($from.x,$from.y), @($to.x,$to.y)); duration_ms=3000; mouse_button='left' } } | Out-Null
      Start-Sleep -Milliseconds 700
      Check ((Fixture-State).leftDown) 'The drag never held the button'
      $script:helper.StandardInput.Close()
      Check ($script:helper.WaitForExit(3000)) 'Cancelled helper did not exit'
      Check (-not (Fixture-State).leftDown) 'Mouse button remained held after cancellation'
      Check ((Attach).tree.elements.Count -gt 5) 'Desktop lease not released on cancellation'
    }
    Test 'killing the helper during a drag releases only its held input' {
      $canvas = Find (Look) 'Canvas'
      $from = Middle $canvas -150 -30; $to = Middle $canvas 120 20
      Send $script:helper 'act' @{ app=$script:app; allowed=@($script:app); action=@{ action='drag'; path=@(@($from.x,$from.y), @($to.x,$to.y)); duration_ms=3000; mouse_button='left' } } | Out-Null
      Start-Sleep -Milliseconds 700
      Check ((Fixture-State).leftDown) 'Crash test never reached held mouse input'
      $script:helper.Kill(); Check ($script:helper.WaitForExit(3000)) 'Worker did not terminate'
      Start-Sleep -Milliseconds 500
      Check (-not (Fixture-State).leftDown) 'Hard worker termination left injected mouse button held'
    }
    Test 'guardian panel exposes working accessible pause resume and stop buttons' {
      Attach | Out-Null
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
        Close-Peer $script:helper
      }
    }
    Test 'the stop command ends the helper as a user stop' {
      Attach | Out-Null
      Control $script:helper 'stop'
      Check ($script:helper.WaitForExit(3000)) 'Stop left the helper running'
      Check ($script:helper.ExitCode -eq 20) 'Stop was reported as a crash rather than an explicit user stop'
    }
    if ($TestInstalledApps) {
      Test 'an installed app is found by name, started on request and typed into' {
        if ($script:helper) { Close-Peer $script:helper }
        $script:helper=Start-Peer
        $apps=(Call 'list_apps' @{ query='notepad'; limit=20 }).apps
        $notepad=@($apps | Where-Object name -eq 'Notepad')[0]
        Check ($null -ne $notepad) ('Notepad is not in the app list: ' + ($apps | ConvertTo-Json -Compress -Depth 4))
        $named=(Call 'resolve_apps' @{ names=@('Notepad') }).apps[0]
        Check ($named.status -eq 'resolved' -and $named.id -eq $notepad.id) 'The display name did not resolve to the listed app'
        $unknown = Request $script:helper 'get_app_state' @{ app='notepad.exe & echo unexpected'; screenshot=$false }
        Check (-not $unknown.ok -and $unknown.error.code -eq 'app_not_found') ('Unresolved command text was accepted: ' + ($unknown | ConvertTo-Json -Compress -Depth 4))
        $oldPids=@(Get-Process -Name notepad -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        try {
          Write-Host 'Real Notepad: start and observe'
          $state=Call 'get_app_state' @{ app=$notepad.id; screenshot=$true }
          $editor=@($state.tree.elements | Where-Object { $_.role -in @('Edit','Document') -and -not ($_.PSObject.Properties['states'] -and $_.states -contains 'disabled') })[0]
          Check ($null -ne $editor) ('Notepad editor was not discovered: ' + ($state.tree | ConvertTo-Json -Compress -Depth 4))
          $expected='Za'+[char]0x17C+[char]0xF3+[char]0x142+[char]0x107+' g'+[char]0x119+[char]0x15B+'l'+[char]0x105+' ja'+[char]0x17A+[char]0x144+".`nTo jest test Moxxy na Windowsie.`nTrzecia linia: "+[char]0x2705
          Write-Host 'Real Notepad: type three lines'
          $typed=Call 'act' @{ app=$notepad.id; allowed=@($notepad.id); action=@{ action='type_text'; element_index=$editor.index; text=$expected } }
          Check ($typed.result.outcome -eq 'delivered') ('Typing into Notepad was not delivered: ' + ($typed.result | ConvertTo-Json -Compress))
          $after=@($typed.state.tree.elements | Where-Object index -eq $editor.index)[0]
          Check ($null -ne $after -and $after.value.Replace("`r",'') -ceq $expected) ('Real Notepad text mismatch: ' + ($after | ConvertTo-Json -Compress))
        } finally {
          # Only the Notepad this test started holds our unsaved text.
          Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object { $oldPids -notcontains $_.Id } | ForEach-Object { $_.Kill(); $_.WaitForExit(3000) | Out-Null }
          Close-Peer $script:helper
        }
      }
    } else { Record 'installed application launch' 'not-tested' 'Explicitly opt in with -TestInstalledApps; opens a new Notepad window.' }
    $exitCode=0
  }
} catch { Record 'test infrastructure/preflight' 'failed' $_.Exception.Message }
finally {
  foreach ($peer in $peers) { Close-Peer $peer; $peer.Dispose() }
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
