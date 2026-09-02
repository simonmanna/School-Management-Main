# Staging Parity Checklist

Staging uses `docker-compose.staging.yml` on top of the production compose definition so it
builds the same API, web and portal images and applies the same migrations.

Before a release, verify PostgreSQL/Redis image versions, migration status, feature flags,
storage driver, background workers, CORS/TLS, email sandbox, logging/redaction, error tracking,
metrics, backup destination, restore credentials and representative data volume. Differences
must be listed in the release ticket with their risk and owner.

Never copy production secrets or unrestricted personal data into staging. Use a scrubbed
restored snapshot or the Phase 0 mixed-school seed. Outbound email/SMS/payment integrations
must target sandboxes or be disabled.
