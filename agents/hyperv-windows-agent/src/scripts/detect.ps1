param(
  [Parameter(Mandatory = $false)]
  [ValidateSet('auto', 'standalone', 'cluster')]
  [string]$ConfiguredScope = 'auto'
)

$ErrorActionPreference = 'Stop'

$os = $null
try {
  $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1
} catch { $os = $null }

$isCluster = $false
$clusterName = $null
$nodeCount = $null
try {
  if (Get-Command Get-Cluster -ErrorAction Stop) {
    $c = Get-Cluster -ErrorAction Stop
    $isCluster = $true
    $clusterName = $c.Name
    try { $nodeCount = (Get-ClusterNode -ErrorAction Stop | Measure-Object).Count } catch { $nodeCount = $null }
  }
} catch { $isCluster = $false }

$isS2d = $null
try {
  if ($isCluster -and (Get-Command Get-ClusterS2D -ErrorAction SilentlyContinue)) {
    $s2d = Get-ClusterS2D -ErrorAction Stop
    $isS2d = [bool]$s2d.S2DEnabled
  }
} catch { $isS2d = $null }

$canListVms = $false
try {
  if (Get-Command Get-VM -ErrorAction Stop) { $null = Get-VM -ErrorAction Stop | Select-Object -First 1; $canListVms = $true }
} catch { $canListVms = $false }

$recommendedScope = if ($isCluster) { 'cluster' } else { 'standalone' }

[pscustomobject]@{
  target_version = if ($os) { $os.Version } else { $null }
  capabilities = [pscustomobject]@{
    is_cluster = $isCluster
    cluster_name = $clusterName
    node_count = $nodeCount
    is_s2d = $isS2d
    can_list_vms = $canListVms
    can_map_vm_to_host = $canListVms
    recommended_scope = $recommendedScope
    configured_scope = $ConfiguredScope
  }
  driver = 'hyperv-agent-v1'
} | ConvertTo-Json -Compress -Depth 6

