$ErrorActionPreference='Stop'
$modulePath=Split-Path -Parent $PSScriptRoot
$dist=Join-Path $modulePath 'dist'
New-Item -ItemType Directory -Force -Path $dist|Out-Null
$target=Join-Path $dist 'mjl-campaign-journal.zip'
$files=@('module.json','README.md','VALIDATION.md','scripts','styles','art')|ForEach-Object{Join-Path $modulePath $_}
Compress-Archive -LiteralPath $files -DestinationPath $target -CompressionLevel Optimal -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($target)
try{
  if(-not($archive.Entries.FullName -contains 'module.json')){throw 'Archive root is invalid'}
  if($archive.Entries.FullName -match '^(dev|tests)/'){throw 'Test data in release archive'}
  foreach($entry in $archive.Entries){if($entry.Length -eq 0){throw "Empty entry: $($entry.FullName)"}}
  Write-Output "Verified $($archive.Entries.Count) release files"
}finally{$archive.Dispose()}
$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $dist 'SHA256SUMS.txt'),"$hash  mjl-campaign-journal.zip`n")
Write-Output $target
