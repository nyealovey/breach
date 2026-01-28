'use client';

import dynamic from 'next/dynamic';

import type { ComponentType } from 'react';

const SwaggerUI = dynamic(() => import('swagger-ui-react').then((mod) => mod.default as any), {
  ssr: false,
}) as unknown as ComponentType<any>;

export default function ApiDocsPage() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">API 文档</div>
          <div className="text-xs text-muted-foreground">Swagger UI · /api/openapi.json</div>
        </div>
      </div>

      <div className="overflow-hidden rounded border bg-background">
        <SwaggerUI url="/api/openapi.json" />
      </div>
    </div>
  );
}
