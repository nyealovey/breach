import { cn } from '@/lib/utils';

export type SignalSourceTone = 'good' | 'warning' | 'bad' | 'muted';

function toneClassName(tone: SignalSourceTone): string {
  if (tone === 'good')
    return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300';
  if (tone === 'warning')
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300';
  if (tone === 'bad')
    return 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300';
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400';
}

function SourceMark(props: { label: string; tone: SignalSourceTone; title: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 w-5 select-none items-center justify-center rounded-md border text-[10px] font-semibold leading-none',
        toneClassName(props.tone),
        props.className,
      )}
      title={props.title}
      aria-label={props.title}
    >
      {props.label}
    </span>
  );
}

export function SolarWindsMark(props: { tone: SignalSourceTone; title: string; className?: string }) {
  return <SourceMark label="SW" tone={props.tone} title={props.title} className={props.className} />;
}

export function VeeamMark(props: { tone: SignalSourceTone; title: string; className?: string }) {
  return <SourceMark label="V" tone={props.tone} title={props.title} className={props.className} />;
}
