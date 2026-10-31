param([string]$Profile, [string]$StateDir)
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskArguments = @((Join-Path $taskRoot 'bin\cli.js'), 'install')
if ($Profile) { $taskArguments += @('--profile', $Profile) }
if ($StateDir) { $taskArguments += @('--state-dir', $StateDir) }
& $taskNode @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'Patch checks failed; Claude was not started.' }
$taskPackage = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $taskPackage) { throw 'Store app not found. Start your Claude installation normally after patching.' }
$taskExecutable = Join-Path $taskPackage.InstallLocation 'app\Claude.exe'
# The visible window is the interactive app requested by the user.
Start-Process -FilePath $taskExecutable
