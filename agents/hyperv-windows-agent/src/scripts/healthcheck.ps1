$ErrorActionPreference = 'Stop'

$canList = $false
try {
  if (Get-Command Get-VM -ErrorAction Stop) { $canList = $true }
} catch { $canList = $false }

$isCluster = $false
try {
  if (Get-Command Get-Cluster -ErrorAction Stop) { $null = Get-Cluster -ErrorAction Stop; $isCluster = $true }
} catch { $isCluster = $false }

[pscustomobject]@{ ok = $true; can_list_vms = $canList; is_cluster = $isCluster } | ConvertTo-Json -Compress

