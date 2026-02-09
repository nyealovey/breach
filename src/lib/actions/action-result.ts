export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function actionOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

export function getActionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message.trim();
    return msg.length > 0 ? msg : fallback;
  }
  if (typeof err === 'string') {
    const msg = err.trim();
    return msg.length > 0 ? msg : fallback;
  }
  return fallback;
}
