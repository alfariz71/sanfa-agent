Add-Type -AssemblyName System.Drawing

$srcPath = "C:\AI\SanfaAgent-web\icon.png"
$srcBmp = [System.Drawing.Bitmap]::FromFile($srcPath)

function Resize-Bitmap($bmp, $width, $height) {
    $destRect = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
    $destImage = New-Object System.Drawing.Bitmap($width, $height)
    $destImage.SetResolution($bmp.HorizontalResolution, $bmp.VerticalResolution)
    $graphics = [System.Drawing.Graphics]::FromImage($destImage)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($bmp, $destRect, 0, 0, $bmp.Width, $bmp.Height, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    return $destImage
}

function Save-Ico($bmp, $icoPath) {
    # 256x256 icon
    $bmp256 = Resize-Bitmap $bmp 256 256
    $hIcon = $bmp256.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    $fileStream = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
    $icon.Save($fileStream)
    $fileStream.Close()
    $icon.Dispose()
    $bmp256.Dispose()
}

# 1. Update electron/assets/icon.png (512x512)
$bmp512 = Resize-Bitmap $srcBmp 512 512
$bmp512.Save("C:\AI\SanfaAgent-web\electron\assets\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp512.Dispose()
Write-Host "Updated electron/assets/icon.png"

# 2. Update electron/assets/tray-icon.png (32x32)
$bmp32 = Resize-Bitmap $srcBmp 32 32
$bmp32.Save("C:\AI\SanfaAgent-web\electron\assets\tray-icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp32.Dispose()
Write-Host "Updated electron/assets/tray-icon.png"

# 3. Update favicon.ico and electron/assets/icon.ico
Save-Ico $srcBmp "C:\AI\SanfaAgent-web\favicon.ico"
Write-Host "Updated favicon.ico"

Save-Ico $srcBmp "C:\AI\SanfaAgent-web\electron\assets\icon.ico"
Write-Host "Updated electron/assets/icon.ico"

# 4. Make an optimized favicon.png (128x128, lightweight for web browsers)
# Backup old high-res icon if needed, but icon.png is already 1920x1920
$bmp128 = Resize-Bitmap $srcBmp 128 128
$bmp128.Save("C:\AI\SanfaAgent-web\favicon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$bmp128.Dispose()
Write-Host "Updated favicon.png (optimized)"

$srcBmp.Dispose()
Write-Host "ALL ICONS GENERATED SUCCESSFULLY!"
