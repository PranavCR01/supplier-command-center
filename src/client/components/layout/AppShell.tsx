import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Sidebar from './Sidebar'

export default function AppShell() {
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState('Loading…')
  const [checking, setChecking] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        navigate('/login')
        return
      }

      const { data: supplier } = await supabase
        .from('suppliers')
        .select('company_name')
        .eq('user_id', session.user.id)
        .single()

      if (supplier) setCompanyName(supplier.company_name)
      setChecking(false)
    }

    checkAuth()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') navigate('/login')
    })

    return () => subscription.unsubscribe()
  }, [navigate])

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="text-[#334155] text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      {/* Desktop: fixed sidebar. Mobile: top bar + slide-in drawer, so pages get the full width */}
      <Sidebar companyName={companyName} className="hidden md:flex" />
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <Sidebar companyName={companyName} onNavigate={() => setMenuOpen(false)} />
          <button className="flex-1 bg-black/40 cursor-pointer" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-[#0F172A] px-4 py-3 text-white">
          <button
            onClick={() => setMenuOpen(true)}
            className="p-1 -ml-1 rounded-md hover:bg-white/10 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold truncate">{companyName}</span>
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
