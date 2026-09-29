# UI урьдчилан харах дэлгэцийн зураг (dev only): .\shot.ps1 -q "tab=games&theme=dark" -out C:\...\x.png [-w 1440 -h 860]
param([string]$q = "", [string]$out = "shot.png", [int]$w = 1440, [int]$h = 860)
$e = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$ud = Join-Path $env:TEMP ("gxshot-" + [guid]::NewGuid().ToString("N"))
$args2 = @('--headless=new', '--disable-gpu', '--disable-sync', '--disable-extensions', '--disable-features=msImplicitSignin', '--no-first-run',
  "--user-data-dir=$ud", '--hide-scrollbars', '--virtual-time-budget=4000', "--window-size=$w,$h", "--screenshot=$out", "http://127.0.0.1:4610/?$q")
Start-Process -FilePath $e -ArgumentList $args2 -Wait -WindowStyle Hidden | Out-Null
Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$ud*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
Remove-Item -Recurse -Force $ud -EA SilentlyContinue
