export type CanonicalFieldGroupA = 'common' | 'vm' | 'host' | 'cluster' | 'extension' | 'custom';

export type CanonicalFieldFormatHint =
  | 'bytes'
  | 'ip'
  | 'ip_list'
  | 'mac_list'
  | 'email_list'
  | 'string_list'
  | 'power_state'
  | 'boolean'
  | 'string'
  | 'number'
  | 'mixed'
  | 'object_list';

export type CanonicalFieldMeta = {
  labelZh: string;
  groupA: CanonicalFieldGroupA;
  groupB: string;
  formatHint?: CanonicalFieldFormatHint;
};

// Key is the canonical path under canonical.fields (e.g. `identity.hostname`).
// This is a UI-focused registry; it intentionally does NOT try to cover dynamic keys (e.g. attributes.*) exhaustively.
export const CANONICAL_FIELD_REGISTRY: Record<string, CanonicalFieldMeta> = {
  // ========== identity ==========
  'identity.hostname': { labelZh: '机器名', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.caption': { labelZh: '名称（caption）', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.machine_uuid': { labelZh: '机器 UUID', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.cloud_native_id': { labelZh: '云资源 ID', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.serial_number': { labelZh: '序列号', groupA: 'host', groupB: 'identity', formatHint: 'string' },
  'identity.vendor': { labelZh: '厂商', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.model': { labelZh: '型号', groupA: 'common', groupB: 'identity', formatHint: 'string' },
  'identity.product_name': { labelZh: '产品名称', groupA: 'common', groupB: 'identity', formatHint: 'string' },

  // ========== network ==========
  'network.ip_addresses': { labelZh: 'IP 地址', groupA: 'common', groupB: 'network', formatHint: 'ip_list' },
  'network.mac_addresses': { labelZh: 'MAC 地址', groupA: 'common', groupB: 'network', formatHint: 'mac_list' },
  'network.management_ip': { labelZh: '管理 IP', groupA: 'host', groupB: 'network', formatHint: 'ip' },
  'network.bmc_ip': { labelZh: '带外管理 IP（BMC）', groupA: 'host', groupB: 'network', formatHint: 'ip' },
  'network.ilo_ip': { labelZh: '带外管理 IP（iLO，旧字段）', groupA: 'host', groupB: 'network', formatHint: 'ip' },

  // ========== os ==========
  'os.name': { labelZh: '操作系统', groupA: 'common', groupB: 'os', formatHint: 'string' },
  'os.version': { labelZh: '系统版本', groupA: 'common', groupB: 'os', formatHint: 'string' },
  'os.fingerprint': { labelZh: '系统指纹', groupA: 'common', groupB: 'os', formatHint: 'string' },

  // ========== hardware ==========
  'hardware.cpu_count': { labelZh: 'CPU 数', groupA: 'common', groupB: 'hardware', formatHint: 'number' },
  'hardware.memory_bytes': { labelZh: '内存', groupA: 'common', groupB: 'hardware', formatHint: 'bytes' },
  'hardware.disks': { labelZh: '磁盘列表', groupA: 'vm', groupB: 'hardware', formatHint: 'object_list' },

  // ========== runtime (vm) ==========
  'runtime.power_state': { labelZh: '电源状态', groupA: 'vm', groupB: 'runtime', formatHint: 'power_state' },
  'runtime.tools_running': {
    labelZh: 'VMware Tools 运行中',
    groupA: 'vm',
    groupB: 'runtime',
    formatHint: 'boolean',
  },
  'runtime.tools_status': { labelZh: 'VMware Tools 状态', groupA: 'vm', groupB: 'runtime', formatHint: 'string' },

  // ========== location ==========
  'location.region': { labelZh: '区域', groupA: 'common', groupB: 'location', formatHint: 'string' },
  'location.city': { labelZh: '城市', groupA: 'common', groupB: 'location', formatHint: 'string' },
  'location.cabinet': { labelZh: '机柜', groupA: 'common', groupB: 'location', formatHint: 'string' },
  'location.position': { labelZh: '机位', groupA: 'common', groupB: 'location', formatHint: 'string' },

  // ========== ownership ==========
  'ownership.department': { labelZh: '部门', groupA: 'common', groupB: 'ownership', formatHint: 'string' },
  'ownership.owner_name': { labelZh: '负责人', groupA: 'common', groupB: 'ownership', formatHint: 'string' },
  'ownership.owner_email': { labelZh: '负责人邮箱', groupA: 'common', groupB: 'ownership', formatHint: 'string' },
  'ownership.cc_emails': { labelZh: '抄送邮箱', groupA: 'common', groupB: 'ownership', formatHint: 'email_list' },

  // ========== service ==========
  'service.system_name': { labelZh: '系统名称', groupA: 'common', groupB: 'service', formatHint: 'string' },
  'service.applications': { labelZh: '应用列表', groupA: 'common', groupB: 'service', formatHint: 'string_list' },
  'service.service_level': { labelZh: '服务等级', groupA: 'common', groupB: 'service', formatHint: 'string' },

  // ========== resource ==========
  'resource.profile': { labelZh: '资源规格', groupA: 'common', groupB: 'resource', formatHint: 'string' },

  // ========== physical (host) ==========
  'physical.fixed_asset_id': { labelZh: '固定资产编号', groupA: 'host', groupB: 'physical', formatHint: 'string' },
  'physical.maintenance_period': { labelZh: '维保周期', groupA: 'host', groupB: 'physical', formatHint: 'string' },

  // ========== top-level misc ==========
  comments: { labelZh: '备注', groupA: 'common', groupB: 'comments', formatHint: 'string' },
  classification: { labelZh: '分类', groupA: 'common', groupB: 'classification', formatHint: 'string' },
  cloud: { labelZh: '云属性', groupA: 'common', groupB: 'cloud', formatHint: 'mixed' },

  // ========== known attributes.* keys (non-schema, but widely used) ==========
  'attributes.cpu_threads': { labelZh: 'CPU 线程数', groupA: 'host', groupB: 'attributes', formatHint: 'number' },
  'attributes.datastore_total_bytes': {
    labelZh: 'Datastore 总容量',
    groupA: 'host',
    groupB: 'attributes',
    formatHint: 'bytes',
  },
  'attributes.disk_total_bytes': { labelZh: '磁盘总容量', groupA: 'host', groupB: 'attributes', formatHint: 'bytes' },
};

export function getCanonicalFieldMeta(path: string): CanonicalFieldMeta | null {
  const exact = CANONICAL_FIELD_REGISTRY[path];
  if (exact) return exact;

  // Dynamic extension fields (attributes.*): show a stable, readable fallback label.
  if (path.startsWith('attributes.')) {
    const key = path.slice('attributes.'.length);
    return {
      labelZh: key ? `扩展字段：${key}` : '扩展字段',
      groupA: 'extension',
      groupB: 'attributes',
      formatHint: 'mixed',
    };
  }

  return null;
}
