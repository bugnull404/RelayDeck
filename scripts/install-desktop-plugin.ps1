param([string]$CodexPath, [string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$taskBundle = $PSScriptRoot
$env:RELAYDECK_MANAGER_PORT = '29647'
if (-not (Test-Path -LiteralPath (Join-Path $taskBundle '.agents\plugins\marketplace.json'))) { throw '请从完整桌面插件发布包中运行此安装脚本' }
if (-not $CodexPath) {
    $taskCodexFiles = @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin') -Directory -ErrorAction SilentlyContinue | ForEach-Object { Get-Item -LiteralPath (Join-Path $_.FullName 'codex.exe') -ErrorAction SilentlyContinue } | Sort-Object LastWriteTime -Descending)
    if (-not $taskCodexFiles.Count) { throw '未检测到桌面 Codex，请用 -CodexPath 指定桌面内置 codex.exe' }
    $CodexPath = $taskCodexFiles[0].FullName
}
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:LOCALAPPDATA 'RelayDeck' }
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $DataDirectory /inheritance:r /grant:r ('*' + $taskSid + ':(OI)(CI)F') '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法保护插件数据目录' }
$taskConfiguration = Join-Path $DataDirectory 'config.local.json'
if (-not (Test-Path -LiteralPath $taskConfiguration)) {
    $taskConfig = [ordered]@{ mode='existing'; host=''; port=29443; name='Codex 电脑'; codexBinary=$CodexPath; threads=@(); allowSelectedChats=$false; autoStart=$false; easytier=@{name='';cidr='';peers=@();listenPort=11011;rpcPort=15899;devName='relaydeck-et'} }
    $taskConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $taskConfiguration -Encoding utf8
}$taskCurrentConfig = Get-Content -LiteralPath $taskConfiguration -Raw | ConvertFrom-Json
if (-not $taskCurrentConfig.codexBinary -or -not (Test-Path -LiteralPath $taskCurrentConfig.codexBinary)) {
    $taskCurrentConfig.codexBinary = $CodexPath
    $taskCurrentConfig | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $taskConfiguration -Encoding utf8
}
$taskSourcesJson = & $CodexPath plugin marketplace list --json
if ($LASTEXITCODE -ne 0) { throw '无法读取已有插件目录' }
$taskPriorSource = ($taskSourcesJson | ConvertFrom-Json).marketplaces | Where-Object { $_.name -eq 'relaydeck-local' } | Select-Object -First 1
$taskSourceChanged = $taskPriorSource -and ([IO.Path]::GetFullPath($taskPriorSource.root).TrimEnd('\') -ne [IO.Path]::GetFullPath($taskBundle).TrimEnd('\'))
if ($taskSourceChanged) {
    & $CodexPath plugin marketplace remove relaydeck-local --json | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '无法更新 RelayDeck 插件目录来源' }
}
if (-not $taskPriorSource -or $taskSourceChanged) {
    & $CodexPath plugin marketplace add $taskBundle --json
    if ($LASTEXITCODE -ne 0) {
        if ($taskSourceChanged) { & $CodexPath plugin marketplace add $taskPriorSource.root --json | Out-Null }
        throw '注册本地插件目录失败，已尝试恢复旧来源'
    }
}
$taskInstalledJson = & $CodexPath plugin add relaydeck-desktop@relaydeck-local --json
if ($LASTEXITCODE -ne 0) { throw '安装插件失败' }
$taskInstalledJson | Write-Output
$taskInstalled = $taskInstalledJson | ConvertFrom-Json
& (Join-Path $taskInstalled.installedPath 'scripts\prepare-desktop-native.ps1') -PluginDirectory $taskInstalled.installedPath
& (Join-Path $taskInstalled.installedPath 'scripts\install-settings-shortcuts.ps1') -PluginDirectory $taskInstalled.installedPath -DataDirectory $DataDirectory
& (Join-Path $taskInstalled.installedPath 'scripts\configure-desktop-autostart.ps1') -DataDirectory $DataDirectory -Start
Write-Output 'RelayDeck 桌面插件已安装。当前聊天可能需要刷新插件或在新的聊天中加载工具。'
Write-Output ('插件数据目录：' + $DataDirectory)



