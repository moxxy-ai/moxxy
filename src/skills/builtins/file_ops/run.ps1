$ErrorActionPreference = "Stop"

# Built-in Skill: file_ops - Structured file manipulation
# Operations: read, write, patch, append, remove, ls, mkdir, tree

$action = $args[0]

function Do-Read {
    $file = $args[1]
    $start = [int]$args[2]
    $end = [int]$args[3]
    if (-not $file) {
        Write-Output "Usage: file_ops read <path> [start_line] [end_line]"
        exit 1
    }
    if (-not (Test-Path $file -PathType Leaf)) {
        Write-Output "Error: file not found: $file"
        exit 1
    }
    $lines = Get-Content $file
    if ($start -and $end) {
        $lines[($start-1)..($end-1)] | ForEach-Object { $_ }
    } elseif ($start) {
        $lines[($start-1)..($lines.Length-1)] | ForEach-Object { $_ }
    } else {
        Get-Content $file -Raw
    }
}

function Do-Write {
    $file = $args[1]
    $content = $args[2]
    if (-not $file -or -not $content) {
        Write-Output "Usage: file_ops write <path> <content>"
        exit 1
    }
    $dir = Split-Path $file -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($file, $content)
    $bytes = (Get-Item $file).Length
    Write-Output "Written $bytes bytes to $file"
}

function Do-Patch {
    $file = $args[1]
    $search = $args[2]
    $replace = $args[3]
    if (-not $file -or -not $search) {
        Write-Output "Usage: file_ops patch <path> <search_string> <replace_string>"
        exit 1
    }
    if (-not (Test-Path $file -PathType Leaf)) {
        Write-Output "Error: file not found: $file"
        exit 1
    }
    $content = Get-Content $file -Raw
    if ($content -notmatch [regex]::Escape($search)) {
        Write-Output "Error: search string not found in file"
        exit 1
    }
    $newContent = $content.Replace($search, $replace)
    [System.IO.File]::WriteAllText($file, $newContent)
    Write-Output "Patched successfully"
}

function Do-Append {
    $file = $args[1]
    $content = $args[2]
    if (-not $file -or -not $content) {
        Write-Output "Usage: file_ops append <path> <content>"
        exit 1
    }
    $dir = Split-Path $file -Parent
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    Add-Content -Path $file -Value $content
    Write-Output "Appended to $file"
}

function Do-Remove {
    $target = $args[1]
    if (-not $target) {
        Write-Output "Usage: file_ops remove <path>"
        exit 1
    }
    if (-not (Test-Path $target)) {
        Write-Output "Error: path not found: $target"
        exit 1
    }
    if (Test-Path $target -PathType Container) {
        Remove-Item $target -Recurse -Force
        Write-Output "Removed directory: $target"
    } else {
        Remove-Item $target -Force
        Write-Output "Removed file: $target"
    }
}

function Do-Ls {
    $dir = if ($args[1]) { $args[1] } else { "." }
    if (-not (Test-Path $dir -PathType Container)) {
        Write-Output "Error: directory not found: $dir"
        exit 1
    }
    Get-ChildItem $dir -Force | Format-Table Mode, Length, LastWriteTime, Name -AutoSize
}

function Do-Mkdir {
    $dir = $args[1]
    if (-not $dir) {
        Write-Output "Usage: file_ops mkdir <path>"
        exit 1
    }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Write-Output "Created directory: $dir"
}

function Do-Tree {
    $dir = if ($args[1]) { $args[1] } else { "." }
    $depth = if ($args[2]) { [int]$args[2] } else { 3 }
    if (-not (Test-Path $dir -PathType Container)) {
        Write-Output "Error: directory not found: $dir"
        exit 1
    }
    Get-ChildItem $dir -Recurse -Depth $depth | Select-Object -First 200 | ForEach-Object {
        $indent = "  " * ($_.FullName.Split([IO.Path]::DirectorySeparatorChar).Length - $dir.Split([IO.Path]::DirectorySeparatorChar).Length)
        "$indent$($_.Name)"
    }
}

switch ($action) {
    "read"   { Do-Read @args }
    "write"  { Do-Write @args }
    "patch"  { Do-Patch @args }
    "append" { Do-Append @args }
    "remove" { Do-Remove @args }
    "rm"     { Do-Remove @args }
    "ls"     { Do-Ls @args }
    "mkdir"  { Do-Mkdir @args }
    "tree"   { Do-Tree @args }
    default {
        Write-Output "Unknown action: $action"
        Write-Output "Available actions: read, write, patch, append, remove, ls, mkdir, tree"
        exit 1
    }
}
