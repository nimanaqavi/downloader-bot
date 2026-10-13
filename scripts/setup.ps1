$ErrorActionPreference = "Stop"

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

if (Test-Command "yt-dlp") {
    $version = & yt-dlp --version
    Write-Host "yt-dlp is already installed: $version"
} else {
    if (Test-Command "py") {
        $python = "py"
        $pythonArgs = @("-3")
    } elseif (Test-Command "python") {
        $python = "python"
        $pythonArgs = @()
    } else {
        throw "Python 3 is required. Install it from https://python.org and run this script again."
    }

    & $python @pythonArgs -m pip --version | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "pip is unavailable. Reinstall Python with pip enabled, then run this script again."
    }
    Write-Host "Installing yt-dlp with pip..."
    & $python @pythonArgs -m pip install --user -U yt-dlp
    if ($LASTEXITCODE -ne 0) { throw "yt-dlp installation failed." }
}

if (Test-Command "ffmpeg") {
    $version = (& ffmpeg -version 2>&1)[0]
    Write-Host "ffmpeg is already installed: $version"
} elseif (Test-Command "winget") {
    Write-Host "Installing ffmpeg with winget..."
    & winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg installation failed. See https://ffmpeg.org/download.html" }
} else {
    throw "winget was not found. Install ffmpeg from https://ffmpeg.org/download.html and add it to PATH."
}

Write-Host "Dependency setup complete. Open a new terminal so PATH changes take effect."
