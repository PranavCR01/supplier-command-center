import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setEmail(session.user.email ?? null)
    })
  }, [])

  const handlePasswordReset = async () => {
    if (!email) return
    setResetting(true)
    setResetError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/profile',
    })
    setResetting(false)
    if (error) {
      setResetError(error.message)
    } else {
      setResetSent(true)
    }
  }

  return (
    <div className="px-6 py-6 max-w-2xl">
      {/* Page header */}
      <div className="flex items-center gap-2 mb-5">
        <Settings className="w-5 h-5 text-[#0369A1]" />
        <h1 className="text-lg font-semibold text-[#0F172A]">Settings</h1>
      </div>

      {/* Account section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 mb-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[#0F172A] mb-4">Account</h2>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-slate-400 mb-1">Email address</p>
            <p className="text-sm text-[#334155] font-medium">{email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-2">Password</p>
            {resetSent ? (
              <p className="text-sm text-emerald-600">
                Password reset email sent. Check your inbox.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePasswordReset}
                  disabled={!email || resetting}
                  className="w-fit text-sm"
                >
                  {resetting ? 'Sending…' : 'Send password reset email'}
                </Button>
                {resetError && (
                  <p className="text-xs text-red-500">{resetError}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* About section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-[#0F172A] mb-4">About</h2>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Version</span>
            <span className="font-medium text-[#334155]">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Platform</span>
            <span className="font-medium text-[#334155]">Supplier Command Center</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Documentation</span>
            <a
              href="https://github.com/PranavCR01/supplier-command-center"
              target="_blank"
              rel="noreferrer"
              className="text-[#0369A1] font-medium hover:underline"
            >
              GitHub →
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
