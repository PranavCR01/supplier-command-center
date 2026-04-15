import { useCallback, useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { seedAcme } from '@/lib/seed'
import { Button } from '@/components/ui/button'
import CompanyInfoCard from '@/components/profile/CompanyInfoCard'
import ContactCard from '@/components/profile/ContactCard'
import CertificationsCard from '@/components/profile/CertificationsCard'
import BuyerRelationshipsCard from '@/components/profile/BuyerRelationshipsCard'
import type { Supplier, SupplierContact, Certification, BuyerRelationship } from '../../../types'

interface ProfileData {
  supplier: Supplier
  contacts: SupplierContact[]
  certifications: Certification[]
  buyers: BuyerRelationship[]
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'empty'; seeding: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; data: ProfileData }

export default function ProfilePage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  const loadProfile = useCallback(async () => {
    setState({ kind: 'loading' })
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('*')
      .eq('user_id', session.user.id)
      .single()

    if (!supplier) {
      if (supplierError?.code === 'PGRST116') {
        setState({ kind: 'empty', seeding: false })
      } else {
        setState({ kind: 'error', message: supplierError?.message ?? 'Could not load supplier profile.' })
      }
      return
    }

    const [contactsRes, certsRes, buyersRes] = await Promise.all([
      supabase.from('supplier_contacts').select('*').eq('supplier_id', supplier.id),
      supabase.from('certifications').select('*').eq('supplier_id', supplier.id),
      supabase.from('buyer_relationships').select('*').eq('supplier_id', supplier.id),
    ])

    setState({
      kind: 'loaded',
      data: {
        supplier: supplier as Supplier,
        contacts: (contactsRes.data ?? []) as SupplierContact[],
        certifications: (certsRes.data ?? []) as Certification[],
        buyers: (buyersRes.data ?? []) as BuyerRelationship[],
      },
    })
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handleLoadDemo = async () => {
    setState({ kind: 'empty', seeding: true })
    await seedAcme()
    await loadProfile()
  }

  const handleStartFromScratch = async () => {
    setState({ kind: 'loading' })
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await supabase.from('suppliers').insert({
      user_id: session.user.id,
      company_name: 'My Company',
    })
    await loadProfile()
  }

  if (state.kind === 'loading') {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-slate-400 text-sm">Loading profile…</div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {state.message}
        </div>
      </div>
    )
  }

  if (state.kind === 'empty') {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="max-w-md w-full text-center">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-[#EFF6FF] flex items-center justify-center">
              <Building2 className="w-7 h-7 text-[#0369A1]" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-[#0F172A] mb-2">
            Welcome to your Supplier Portal
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Your portal is ready. Load demo data to explore all features, or build your profile manually.
          </p>
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleLoadDemo}
              disabled={state.seeding}
              className="w-full bg-[#0369A1] hover:bg-[#0284C7] text-white font-semibold"
            >
              {state.seeding ? 'Setting up your workspace…' : 'Load demo data'}
            </Button>
            <Button
              variant="outline"
              onClick={handleStartFromScratch}
              disabled={state.seeding}
              className="w-full"
            >
              Start from scratch
            </Button>
          </div>
        </div>
      </div>
    )
  }

  const { data } = state

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="pb-2">
        <h1 className="text-2xl font-bold text-[#0F172A]">{data.supplier.company_name}</h1>
        {data.supplier.dba && (
          <p className="text-sm text-slate-500 mt-0.5">DBA: {data.supplier.dba}</p>
        )}
      </div>

      <CompanyInfoCard
        supplier={data.supplier}
        onUpdate={(updated) => setState({ kind: 'loaded', data: { ...data, supplier: updated } })}
      />
      <ContactCard contacts={data.contacts} />
      <CertificationsCard items={data.certifications} category="certification" title="Certifications" />
      <CertificationsCard items={data.certifications} category="insurance" title="Insurance" />
      <CertificationsCard items={data.certifications} category="diversity" title="Diversity & Inclusion" />
      <BuyerRelationshipsCard buyers={data.buyers} />
    </div>
  )
}
