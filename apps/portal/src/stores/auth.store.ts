import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  roles: string[];
}

export interface SessionOrganization {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
  timezone: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
  permissions: string[];
  organization?: SessionOrganization;
}

/** One pupil this session may open. */
export interface PortalStudent {
  studentProfileId: string;
  name: string;
  admissionNo: string | null;
  classId: string | null;
  className: string | null;
}

/** `GET school/portals/me` — who the server says this session is. */
export interface PortalContext {
  kind: 'student' | 'guardian' | 'staff';
  students: PortalStudent[];
  teacher: { staffProfileId: string; partnerId: string | null; name: string } | null;
  defaultLanding: 'student' | 'parent' | 'teacher' | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: SessionUser | null;
  organization: SessionOrganization | null;
  permissions: string[];
  /**
   * Who this session speaks for, from `GET school/portals/me`.
   *
   * Cached only so the UI can render a name and a child picker without a
   * round-trip. It is NOT an authorization input: every request is re-checked
   * server-side against the token's portal claim, so tampering with what is in
   * localStorage changes what this browser draws and nothing about what the API
   * will hand over.
   */
  portal: PortalContext | null;
  /** Which child a guardian is currently looking at. Null for a single child. */
  activeStudentId: string | null;

  setSession: (payload: LoginResponse) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setPortal: (portal: PortalContext) => void;
  setActiveStudent: (id: string | null) => void;
  clear: () => void;
  hasPermission: (permission: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      organization: null,
      permissions: [],
      portal: null,
      activeStudentId: null,

      setSession: (payload) =>
        set({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          user: payload.user,
          organization: payload.organization ?? null,
          permissions: payload.permissions,
        }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setPortal: (portal) =>
        set((s) => ({
          portal,
          // Default a guardian to their first child, and correct a stale
          // selection — a pupil who left, or a browser that remembered a child
          // this account no longer holds.
          activeStudentId:
            s.activeStudentId && portal.students.some((c) => c.studentProfileId === s.activeStudentId)
              ? s.activeStudentId
              : portal.students[0]?.studentProfileId ?? null,
        })),
      setActiveStudent: (activeStudentId) => set({ activeStudentId }),

      clear: () =>
        set({
          accessToken: null,
          refreshToken: null,
          user: null,
          organization: null,
          permissions: [],
          portal: null,
          activeStudentId: null,
        }),

      hasPermission: (permission) => get().permissions.includes(permission),
    }),
    {
      // Distinct from the admin app's `cafe-pos-auth`. They are separate origins
      // in production so the keys could not collide anyway, but during local
      // development both run on localhost and a shared key would mean signing
      // into one silently signs you out of the other.
      name: 'school-portal-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        organization: state.organization,
        permissions: state.permissions,
        portal: state.portal,
        activeStudentId: state.activeStudentId,
      }),
    },
  ),
);

/** The pupil the UI is currently showing, or null. */
export function useActiveStudent(): PortalStudent | null {
  return useAuthStore((s) => {
    const list = s.portal?.students ?? [];
    if (list.length === 0) return null;
    return list.find((c) => c.studentProfileId === s.activeStudentId) ?? list[0];
  });
}
