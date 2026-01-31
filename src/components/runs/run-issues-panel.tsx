import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getRunErrorUiMeta } from '@/lib/runs/run-error-actions';
import { groupRunIssuesByCode, parseRunIssues, sanitizeRedactedContext } from '@/lib/runs/run-issues';

type RunIssuesPanelProps = {
  title: string;
  issues: unknown;
  defaultOpen?: boolean;
};

export function RunIssuesPanel({ title, issues, defaultOpen }: RunIssuesPanelProps) {
  const parsed = parseRunIssues(issues);
  const groups = groupRunIssuesByCode(parsed);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {title}（{parsed.length}）
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {parsed.length === 0 ? (
          <div className="text-sm text-muted-foreground">暂无。</div>
        ) : (
          groups.map((group) => {
            const meta = getRunErrorUiMeta(group.code);
            return (
              <details key={group.code} open={defaultOpen}>
                <summary className="cursor-pointer select-none text-sm">
                  <span className="font-mono">{group.code}</span>
                  <span className="ml-2 text-muted-foreground">{meta.title}</span>
                  <span className="ml-2 text-muted-foreground">({group.issues.length})</span>
                </summary>
                <div className="mt-2 space-y-3 border-l pl-4">
                  {group.issues.map((issue, index) => {
                    const context = sanitizeRedactedContext(issue.redacted_context);
                    return (
                      <div key={`${group.code}_${index}`} className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {issue.category ? <span>category={issue.category}</span> : null}
                          {typeof issue.retryable === 'boolean' ? (
                            <Badge variant={issue.retryable ? 'default' : 'secondary'}>
                              {issue.retryable ? 'retryable' : 'not retryable'}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="text-sm">{issue.message ?? '-'}</div>
                        {context ? (
                          <pre className="max-h-40 overflow-auto rounded bg-muted p-3 text-xs">
                            {JSON.stringify(context, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
