import React from 'react';
import {
  Search,
  Maximize2,
  Minimize2,
  LogOut,
  BarChart3,
  PowerOff,
  User as UserIcon,
  LayoutGrid,
  ClipboardList,
  PowerCircle,
} from 'lucide-react';
import type { CashSession } from './types';
import { UserSwitcher } from './UserSwitcher';

interface Props {
  search: string;
  onSearch: (v: string) => void;
  onOpenReports: () => void;
  onOpenShift: () => void;
  onCloseShift: () => void;
  onOpenTableSelector?: () => void;
  activeTableLabel?: string | null;
  staffName?: string;
  staffRole?: string;
  session: CashSession | null;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onLogout: () => void;
  onUserChanged: () => void;
  onOpenHeldOrders?: () => void;
  /** Odoo-style Orders panel opener + live count for the nav badge. */
  onOpenOrders?: () => void;
  ordersCount?: number;
  /** Dine-in: show the table-selector button; takeaway/delivery: hide it. */
  orderType?: 'dine-in' | 'takeaway' | 'delivery';
  /** Extra nodes pinned to the right cluster (e.g. the offline indicator). */
  rightExtras?: React.ReactNode;
}

const initials = (name?: string) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
};

export const Topbar: React.FC<Props> = ({
  search,
  onSearch,
  onOpenReports,
  onOpenShift,
  onCloseShift,
  onOpenTableSelector,
  activeTableLabel,
  staffName,
  staffRole,
  session,
  fullscreen,
  onToggleFullscreen,
  onLogout,
  onUserChanged,
  onOpenHeldOrders,
  onOpenOrders,
  ordersCount = 0,
  orderType,
  rightExtras,
}) => {
  const shiftOpen = !!session && session.status === 'open';

  return (
    <div className="pos-topbar-pro">

      {/* Shift indicator pill */}
      <button
        type="button"
        className={`pos-nav-btn ${shiftOpen ? 'pos-nav-btn--open' : 'pos-nav-btn--closed'}`}
        onClick={shiftOpen ? onCloseShift : onOpenShift}
        title={shiftOpen ? 'Close current shift' : 'Open shift to start selling'}
      >
        {shiftOpen ? <PowerCircle className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
        {shiftOpen ? (
          <>
            <span>Shift Close</span>
            <span className="pos-active-dot" />
          </>
        ) : (
          <span>Open Shift</span>
        )}
      </button>

      {/* Orders (Odoo-style multi-order panel) */}
      {onOpenOrders && (
        <button
          type="button"
          className="pos-nav-btn"
          onClick={onOpenOrders}
          title="Open orders — resume any order"
        >
          <ClipboardList className="h-4 w-4" />
          <span>Orders</span>
          {ordersCount > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-white/90 text-slate-900 text-[11px] font-bold leading-none">
              {ordersCount}
            </span>
          ) : null}
        </button>
      )}

      {/* Held Orders (legacy) */}
      {onOpenHeldOrders && (
        <button
          type="button"
          className="pos-nav-btn"
          onClick={onOpenHeldOrders}
          title="View held orders"
        >
          <ClipboardList className="h-4 w-4" />
          <span>Held Orders</span>
        </button>
      )}

      {/* Table selector (dine-in only) */}
      {onOpenTableSelector && orderType === 'dine-in' && (
        <>
        <button
          type="button"
          className={`pos-nav-btn ${activeTableLabel ? 'pos-nav-btn--open' : ''}`}
          onClick={onOpenTableSelector}
          title="Choose a table"
        >
          <LayoutGrid className="h-4 w-4" />
          <span>{'Tables'}</span>
          {activeTableLabel ? <span className="pos-active-dot" /> : null}
        </button>
        <span>{activeTableLabel}</span>
                  </>
      )}

      {/* Reports */}
      <button type="button" className="pos-nav-btn" onClick={onOpenReports} title="X / Z reports + sales analytics">
        <BarChart3 className="h-4 w-4" />
        <span>Reports</span>
      </button>

      {/* Search */}
      <div className="pos-searchbar-pro ml-2">
        <Search className="pos-search-icon h-4 w-4" />
        <input
          type="text"
          placeholder="Search menu or scan barcode…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          autoFocus
        />
        <span className="pos-search-kbd">/</span>
      </div>

      <div className="flex-1" />

      {/* Right-cluster extras (e.g. offline indicator) */}
      {rightExtras ? <div className="flex items-center mr-1">{rightExtras}</div> : null}

      {/* POS User Switcher — PIN‑logged cashier */}
      <UserSwitcher onUserChanged={onUserChanged} />

      {/* Staff badge */}
      <div className="pos-staff-pill">
        <UserIcon className="h-3.5 w-3.5" />
        <span className="pos-staff-avatar">{initials(staffName)}</span>
        <span>{staffName || 'Guest'}</span>
        {staffRole ? <span className="opacity-70">· {staffRole}</span> : null}
      </div>

      <button
        type="button"
        className="pos-icon-btn ml-2"
        onClick={onToggleFullscreen}
        title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      >
        {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      <button type="button" className="pos-icon-btn ml-1" onClick={onLogout} title="Sign out">
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
};