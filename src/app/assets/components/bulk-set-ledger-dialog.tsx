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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type BulkFieldOption = {
  key: string;
  label: string;
  kind: string;
  isHostOnly: boolean;
  disabled: boolean;
};

type BulkSetLedgerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  fieldOptions: BulkFieldOption[];
  bulkKey: string;
  bulkValue: string;
  onBulkKeyChange: (value: string) => void;
  onBulkValueChange: (value: string) => void;
  isDateField: boolean;
  isAdmin: boolean;
  bulkSaving: boolean;
  canSave: boolean;
  onSave: () => void | Promise<void>;
};

export function BulkSetLedgerDialog({
  open,
  onOpenChange,
  selectedCount,
  fieldOptions,
  bulkKey,
  bulkValue,
  onBulkKeyChange,
  onBulkValueChange,
  isDateField,
  isAdmin,
  bulkSaving,
  canSave,
  onSave,
}: BulkSetLedgerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量设置台账覆盖值</DialogTitle>
          <DialogDescription>仅支持对“当前页勾选”的资产批量设置 1 个字段（N≤100）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-xs text-muted-foreground">已选择：{selectedCount} 个资产</div>

          <div className="space-y-2">
            <Label>字段</Label>
            <Select
              value={bulkKey || 'choose'}
              onValueChange={(value) => {
                onBulkKeyChange(value === 'choose' ? '' : value);
                onBulkValueChange('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择字段" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="choose">请选择</SelectItem>
                {fieldOptions.map((field) => (
                  <SelectItem key={field.key} value={field.key} disabled={field.disabled}>
                    {field.label}
                    {field.isHostOnly ? '（仅 Host）' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>值</Label>
            {isDateField ? (
              <Input type="date" value={bulkValue} onChange={(e) => onBulkValueChange(e.target.value)} />
            ) : (
              <Input value={bulkValue} placeholder="留空表示清空" onChange={(e) => onBulkValueChange(e.target.value)} />
            )}
            <div className="text-xs text-muted-foreground">留空表示清空（等价 value=null）。</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={bulkSaving} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!isAdmin || !canSave} onClick={onSave}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
