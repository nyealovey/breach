'use client';

import { RefreshCw, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type EditAssetDialogTarget = {
  assetUuid: string;
  machineNameCollected: string | null;
  ipCollected: string | null;
  osCollected: string | null;
};

type SolarWindsCandidate = {
  nodeId: string;
  caption: string | null;
  sysName: string | null;
  dns: string | null;
  ipAddress: string | null;
  machineType: string | null;
  statusDescription: string | null;
  unmanaged: boolean | null;
  lastSyncIso: string | null;
  matchScore: number;
  matchReasons: string[];
};

type EditAssetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTarget: EditAssetDialogTarget | null;
  editMachineNameValue: string;
  editIpValue: string;
  editOsValue: string;
  onEditMachineNameChange: (value: string) => void;
  onEditIpChange: (value: string) => void;
  onEditOsChange: (value: string) => void;
  swCandidates: SolarWindsCandidate[] | null;
  swSelectedNodeId: string;
  onSelectSolarWindsNode: (nodeId: string) => void;
  onCloseSolarWindsCandidates: () => void;
  onCollectFromSolarWinds: (args: { assetUuid: string; nodeId?: string }) => void | Promise<void>;
  swCollecting: boolean;
  hasOverrideDraft: boolean;
  onClearOverrideDraft: () => void;
  editSaving: boolean;
  onSave: () => void | Promise<void>;
  formatDateTime: (iso: string | null | undefined) => string;
};

export function EditAssetDialog({
  open,
  onOpenChange,
  editTarget,
  editMachineNameValue,
  editIpValue,
  editOsValue,
  onEditMachineNameChange,
  onEditIpChange,
  onEditOsChange,
  swCandidates,
  swSelectedNodeId,
  onSelectSolarWindsNode,
  onCloseSolarWindsCandidates,
  onCollectFromSolarWinds,
  swCollecting,
  hasOverrideDraft,
  onClearOverrideDraft,
  editSaving,
  onSave,
  formatDateTime,
}: EditAssetDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>编辑资产字段</DialogTitle>
          <DialogDescription>
            可覆盖机器名 / IP / 操作系统。打开编辑后，可手动点击采集图标把 SolarWinds
            采集值填充到覆盖字段（不会自动保存）。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex h-full flex-col rounded-md border bg-muted/30 p-3 text-xs">
            <div className="font-medium">覆盖值（草稿）</div>
            <div className="mt-3 flex-1 space-y-3 text-sm">
              <div className="space-y-1.5">
                <Label htmlFor="asset-machineNameOverride">机器名（覆盖）</Label>
                <Input
                  id="asset-machineNameOverride"
                  value={editMachineNameValue}
                  placeholder="留空表示不覆盖"
                  onChange={(e) => onEditMachineNameChange(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="asset-ipOverrideText">IP（覆盖）</Label>
                <Input
                  id="asset-ipOverrideText"
                  value={editIpValue}
                  placeholder="多个用逗号分隔；留空表示不覆盖"
                  onChange={(e) => onEditIpChange(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="asset-osOverrideText">操作系统（覆盖）</Label>
                <Input
                  id="asset-osOverrideText"
                  value={editOsValue}
                  placeholder="留空表示不覆盖"
                  onChange={(e) => onEditOsChange(e.target.value)}
                />
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              支持多个 IP（逗号分隔）；资产清单展示/搜索/筛选会优先使用覆盖值。
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex h-full flex-col rounded-md border bg-muted/30 p-3 text-xs">
              <div className="font-medium">采集值（当前）</div>
              <div className="mt-3 flex-1 space-y-3">
                <div>
                  <div className="text-muted-foreground">机器名</div>
                  <div className="mt-1 font-mono break-all">{editTarget?.machineNameCollected ?? '暂无'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">IP</div>
                  <div className="mt-1 font-mono break-all">{editTarget?.ipCollected ?? '暂无'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">操作系统</div>
                  <div className="mt-1 break-words">{editTarget?.osCollected ?? '暂无'}</div>
                </div>
              </div>
            </div>

            {swCandidates ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">多个 SolarWinds 节点匹配</div>
                <div className="text-xs text-muted-foreground">
                  请选择一个节点继续采集（采集会填充覆盖字段，但不会自动保存）。
                </div>
                <div className="max-h-[260px] space-y-2 overflow-auto rounded-md border bg-background p-2">
                  {swCandidates.map((candidate) => {
                    const title = candidate.caption ?? candidate.sysName ?? candidate.dns ?? `Node ${candidate.nodeId}`;
                    const subtitleParts = [
                      candidate.ipAddress ? `IP: ${candidate.ipAddress}` : null,
                      candidate.machineType ? `OS: ${candidate.machineType}` : null,
                      candidate.unmanaged === true ? 'Unmanaged' : null,
                      candidate.lastSyncIso ? `LastSync: ${formatDateTime(candidate.lastSyncIso)}` : null,
                    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

                    return (
                      <label
                        key={candidate.nodeId}
                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/30 ${
                          swSelectedNodeId === candidate.nodeId ? 'border-primary/50 bg-muted/20' : ''
                        }`}
                      >
                        <input
                          type="radio"
                          name="sw_node"
                          className="mt-1"
                          checked={swSelectedNodeId === candidate.nodeId}
                          onChange={() => onSelectSolarWindsNode(candidate.nodeId)}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="min-w-0 break-all font-medium">{title}</div>
                            <Badge variant="outline">NodeID: {candidate.nodeId}</Badge>
                            <Badge variant="secondary">score {candidate.matchScore}</Badge>
                          </div>
                          {subtitleParts.length > 0 ? (
                            <div className="mt-1 break-words text-xs text-muted-foreground">
                              {subtitleParts.join(' · ')}
                            </div>
                          ) : null}
                          {candidate.matchReasons.length > 0 ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              命中：{candidate.matchReasons.join(', ')}
                            </div>
                          ) : null}
                          {candidate.statusDescription ? (
                            <div className="mt-1 text-xs text-muted-foreground">
                              状态：{candidate.statusDescription}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={swCollecting} onClick={onCloseSolarWindsCandidates}>
                    关闭
                  </Button>
                  <Button
                    size="sm"
                    disabled={!editTarget || !swSelectedNodeId || swCollecting}
                    onClick={() => {
                      if (!editTarget || !swSelectedNodeId) return;
                      void onCollectFromSolarWinds({ assetUuid: editTarget.assetUuid, nodeId: swSelectedNodeId });
                    }}
                  >
                    选择并采集
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:space-x-0">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              title="采集并填充覆盖草稿（不会自动保存）"
              aria-label="采集并填充覆盖草稿"
              disabled={!editTarget || swCollecting}
              onClick={() => {
                if (!editTarget) return;
                void onCollectFromSolarWinds({ assetUuid: editTarget.assetUuid });
              }}
            >
              <RefreshCw className={swCollecting ? 'animate-spin' : undefined} />
            </Button>
            <Button
              size="icon"
              variant="outline"
              title="清空覆盖草稿（需点击保存生效）"
              aria-label="清空覆盖草稿"
              disabled={editSaving || swCollecting || !hasOverrideDraft}
              onClick={onClearOverrideDraft}
            >
              <Trash2 />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={editSaving || swCollecting} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={!editTarget || editSaving} onClick={onSave}>
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
