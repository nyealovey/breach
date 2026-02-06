import { normalizePowerState } from '@/lib/assets/power-state';

export const TOOLS_NOT_RUNNING_TEXT = '- (Tools 未运行)' as const;
export const TOOLS_NOT_RUNNING_TOOLTIP =
  'Guest Agent / Tools / Guest 服务未安装或未运行，无法获取 guest 信息（如机器名 / 系统 / IP）' as const;

export function shouldShowToolsNotRunning(input: {
  assetType: string;
  powerState: string | null;
  toolsRunning: boolean | null;
}): boolean {
  if (input.assetType !== 'vm') return false;
  if (normalizePowerState(input.powerState ?? '') !== 'poweredOn') return false;
  return input.toolsRunning === false;
}
