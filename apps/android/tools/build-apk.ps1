param([switch]$DebugBuild)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectDirectory
$sdkDirectory = $env:ANDROID_HOME
if (-not $sdkDirectory) { throw '请设置 ANDROID_HOME' }
$jdkDirectory = $env:JAVA_HOME
if (-not $jdkDirectory) { throw '请设置 JAVA_HOME' }
$buildToolsDirectory = Join-Path $sdkDirectory 'build-tools\36.1.0'
$platformJar = Join-Path $sdkDirectory 'platforms\android-35\android.jar'
foreach ($required in @($platformJar, (Join-Path $buildToolsDirectory 'aapt2.exe'), (Join-Path $jdkDirectory 'bin\javac.exe'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw "缺少构建工具：$required" }
}
function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "构建命令失败：$Executable" }
}
$buildDirectory = Join-Path $projectDirectory 'build'
$localDirectory = Join-Path $projectDirectory '.local'
foreach ($generatedDirectory in @('assets', 'classes', 'generated', 'dex')) {
    $generatedPath = [System.IO.Path]::GetFullPath((Join-Path $buildDirectory $generatedDirectory))
    if (-not $generatedPath.StartsWith($buildDirectory + [System.IO.Path]::DirectorySeparatorChar)) { throw '构建目录不在项目范围内' }
    if (Test-Path -LiteralPath $generatedPath) { Remove-Item -LiteralPath $generatedPath -Recurse -Force }
}
foreach ($directory in @('build', 'build\classes', 'build\generated', 'build\dex', 'build\deps', '.local')) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Invoke-Checked 'node' @('tools/build-web.mjs')
$dependencies = @(
    @{ Name = 'android-mail-1.6.7.jar'; Url = 'https://repo.maven.apache.org/maven2/com/sun/mail/android-mail/1.6.7/android-mail-1.6.7.jar' },
    @{ Name = 'android-activation-1.6.7.jar'; Url = 'https://repo.maven.apache.org/maven2/com/sun/mail/android-activation/1.6.7/android-activation-1.6.7.jar' }
)
foreach ($dependency in $dependencies) {
    $dependencyPath = Join-Path $buildDirectory "deps\$($dependency.Name)"
    if (-not (Test-Path -LiteralPath $dependencyPath)) { Invoke-WebRequest -Uri $dependency.Url -OutFile $dependencyPath }
}
$resourceDirectory = Join-Path $buildDirectory 'mail-resources'
New-Item -ItemType Directory -Force -Path $resourceDirectory | Out-Null
Push-Location -LiteralPath $resourceDirectory
try {
    Invoke-Checked (Join-Path $jdkDirectory 'bin/jar.exe') @('xf', (Join-Path $buildDirectory 'deps/android-mail-1.6.7.jar'), 'META-INF/mailcap', 'META-INF/javamail.default.providers', 'META-INF/javamail.charset.map', 'META-INF/javamail.default.address.map', 'META-INF/LICENSE.md', 'META-INF/NOTICE.md')
    Invoke-Checked (Join-Path $jdkDirectory 'bin/jar.exe') @('xf', (Join-Path $buildDirectory 'deps/android-activation-1.6.7.jar'), 'META-INF/mailcap.default', 'META-INF/mimetypes.default')
} finally { Pop-Location }
$manifest = if ($DebugBuild) { 'native/AndroidManifest.debug.xml' } else { 'native/AndroidManifest.xml' }
Invoke-Checked (Join-Path $buildToolsDirectory 'aapt2.exe') @('compile', '--dir', 'native/res', '-o', 'build/resources.zip')
Invoke-Checked (Join-Path $buildToolsDirectory 'aapt2.exe') @('link', '-o', 'build/base.apk', '-I', $platformJar, '--manifest', $manifest, '-A', 'build/assets', '--java', 'build/generated', 'build/resources.zip')
$dependencyJars = @(Get-ChildItem -LiteralPath 'build/deps' -Filter '*.jar' | ForEach-Object { $_.FullName })
$classpath = (@($platformJar) + $dependencyJars) -join ';'
$sourceFiles = @(Get-ChildItem -LiteralPath 'native/io','build/generated' -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
Invoke-Checked (Join-Path $jdkDirectory 'bin/javac.exe') (@('-encoding', 'UTF-8', '--release', '8', '-cp', $classpath, '-d', 'build/classes') + $sourceFiles)
$classFiles = @(Get-ChildItem -LiteralPath 'build/classes' -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Invoke-Checked (Join-Path $jdkDirectory 'bin/java.exe') (@('-cp', (Join-Path $buildToolsDirectory 'lib/d8.jar'), 'com.android.tools.r8.D8', '--lib', $platformJar, '--min-api', '26', '--output', 'build/dex') + $classFiles + $dependencyJars)
Invoke-Checked (Join-Path $jdkDirectory 'bin/jar.exe') @('uf', 'build/base.apk', '-C', 'build/dex', 'classes.dex')
Invoke-Checked (Join-Path $jdkDirectory 'bin/jar.exe') @('uf', 'build/base.apk', '-C', 'build/mail-resources', 'META-INF')
Invoke-Checked (Join-Path $buildToolsDirectory 'zipalign.exe') @('-f', '-p', '4', 'build/base.apk', 'build/aligned.apk')
$keyStore = Join-Path $localDirectory 'release.jks'
$passwordFile = Join-Path $localDirectory 'signing-password.txt'
if (-not (Test-Path -LiteralPath $keyStore)) {
    $passwordBytes = New-Object byte[] 32
    $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $randomGenerator.GetBytes($passwordBytes)
    $signingPassword = [Convert]::ToBase64String($passwordBytes)
    [System.IO.File]::WriteAllText($passwordFile, $signingPassword)
    Invoke-Checked (Join-Path $jdkDirectory 'bin/keytool.exe') @('-genkeypair', '-keystore', $keyStore, '-alias', 'anothertodo', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-storepass:file', $passwordFile, '-keypass:file', $passwordFile, '-dname', 'CN=AnotherTODO,OU=Android,O=AnotherTODO')
}
if (-not (Test-Path -LiteralPath $passwordFile)) { throw '签名密码文件不存在，请恢复 .local/signing-password.txt' }
$apkName = if ($DebugBuild) { 'AnotherTODO-debug.apk' } else { 'AnotherTODO.apk' }
$apkPath = Join-Path $buildDirectory $apkName
Invoke-Checked (Join-Path $buildToolsDirectory 'apksigner.bat') @('sign', '--ks', $keyStore, '--ks-key-alias', 'anothertodo', '--ks-pass', "file:$passwordFile", '--out', $apkPath, 'build/aligned.apk')
Invoke-Checked (Join-Path $buildToolsDirectory 'apksigner.bat') @('verify', '--verbose', $apkPath)
Get-Item -LiteralPath $apkPath | Select-Object FullName,Length
Get-FileHash -LiteralPath $apkPath -Algorithm SHA256 | Format-List Algorithm,Hash,Path
