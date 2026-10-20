# clean-build-artifacts.ps1
# Cleans up accumulated electron-builder output.
#
# WHY: every packaging run creates a new folder under release\ and leaves a
# scratch folder under .tmp\. Each bundle contains a full copy of
# model.gguf (1.03 GB) + vision.gguf (0.41 GB), so one run costs
# roughly +2.5 to +4.5 GB. Without cleanup this eats tens of GB in days.
#
# USAGE:
#   powershell -ExecutionPolicy Bypass -File scripts\clean-build-artifacts.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\clean-build-artifacts.ps1 -Keep 2
#   powershell -ExecutionPolicy Bypass -File scripts\clean-build-artifacts.ps1 -WhatIf
#
# SUGGESTED package.json wiring:
#   "clean:builds": "powershell -ExecutionPolicy Bypass -File scripts/clean-build-artifacts.ps1",
#   "prepackage":   "npm run clean:builds"

param(
    [int]$Keep = 1,          # keep the N newest folders under release\
    [switch]$KeepTmp,        # keep .tmp entirely
    [switch]$WhatIf,         # report only, delete nothing
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "SilentlyContinue"

function Get-FreeGB {
    $d = Get-PSDrive C
    return [math]::Round($d.Free / 1GB, 2)
}

function Get-NewestWrite($path) {
    $t = [datetime]"1900-01-01"
    try {
        foreach ($f in [System.IO.Directory]::EnumerateFiles($path, "*", [System.IO.SearchOption]::AllDirectories)) {
            try {
                $fi = New-Object System.IO.FileInfo $f
                if ($fi.LastWriteTime -gt $t) { $t = $fi.LastWriteTime }
            } catch {}
        }
    } catch {}
    return $t
}

function Get-RunningExeNames {
    # process names whose executable lives inside this project
    $names = New-Object System.Collections.Generic.HashSet[string]
    Get-Process | ForEach-Object {
        $p = $null
        try { $p = $_.Path } catch {}
        if ($p -and $p.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $null = $names.Add($_.ProcessName)
        }
    }
    return $names
}

function Test-PackInUse($packPath, $runningNames) {
    $unpacked = Join-Path $packPath "win-unpacked"
    if (-not (Test-Path -LiteralPath $unpacked)) { return $false }
    foreach ($n in $runningNames) {
        if (Get-Process -Name $n -ErrorAction SilentlyContinue) { return $true }
    }
    return $false
}

Write-Host ""
Write-Host "=== electron-builder artifact cleanup ===" -ForegroundColor Cyan
Write-Host "root      : $Root"
Write-Host "keep last : $Keep release folder(s)"
if ($WhatIf) { Write-Host "mode      : DRY RUN (nothing will be deleted)" -ForegroundColor Yellow }
Write-Host ""

$before = Get-FreeGB
Write-Host ("free before: {0:N2} GB" -f $before) -ForegroundColor Gray

$running = Get-RunningExeNames
if ($running.Count -gt 0) {
    Write-Host ("running apps from this project: {0}" -f ($running -join ", ")) -ForegroundColor Yellow
    Write-Host "(their packages will be skipped)" -ForegroundColor Yellow
}

$skipped = 0

# ---------- 1. release\ : keep newest N ----------
$rel = Join-Path $Root "release"
if (Test-Path -LiteralPath $rel) {
    Write-Host ""
    Write-Host "[1/2] release\" -ForegroundColor White

    $items = @()
    foreach ($d in [System.IO.Directory]::EnumerateDirectories($rel)) {
        $items += [pscustomobject]@{
            Path   = $d
            Name   = (Split-Path $d -Leaf)
            Newest = (Get-NewestWrite $d)
        }
    }
    $items = $items | Sort-Object Newest -Descending

    $i = 0
    foreach ($it in $items) {
        $i++
        if ($i -le $Keep) {
            Write-Host ("  KEEP    {0}  ({1:MM-dd HH:mm})" -f $it.Name, $it.Newest) -ForegroundColor Green
            continue
        }
        if (Test-PackInUse $it.Path $running) {
            Write-Host ("  SKIP    {0}  (in use)" -f $it.Name) -ForegroundColor Yellow
            $skipped++
            continue
        }
        if ($WhatIf) {
            Write-Host ("  WOULD   {0}" -f $it.Name) -ForegroundColor DarkGray
            continue
        }
        try {
            Remove-Item -LiteralPath $it.Path -Recurse -Force -ErrorAction Stop
            Write-Host ("  DELETED {0}" -f $it.Name) -ForegroundColor DarkGray
        } catch {
            Write-Host ("  FAILED  {0}  ({1})" -f $it.Name, $_.Exception.Message) -ForegroundColor Red
            $skipped++
        }
    }
}

# ---------- 2. .tmp\ : purge scratch folders ----------
$tmp = Join-Path $Root ".tmp"
if (-not $KeepTmp -and (Test-Path -LiteralPath $tmp)) {
    Write-Host ""
    Write-Host "[2/2] .tmp\" -ForegroundColor White

    foreach ($d in [System.IO.Directory]::EnumerateDirectories($tmp)) {
        $name = Split-Path $d -Leaf
        $inUse = $false
        $probe = Join-Path $d "release"
        if (Test-Path -LiteralPath $probe) {
            foreach ($n in $running) {
                if (Get-Process -Name $n -ErrorAction SilentlyContinue) { $inUse = $true; break }
            }
        }
        if ($inUse) {
            Write-Host ("  SKIP    {0}  (in use)" -f $name) -ForegroundColor Yellow
            $skipped++
            continue
        }
        if ($WhatIf) {
            Write-Host ("  WOULD   {0}" -f $name) -ForegroundColor DarkGray
            continue
        }
        try {
            Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction Stop
            Write-Host ("  DELETED {0}" -f $name) -ForegroundColor DarkGray
        } catch {
            Write-Host ("  FAILED  {0}" -f $name) -ForegroundColor Red
            $skipped++
        }
    }

    if (-not $WhatIf) {
        foreach ($f in [System.IO.Directory]::EnumerateFiles($tmp)) {
            try { Remove-Item -LiteralPath $f -Force -ErrorAction Stop } catch {}
        }
    }
}

# ---------- summary ----------
$after = Get-FreeGB
Write-Host ""
Write-Host "=== done ===" -ForegroundColor Cyan
Write-Host ("before: {0:N2} GB    after: {1:N2} GB    freed: {2:N2} GB" -f $before, $after, ($after - $before)) -ForegroundColor Cyan
if ($skipped -gt 0) {
    Write-Host ("{0} item(s) skipped (in use or locked)" -f $skipped) -ForegroundColor Yellow
}
Write-Host ""
