#requires -Version 5.1

[CmdletBinding()]
param(
    [ValidateRange(10, 900)]
    [int]$DockerStartupTimeoutSeconds = 180,

    [ValidateRange(10, 600)]
    [int]$HealthTimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ContainerName = "harmonymaker-audiveris"
$ImageName = "harmonymaker-audiveris"
$VolumeName = "harmonymaker-audiveris-data"
$ProviderUrl = "http://127.0.0.1:8001"
$ExpectedAudiverisVersion = "5.10.2"
$RepositoryRoot = Split-Path -Parent $PSScriptRoot

function Find-DockerExecutable {
    $command = Get-Command -Name "docker" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -ne $command) {
        return $command.Source
    }

    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles})) {
        $candidates += (Join-Path ${env:ProgramFiles} "Docker\Docker\resources\bin\docker.exe")
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:LOCALAPPDATA})) {
        $candidates += (Join-Path ${env:LOCALAPPDATA} "Programs\DockerDesktop\resources\bin\docker.exe")
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "Docker CLI was not found. Install or repair Docker Desktop, then rerun this script."
}

$DockerExecutable = Find-DockerExecutable

function Test-DockerEngine {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & $script:DockerExecutable info --format "{{.ServerVersion}}" 2>$null | Out-Null
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    return ($exitCode -eq 0)
}

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
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
    if ($exitCode -ne 0) {
        $detail = ($output | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($detail)) {
            throw $FailureMessage
        }
        throw ("{0} Docker reported: {1}" -f $FailureMessage, $detail)
    }
    return $output
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerEngine) {
        return
    }

    $desktopCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles})) {
        $desktopCandidates += (Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe")
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:LOCALAPPDATA})) {
        $desktopCandidates += (Join-Path ${env:LOCALAPPDATA} "Programs\DockerDesktop\Docker Desktop.exe")
        $desktopCandidates += (Join-Path ${env:LOCALAPPDATA} "Docker\Docker Desktop.exe")
    }

    $desktopExecutable = $desktopCandidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    $desktopProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
    if ($null -eq $desktopProcess) {
        if ([string]::IsNullOrWhiteSpace([string]$desktopExecutable)) {
            throw "Docker engine is not running and Docker Desktop could not be located. Start Docker Desktop, wait for the Linux engine, then rerun this script."
        }

        Write-Host "Docker engine is not running; starting Docker Desktop..."
        Start-Process -FilePath $desktopExecutable -WindowStyle Hidden | Out-Null
    }
    else {
        Write-Host "Docker Desktop is running; waiting for its Docker engine..."
    }

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    while ($timer.Elapsed.TotalSeconds -lt $DockerStartupTimeoutSeconds) {
        if (Test-DockerEngine) {
            Write-Host "Docker engine is ready."
            return
        }
        Start-Sleep -Seconds 3
    }

    throw ("Docker engine did not become ready within {0} seconds. Open Docker Desktop, confirm it is using Linux containers, and rerun this script." -f $DockerStartupTimeoutSeconds)
}

function Test-DockerNamedObjectExists {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("container", "image", "volume")]
        [string]$ObjectType,

        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    switch ($ObjectType) {
        "container" {
            $values = @(Invoke-Docker -Arguments @("container", "ls", "--all", "--format", "{{.Names}}") -FailureMessage "Could not list Docker containers.")
            return (@($values | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" }) -contains $Name)
        }
        "image" {
            $values = @(Invoke-Docker -Arguments @("image", "ls", "--format", "{{.Repository}}:{{.Tag}}") -FailureMessage "Could not list Docker images.")
            $references = @($values | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" })
            return (($references -contains $Name) -or ($references -contains ("{0}:latest" -f $Name)))
        }
        "volume" {
            $values = @(Invoke-Docker -Arguments @("volume", "ls", "--quiet") -FailureMessage "Could not list Docker volumes.")
            return (@($values | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne "" }) -contains $Name)
        }
    }
}

function Assert-LocalProviderApiKey {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Source
    )

    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -lt 32 -or $Value.Length -gt 512) {
        throw ("{0} must contain between 32 and 512 characters." -f $Source)
    }
    return $Value
}

function Get-LocalProviderApiKey {
    if (-not [string]::IsNullOrWhiteSpace(${env:OMR_AUDIVERIS_API_KEY})) {
        return (Assert-LocalProviderApiKey -Value ${env:OMR_AUDIVERIS_API_KEY} -Source "OMR_AUDIVERIS_API_KEY in the process environment")
    }

    $nodeEnvironment = if (${env:NODE_ENV} -in @("development", "production", "test")) { ${env:NODE_ENV} } else { "development" }
    $environmentFiles = @((Join-Path $RepositoryRoot (".env.{0}.local" -f $nodeEnvironment)))
    if ($nodeEnvironment -ne "test") {
        $environmentFiles += (Join-Path $RepositoryRoot ".env.local")
    }
    $environmentFiles += (Join-Path $RepositoryRoot (".env.{0}" -f $nodeEnvironment))
    $environmentFiles += (Join-Path $RepositoryRoot ".env")

    foreach ($environmentFile in $environmentFiles) {
        if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
            continue
        }

        foreach ($line in Get-Content -LiteralPath $environmentFile) {
            if ($line -notmatch '^\s*OMR_AUDIVERIS_API_KEY\s*=\s*(.*?)\s*$') {
                continue
            }

            $value = $Matches[1].Trim()
            if ($value.Length -ge 2) {
                $first = $value.Substring(0, 1)
                $last = $value.Substring($value.Length - 1, 1)
                if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
            }

            return (Assert-LocalProviderApiKey -Value $value -Source ("OMR_AUDIVERIS_API_KEY in {0}" -f $environmentFile))
        }
    }

    throw "No local OMR_AUDIVERIS_API_KEY was found. Complete the local configuration in an ignored .env.local file, then rerun this script."
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

function Assert-CompatibleExistingContainer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ExpectedApiKey
    )

    $image = (Invoke-Docker -Arguments @("container", "inspect", "--format", "{{.Config.Image}}", $ContainerName) -FailureMessage ("Could not inspect image configuration for container '{0}'." -f $ContainerName) | Select-Object -First 1).Trim()
    $hostConfigJson = (Invoke-Docker -Arguments @("container", "inspect", "--format", "{{json .HostConfig}}", $ContainerName) -FailureMessage ("Could not inspect port configuration for container '{0}'." -f $ContainerName) | Out-String).Trim()
    $mountsJson = (Invoke-Docker -Arguments @("container", "inspect", "--format", "{{json .Mounts}}", $ContainerName) -FailureMessage ("Could not inspect mount configuration for container '{0}'." -f $ContainerName) | Out-String).Trim()
    $containerEnvironment = @(Invoke-Docker -Arguments @("container", "inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", $ContainerName) -FailureMessage ("Could not inspect environment configuration for container '{0}'." -f $ContainerName) |
        ForEach-Object { ([string]$_).Trim() } |
        Where-Object { $_ -ne "" })

    try {
        $hostConfig = $hostConfigJson | ConvertFrom-Json -ErrorAction Stop
        $mounts = @($mountsJson | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        throw ("Docker returned unreadable configuration for container '{0}'. No container was changed." -f $ContainerName)
    }

    $problems = @()
    if ($image -notin @($ImageName, ("{0}:latest" -f $ImageName))) {
        $problems += "unexpected image reference"
    }

    $portProperty = $hostConfig.PortBindings.PSObject.Properties["8000/tcp"]
    $portBindings = @()
    if ($null -ne $portProperty -and $null -ne $portProperty.Value) {
        $portBindings = @($portProperty.Value)
    }
    $portMatches = $portBindings.Count -eq 1 -and
        [string]$portBindings[0].HostIp -eq "127.0.0.1" -and
        [string]$portBindings[0].HostPort -eq "8001"
    if (-not $portMatches) {
        $problems += "expected loopback port binding 127.0.0.1:8001 -> 8000/tcp is missing or ambiguous"
    }

    $dataMounts = @($mounts | Where-Object { [string]$_.Destination -eq "/data" })
    $mountMatches = $dataMounts.Count -eq 1 -and
        [string]$dataMounts[0].Type -eq "volume" -and
        [string]$dataMounts[0].Name -eq $VolumeName -and
        [bool]$dataMounts[0].RW
    if (-not $mountMatches) {
        $problems += "expected read-write volume harmonymaker-audiveris-data:/data is missing or ambiguous"
    }

    $durableEntries = @($containerEnvironment | Where-Object { [string]$_ -eq "HM_AUDIVERIS_DURABLE_STORAGE=1" })
    if ($durableEntries.Count -ne 1) {
        $problems += "durable-storage marker is missing or ambiguous"
    }
    $fakeEngineEntries = @($containerEnvironment | Where-Object { [string]$_ -eq "HM_AUDIVERIS_FAKE_ENGINE=1" })
    if ($fakeEngineEntries.Count -ne 0) {
        $problems += "fake-engine marker is enabled"
    }

    $apiKeyPrefix = "HM_AUDIVERIS_API_KEY="
    $apiKeyEntries = @($containerEnvironment | Where-Object { ([string]$_).StartsWith($apiKeyPrefix, [System.StringComparison]::Ordinal) })
    $apiKeyMatches = $apiKeyEntries.Count -eq 1 -and
        ([string]$apiKeyEntries[0]).Substring($apiKeyPrefix.Length) -ceq $ExpectedApiKey
    if (-not $apiKeyMatches) {
        $problems += "provider API key does not match the local HarmonyMaker configuration"
    }

    if ($problems.Count -ne 0) {
        throw ("Existing container '{0}' is not safe to reuse: {1}. No container was changed. Recreate only this container from the expected prebuilt image and rerun the script." -f $ContainerName, ($problems -join "; "))
    }
}

Start-DockerDesktopIfNeeded

$dockerOsType = (Invoke-Docker -Arguments @("info", "--format", "{{.OSType}}") -FailureMessage "Could not determine the Docker engine type." | Select-Object -First 1).Trim()
if ($dockerOsType -ne "linux") {
    throw ("Docker is using the '{0}' container engine. Switch Docker Desktop to Linux containers, wait for it to become ready, and rerun this script." -f $dockerOsType)
}

$providerApiKey = Get-LocalProviderApiKey

if (-not (Test-DockerNamedObjectExists -ObjectType "container" -Name $ContainerName)) {
    if (-not (Test-DockerNamedObjectExists -ObjectType "image" -Name $ImageName)) {
        throw ("Neither container '{0}' nor image '{1}' exists. This start script never rebuilds images; complete the documented first-time image setup, then rerun it." -f $ContainerName, $ImageName)
    }

    if (-not (Test-DockerNamedObjectExists -ObjectType "volume" -Name $VolumeName)) {
        Invoke-Docker -Arguments @("volume", "create", $VolumeName) -FailureMessage ("Could not create Docker volume '{0}'." -f $VolumeName) | Out-Null
    }

    $previousProviderApiKey = [Environment]::GetEnvironmentVariable("HM_AUDIVERIS_API_KEY", "Process")
    try {
        # Pass the secret through the child-process environment, never as a command-line value.
        [Environment]::SetEnvironmentVariable("HM_AUDIVERIS_API_KEY", $providerApiKey, "Process")
        Invoke-Docker -Arguments @(
            "container", "run", "--detach",
            "--name", $ContainerName,
            "--restart", "unless-stopped",
            "--publish", "127.0.0.1:8001:8000",
            "--env", "HM_AUDIVERIS_API_KEY",
            "--env", "HM_AUDIVERIS_DURABLE_STORAGE=1",
            "--env", "JAVA_TOOL_OPTIONS=-Xms128m -Xmx512m -Djava.awt.headless=true",
            "--volume", ("{0}:/data" -f $VolumeName),
            $ImageName
        ) -FailureMessage ("Could not create container '{0}' from the existing image." -f $ContainerName) | Out-Null
    }
    finally {
        [Environment]::SetEnvironmentVariable("HM_AUDIVERIS_API_KEY", $previousProviderApiKey, "Process")
    }

    Write-Host ("Created and started container '{0}' from the existing image." -f $ContainerName)
}
else {
    Assert-CompatibleExistingContainer -ExpectedApiKey $providerApiKey
    Invoke-Docker -Arguments @("container", "update", "--restart", "unless-stopped", $ContainerName) -FailureMessage ("Could not set restart policy on container '{0}'." -f $ContainerName) | Out-Null

    $state = (Invoke-Docker -Arguments @("container", "inspect", "--format", "{{.State.Status}}", $ContainerName) -FailureMessage ("Could not inspect container '{0}'." -f $ContainerName) | Select-Object -First 1).Trim()
    if ($state -ne "running") {
        Invoke-Docker -Arguments @("container", "start", $ContainerName) -FailureMessage ("Could not start container '{0}'." -f $ContainerName) | Out-Null
        Write-Host ("Started existing container '{0}'." -f $ContainerName)
    }
    else {
        Write-Host ("Container '{0}' is already running." -f $ContainerName)
    }
}

$healthUrl = "{0}/health" -f $ProviderUrl
$lastHealthResult = "No response received."
$healthConfigurationError = $null
$healthTimer = [System.Diagnostics.Stopwatch]::StartNew()
while ($healthTimer.Elapsed.TotalSeconds -lt $HealthTimeoutSeconds) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5 -ErrorAction Stop
        $status = Get-ResponseValue -Response $health -Name "status"
        $engine = Get-ResponseValue -Response $health -Name "engine"
        $version = Get-ResponseValue -Response $health -Name "audiverisVersion"
        $durableStorage = Get-ResponseValue -Response $health -Name "durableStorage"

        if ($status -eq "ok" -and $engine -eq "audiveris" -and $version -eq $ExpectedAudiverisVersion -and $durableStorage -eq "True") {
            $capabilities = Invoke-RestMethod -Uri ("{0}/v1/capabilities" -f $ProviderUrl) -Method Get -Headers @{ Authorization = ("Bearer {0}" -f $providerApiKey) } -TimeoutSec 5 -ErrorAction Stop
            $vendorId = Get-ResponseValue -Response $capabilities -Name "vendorId"
            if ($vendorId -ne "audiveris") {
                $healthConfigurationError = "The authenticated provider capability response did not identify the Audiveris vendor."
                break
            }
            Write-Host ("Audiveris OMR is healthy at {0} (Audiveris {1})." -f $ProviderUrl, $version)
            exit 0
        }

        $lastHealthResult = "status='{0}', engine='{1}', audiverisVersion='{2}', durableStorage='{3}'" -f $status, $engine, $version, $durableStorage
        if ($status -eq "ok" -and $engine -ne "audiveris") {
            $healthConfigurationError = "The provider answered /health but reported engine '$engine'; the real Audiveris engine is required."
            break
        }
        if ($status -eq "ok" -and $version -ne $ExpectedAudiverisVersion) {
            $healthConfigurationError = "The provider answered /health but reported Audiveris '$version'; version '$ExpectedAudiverisVersion' is required."
            break
        }
        if ($status -eq "ok" -and $durableStorage -ne "True") {
            $healthConfigurationError = "The provider answered /health but did not confirm durable storage."
            break
        }
    }
    catch {
        $lastHealthResult = $_.Exception.Message
    }

    Start-Sleep -Seconds 2
}

$containerState = "unknown"
try {
    $containerState = (Invoke-Docker -Arguments @("container", "inspect", "--format", "{{.State.Status}}", $ContainerName) -FailureMessage "Could not inspect the container after its health timeout." | Select-Object -First 1).Trim()
}
catch {
    $containerState = "unavailable"
}

if ($null -ne $healthConfigurationError) {
    throw ("{0} Container state: {1}. Recreate '{2}' from the correct prebuilt image and rerun this script." -f $healthConfigurationError, $containerState, $ContainerName)
}

throw ("Provider health verification failed after {0} seconds (container state: {1}; last result: {2}). Run 'docker logs --tail 100 {3}' for provider diagnostics, correct the reported issue, and rerun this script." -f $HealthTimeoutSeconds, $containerState, $lastHealthResult, $ContainerName)
