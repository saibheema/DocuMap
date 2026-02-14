# DocuMap UI Screen Plan (Core Functionality Unchanged)

## Goal
Keep the same core flow (reference ingestion -> mapping -> template reuse -> job tracking) while presenting a complete SaaS-style interface for multi-tenant operations.

## Screen Map

1. Home / Product Landing
- Path: `/`
- Purpose: SaaS positioning and entry point into app.

2. Dashboard
- Path: `/dashboard`
- Purpose: Tenant-level KPIs, activity feed, and quick actions.
- API: `GET /dashboard/summary`

3. Source Connections
- Path: `/connections`
- Purpose: Define tenant-specific input/output client folder references.
- API: `GET /source-connections`, `POST /source-connections`, `PATCH /source-connections/:id/deactivate`

4. Reference Ingestion
- Path: `/ingestion`
- Purpose: Register file references without uploading binaries.
- API: `GET /upload`, `POST /upload`, `PATCH /upload/:id/status`

5. Mapping Studio
- Path: `/mapping`
- Purpose: Drag-and-drop source fields to output schema, validation and preview.
- API (next integration): `POST /preview`, template save endpoints.

6. Templates
- Path: `/templates`
- Purpose: Create, clone, activate/deactivate templates.
- API: `GET /templates`, `POST /templates`, `POST /templates/:id/clone`, `PATCH /templates/:id/deactivate`

7. Jobs
- Path: `/jobs`
- Purpose: Monitor processing lifecycle and review statuses.
- API: `GET /mapping-jobs`, `POST /mapping-jobs`, `PATCH /mapping-jobs/:id/status`, `GET /mapping-jobs/:id`

## UX Notes
- Tenant context is visible in the top shell on all app pages.
- Data residency message is shown in dashboard and policy endpoints.
- Core business behavior remains the same; UI is expanded for operational completeness.

## Next UI Integration Steps
1. Wire each screen to live API data using tenant header `x-tenant-id`.
2. Replace local state in `/connections` and `/ingestion` with real API mutations.
3. Connect `/mapping` “Save Template” to `POST /templates` with user-built mappings.
4. Add optimistic updates and toast notifications for create/update actions.
