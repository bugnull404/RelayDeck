param([Parameter(Mandatory=$true)][string]$PluginDirectory)
$ErrorActionPreference = 'Stop'
$taskBundle = Split-Path -Parent $PSScriptRoot
$taskReleasePath = @(
    (Join-Path $taskBundle 'release.json'),
    (Join-Path $taskBundle '..\release.json')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskReleasePath) { throw '找不到发布版本元数据 release.json' }
$taskRelease = Get-Content -LiteralPath $taskReleasePath -Raw | ConvertFrom-Json
$taskEasyTierVersion = [string]$taskRelease.easytierVersion
$taskDestination = Join-Path $PluginDirectory 'vendor\easytier\Packet.dll'
$taskExpected = 'C7C03A87EAC7243CCBE331554624B18803010B740E311FC8CFDDB573096EACAC'
if ((Test-Path -LiteralPath $taskDestination) -and (Get-FileHash -LiteralPath $taskDestination -Algorithm SHA256).Hash -eq $taskExpected) { return }
# Obtain the required Packet.dll directly from the official EasyTier archive
# for this user's installation; do not re-distribute it in our plugin ZIP.
$taskCache = Join-Path $env:LOCALAPPDATA ('RelayDeck\downloads\easytier-' + $taskEasyTierVersion)
New-Item -ItemType Directory -Force -Path $taskCache | Out-Null
$taskArchive = Join-Path $taskCache ('easytier-windows-x86_64-v' + $taskEasyTierVersion + '.zip')
if (-not (Test-Path -LiteralPath $taskArchive)) {
    Invoke-WebRequest ('https://github.com/EasyTier/EasyTier/releases/download/v' + $taskEasyTierVersion + '/easytier-windows-x86_64-v' + $taskEasyTierVersion + '.zip') -OutFile ($taskArchive + '.part')
    Move-Item -LiteralPath ($taskArchive + '.part') -Destination $taskArchive
}
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne '27AF91E270E554709B048BD32327FEFD2DFCE5062AE1E8701AF7550C6F525F84') { throw '官方 EasyTier 安装依赖摘要不匹配' }
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskCache -Force
$taskPacket = Join-Path $taskCache 'easytier-windows-x86_64\Packet.dll'
if ((Get-FileHash -LiteralPath $taskPacket -Algorithm SHA256).Hash -ne $taskExpected) { throw 'Packet.dll 摘要不匹配' }
Copy-Item -LiteralPath $taskPacket -Destination $taskDestination -Force
