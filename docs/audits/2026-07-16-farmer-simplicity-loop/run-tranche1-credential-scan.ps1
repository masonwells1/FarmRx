param([string]$Base = '943e5688d05559e990d77390391d85975d4170b6')
$ErrorActionPreference = 'Stop'

$tracked = @(git diff --name-only $Base)
$untracked = @(git ls-files --others --exclude-standard)
$files = @($tracked + $untracked | Where-Object { $_ -and $_.Replace('\', '/') -notmatch '^docs/audits/' } | Sort-Object -Unique)
$binaryExtensions = @('.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.woff', '.woff2', '.ttf')
$patterns = [ordered]@{
  PrivateKeyBlock = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  SupabaseServiceRole = '(?i)(SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=])'
  CloudAccessKey = '(AKIA|ASIA)[A-Z0-9]{16}'
  AssignedSecret = '(?i)(api[_-]?key|client[_-]?secret|password|access[_-]?token|refresh[_-]?token)\s*[:=]\s*["''][^"''\r\n]{8,}["'']'
  JwtShape = 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
}

$findings = New-Object System.Collections.Generic.List[string]
foreach ($relative in $files) {
  $normalized = $relative.Replace('\', '/')
  if ($normalized.EndsWith('/run-tranche1-credential-scan.ps1', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
  if ($normalized -match '(^|/)\.env($|\.)|(?i)(secret|credential|private[-_]?key)') {
    $findings.Add("$normalized`tFilenameRisk")
  }
  $extension = [System.IO.Path]::GetExtension($relative).ToLowerInvariant()
  if ($binaryExtensions -contains $extension) { continue }
  try { $content = Get-Content -Raw -LiteralPath $relative -ErrorAction Stop } catch { continue }
  foreach ($entry in $patterns.GetEnumerator()) {
    if ($content -match $entry.Value) { $findings.Add("$normalized`t$($entry.Key)") }
  }
}

if ($findings.Count -eq 0) {
  Write-Output "CREDENTIAL_SCAN_PASS files=$($files.Count) findings=0"
} else {
  Write-Output "CREDENTIAL_SCAN_REVIEW files=$($files.Count) findings=$($findings.Count)"
  $findings | Sort-Object -Unique
}
