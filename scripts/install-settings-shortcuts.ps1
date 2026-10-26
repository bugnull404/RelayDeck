param(
    [Parameter(Mandatory=$true)][string]$PluginDirectory,
    [string]$DataDirectory,
    [string]$ShortcutRoot
)
$ErrorActionPreference = 'Stop'
if (-not $DataDirectory) { $DataDirectory = Join-Path $env:LOCALAPPDATA 'RelayDeck' }
$taskOpen = Join-Path $PluginDirectory 'scripts\start-desktop-plugin.ps1'
if (-not (Test-Path -LiteralPath $taskOpen)) { throw '插件未完整安装，找不到设置启动程序' }
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$taskLauncher = Join-Path $DataDirectory 'open-settings.ps1'
# Store paths only. Each launch obtains a fresh capability; no token in shortcuts.
$taskLauncherText = "`$ErrorActionPreference = 'Stop'`n& '" + $taskOpen.Replace("'","''") + "' -DataDirectory '" + $DataDirectory.Replace("'","''") + "'`n"
[IO.File]::WriteAllText($taskLauncher,$taskLauncherText,[Text.UTF8Encoding]::new($true))
$taskPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskTargets = if ($ShortcutRoot) { @($ShortcutRoot) } else { @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'RelayDeck')) }
$taskShell = New-Object -ComObject WScript.Shell
foreach ($taskDirectory in $taskTargets) {
    New-Item -ItemType Directory -Force -Path $taskDirectory | Out-Null
    $taskShortcut = $taskShell.CreateShortcut((Join-Path $taskDirectory 'RelayDeck 设置.lnk'))
    $taskShortcut.TargetPath = $taskPowerShell
    $taskShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $taskLauncher + '"'
    $taskShortcut.WorkingDirectory = $DataDirectory
    $taskShortcut.Description = '打开 RelayDeck 设置：电脑连接、EasyTier、配对与设备管理'
    $taskShortcut.IconLocation = (Join-Path $env:SystemRoot 'System32\shell32.dll') + ',17'
    $taskShortcut.WindowStyle = 7
    $taskShortcut.Save()
}
Write-Output '已创建桌面和开始菜单入口：RelayDeck 设置。'

