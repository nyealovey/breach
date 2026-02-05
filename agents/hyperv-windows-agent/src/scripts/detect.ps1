param(
  [Parameter(Mandatory = $true)]
  [string]$Endpoint,

  [Parameter(Mandatory = $false)]
  [ValidateSet('auto', 'standalone', 'cluster')]
  [string]$ConfiguredScope = 'auto'
)

$ErrorActionPreference = 'Stop'

function Get-WinRmSpnPrefix() {
  try {
    $p = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Client'
    $v = (Get-ItemProperty -Path $p -Name spn_prefix -ErrorAction Stop).spn_prefix
    if ([string]::IsNullOrWhiteSpace([string]$v)) { return $null }
    return [string]$v
  } catch { return $null }
}

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
$clusterName = if ($cluster) { $cluster.Name } else { $null }

$nodes = @()
if ($isCluster) {
  $nodes = @(
    Get-ClusterNode -Cluster $cluster -ErrorAction Stop | ForEach-Object { $_.Name }
  )
  if (-not $nodes -or $nodes.Count -eq 0) {
    throw 'cluster has no nodes'
  }
}

$targetHost = if ($isCluster) { $nodes[0] } else { $Endpoint }

$os = Invoke-Command -ComputerName $targetHost -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  try {
    Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1
  } catch { $null }
} -ErrorAction Stop

$isS2d = $null
if ($isCluster) {
  $isS2d = Invoke-Command -ComputerName $targetHost -ScriptBlock {
    $ErrorActionPreference = 'Stop'
    $val = $null
    try {
      if (Get-Command Get-ClusterS2D -ErrorAction SilentlyContinue) {
        $s2d = Get-ClusterS2D -ErrorAction Stop
        $val = [bool]$s2d.S2DEnabled
      }
    } catch { $val = $null }
    return $val
  } -ErrorAction Stop
}

$canListVms = Invoke-Command -ComputerName $targetHost -ScriptBlock {
  $ErrorActionPreference = 'Stop'
  $can = $false
  try {
    if (Get-Command Get-VM -ErrorAction Stop) { $null = Get-VM -ErrorAction Stop | Select-Object -First 1; $can = $true }
  } catch { $can = $false }
  return $can
} -ErrorAction Stop

$nodeCount = if ($isCluster) { $nodes.Count } else { $null }
$recommendedScope = if ($isCluster) { 'cluster' } else { 'standalone' }
$spnPrefix = Get-WinRmSpnPrefix

[pscustomobject]@{
  target_version = if ($os) { $os.Version } else { $null }
  winrm_client_spn_prefix = $spnPrefix
  capabilities = [pscustomobject]@{
    is_cluster = $isCluster
    cluster_name = $clusterName
    node_count = $nodeCount
    is_s2d = $isS2d
    can_list_vms = [bool]$canListVms
    can_map_vm_to_host = [bool]$canListVms
    recommended_scope = $recommendedScope
    configured_scope = $ConfiguredScope
  }
  driver = 'hyperv-agent-v1'
} | ConvertTo-Json -Compress -Depth 6
