export type AssetFieldGroupA = 'common' | 'vm' | 'host' | 'cluster' | 'attributes' | 'ledger' | 'unknown';
export type AssetFieldGroupB =
  | 'identity'
  | 'network'
  | 'os'
  | 'hardware'
  | 'runtime'
  | 'storage'
  | 'attributes'
  | 'other';

export type AssetFieldFormatHint = 'string' | 'bytes' | 'datetime' | 'boolean' | 'enum' | 'ip' | 'json';

export type AssetFieldMeta = {
  labelZh: string;
  groupA: AssetFieldGroupA;
  groupB: AssetFieldGroupB;
  formatHint: AssetFieldFormatHint;
};

const FIELD_META: Record<string, AssetFieldMeta> = {
  // ===== identity =====
  'identity.hostname': { labelZh: '机器名', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.caption': { labelZh: '虚拟机名', groupA: 'vm', groupB: 'identity', formatHint: 'string' },

  // ===== network =====
  'network.ip_addresses': { labelZh: 'IP 地址', groupA: 'common', groupB: 'network', formatHint: 'ip' },

  // ===== os =====
  'os.name': { labelZh: '操作系统', groupA: 'common', groupB: 'os', formatHint: 'string' },
  'os.version': { labelZh: '操作系统版本', groupA: 'common', groupB: 'os', formatHint: 'string' },
  // NOTE: os.fingerprint is deliberately VM-only (host build is not displayed by default in list).
  'os.fingerprint': { labelZh: 'OS 指纹', groupA: 'vm', groupB: 'os', formatHint: 'string' },

  // ===== hardware =====
  'hardware.cpu_count': { labelZh: 'CPU', groupA: 'common', groupB: 'hardware', formatHint: 'json' },
  'hardware.memory_bytes': { labelZh: '内存', groupA: 'common', groupB: 'hardware', formatHint: 'bytes' },
  'hardware.disks': { labelZh: '磁盘', groupA: 'vm', groupB: 'hardware', formatHint: 'json' },

  // ===== runtime =====
  'runtime.power_state': { labelZh: '电源状态', groupA: 'vm', groupB: 'runtime', formatHint: 'enum' },
  'runtime.tools_running': { labelZh: 'Tools 运行', groupA: 'vm', groupB: 'runtime', formatHint: 'boolean' },

  // ===== storage =====
  'storage.datastores': { labelZh: 'Datastore 明细', groupA: 'host', groupB: 'storage', formatHint: 'json' },

  // ===== common attributes (best-effort localizations) =====
  'attributes.cpu_threads': { labelZh: 'CPU 线程数', groupA: 'host', groupB: 'hardware', formatHint: 'json' },
  'attributes.datastore_total_bytes': {
    labelZh: 'Datastore 总容量',
    groupA: 'host',
    groupB: 'storage',
    formatHint: 'bytes',
  },
  'attributes.disk_total_bytes': { labelZh: '本地盘总容量', groupA: 'host', groupB: 'storage', formatHint: 'bytes' },
};

function fallbackUnknownMeta(): AssetFieldMeta {
  return { labelZh: '-', groupA: 'unknown', groupB: 'other', formatHint: 'json' };
}

export function getAssetFieldMeta(_path: string): AssetFieldMeta {
  const path = _path.trim();
  const exact = FIELD_META[path];
  if (exact) return exact;

  if (path.startsWith('attributes.') && path.length > 'attributes.'.length) {
    const key = path.slice('attributes.'.length);
    return { labelZh: `扩展字段：${key}`, groupA: 'attributes', groupB: 'attributes', formatHint: 'json' };
  }

  return fallbackUnknownMeta();
}
