/**
 * User Switcher — quick POS user switch from the topbar.
 *
 * Shows current user avatar + name. Clicking the badge opens a dropdown with:
 *   - Change PIN
 *   - Switch User
 *   - Logout
 */
import React, { useState } from 'react';
import { LogOut, Repeat, ChevronDown, LockKeyhole, KeyRound } from 'lucide-react';
import { usePosAuthStore } from '@/features/pos/pos-auth.store';
import PosLoginScreen from './PosLoginScreen';
import { PosChangePinDialog } from './PosChangePinDialog';
import { PosChangePasswordDialog } from './PosChangePasswordDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  onUserChanged: () => void;
}

export const UserSwitcher: React.FC<Props> = ({ onUserChanged }) => {
  const user = usePosAuthStore((s) => s.user);
  const logout = usePosAuthStore((s) => s.logout);
  const [switching, setSwitching] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  if (!user && !switching) return null;

  const handleSwitch = () => {
    logout();
    setSwitching(true);
  };

  const handleLogout = () => {
    logout();
    onUserChanged();
  };

  return (
    <>
      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/10 border border-white/15 hover:bg-white/15 transition-colors">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-[10px] font-extrabold text-white">
                {((user.firstName?.[0] || '') + (user.lastName?.[0] || '')).toUpperCase() || '?'}
              </div>
              <span className="text-xs font-semibold text-white">{user.firstName}</span>
              <ChevronDown className="h-3 w-3 text-slate-300" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-slate-800 border-slate-600 text-white">
            <DropdownMenuItem onSelect={() => setTimeout(() => setChangePinOpen(true), 50)}>
              <LockKeyhole className="mr-2 h-4 w-4" /> Change PIN
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setChangePasswordOpen(true), 50)}>
              <KeyRound className="mr-2 h-4 w-4" /> Change Password
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSwitch}>
              <Repeat className="mr-2 h-4 w-4" /> Switch User
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Full-screen PIN login when switching */}
      {switching && <PosLoginScreen onLoggedIn={() => { setSwitching(false); onUserChanged(); }} />}

      {/* Change PIN dialog */}
      <PosChangePinDialog open={changePinOpen} onOpenChange={setChangePinOpen} />

      {/* Change Password dialog */}
      <PosChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </>
  );
};
