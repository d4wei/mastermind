param([Parameter(Mandatory)][string]$Binary)
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$identifier = [Guid]::NewGuid().ToString('N')
$pipeName = "mastermind-launch-check-$identity-$identifier"
$user = 'mmcheck' + $identifier.Substring(0, 10)
$password = ConvertTo-SecureString ('Mm1!' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$shared = Join-Path $env:PUBLIC $identifier
$hostProcess = $null
$userCreated = $false
$oldId = $env:MM_LAUNCH_CHECK_ID
try {
    New-Item -ItemType Directory -Path $shared | Out-Null
    $client = Join-Path $shared 'client.ps1'
    @'
param([string]$PipeName)
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [System.IO.Pipes.PipeDirection]::InOut)
try {
    $pipe.Connect(3000)
    Write-Output 'Unexpected access to another user pipe'
    exit 1
} catch [System.UnauthorizedAccessException] {
    Write-Output 'Other-user pipe access denied'
    exit 0
} catch {
    Write-Error $_
    exit 2
} finally {
    $pipe.Dispose()
}
'@ | Set-Content -Encoding utf8 $client
    New-LocalUser -Name $user -Password $password -AccountExpires (Get-Date).AddDays(1) | Out-Null
    $userCreated = $true
    icacls $shared /grant "${user}:(OI)(CI)RX" | Out-Null
    if ($LASTEXITCODE) { throw 'Cannot grant the test user script access' }
    $env:MM_LAUNCH_CHECK_ID = $identifier
    $hostProcess = Start-Process -FilePath $Binary -ArgumentList 'host' -WindowStyle Hidden -PassThru
    $sameUser = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut)
    try { $sameUser.Connect(10000) } finally { $sameUser.Dispose() }
    $credential = [PSCredential]::new("$env:COMPUTERNAME\$user", $password)
    $other = Start-Process -FilePath 'powershell.exe' -Credential $credential -LoadUserProfile `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$client`"", '-PipeName', $pipeName) `
        -RedirectStandardOutput (Join-Path $shared 'stdout.txt') `
        -RedirectStandardError (Join-Path $shared 'stderr.txt') -PassThru
    if (-not $other.WaitForExit(15000)) { $other.Kill(); throw 'Other-user client timed out' }
    Get-Content (Join-Path $shared 'stdout.txt')
    if ($other.ExitCode -ne 0) {
        Get-Content (Join-Path $shared 'stderr.txt')
        throw "Other-user access check failed: $($other.ExitCode)"
    }
} finally {
    if ($hostProcess -and -not $hostProcess.HasExited) { $hostProcess.Kill(); $hostProcess.WaitForExit() }
    $env:MM_LAUNCH_CHECK_ID = $oldId
    if ($userCreated) { Remove-LocalUser -Name $user }
    if (Test-Path $shared) { Remove-Item -Recurse -Force $shared }
}
