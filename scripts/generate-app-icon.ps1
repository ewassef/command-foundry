Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $root "assets"
$publicDir = Join-Path $root "public"
$pngPath = Join-Path $assetsDir "app-icon.png"
$icoPath = Join-Path $assetsDir "app-icon.ico"
$publicIcoPath = Join-Path $publicDir "app-icon.ico"

$size = 256
$bitmap = New-Object System.Drawing.Bitmap $size, $size
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$background = New-Object System.Drawing.Rectangle 0, 0, $size, $size
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  $background,
  [System.Drawing.Color]::FromArgb(255, 18, 28, 45),
  [System.Drawing.Color]::FromArgb(255, 38, 90, 122),
  45
)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 56
$diameter = $radius * 2
$path.AddArc(16, 16, $diameter, $diameter, 180, 90)
$path.AddArc($size - 16 - $diameter, 16, $diameter, $diameter, 270, 90)
$path.AddArc($size - 16 - $diameter, $size - 16 - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(16, $size - 16 - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()
$graphics.FillPath($gradient, $path)

$innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(35, 255, 255, 255))
$graphics.FillEllipse($innerBrush, 148, 28, 76, 76)

$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(52, 255, 255, 255), 3)
$graphics.DrawPath($pen, $path)

$fontFamily = New-Object System.Drawing.FontFamily "Segoe UI Semibold"
$font = New-Object System.Drawing.Font $fontFamily, 108, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 248, 255))
$layout = New-Object System.Drawing.RectangleF 0, 0, $size, $size
$graphics.DrawString("CF", $font, $textBrush, $layout, $format)

$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$stream = [System.IO.File]::Open($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Flush()
$writer.Dispose()
$stream.Dispose()

[System.IO.File]::Copy($icoPath, $publicIcoPath, $true)

$textBrush.Dispose()
$format.Dispose()
$font.Dispose()
$fontFamily.Dispose()
$pen.Dispose()
$innerBrush.Dispose()
$gradient.Dispose()
$path.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
