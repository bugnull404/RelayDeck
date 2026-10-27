param(
    [string]$SdkPath,
    [string]$JavaPath,
    [string]$GradlePath,
    [string]$UpdateRepo
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskRelease = Get-Content -LiteralPath (Join-Path $taskRoot 'release.json') -Raw | ConvertFrom-Json
& (Join-Path $PSScriptRoot 'prepare-easytier.ps1')
function Find-TaskDirectory([string[]]$Candidates, [string]$Marker) {
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath (Join-Path $candidate $Marker))) { return $candidate }
    }
    return $null
}
function Find-TaskJava17([string[]]$Candidates) {
    foreach ($candidate in $Candidates) {
        if (-not $candidate -or -not (Test-Path -LiteralPath (Join-Path $candidate 'bin\java.exe'))) { continue }
        $release = Join-Path $candidate 'release'
        if (Test-Path -LiteralPath $release) {
            $versionLine = Select-String -LiteralPath $release -Pattern '^JAVA_VERSION="17(?:\.|")' | Select-Object -First 1
            if ($versionLine) { return $candidate }
        }
    }
    return $null
}
if (-not $SdkPath) {
    $SdkPath = Find-TaskDirectory @(
        (Join-Path $taskRoot '.local\toolchain\android-sdk'),
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
        'D:\Program Files\Android\SDK'
    ) 'platforms\android-35\android.jar'
}
$SdkPath = [System.IO.Path]::GetFullPath($SdkPath)
if (-not $JavaPath) {
    $taskJdks = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot '.local\toolchain\jdk17') -Directory -ErrorAction SilentlyContinue)
    $taskJavaCandidates = @($taskJdks.FullName) + @(
        $env:JAVA_HOME,
        'D:\Program Files\Android\Android Studio\jbr',
        'C:\Program Files\Android\Android Studio\jbr'
    )
    $JavaPath = Find-TaskJava17 $taskJavaCandidates
    if (-not $JavaPath -and $SdkPath) {
        $JavaPath = Find-TaskJava17 @((Join-Path $SdkPath 'JDK'))
    }
}
if (-not $GradlePath) {
    $taskWrapper = Join-Path $taskRoot 'android\gradlew.bat'
    if (Test-Path -LiteralPath $taskWrapper) { $GradlePath = $taskWrapper }
    else { $GradlePath = Join-Path $taskRoot '.local\gradle-8.9\gradle-8.9\bin\gradle.bat' }
}
if (-not $SdkPath) { throw '未找到 Android SDK，请用 -SdkPath 指定包含 platform 35 的目录' }
if (-not $JavaPath) { throw '未找到 JDK 17，请用 -JavaPath 指定 JDK 17 目录' }
if (-not (Test-Path -LiteralPath $GradlePath)) { throw '未找到 Gradle，请用 -GradlePath 指定 gradle.bat' }
$taskSigningDirectory = Join-Path $taskRoot '.local\secrets'
New-Item -ItemType Directory -Force -Path $taskSigningDirectory | Out-Null
$taskSigningKey = Join-Path $taskSigningDirectory 'android-debug.keystore'
if (-not (Test-Path -LiteralPath $taskSigningKey)) {
    & (Join-Path $JavaPath 'bin\keytool.exe') -genkeypair -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=RelayDeck Debug' -keystore $taskSigningKey -storepass android -keypass android
    if ($LASTEXITCODE -ne 0) { throw '无法创建本地调试签名' }
}
if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'platforms\android-35\android.jar'))) { throw '缺少 Android SDK platform 35' }
$env:JAVA_HOME = $JavaPath
# Some host PATH entries contain literal quotes; AGP forwards PATH into a JVM property.
# Normalize only this build process so a quoted entry cannot split the test worker command.
$env:PATH = $env:PATH.Replace('"', '')
$env:ANDROID_HOME = $SdkPath
$env:GRADLE_USER_HOME = Join-Path $taskRoot '.local\toolchain\gradle-home'
$taskAndroidBuild = Join-Path $taskRoot '.local\android-build\app'
$env:ANDROID_USER_HOME = Join-Path $taskRoot '.local\toolchain\android-user'
New-Item -ItemType Directory -Force -Path $env:ANDROID_USER_HOME | Out-Null
$taskTemporary = Join-Path $taskRoot '.local\toolchain\tmp'
New-Item -ItemType Directory -Force -Path $taskTemporary | Out-Null
$env:TEMP = $taskTemporary
$env:TMP = $taskTemporary
$taskProperties = 'sdk.dir=' + $SdkPath.Replace('\', '/')
$taskProperties = -join ($taskProperties.ToCharArray() | ForEach-Object { if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ } })
Set-Content -LiteralPath (Join-Path $taskRoot 'android\local.properties') -Value $taskProperties -Encoding ascii
$taskResolvedBuild = [System.IO.Path]::GetFullPath($taskAndroidBuild)
if (-not $taskResolvedBuild.StartsWith([System.IO.Path]::GetFullPath($taskRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '构建清理目标不在项目内' }
$taskGradleArguments = @('-p',(Join-Path $taskRoot 'android'),"-PrelaydeckBuildDir=$taskAndroidBuild","-PrelaydeckStoreFile=$taskSigningKey",'-PrelaydeckStorePassword=android','-PrelaydeckKeyAlias=androiddebugkey','-PrelaydeckKeyPassword=android')
if ($UpdateRepo) {
    if ($UpdateRepo -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'UpdateRepo 必须使用 owner/repository 格式' }
    $taskGradleArguments += "-PrelaydeckUpdateRepo=$UpdateRepo"
}
$taskGradleArguments += @('--no-daemon','--console=plain','clean','compileDebugUnitTestJavaWithJavac','assembleDebug')
& $GradlePath @taskGradleArguments
if ($LASTEXITCODE -ne 0) { throw 'Android 构建失败' }
# Run the compiled JVM tests directly: Gradle 8.9's worker argfile cannot resolve
# this Windows workspace's non-ASCII classpaths. This still runs real JUnit tests.
$taskJsonJar = Get-ChildItem (Join-Path $env:GRADLE_USER_HOME 'caches\modules-2\files-2.1\com.vaadin.external.google\android-json\0.0.20131108.vaadin1') -Recurse -Filter '*.jar' | Select-Object -First 1
$taskJunitJar = Get-ChildItem (Join-Path $env:GRADLE_USER_HOME 'caches\modules-2\files-2.1\junit\junit\4.13.2') -Recurse -Filter '*.jar' | Select-Object -First 1
$taskHamcrestJar = Get-ChildItem (Join-Path $env:GRADLE_USER_HOME 'caches\modules-2\files-2.1\org.hamcrest\hamcrest-core\1.3') -Recurse -Filter '*.jar' | Select-Object -First 1
$taskQrJar = Get-ChildItem (Join-Path $env:GRADLE_USER_HOME 'caches\modules-2\files-2.1\com.google.zxing\core\3.5.4') -Recurse -Filter '*.jar' | Select-Object -First 1
$taskClasspath = @((Join-Path $taskAndroidBuild 'intermediates\javac\debug\compileDebugJavaWithJavac\classes'), (Join-Path $taskAndroidBuild 'intermediates\javac\debugUnitTest\compileDebugUnitTestJavaWithJavac\classes'), $taskJsonJar.FullName, $taskJunitJar.FullName, $taskHamcrestJar.FullName, $taskQrJar.FullName) -join ';'
& (Join-Path $JavaPath 'bin\java.exe') -cp $taskClasspath org.junit.runner.JUnitCore dev.relaydeck.mobile.MobileStateTest
if ($LASTEXITCODE -ne 0) { throw 'Android 状态逻辑测试失败' }
$taskOutput = Join-Path $taskRoot '.local\releases'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskApk = Join-Path $taskOutput ('relaydeck-' + $taskRelease.version + '.apk')
Copy-Item -LiteralPath (Join-Path $taskAndroidBuild 'outputs\apk\debug\app-debug.apk') -Destination $taskApk -Force
Write-Output $taskApk

