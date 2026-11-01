param(
    [ValidateSet('check','install','restore')][string]$Action = 'check',
    [Parameter(Mandatory=$true)][string]$Manifest,
    [string]$Python
)
$ErrorActionPreference = 'Stop'
$taskManifest = (Resolve-Path -LiteralPath $Manifest).Path
$taskScript = Join-Path $PSScriptRoot 'install-native.py'
$taskPython = if ($Python) { (Resolve-Path -LiteralPath $Python).Path } else { (Get-Command python.exe -ErrorAction Stop).Source }
if ($Action -eq 'check') {
    & $taskPython $taskScript check --manifest $taskManifest
    if ($LASTEXITCODE -ne 0) { throw 'Verification failed. See check-result.json beside the manifest.' }
    return
}
$taskArguments = @($taskScript, $Action, '--manifest', $taskManifest)
$taskPrincipal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if ($taskPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    & $taskPython @taskArguments
    if ($LASTEXITCODE -ne 0) { throw 'Operation failed. See the result file beside the manifest.' }
} else {
    $taskQuotedArguments = @($taskArguments | ForEach-Object { '"' + $_ + '"' })
    $taskProcess = Start-Process -FilePath $taskPython -ArgumentList $taskQuotedArguments -Verb RunAs -WindowStyle Hidden -PassThru
    $taskProcess.WaitForExit()
    if ($taskProcess.ExitCode -ne 0) { throw 'Operation failed. See the result file beside the manifest.' }
}
Get-Content -LiteralPath (Join-Path (Split-Path -Parent $taskManifest) ($Action + '-result.json'))
