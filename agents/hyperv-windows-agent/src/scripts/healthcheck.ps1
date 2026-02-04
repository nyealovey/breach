param(
  [Parameter(Mandatory = $true)]
  [string]$Endpoint
)

$ErrorActionPreference = 'Stop'

function Try-GetCluster([string]$Name) {
  try {
    if (Get-Command Get-Cluster -ErrorAction Stop) {
      return Get-Cluster -Name $Name -ErrorAction Stop
    }
  } catch { return $null }
  return $null
}

$cluster = Try-GetCluster $Endpoint
$isCluster = [bool]$cluster

$targetHost = $Endpoint
if ($isCluster) {
  $first = Get-ClusterNode -Cluster $cluster -ErrorAction Stop | Select-Object -First 1
  if ($first -and $first.Name) { $targetHost = $first.Name }
}

$canList = Invoke-Command -ComputerName $targetHost -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  $can = $false
  try {
    if (Get-Command Get-VM -ErrorAction Stop) { $can = $true }
  } catch { $can = $false }
  return $can
} -ErrorAction Stop

[pscustomobject]@{
  ok = $true
  can_list_vms = [bool]$canList
  is_cluster = $isCluster
} | ConvertTo-Json -Compress
