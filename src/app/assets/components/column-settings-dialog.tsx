'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { ReactNode } from 'react';

type ColumnSettingItem = {
  id: string;
  label: string;
};

type ColumnSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderColumnSettingItem: (col: ColumnSettingItem) => ReactNode;
  assetFieldCommonColumns: ColumnSettingItem[];
  assetFieldVmOnlyColumns: ColumnSettingItem[];
  assetFieldHostOnlyColumns: ColumnSettingItem[];
  ledgerFieldCommonColumns: ColumnSettingItem[];
  ledgerFieldHostOnlyColumns: ColumnSettingItem[];
  columnSaving: boolean;
  columnDraftLength: number;
  onResetDefault: () => void;
  onSave: () => void | Promise<void>;
};

export function ColumnSettingsDialog({
  open,
  onOpenChange,
  renderColumnSettingItem,
  assetFieldCommonColumns,
  assetFieldVmOnlyColumns,
  assetFieldHostOnlyColumns,
  ledgerFieldCommonColumns,
  ledgerFieldHostOnlyColumns,
  columnSaving,
  columnDraftLength,
  onResetDefault,
  onSave,
}: ColumnSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>列设置</DialogTitle>
          <DialogDescription>列配置按用户保存到数据库，可在不同设备复用。</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <div className="text-sm font-semibold">资产字段</div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">通用字段</div>
              <div className="space-y-2">{assetFieldCommonColumns.map(renderColumnSettingItem)}</div>
            </div>

            {assetFieldVmOnlyColumns.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">VM 专属</div>
                <div className="space-y-2">{assetFieldVmOnlyColumns.map(renderColumnSettingItem)}</div>
              </div>
            ) : null}

            {assetFieldHostOnlyColumns.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Host 专属</div>
                <div className="space-y-2">{assetFieldHostOnlyColumns.map(renderColumnSettingItem)}</div>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="text-sm font-semibold">台账字段</div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">通用字段</div>
              <div className="space-y-2">{ledgerFieldCommonColumns.map(renderColumnSettingItem)}</div>
            </div>

            {ledgerFieldHostOnlyColumns.length > 0 ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Host 专属</div>
                <div className="space-y-2">{ledgerFieldHostOnlyColumns.map(renderColumnSettingItem)}</div>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={columnSaving} onClick={onResetDefault}>
            恢复默认
          </Button>
          <Button variant="outline" disabled={columnSaving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={columnSaving || columnDraftLength < 1} onClick={onSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
