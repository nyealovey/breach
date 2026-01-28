import { randomUUID } from 'node:crypto';

export function getOrCreateRequestId(input: string | null | undefined) {
  return input && input.trim().length > 0 ? input : `req_${randomUUID()}`;
}

