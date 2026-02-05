import { cn } from '@/lib/utils';

type IdTextProps = {
  value: string | null | undefined;
  className?: string;
  title?: string;
};

export function IdText({ value, className, title }: IdTextProps) {
  if (!value) return <span className={cn('text-xs text-muted-foreground', className)}>-</span>;

  return (
    <span
      className={cn('font-mono text-xs text-muted-foreground break-all whitespace-normal', className)}
      title={title ?? value}
    >
      {value}
    </span>
  );
}
