import { SetMetadata } from '@nestjs/common';

export const LMS_CAPABILITY_KEY = 'lms_required_capability';
export const LMS_CAPABILITY_SOURCE_KEY = 'lms_capability_source';

/** Where the course-offering id is found on the request, so the guard can resolve the context. */
export type CapabilitySource = 'courseParam' | 'moduleParam' | 'sectionParam' | 'bodyCourse';

/**
 * Require an LMS capability (fine gate) in addition to the route's coarse
 * `@RequirePermissions`. `source` tells the guard how to find the course:
 *  - courseParam  → req.params.id is a CourseOffering id (default)
 *  - moduleParam  → req.params.id is a CourseModule id → look up its offering
 *  - sectionParam → req.params.id is a CourseSection id → look up its offering
 *  - bodyCourse   → req.body.courseOfferingId
 */
export function RequireCapability(capability: string, source: CapabilitySource = 'courseParam') {
  return (target: object, key: string | symbol, descriptor: PropertyDescriptor) => {
    SetMetadata(LMS_CAPABILITY_KEY, capability)(target, key, descriptor);
    SetMetadata(LMS_CAPABILITY_SOURCE_KEY, source)(target, key, descriptor);
    return descriptor;
  };
}
