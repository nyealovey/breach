#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'

function New-Response([hashtable]$Partial) {
  $base = @{
    schema_version = 'collector-response-v1'
    assets = @()
    relations = @()
    stats = @{ assets = 0; relations = 0; inventory_complete = $false; warnings = @() }
    errors = @()
  }

  foreach ($k in $Partial.Keys) {
    $base[$k] = $Partial[$k]
  }

  return $base
}

function Write-Response([hashtable]$Partial, [int]$ExitCode) {
  $resp = New-Response $Partial
  $json = $resp | ConvertTo-Json -Compress -Depth 20
  [Console]::Out.WriteLine($json)
  exit $ExitCode
}

$inputText = [Console]::In.ReadToEnd()

if ([string]::IsNullOrWhiteSpace($inputText)) {
  Write-Response @{ errors = @(@{ code = 'HYPERV_PARSE_ERROR'; category = 'parse'; message = 'empty input'; retryable = $false }) } 1
}

try {
  $req = $inputText | ConvertFrom-Json -Depth 50
} catch {
  Write-Response @{ errors = @(@{ code = 'HYPERV_PARSE_ERROR'; category = 'parse'; message = 'invalid input json'; retryable = $false }) } 1
}

if ($null -eq $req.schema_version -or $req.schema_version -ne 'collector-request-v1') {
  Write-Response @{ errors = @(@{ code = 'HYPERV_CONFIG_INVALID'; category = 'config'; message = 'unsupported schema_version'; retryable = $false }) } 1
}

if ($null -eq $req.source -or $req.source.source_type -ne 'hyperv') {
  Write-Response @{ errors = @(@{ code = 'HYPERV_CONFIG_INVALID'; category = 'config'; message = 'unsupported source_type'; retryable = $false }) } 1
}

# TODO(hyperv-pwsh): implement healthcheck/detect/collect via WinRM (NTLM) and emit normalized-v1 assets/relations.
Write-Response @{ errors = @(@{ code = 'HYPERV_CONFIG_INVALID'; category = 'config'; message = 'hyperv pwsh plugin not implemented'; retryable = $false }) } 1
