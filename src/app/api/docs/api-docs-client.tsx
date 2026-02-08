'use client';

import dynamic from 'next/dynamic';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import type { ComponentType } from 'react';

const SwaggerUI = dynamic(() => import('swagger-ui-react').then((mod) => mod.default as any), {
  ssr: false,
}) as unknown as ComponentType<any>;

export function ApiDocsClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="API 文档"
        description="Swagger UI · /api/openapi.json"
        actions={
          <Button asChild size="sm" variant="outline">
            <a href="/api/openapi.json" target="_blank" rel="noreferrer">
              打开 OpenAPI JSON
            </a>
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <SwaggerUI url="/api/openapi.json" />
        </CardContent>
      </Card>
    </div>
  );
}
