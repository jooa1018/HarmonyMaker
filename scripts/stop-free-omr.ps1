#requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ContainerName = "harmonymaker-audiveris"

function Find-DockerExecutable {
    $command = Get-Command -Name "docker" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $command) {
        return $command.Source
    }

    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles})) {
        $candidate = Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin\docker.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:LOCALAPPDATA})) {
        $candidate = Join-Path ${env:LOCALAPPDATA} "Programs\DockerDesktop\resources\bin\docker.exe"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "Docker CLI was not found. No containers were changed. Install or repair Docker Desktop, then rerun this script."
}

$DockerExecutable = Find-DockerExecutable

function Invoke-DockerCapture {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $script:DockerExecutable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

$engineProbe = Invoke-DockerCapture -Arguments @("info", "--format", "{{.ServerVersion}}")
if ($engineProbe.ExitCode -ne 0) {
    throw "Docker engine is not available, so no containers were changed. Start Docker Desktop and rerun this script."
}

$containerList = Invoke-DockerCapture -Arguments @("container", "ls", "--all", "--format", "{{.Names}}")
if ($containerList.ExitCode -ne 0) {
    $detail = ($containerList.Output | Out-String).Trim()
    throw ("Could not list Docker containers, so no containers were changed. Docker reported: {0}" -f $detail)
}
$containerNames = @($containerList.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" })
if ($containerNames -notcontains $ContainerName) {
    Write-Host ("Container '{0}' does not exist; nothing was stopped." -f $ContainerName)
    exit 0
}

$stateResult = Invoke-DockerCapture -Arguments @("container", "inspect", "--format", "{{.State.Status}}", $ContainerName)
if ($stateResult.ExitCode -ne 0) {
    $detail = ($stateResult.Output | Out-String).Trim()
    throw ("Could not inspect container '{0}'. Docker reported: {1}" -f $ContainerName, $detail)
}

$state = ([string]($stateResult.Output | Select-Object -First 1)).Trim()
if ($state -notin @("running", "restarting", "paused")) {
    Write-Host ("Container '{0}' is already stopped (state: {1})." -f $ContainerName, $state)
    exit 0
}

$stopResult = Invoke-DockerCapture -Arguments @("container", "stop", $ContainerName)
if ($stopResult.ExitCode -ne 0) {
    $detail = ($stopResult.Output | Out-String).Trim()
    throw ("Could not stop container '{0}'. Docker reported: {1}" -f $ContainerName, $detail)
}

Write-Host ("Stopped only container '{0}'. Docker Desktop and all other containers were left unchanged." -f $ContainerName)
