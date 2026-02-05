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

function Map-ClusterNodePowerState([string]$State) {
  if ([string]::IsNullOrWhiteSpace([string]$State)) { return $null }
  $s = ([string]$State).Trim().ToLower()
  if ($s -eq 'up') { return 'poweredOn' }
  if ($s -eq 'down') { return 'poweredOff' }
  if ($s -eq 'paused') { return 'suspended' }
  return $null
}

$resolvedScope = $Scope
$cluster = $null
$clusterName = $null
$spnPrefix = Get-WinRmSpnPrefix

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

  function Format-MacAddress([string]$mac) {
    if ([string]::IsNullOrWhiteSpace($mac)) { return $null }
    $m = ([string]$mac).Trim() -replace '[-:]', ''
    $m = $m.ToLower()
    if ($m.Length -ne 12) { return $m }
    return ($m -replace '(.{2})(?=.)','$1:').TrimEnd(':')
  }

  $hostName = $env:COMPUTERNAME
  $bios = $null
  try { $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction Stop | Select-Object -First 1 } catch { $bios = $null }
  $cs = $null
  try { $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop | Select-Object -First 1 } catch { $cs = $null }
  $csp = $null
  try { $csp = Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop | Select-Object -First 1 } catch { $csp = $null }
  $os = $null
  try { $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop | Select-Object -First 1 } catch { $os = $null }

  $diskTotalBytes = $null
  try {
    $sum = [int64]0
    $seen = $false
    $drives = Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction Stop
    foreach ($d in $drives) {
      $size = $null
      try { $size = [int64]$d.Size } catch { $size = $null }
      if ($null -ne $size -and $size -gt 0) {
        $sum += $size
        $seen = $true
      }
    }
    if ($seen) { $diskTotalBytes = $sum }
  } catch { $diskTotalBytes = $null }

  $hostIps = @()
  $mgmtIp = $null
  try {
    if (Get-Command Get-NetIPAddress -ErrorAction SilentlyContinue) {
      $hostIps = @(
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
          ForEach-Object { $_.IPAddress } |
          Where-Object { $_ -and $_ -ne '127.0.0.1' -and $_ -ne '0.0.0.0' } |
          Sort-Object -Unique
      )
    }
  } catch { $hostIps = @() }

  try {
    $preferred = @($hostIps | Where-Object { -not $_.StartsWith('169.254.') } | Select-Object -First 1)
    if ($preferred -and $preferred.Count -gt 0) { $mgmtIp = $preferred[0] }
    if (-not $mgmtIp -and $hostIps.Count -gt 0) { $mgmtIp = $hostIps[0] }
  } catch { $mgmtIp = $null }

  $datastores = @()
  try {
    $datastores = @(
      Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction Stop |
        ForEach-Object {
          $name = [string]$_.DeviceID
          if ([string]::IsNullOrWhiteSpace([string]$name)) { return }
          $cap = $null
          try { $cap = [int64]$_.Size } catch { $cap = $null }
          if ($null -eq $cap -or $cap -lt 0) { return }
          [pscustomobject]@{ name = $name; capacity_bytes = $cap }
        } | Where-Object { $_ -ne $null }
    )
  } catch { $datastores = @() }

  # Best-effort: Cluster Shared Volumes (CSV) as datastores when available.
  try {
    if (Get-Command Get-ClusterSharedVolume -ErrorAction SilentlyContinue) {
      $volumes = $null
      try { $volumes = Get-CimInstance -ClassName Win32_Volume -ErrorAction Stop } catch { $volumes = $null }
      $csvs = Get-ClusterSharedVolume -ErrorAction Stop
      foreach ($csv in $csvs) {
        $path = $null
        try { $path = [string]$csv.SharedVolumeInfo.FriendlyVolumeName } catch { $path = $null }
        if ([string]::IsNullOrWhiteSpace([string]$path)) { continue }
        if ($null -eq $volumes) { continue }
        $vol = $volumes | Where-Object { $_.Name -eq $path -or $_.Name -eq ($path + '\') } | Select-Object -First 1
        if (-not $vol) { continue }
        $cap = $null
        try { $cap = [int64]$vol.Capacity } catch { $cap = $null }
        if ($null -eq $cap -or $cap -lt 0) { continue }
        $datastores += [pscustomobject]@{ name = $path; capacity_bytes = $cap }
      }
    }
  } catch { }

  # $Host is a built-in read-only variable in PowerShell, so don't overwrite it.
  $hostInfo = [pscustomobject]@{
    hostname = $hostName
    host_uuid = if ($csp) { $csp.UUID } else { $null }
    serial_number = if ($bios) { $bios.SerialNumber } else { $null }
    vendor = if ($cs) { $cs.Manufacturer } else { $null }
    model = if ($cs) { $cs.Model } else { $null }
    os_name = if ($os) { $os.Caption } else { $null }
    os_version = if ($os) { $os.Version } else { $null }
    cpu_count = if ($cs) { $cs.NumberOfLogicalProcessors } else { $null }
    memory_bytes = if ($cs) { [int64]$cs.TotalPhysicalMemory } else { $null }
    ip_addresses = $hostIps
    management_ip = $mgmtIp
    power_state = 'poweredOn'
    datastores = $datastores
    disk_total_bytes = $diskTotalBytes
  }

  $vms = @(
    Get-VM -ErrorAction Stop | ForEach-Object {
      $vmDisks = @()
      try {
        if (Get-Command Get-VMHardDiskDrive -ErrorAction SilentlyContinue) {
          $drives = Get-VMHardDiskDrive -VMId $_.VMId -ErrorAction Stop
          foreach ($drive in $drives) {
            if ([string]::IsNullOrWhiteSpace([string]$drive.Path)) { continue }
            $sizeBytes = $null
            try {
              if (Get-Command Get-VHD -ErrorAction SilentlyContinue) {
                $vhd = Get-VHD -Path $drive.Path -ErrorAction Stop
                $sizeBytes = [int64]$vhd.Size
              }
            } catch { $sizeBytes = $null }
            if ($null -eq $sizeBytes -or $sizeBytes -lt 0) { continue }

            $diskName = $null
            try {
              $ct = if ($drive.ControllerType) { $drive.ControllerType.ToString() } else { $null }
              $cn = $drive.ControllerNumber
              $cl = $drive.ControllerLocation
              if ($ct -and ($null -ne $cn) -and ($null -ne $cl)) {
                # In PowerShell string interpolation, a colon right after $var can be parsed as a scoped variable (e.g. $env:Path).
                # Use ${} to delimit variable names.
                $diskName = "${ct} ${cn}:${cl}"
              }
            } catch { $diskName = $null }

            if ($diskName) {
              $vmDisks += [pscustomobject]@{ name = $diskName; size_bytes = $sizeBytes }
            } else {
              $vmDisks += [pscustomobject]@{ size_bytes = $sizeBytes }
            }
          }
        }
      } catch { $vmDisks = @() }

      $vmIps = @()
      $vmMacs = @()
      try {
        if (Get-Command Get-VMNetworkAdapter -ErrorAction SilentlyContinue) {
          $nics = Get-VMNetworkAdapter -VMId $_.VMId -ErrorAction Stop
          foreach ($nic in $nics) {
            try {
              $mac = $null
              try { $mac = Format-MacAddress $nic.MacAddress } catch { $mac = $null }
              if ($mac) { $vmMacs += $mac }
            } catch { }

            try {
              $ips = $null
              try { $ips = $nic.IPAddresses } catch { $ips = $null }
              foreach ($ip in $ips) {
                if ([string]::IsNullOrWhiteSpace([string]$ip)) { continue }
                $s = ([string]$ip).Trim()
                if ($s -match '^[0-9]{1,3}([.][0-9]{1,3}){3}$' -and $s -ne '127.0.0.1' -and $s -ne '0.0.0.0') {
                  $vmIps += $s
                }
              }
            } catch { }
          }
        }
      } catch { $vmIps = @(); $vmMacs = @() }

      $vmIps = @($vmIps | Sort-Object -Unique)
      $vmMacs = @($vmMacs | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Sort-Object -Unique)

      [pscustomobject]@{
        vm_id = [string]$_.VMId
        name = $_.Name
        state = $_.State.ToString()
        cpu_count = $_.ProcessorCount
        memory_bytes = [int64]$_.MemoryStartup
        ip_addresses = $vmIps
        mac_addresses = $vmMacs
        disks = $vmDisks
      }
    }
  )

  return [pscustomobject]@{ node = $hostName; host = $hostInfo; vms = $vms }
}

if ($resolvedScope -eq 'cluster') {
  if (-not $clusterName) {
    $cluster = Try-GetCluster $Endpoint
    if (-not $cluster) { throw 'endpoint is not a cluster' }
    $clusterName = $cluster.Name
  }

  $nodeRows = @(
    Get-ClusterNode -Cluster $cluster -ErrorAction Stop
  )
  $nodes = @($nodeRows | ForEach-Object { $_.Name })
  $nodeStates = @($nodeRows | ForEach-Object { [pscustomobject]@{ name = $_.Name; state = $_.State.ToString() } })
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

  # Best-effort: enrich host.power_state from Get-ClusterNode state.
  try {
    $powerByNode = @{}
    foreach ($row in $nodeStates) {
      $n = if ($row -and $row.name) { [string]$row.name } else { $null }
      $st = if ($row -and $row.state) { [string]$row.state } else { $null }
      if ([string]::IsNullOrWhiteSpace([string]$n)) { continue }
      $p = Map-ClusterNodePowerState $st
      if ($p) { $powerByNode[$n] = $p }
    }

    foreach ($nr in $nodeResults) {
      if ($null -eq $nr -or $null -eq $nr.host) { continue }
      $n = if ($nr.node) { [string]$nr.node } else { $null }
      if ([string]::IsNullOrWhiteSpace([string]$n)) { continue }
      if ($powerByNode.ContainsKey($n)) {
        $nr.host.power_state = $powerByNode[$n]
      }
    }
  } catch { }

  [pscustomobject]@{
    scope = 'cluster'
    winrm_client_spn_prefix = $spnPrefix
    cluster_name = $clusterName
    nodes = $nodeResults
    owner_rows = $vmOwnerRows
  } | ConvertTo-Json -Compress -Depth 8
  exit 0
}

$inv = Invoke-Command -ComputerName $Endpoint -ScriptBlock $sbInventory -ErrorAction Stop
[pscustomobject]@{
  scope = 'standalone'
  winrm_client_spn_prefix = $spnPrefix
  host = $inv.host
  vms = $inv.vms
} | ConvertTo-Json -Compress -Depth 6
