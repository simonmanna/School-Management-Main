import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@erp/shared';

/**
 * Exposes the permission catalog (resource + action) for the admin UI so it
 * can render a permission matrix without bundling its own copy of the keys.
 *
 * Was @Public on the rationale that the login screen reads the catalog before
 * authenticating. Nothing does: the only consumer is `usePermissionCatalog` in
 * the staff admin screens, which is already behind auth. The response is static
 * and carries no tenant data, but a full map of every capability in the system
 * is free reconnaissance, so it now requires a session.
 */
@ApiTags('auth')
@Controller('auth/permissions')
export class PermissionsController {
  @Get()
  catalog() {
    // Flatten the nested PERMISSIONS object into the { resource, action, key }
    // shape the admin matrix expects. We group by top-level key (e.g.
    // "organization", "user", "pos") which corresponds to the sidebar nav.
    const groups: { resource: string; permissions: { action: string; key: string }[] }[] = [];
    for (const [group, value] of Object.entries(PERMISSIONS as Record<string, unknown>)) {
      const permissions: { action: string; key: string }[] = [];
      if (typeof value === 'string') {
        const [resource, action] = value.split(':');
        permissions.push({ action: action ?? value, key: value });
      } else if (value && typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) {
          if (typeof v === 'string') {
            const [resource, action] = v.split(':');
            permissions.push({ action: action ?? v, key: v });
          }
        }
      }
      if (permissions.length > 0) {
        groups.push({ resource: group, permissions });
      }
    }
    return { groups };
  }
}
