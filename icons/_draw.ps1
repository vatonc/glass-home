Add-Type -AssemblyName System.Drawing

# Renders the user-provided Chrome logo SVG (1024 viewBox) into 128/48/16 PNGs
# using headless Chrome, so the vector is rasterized at each exact size.

$svg = @'
<svg viewBox="0 0 1024 1024" width="%SIZE%" height="%SIZE%" fill="#5F6368" xmlns="http://www.w3.org/2000/svg"><path d="M503.68 285.976c4.266 0 8.619 0.17 12.8 0.427v-0.171l444.965-0.17C879.69 116.745 706.363 0 505.813 0 360.307 0 229.224 61.53 136.886 159.928L294.083 434.81c30.296-86.621 112.65-148.834 209.596-148.834z m-145.165 221.97c0 80.135 64.944 145.164 145.164 145.164s145.164-64.944 145.164-145.164-65.029-145.164-145.164-145.164-145.164 65.03-145.164 145.164z m189.712 217.448c-14.337 2.987-29.272 4.523-44.548 4.523-78.684 0-147.724-40.964-187.151-102.75l-0.427 0.341L85.511 224.36C31.491 304.836 0 401.612 0 505.813c0 244.5 173.497 448.464 404.002 495.572l-11.35-6.827 155.575-269.164z m442.746-362.782l-319.514 0.17c33.71 38.915 54.19 89.693 54.19 145.164 0 42.927-12.203 83.037-33.367 117.002l-222.654 385.227c11.948 0.853 23.981 1.45 36.185 1.45 279.32 0 505.813-226.493 505.813-505.812 0-49.754-7.254-97.8-20.653-143.201z"/></svg>
'@

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$browser = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw "no Chrome/Edge found for rasterizing the SVG" }

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path $env:TEMP ("glass-icon-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $work -Force | Out-Null

foreach ($size in 128, 48, 16) {
  $html = "<!doctype html><html><head><meta charset=`"utf-8`"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style></head><body>" + ($svg -replace "%SIZE%", $size) + "</body></html>"
  $htmlPath = Join-Path $work "icon.html"
  Set-Content -Path $htmlPath -Value $html -Encoding UTF8
  $shot = Join-Path $work "icon.png"
  Remove-Item $shot -Force -ErrorAction SilentlyContinue
  $url = "file:///" + ($htmlPath -replace "\\", "/")
  & $browser --headless=new --disable-gpu --hide-scrollbars --no-first-run --virtual-time-budget=1500 `
    --default-background-color=00000000 --user-data-dir="$work\profile" `
    --window-size="$size,$size" --screenshot="$shot" $url 2>$null | Out-Null
  Start-Sleep -Milliseconds 350
  if (-not (Test-Path $shot)) { throw "screenshot failed at $size" }
  $img = [System.Drawing.Image]::FromFile($shot)
  if ($img.Width -ne $size -or $img.Height -ne $size) { throw "unexpected size at $size : $($img.Width)x$($img.Height)" }
  $img.Dispose()
  Copy-Item $shot (Join-Path $dir "icon$size.png") -Force
}

Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
