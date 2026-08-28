#requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ContainerName = "harmonymaker-audiveris"
$ProviderUrl = "http://127.0.0.1:8001"

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

    return $null
}

function Get-ResponseValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Response,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $property = $Response.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $null
    }
    return [string]$property.Value
}

function Invoke-DockerCapture {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DockerExecutable,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = @(& $DockerExecutable @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output }
}

$dockerExecutable = Find-DockerExecutable
$dockerStatus = "unavailable (Docker CLI not found)"
$containerExists = "unknown"
$containerState = "unknown"
$restartPolicy = "unknown"
$containerImage = "unknown"

if ($null -ne $dockerExecutable) {
    $serverResult = Invoke-DockerCapture -DockerExecutable $dockerExecutable -Arguments @("info", "--format", "{{.ServerVersion}}|{{.OSType}}")
    if ($serverResult.ExitCode -eq 0) {
        $serverParts = ([string]($serverResult.Output | Select-Object -First 1)).Trim().Split('|')
        $serverVersion = $serverParts[0]
        $serverOsType = if ($serverParts.Count -ge 2) { $serverParts[1] } else { "unknown engine type" }
        $dockerStatus = "available (server {0}, {1} containers)" -f $serverVersion, $serverOsType

        $containerList = Invoke-DockerCapture -DockerExecutable $dockerExecutable -Arguments @("container", "ls", "--all", "--format", "{{.Names}}")
        if ($containerList.ExitCode -eq 0) {
            $containerNames = @($containerList.Output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" })
            if ($containerNames -contains $ContainerName) {
                $containerExists = "yes"
                $inspectResult = Invoke-DockerCapture -DockerExecutable $dockerExecutable -Arguments @("container", "inspect", "--format", "{{.State.Status}}|{{.HostConfig.RestartPolicy.Name}}|{{.Config.Image}}", $ContainerName)
                if ($inspectResult.ExitCode -eq 0) {
                    $parts = ([string]($inspectResult.Output | Select-Object -First 1)).Trim().Split('|')
                    if ($parts.Count -ge 3) {
                        $containerState = $parts[0]
                        $restartPolicy = $parts[1]
                        $containerImage = $parts[2]
                    }
                    else {
                        $containerState = "inspect output could not be parsed"
                        $restartPolicy = "unknown"
                        $containerImage = "unknown"
                    }
                }
                else {
                    $containerState = "inspect failed"
                    $restartPolicy = "unknown"
                    $containerImage = "unknown"
                }
            }
            else {
                $containerExists = "no"
                $containerState = "absent"
                $restartPolicy = "not applicable"
                $containerImage = "not applicable"
            }
        }
        else {
            $containerExists = "unknown (Docker query failed)"
            $containerState = "unknown"
            $restartPolicy = "unknown"
            $containerImage = "unknown"
        }
    }
    else {
        $dockerStatus = "unavailable (Docker engine not responding)"
    }
}

$providerHealth = "unavailable"
$providerEngine = "unavailable"
$audiverisVersion = "unavailable"
$durableStorage = "unavailable"
try {
    $health = Invoke-RestMethod -Uri ("{0}/health" -f $ProviderUrl) -Method Get -TimeoutSec 5 -ErrorAction Stop
    $statusValue = Get-ResponseValue -Response $health -Name "status"
    $engineValue = Get-ResponseValue -Response $health -Name "engine"
    $versionValue = Get-ResponseValue -Response $health -Name "audiverisVersion"
    $durableValue = Get-ResponseValue -Response $health -Name "durableStorage"

    $providerHealth = if ([string]::IsNullOrWhiteSpace($statusValue)) { "response missing status" } else { $statusValue }
    $providerEngine = if ([string]::IsNullOrWhiteSpace($engineValue)) { "response missing engine" } else { $engineValue }
    $audiverisVersion = if ([string]::IsNullOrWhiteSpace($versionValue)) { "response missing audiverisVersion" } else { $versionValue }
    $durableStorage = if ([string]::IsNullOrWhiteSpace($durableValue)) { "response missing durableStorage" } else { $durableValue }
}
catch {
    $providerHealth = "unreachable ({0})" -f $_.Exception.Message
}

Write-Output ("DOCKER_ENGINE = {0}" -f $dockerStatus)
Write-Output ("CONTAINER_NAME = {0}" -f $ContainerName)
Write-Output ("CONTAINER_EXISTS = {0}" -f $containerExists)
Write-Output ("CONTAINER_STATE = {0}" -f $containerState)
Write-Output ("CONTAINER_IMAGE = {0}" -f $containerImage)
Write-Output ("RESTART_POLICY = {0}" -f $restartPolicy)
Write-Output ("PROVIDER_URL = {0}" -f $ProviderUrl)
Write-Output ("PROVIDER_HEALTH = {0}" -f $providerHealth)
Write-Output ("PROVIDER_ENGINE = {0}" -f $providerEngine)
Write-Output ("AUDIVERIS_VERSION = {0}" -f $audiverisVersion)
Write-Output ("DURABLE_STORAGE = {0}" -f $durableStorage)
