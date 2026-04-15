import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Building2, Inbox, ShieldCheck, BarChart3, Settings, LogOut, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  badge?: number
}

interface SidebarProps {
  companyName: string
  pendingCount?: number
  criticalCount?: number
}

const navItems = (pendingCount: number, criticalCount: number): NavItem[] => [
  { label: 'Profile', to: '/profile', icon: Building2 },
  { label: 'Inbox', to: '/inbox', icon: Inbox, badge: pendingCount || undefined },
  { label: 'Compliance', to: '/compliance', icon: ShieldCheck, badge: criticalCount || undefined },
  { label: 'Dashboard', to: '/dashboard', icon: BarChart3 },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export default function Sidebar({ companyName, pendingCount = 0, criticalCount = 0 }: SidebarProps) {
  const navigate = useNavigate()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-[#0F172A] text-white shrink-0">
      {/* Brand */}
      <div className="px-6 py-5 border-b border-white/10">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Supplier Portal</p>
        <h2 className="text-sm font-semibold text-white truncate">{companyName}</h2>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems(pendingCount, criticalCount).map(({ label, to, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group',
                isActive
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {badge !== undefined && badge > 0 && (
              <span className="bg-[#0369A1] text-white text-xs font-semibold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                {badge}
              </span>
            )}
            <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-white/10">
        <button
          onClick={() => setConfirmOpen(true)}
          className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-all duration-150 cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out of Supplier Command Center?</DialogTitle>
            <DialogDescription>
              You'll need to sign in again to access your portal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleLogout}
              className="bg-[#0369A1] hover:bg-[#0284C7] text-white"
            >
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}
