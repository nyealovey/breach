import { bootstrapAdmin } from '@/lib/auth/bootstrap-admin';

async function main() {
  await bootstrapAdmin();
  console.log('[bootstrap-admin] ensured default admin exists (username=admin)');
}

main().catch((err) => {
  console.error('[bootstrap-admin] failed', err);
  process.exit(1);
});
