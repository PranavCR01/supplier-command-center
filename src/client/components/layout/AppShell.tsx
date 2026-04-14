import { useEffect, useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import Sidebar from './Sidebar'

export default function AppShell() {
  const navigate = useNavigate()
  const [companyName, setCompanyName] = useState('Loading…')
  const [checking, setChecking] = useState(true)

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
      <Sidebar companyName={companyName} />
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
