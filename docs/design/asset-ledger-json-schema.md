# 资产台账 normalized / canonical JSON Schema

版本：v1.3  
日期：2026-01-31

## 文档简介

本文档沉淀资产台账系统的两套结构化数据 Schema：

- **normalized-v1**：采集插件输出、核心落库到 `source_record.normalized` 的标准化字段结构。
- **canonical-v1**：核心聚合后的“统一资产视图快照”，落库到 `asset_run_snapshot.canonical`（用于 UI 展示、历史追溯与对比）。

目标：**让采集侧、入账侧、展示侧对齐同一份可执行结构**，减少“字段名/层级漂移”，并为后续导入（表格/CSV）与第三方来源接入提供统一落点。

关联文档：

- SRS：`docs/requirements/asset-ledger-srs.md`
- 概念数据模型：`docs/design/asset-ledger-data-model.md`
- 采集插件参考：`docs/design/asset-ledger-collector-reference.md`

## 1. normalized-v1（SourceRecord.normalized）

### 1.1 设计原则

- normalized 仅表达“来源侧看到的事实 + 轻量标准化”，不承载台账核心域逻辑（去重、合并、冲突裁决由 core 负责）。
- normalized 必须覆盖 dup-rules-v1 的最小候选键（见 SRS/Collector Reference），其余字段按来源能力填充。
- **安全**：normalized 不得包含明文凭证/口令；如确需表达“管理码”，只能以脱敏后的引用/占位符形式出现（例如 `***`、`secret_ref`）。

### 1.2 JSON Schema（Draft 2020-12）

> 说明：这是 normalized 对象的 schema；它作为 `source_record.normalized` 的内容存储。  
> `kind` 必须与采集输出的 `external_kind` 一致（vm/host/cluster）。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "asset-ledger/normalized-v1.schema.json",
  "title": "asset-ledger normalized-v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "kind"],
  "properties": {
    "version": { "const": "normalized-v1" },
    "kind": { "enum": ["vm", "host", "cluster"] },

    "identity": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "hostname": { "type": "string", "minLength": 1 },
        "machine_uuid": { "type": "string", "minLength": 1 },
        "serial_number": { "type": "string", "minLength": 1 },
        "cloud_native_id": { "type": "string", "minLength": 1 },
        "vendor": { "type": "string" },
        "model": { "type": "string" },
        "product_name": { "type": "string" },
        "caption": { "type": "string" }
      }
    },

    "network": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "ip_addresses": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "mac_addresses": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "uniqueItems": true
        },
        "management_ip": { "type": "string", "minLength": 1 },
        "bmc_ip": {
          "type": "string",
          "minLength": 1,
          "description": "Out-of-band management IP (BMC/iLO/iDRAC/IPMI). Preferred field."
        },
        "ilo_ip": {
          "type": "string",
          "minLength": 1,
          "description": "DEPRECATED: legacy alias of bmc_ip. Please write to network.bmc_ip."
        }
      }
    },

    "os": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "name": { "type": "string" },
        "version": { "type": "string" },
        "fingerprint": { "type": "string" }
      }
    },

    "hardware": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "cpu_count": { "type": "integer", "minimum": 0 },
        "memory_bytes": { "type": "integer", "minimum": 0 },
        "disks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": { "type": "string" },
              "size_bytes": { "type": "integer", "minimum": 0 },
              "type": {
                "enum": ["thin", "thick", "eagerZeroedThick"],
                "description": "Disk provisioning type (vCenter): thin/thick/eagerZeroedThick."
              }
            }
          }
        }
      }
    },

    "runtime": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "power_state": { "enum": ["poweredOn", "poweredOff", "suspended"] },
        "tools_running": {
          "type": "boolean",
          "description": "Whether VMware Tools is running in the guest (only for VMs)"
        },
        "tools_status": {
          "type": "string",
          "description": "VMware Tools version status (NOT_INSTALLED, CURRENT, TOO_OLD, etc.)"
        }
      }
    },

    "storage": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "datastores": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["name", "capacity_bytes"],
            "properties": {
              "name": { "type": "string", "minLength": 1 },
              "capacity_bytes": { "type": "integer", "minimum": 0 }
            }
          }
        }
      }
    },

    "location": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "region": { "type": "string" },
        "city": { "type": "string" },
        "cabinet": { "type": "string" },
        "position": { "type": "string" }
      }
    },

    "ownership": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "department": { "type": "string" },
        "owner_name": { "type": "string" },
        "owner_email": { "type": "string" },
        "cc_emails": {
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true
        }
      }
    },

    "service": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "system_name": { "type": "string" },
        "applications": {
          "type": "array",
          "items": { "type": "string" },
          "uniqueItems": true
        },
        "service_level": { "type": "string" }
      }
    },

    "resource": {
      "type": "object",
      "description": "可选：用于承接资源规格/形态等辅助信息（不作为强制候选键），避免散落在 attributes.*",
      "additionalProperties": false,
      "properties": {
        "profile": {
          "type": "string",
          "description": "资源规格/形态的指纹化描述（例如 instance_type / sku / 合并后的规格摘要）"
        }
      }
    },

    "physical": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "fixed_asset_id": { "type": "string" },
        "maintenance_period": { "type": "string" }
      }
    },

    "comments": { "type": "string" },
    "classification": { "type": "string" },
    "cloud": { "type": ["boolean", "string"] },

    "attributes": {
      "type": "object",
      "description": "用于承接来源特有字段/导入表格未结构化字段；建议 value 仅使用 string/number/bool",
      "additionalProperties": {
        "type": ["string", "number", "boolean", "null"]
      }
    }
  }
}
```

### 1.3 示例：虚拟机（vm）

```json
{
  "version": "normalized-v1",
  "kind": "vm",
  "identity": {
    "hostname": "vm-app-01",
    "machine_uuid": "420b5a7e-6b8c-4d0e-9b2e-xxxxxxxxxxxx"
  },
  "network": {
    "ip_addresses": ["10.10.1.23"],
    "mac_addresses": ["00:50:56:aa:bb:cc"]
  },
  "os": { "name": "Ubuntu", "version": "22.04" },
  "hardware": {
    "cpu_count": 4,
    "memory_bytes": 8589934592,
    "disks": [{ "name": "Hard disk 1", "size_bytes": 53687091200, "type": "thin" }]
  },
  "runtime": { "power_state": "poweredOn", "tools_running": true },
  "ownership": { "department": "IT", "owner_name": "Alice" },
  "service": { "system_name": "订单系统", "applications": ["order-api"], "service_level": "P1" }
}
```

### 1.4 示例：物理机（host）

> 说明：固定资产编号/维保期等字段属于**物理机扩展（physical）**，不作为通用字段强制要求。维保起止由“采购日志 + 维保期”自动计算，不要求在 normalized 内单独存储起止日期。

```json
{
  "version": "normalized-v1",
  "kind": "host",
  "identity": {
    "hostname": "srv-db-01",
    "serial_number": "CN12345678",
    "vendor": "Dell",
    "model": "R740"
  },
  "network": {
    "management_ip": "10.10.9.10",
    "bmc_ip": "10.10.9.11",
    "ip_addresses": ["10.10.9.10"]
  },
  "os": { "name": "Windows Server", "version": "2019" },
  "hardware": { "cpu_count": 32, "memory_bytes": 274877906944 },
  "storage": {
    "datastores": [
      { "name": "local-vmfs-1", "capacity_bytes": 1099511627776 },
      { "name": "shared-vmfs-2", "capacity_bytes": 2199023255552 }
    ]
  },
  "location": { "region": "华东", "cabinet": "A01", "position": "U12" },
  "service": { "service_level": "P0" },
  "physical": {
    "fixed_asset_id": "FA-2025-0001",
    "maintenance_period": "3y"
  }
}
```

### 1.5 示例：集群（cluster）

```json
{
  "version": "normalized-v1",
  "kind": "cluster",
  "identity": {
    "hostname": "cluster-prod-01",
    "caption": "生产集群"
  },
  "hardware": {
    "cpu_count": 128,
    "memory_bytes": 1099511627776
  },
  "location": {
    "region": "华东",
    "city": "上海"
  },
  "attributes": {
    "ha_enabled": true,
    "drs_enabled": true,
    "host_count": 4,
    "vm_count": 120
  }
}
```

## 2. canonical-v1（AssetRunSnapshot.canonical）

### 2.1 字段级可追溯（provenance）结构

canonical-v1 采用“值 + 来源证据”的封装结构（`field`）：

- `value`：当前统一视图采用的值（数组字段通常做并集去重）。
- `sources[]`：至少包含 `source_id` 与 `run_id`（可选 `record_id/collected_at`），用于回溯证据。
- `conflict`：当出现单值冲突时为 `true`。
- `alternatives[]`：冲突时保留备选值与其来源证据。

### 2.2 JSON Schema（Draft 2020-12）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "asset-ledger/canonical-v1.schema.json",
  "title": "asset-ledger canonical-v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["version", "asset_uuid", "asset_type", "status", "display_name", "fields", "relations"],
  "properties": {
    "version": { "const": "canonical-v1" },
    "asset_uuid": { "type": "string", "minLength": 1 },
    "asset_type": { "enum": ["vm", "host", "cluster"] },
    "status": { "enum": ["in_service", "offline", "merged"] },
    "display_name": { "type": "string" },
    "last_seen_at": { "type": ["string", "null"], "format": "date-time" },

    "fields": {
      "$ref": "#/$defs/CanonicalObject",
      "description": "键名建议与 normalized-v1 对齐（identity/network/os/hardware/location/ownership/service/physical）；叶子节点使用 FieldValue（含 sources/alternatives）"
    },

    "relations": {
      "type": "object",
      "additionalProperties": false,
      "required": ["outgoing"],
      "properties": {
        "outgoing": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["type", "to"],
            "properties": {
              "type": { "enum": ["runs_on", "member_of", "hosts_vm"] },
              "to": {
                "type": "object",
                "additionalProperties": false,
                "required": ["asset_uuid", "display_name"],
                "properties": {
                  "asset_uuid": { "type": "string" },
                  "display_name": { "type": "string" },
                  "asset_type": { "enum": ["vm", "host", "cluster"] }
                }
              },
              "source_id": { "type": "string" },
              "last_seen_at": { "type": ["string", "null"], "format": "date-time" }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "FieldProvenance": {
      "type": "object",
      "additionalProperties": false,
      "required": ["source_id", "run_id"],
      "properties": {
        "source_id": { "type": "string", "minLength": 1 },
        "run_id": { "type": "string", "minLength": 1 },
        "record_id": { "type": "string" },
        "collected_at": { "type": "string", "format": "date-time" }
      }
    },
    "FieldValue": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "sources"],
      "properties": {
        "value": {
          "type": ["string", "number", "boolean", "object", "array", "null"]
        },
        "sources": {
          "type": "array",
          "minItems": 1,
          "items": { "$ref": "#/$defs/FieldProvenance" }
        },
        "conflict": { "type": "boolean" },
        "alternatives": {
          "type": "array",
          "items": { "$ref": "#/$defs/FieldValue" }
        }
      }
    },
    "CanonicalNode": {
      "anyOf": [
        { "$ref": "#/$defs/FieldValue" },
        {
          "type": "object",
          "additionalProperties": { "$ref": "#/$defs/CanonicalNode" }
        }
      ]
    },
    "CanonicalObject": {
      "type": "object",
      "additionalProperties": { "$ref": "#/$defs/CanonicalNode" }
    }
  }
}
```

### 2.3 示例：canonical-v1（字段冲突 + 关系摘要）

```json
{
  "version": "canonical-v1",
  "asset_uuid": "a_123",
  "asset_type": "vm",
  "status": "in_service",
  "display_name": "vm-app-01",
  "last_seen_at": "2026-01-26T12:00:00Z",
  "fields": {
    "identity": {
      "hostname": {
        "value": "vm-app-01",
        "sources": [{ "source_id": "vcenter-prod", "run_id": "run_001" }],
        "conflict": true,
        "alternatives": [
          { "value": "vm-app-01", "sources": [{ "source_id": "vcenter-prod", "run_id": "run_001" }] },
          { "value": "vm-app-01-bak", "sources": [{ "source_id": "pve-lab", "run_id": "run_002" }] }
        ]
      }
    },
    "network": {
      "ip_addresses": {
        "value": ["10.10.1.23", "10.10.1.24"],
        "sources": [
          { "source_id": "vcenter-prod", "run_id": "run_001" },
          { "source_id": "pve-lab", "run_id": "run_002" }
        ]
      }
    }
  },
  "relations": {
    "outgoing": [
      {
        "type": "runs_on",
        "to": { "asset_uuid": "h_456", "asset_type": "host", "display_name": "esxi-01" },
        "source_id": "vcenter-prod",
        "last_seen_at": "2026-01-26T12:00:00Z"
      },
      {
        "type": "member_of",
        "to": { "asset_uuid": "c_789", "asset_type": "cluster", "display_name": "cluster-a" },
        "source_id": "vcenter-prod",
        "last_seen_at": "2026-01-26T12:00:00Z"
      }
    ]
  }
}
```
