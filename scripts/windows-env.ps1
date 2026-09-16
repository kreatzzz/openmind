# Dot-source this file to prepare the current shell for Windows x64 builds.
# It does not install tools or change the user's persistent PATH.
$openmindVsWhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $openmindVsWhere)) {
    throw 'Install Visual Studio with the Desktop development with C++ workload first.'
}
$openmindVsPath = & $openmindVsWhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $openmindVsPath) {
    throw 'The Visual Studio C++ toolchain was not found. Install the Desktop development with C++ workload.'
}
Import-Module (Join-Path $openmindVsPath 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll') -ErrorAction Stop
Enter-VsDevShell -VsInstallPath $openmindVsPath -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' -ErrorAction Stop | Out-Null

$openmindPerlCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Openmind/toolchains/strawberry-perl-*/perl/bin/perl.exe'),
    'C:/Strawberry/perl/bin/perl.exe'
)
$openmindExistingPerl = Get-Command perl.exe -ErrorAction SilentlyContinue
if ($openmindExistingPerl) {
    $openmindPerlCandidates += $openmindExistingPerl.Source
}
$openmindPerlPath = $null
foreach ($openmindCandidate in $openmindPerlCandidates) {
    foreach ($openmindPerl in Get-ChildItem -Path $openmindCandidate -ErrorAction SilentlyContinue) {
        $openmindPerlPlatform = & $openmindPerl.FullName -MIPC::Cmd -e 'print $^O' 2>$null
        if ($LASTEXITCODE -eq 0 -and $openmindPerlPlatform -eq 'MSWin32') {
            $openmindPerlPath = $openmindPerl.DirectoryName
            break
        }
    }
    if ($openmindPerlPath) { break }
}
if (-not $openmindPerlPath) {
    throw 'A native Windows Perl with IPC::Cmd is required for vendored OpenSSL. Install Strawberry Perl; Git for Windows Perl is unsuitable.'
}
if (($env:PATH -split ';')[0] -ne $openmindPerlPath) {
    $env:PATH = $openmindPerlPath + ';' + $env:PATH
}
Write-Host 'Openmind Windows build environment ready for this shell.'
