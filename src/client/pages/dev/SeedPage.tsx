import { useState } from 'react'
import { seedAcme } from '@/lib/seed'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SeedPage() {
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSeed = async () => {
    setLoading(true)
    setStatus(null)
    const result = await seedAcme()
    setStatus(result.message)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Dev: Seed Acme Tech Solutions</CardTitle>
          <CardDescription>
            Loads Acme Tech Solutions test data into Supabase for the current logged-in user.
            Only available in development.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={handleSeed}
            disabled={loading}
            className="bg-[#0369A1] hover:bg-[#0284C7] text-white cursor-pointer"
          >
            {loading ? 'Seeding…' : 'Seed Acme Data'}
          </Button>
          {status && (
            <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{status}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
