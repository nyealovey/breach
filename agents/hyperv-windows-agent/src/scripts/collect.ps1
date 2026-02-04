param(
  [Parameter(Mandatory = $true)]
  [string]$Endpoint,

  [Parameter(Mandatory = $false)]
  [ValidateSet('auto', 'standalone', 'cluster')]
  [string]$Scope = 'auto',

  [Parameter(Mandatory = $false)]
  [int]$MaxParallelNodes = 5
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

$resolvedScope = $Scope
$cluster = $null
$clusterName = $null

if ($resolvedScope -eq 'auto' -or $resolvedScope -eq 'cluster') {
  $cluster = Try-GetCluster $Endpoint
  if ($cluster) {
    $clusterName = $cluster.Name
    if ($resolvedScope -eq 'auto') { $resolvedScope = 'cluster' }
  } else {
    if ($resolvedScope -eq 'cluster') { throw 'endpoint is not a cluster' }
    $resolvedScope = 'standalone'
  }
}

$sbInventory = {
  $ErrorActionPreference = 'Stop'

  $hostName = $env:COMPUTERNAME
  $bios = $null
  try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
  $cs = $null
  try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
  $csp = $null
  try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
  $os = $null
  try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

  $host = [pscustomobject]@{
    hostname = $hostName
    host_uuid = if ($csp) { $csp.UUID } else { $null }
    serial_number = if ($bios) { $bios.SerialNumber } else { $null }
    vendor = if ($cs) { $cs.Manufacturer } else { $null }
    model = if ($cs) { $cs.Model } else { $null }
    os_name = if ($os) { $os.Caption } else { $null }
    os_version = if ($os) { $os.Version } else { $null }
    cpu_count = if ($cs) { $cs.NumberOfLogicalProcessors } else { $null }
    memory_bytes = if ($cs) { [int64]$cs.TotalPhysicalMemory } else { $null }
  }

  $vms = @(
    Get-VM -ErrorAction Stop | ForEach-Object {
      [pscustomobject]@{
        vm_id = [string]$_.VMId
        name = $_.Name
        state = $_.State.ToString()
        cpu_count = $_.ProcessorCount
        memory_bytes = [int64]$_.MemoryStartup
      }
    }
  )

  return [pscustomobject]@{ node = $hostName; host = $host; vms = $vms }
}

if ($resolvedScope -eq 'cluster') {
  if (-not $clusterName) {
    $cluster = Try-GetCluster $Endpoint
    if (-not $cluster) { throw 'endpoint is not a cluster' }
    $clusterName = $cluster.Name
  }

  $nodes = @(
    Get-ClusterNode -Cluster $cluster -ErrorAction Stop | ForEach-Object { $_.Name }
  )
  if (-not $nodes -or $nodes.Count -eq 0) {
    throw 'cluster has no nodes'
  }

  # Best-effort: map VM Name -> OwnerNode from cluster groups.
  $ownerRows = @()
  try {
    if (Get-Command Get-ClusterGroup -ErrorAction Stop) {
      $ownerRows = @(
        Get-ClusterGroup -Cluster $cluster -ErrorAction Stop | ForEach-Object {
          [pscustomobject]@{
            name = $_.Name
            group_type = $_.GroupType.ToString()
            owner_node = if ($_.OwnerNode) { $_.OwnerNode.Name } else { $null }
          }
        }
      )
    }
  } catch { $ownerRows = @() }

  $vmOwnerRows = @(
    $ownerRows |
      Where-Object { ($_.group_type -as [string]).ToLower().Contains('virtualmachine') } |
      ForEach-Object { [pscustomobject]@{ name = $_.name; owner_node = $_.owner_node } }
  )

  $throttle = if ($MaxParallelNodes -gt 0) { $MaxParallelNodes } else { 5 }

  $nodeResults = @(
    Invoke-Command -ComputerName $nodes -ScriptBlock $sbInventory -ThrottleLimit $throttle -ErrorAction Stop
  )

  [pscustomobject]@{
    scope = 'cluster'
    cluster_name = $clusterName
    nodes = $nodeResults
    owner_rows = $vmOwnerRows
  } | ConvertTo-Json -Compress -Depth 8
  exit 0
}

$inv = Invoke-Command -ComputerName $Endpoint -ScriptBlock $sbInventory -ErrorAction Stop
[pscustomobject]@{ scope = 'standalone'; host = $inv.host; vms = $inv.vms } | ConvertTo-Json -Compress -Depth 6
