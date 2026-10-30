# Build engine brand icons into icons/engines/*.png
# Sources are the engines' own favicons / official brand assets.
Add-Type -AssemblyName System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$dest = Join-Path $PSScriptRoot "engines"
$tmp = Join-Path $env:TEMP "gh-engines"
New-Item -ItemType Directory -Force -Path $dest, $tmp | Out-Null

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
function Get-Remote($url, $path) {
  Invoke-WebRequest -Uri $url -OutFile $path -TimeoutSec 30 -UserAgent $ua
}

# 1) real site favicons
Get-Remote "https://www.bing.com/favicon.ico" "$tmp\bing.ico"
Get-Remote "https://www.baidu.com/favicon.ico" "$tmp\baidu.ico"
Get-Remote "https://www.sogou.com/favicon.ico" "$tmp\sogou.ico"

# 2) official brand assets
Get-Remote "https://www.gstatic.com/images/branding/googleg/1x/googleg_standard_color_128dp.png" "$dest\google.png"
Get-Remote "https://cdn.jsdelivr.net/gh/edent/SuperTinyIcons@master/images/svg/duckduckgo.svg" "$tmp\duckduckgo.svg"

function Convert-Ico($src, $dst, $size) {
  $ico = New-Object System.Drawing.Icon($src, $size, $size)
  $bmp = $ico.ToBitmap()
  $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  "$(Split-Path $dst -Leaf)`t$($bmp.Width)x$($bmp.Height)"
  $bmp.Dispose()
  $ico.Dispose()
}

Convert-Ico "$tmp\bing.ico" "$dest\bing.png" 32
Convert-Ico "$tmp\baidu.ico" "$dest\baidu.png" 64
Convert-Ico "$tmp\sogou.ico" "$dest\sogou.png" 32

# 3) SVG -> PNG via headless Chrome (transparent background)
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  $svg = Get-Content "$tmp\duckduckgo.svg" -Raw
  $html = "<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{width:64px;height:64px;display:block}</style></head><body>$svg</body></html>"
  Set-Content -Path "$tmp\duckduckgo.html" -Value $html -Encoding UTF8
  $url = "file:///" + (("$tmp\duckduckgo.html") -replace '\\', '/')
  & $chrome --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=64,64 --screenshot="$dest\duckduckgo.png" $url | Out-Null
  "duckduckgo.png`t$((Get-Item "$dest\duckduckgo.png").Length)B"
} else {
  "chrome not found: duckduckgo.png skipped"
}

Get-ChildItem $dest | ForEach-Object { "$($_.Name)`t$($_.Length)B" }
