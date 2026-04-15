import { useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ConfirmedPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-[#0F172A]">Supplier Command Center</h1>
          <p className="text-[#334155] mt-1 text-sm">Powered by Valorant · Astra</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-md px-8 py-10 flex flex-col items-center gap-5 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          <div>
            <h2 className="text-xl font-semibold text-[#0F172A] mb-1">Email confirmed</h2>
            <p className="text-sm text-slate-500">
              Your account is ready. Sign in to access your supplier portal.
            </p>
          </div>
          <Button
            onClick={() => navigate('/login')}
            className="w-full bg-[#0369A1] hover:bg-[#0284C7] text-white font-semibold"
          >
            Sign in
          </Button>
        </div>
      </div>
    </div>
  )
}
