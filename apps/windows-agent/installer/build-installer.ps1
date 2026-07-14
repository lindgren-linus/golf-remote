param(
    [string]$Version = "0.1.0"
)

$ErrorActionPreference = "Stop"
$installerDir = $PSScriptRoot
$agentProject = Join-Path $installerDir "..\src\GolfRemote.Agent\GolfRemote.Agent.csproj"
$publishDir = Join-Path $installerDir "..\artifacts\publish"
$scriptPath = Join-Path $installerDir "GolfRemote.iss"
$isccCandidates = @(@(
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path $_) })

if (-not $isccCandidates)
{
    throw "Inno Setup 6 hittades inte. Installera det från https://jrsoftware.org/isdl.php och kör sedan skriptet igen."
}

dotnet publish $agentProject --configuration Release --runtime win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --output $publishDir

& $isccCandidates[0] "/DMyAppVersion=$Version" $scriptPath
if ($LASTEXITCODE -ne 0)
{
    throw "Inno Setup kunde inte skapa installationspaketet."
}

Write-Host "Klart: $(Join-Path $installerDir "..\artifacts\installer")"
