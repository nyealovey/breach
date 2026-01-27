# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Requirements

- **永远使用中文回复**
- **每次输出信息前必须加称谓：以「金主大人」开头**
- 任何用户可见改动都要同步写文档（优先更新 README.md）

## Build & Development Commands

```bash
# Package manager: Bun (lockfile: bun.lock)
bun install                    # Install dependencies
bun run dev                    # Start dev server (http://localhost:3000)
bun run build                  # Production build
bun run start                  # Start production server

# Database (Prisma + PostgreSQL)
bun run db:generate            # Generate Prisma Client
bun run db:migrate             # Run migrations (dev)
bun run db:studio              # Open Prisma Studio

# Asset Ledger services (run in separate terminals)
bun run scheduler              # Start scheduler (creates Runs at scheduled times)
bun run worker                 # Start worker (processes queued Runs)

# Quality checks (all must pass before commit)
bun run type-check             # TypeScript type checking
bun run lint                   # ESLint
bun run lint:fix               # ESLint auto-fix
bun run format:check           # Prettier check
bun run format                 # Prettier format
```

## Architecture Overview

This is an **Asset Ledger System (资产台账系统)** for collecting and tracking IT assets from virtualization platforms (vCenter MVP, with PVE/Hyper-V/Aliyun planned).

### Three-Component Architecture

1. **Web/API (Next.js 16 App Router)** - UI and REST API for managing Sources, Runs, Assets
2. **Scheduler (`src/bin/scheduler.ts`)** - Creates Runs at configured times per ScheduleGroup (timezone-aware, idempotent)
3. **Worker (`src/bin/worker.ts`)** - Claims queued Runs via `FOR UPDATE SKIP LOCKED`, spawns collector plugins as child processes

### Plugin Contract

Collectors communicate via JSON stdin/stdout:
- Input: `collector-request-v1` (source config, credentials, run metadata)
- Output: `collector-response-v1` (assets, relations, stats, errors)
- Modes: `healthcheck`, `detect`, `collect`

### Database Models (Prisma)

- **ScheduleGroup** - Scheduling config (timezone, runAtHhmm), tracks lastTriggeredDate
- **Source** - Collection source (vcenter/pve/hyperv/aliyun), stores config JSON
- **Run** - Execution record with status (Queued→Running→Succeeded/Failed/Cancelled)

## Code Style

- **Indentation**: 2 spaces
- **Line width**: 120 characters
- **Path aliases**: `@/*` → `src/*`, `@/public/*` → `public/*`
- **Commits**: Conventional Commits (feat:/fix:/chore:), enforced by commitlint

## Environment Variables

Required for production:
- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - Session signing key
- `PASSWORD_ENCRYPTION_KEY` - Source credential encryption (32 bytes, base64url)
- `ASSET_LEDGER_ADMIN_PASSWORD` - Initial admin password (first run only)

Generate secrets:
```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"  # SECRET_KEY
python -c "import base64, os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"  # PASSWORD_ENCRYPTION_KEY
```

## Documentation

- **Overview**: `docs/index.md` (explains PRD vs SRS layering)
- **Requirements**: `docs/requirements/asset-ledger-srs.md`, `docs/prds/`
- **Design**: `docs/design/` (data model, JSON schema, logging spec, error codes, collector reference)
- **Environment schema**: `src/lib/env/server.ts` (T3 Env with Zod validation)
