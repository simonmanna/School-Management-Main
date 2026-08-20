-- School Transport Management System (STMS) — tenant-isolation policies.
--
-- Same shape as every other org-scoped table: create the policy and FORCE ROW
-- LEVEL SECURITY, but deliberately do NOT `ENABLE ROW LEVEL SECURITY`. RLS is
-- left inert; isolation is enforced by the app-side Prisma tenancy extension.
-- The policy lies dormant until an operator turns RLS on org-wide via
-- `pnpm rls:setup-role`.
--
-- The matching app-side registration lives in ORG_SCOPED
-- (apps/api/src/kernel/prisma/tenancy.extension.ts) and is verified against the
-- schema by tenancy-registration.spec.ts.

DO $$
DECLARE
    t text;
    transport_tables text[] := ARRAY[
        'TransportSettings',
        'TransportZone',
        'TransportRouteVersion',
        'TransportRouteStop',
        'TransportCrewMember',
        'TransportCrewDocument',
        'TransportVehicleDocument',
        'TransportRequest',
        'TransportAuthorizedPerson',
        'TransportSpecialRequirement',
        'TransportSchedule',
        'TransportScheduleException',
        'TransportTrip',
        'TransportTripStop',
        'TransportTripPassenger',
        'TransportBoardingEvent',
        'TransportVehicleInspection',
        'TransportInspectionItem',
        'TransportTripEvent',
        'TransportFeePlan',
        'TransportFeePlanRate',
        'TransportDiscountRule',
        'TransportCharge',
        'TransportIncident',
        'TransportIncidentStudent',
        'TransportIncidentAction',
        'TransportEndOfTripCheck',
        'TransportDevice',
        'TransportLocationEvent',
        'TransportGeofence',
        'TransportGeofenceEvent',
        'TransportTrackingAlert',
        'TransportTripTrack',
        'Stop',
        'Route',
        'Vehicle',
        'StudentTransportAssignment'
    ];
BEGIN
    FOREACH t IN ARRAY transport_tables LOOP
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("organizationId" = current_setting(''app.org_id'', true));',
            t
        );
    END LOOP;
END $$;
