'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/ui/cn';

type NavLink = { href: string; label: string };

const CONFIG_CENTER_LINKS: NavLink[] = [
  { href: '/sources', label: '来源' },
  { href: '/credentials', label: '凭据' },
];

function isActiveHref(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isInConfigCenter(pathname: string) {
  return CONFIG_CENTER_LINKS.some((l) => isActiveHref(pathname, l.href));
}

export function AppTopNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const showAdmin = isAdmin;
  const activeInConfig = isInConfigCenter(pathname);

  return (
    <div className="flex flex-col">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link className="shrink-0 text-sm font-semibold" href="/">
          资产台账
        </Link>

        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="主导航">
          <Button asChild size="sm" variant={isActiveHref(pathname, '/assets') ? 'secondary' : 'ghost'}>
            <Link href="/assets">资产</Link>
          </Button>
          <Button asChild size="sm" variant={isActiveHref(pathname, '/runs') ? 'secondary' : 'ghost'}>
            <Link href="/runs">运行</Link>
          </Button>

          {showAdmin ? (
            <Button asChild size="sm" variant={isActiveHref(pathname, '/schedule-groups') ? 'secondary' : 'ghost'}>
              <Link href="/schedule-groups">调度组</Link>
            </Button>
          ) : null}

          {showAdmin ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant={activeInConfig ? 'secondary' : 'ghost'}
                  className={cn('gap-1', activeInConfig && 'font-semibold')}
                >
                  配置中心
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {CONFIG_CENTER_LINKS.map((l) => (
                  <DropdownMenuItem key={l.href} asChild>
                    <Link href={l.href}>{l.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {showAdmin ? (
            <Button asChild size="sm" variant={isActiveHref(pathname, '/exports') ? 'secondary' : 'ghost'}>
              <Link href="/exports">导出</Link>
            </Button>
          ) : null}

          {showAdmin ? (
            <Button asChild size="sm" variant={isActiveHref(pathname, '/duplicate-candidates') ? 'secondary' : 'ghost'}>
              <Link href="/duplicate-candidates">重复中心</Link>
            </Button>
          ) : null}

          {showAdmin ? (
            <Button asChild size="sm" variant={isActiveHref(pathname, '/api/docs') ? 'secondary' : 'ghost'}>
              <Link href="/api/docs">API 文档</Link>
            </Button>
          ) : null}

          <Button asChild size="sm" variant={isActiveHref(pathname, '/') ? 'secondary' : 'ghost'}>
            <Link href="/">概览</Link>
          </Button>
        </nav>

        <div className="shrink-0 text-xs text-muted-foreground">{showAdmin ? 'admin' : 'user'}</div>
      </div>

      {showAdmin && activeInConfig ? (
        <div className="border-t bg-muted/40" aria-label="配置中心二级导航">
          <div className="flex h-10 items-center gap-1 px-4">
            {CONFIG_CENTER_LINKS.map((l) => (
              <Button key={l.href} asChild size="sm" variant={isActiveHref(pathname, l.href) ? 'secondary' : 'ghost'}>
                <Link href={l.href}>{l.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
