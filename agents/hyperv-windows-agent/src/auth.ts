export function parseBearerToken(value: string | null): string | null {
  if (!value) return null;
  const m = /^\s*Bearer\s+(.+)\s*$/i.exec(value);
  if (!m) return null;
  const token = m[1]?.trim() ?? '';
  return token.length > 0 ? token : null;
}

export function isAuthorized(headers: Headers, expectedToken: string): boolean {
  const token = parseBearerToken(headers.get('authorization'));
  return !!token && token === expectedToken;
}
