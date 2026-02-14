# PDF Document Mapping Service (DocuMap)

Monorepo starter for a multi-source PDF extraction and field mapping platform.

## Included

- Intuitive Next.js UI with graphical mapping screen
- SaaS app shell with dashboard, ingestion, connections, templates, and jobs screens
- Node.js API for upload, templates, jobs, and preview
- Shared schema/types package
- Mapping file download/upload for manual backup and restore
- Docker setup for local development
- Deployment-ready structure for Google Cloud Run

## Pass 1 Workflow (Simple)

- User provides source file reference (or local file name) and source folder path.
- Source file name must follow `Source1_<filename>`.
- User can provide extracted fields for that one source file.
- Mapping canvas uses dropdown rows where user chooses only required mappings.
- Single field maps to single output field.
- Table-like values can be mapped to either a single target field or a target table name.
- On Generate, output JSON file is produced and downloaded.

## Project Structure

- `apps/web`: Next.js UI
- `apps/api`: Express API
- `packages/shared`: Shared types/schema

## Quick Start

1. Copy `.env.example` to `.env` and update values.
   - Add `NEXT_PUBLIC_TENANT_ID=<your-tenant-id>` for web app tenant context.
2. Install dependencies:
   - `npm install`
3. Start both services:
   - `npm run dev`
4. Open:
   - UI: `http://localhost:3000`
   - API: `http://localhost:4000/health`

## API Endpoints (MVP)

All endpoints except `/health` require tenant header:

- `x-tenant-id: <tenant-id>`

Each tenant is isolated logically in API storage (uploads, templates, and jobs are scoped per tenant).

Data residency model:

- Source documents remain in each company network folders.
- This app stores mapping templates, tenant metadata, file references, and statuses only.
- No binary PDF payload is persisted by API in this mode.

Persistence mode:

- Runtime storage is in-memory.
- Use `GET /templates/export` to download mapping JSON.
- Use `POST /templates/import` to upload mapping JSON after server restart (replace/merge modes).

- `POST /upload` (reference-only payload: `fileName`, `sourcePath`, optional `outputPath`)
- `GET /upload`
- `PATCH /upload/:id/status`
- `GET /source-connections`
- `POST /source-connections`
- `PATCH /source-connections/:id/deactivate`
- `GET /dashboard/summary`
- `GET /templates`
- `GET /templates/export`
- `POST /templates/import`
- `POST /templates`
- `POST /templates/:id/clone`
- `PATCH /templates/:id/deactivate`
- `GET /mapping-jobs`
- `POST /mapping-jobs`
- `GET /mapping-jobs/:id`
- `PATCH /mapping-jobs/:id/status`
- `POST /generate`
- `POST /preview`
- `GET /whoami`
- `GET /data-policy`

## UI Plan

- Screen-level plan and workflow details are in [docs/ui-screen-plan.md](docs/ui-screen-plan.md).
- UI pages load data from API endpoints (no hardcoded sample records).

## GCP Deployment Notes

- Deploy `apps/api` to Cloud Run.
- Deploy `apps/web` to Cloud Run (or App Hosting).
- Store only metadata and mapping backups (JSON files) as needed.

## Next Steps

- Integrate Docling extraction worker in `apps/api`.
- Optional: add encrypted object-store backup for mapping JSON files.
- Add authentication and role-based access.
- Add validation engine for required field and type checks.
