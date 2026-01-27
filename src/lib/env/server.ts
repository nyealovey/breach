import { z } from 'zod/v4';

import { createEnv } from '@t3-oss/env-nextjs';

export const serverEnv = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    ASSET_LEDGER_SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),
    ASSET_LEDGER_WORKER_POLL_MS: z.coerce.number().int().positive().default(2_000),
    ASSET_LEDGER_WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(1),
    ASSET_LEDGER_PLUGIN_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

    ASSET_LEDGER_VCENTER_PLUGIN_PATH: z.string().min(1).optional(),
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
  experimental__runtimeEnv: {},
});
