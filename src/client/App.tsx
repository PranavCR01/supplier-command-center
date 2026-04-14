import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/LoginPage'
import SignupPage from '@/pages/auth/SignupPage'
import ProfilePage from '@/pages/profile/ProfilePage'
import SeedPage from '@/pages/dev/SeedPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5, retry: 1 },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Protected — wrapped in AppShell */}
          <Route element={<AppShell />}>
            <Route path="/profile" element={<ProfilePage />} />
            {/* Slice 2+ routes added here */}
            <Route path="/inbox" element={<ComingSoon label="Smart Inbox" />} />
            <Route path="/compliance" element={<ComingSoon label="Compliance Tracker" />} />
            <Route path="/dashboard" element={<ComingSoon label="Buyer Dashboard" />} />
            <Route path="/settings" element={<ComingSoon label="Settings" />} />
          </Route>

          {/* Dev only */}
          {import.meta.env.DEV && <Route path="/dev/seed" element={<SeedPage />} />}

          <Route path="/" element={<Navigate to="/profile" replace />} />
          <Route path="*" element={<Navigate to="/profile" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-64 text-center">
      <h2 className="text-lg font-semibold text-[#0F172A]">{label}</h2>
      <p className="text-slate-400 text-sm mt-1">Coming in the next slice.</p>
    </div>
  )
}
