import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
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

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: supplier, error: supplierError } = await supabase
        .from('suppliers')
        .select('*')
        .eq('user_id', session.user.id)
        .single()

      if (supplierError || !supplier) {
        setError('Could not load supplier profile.')
        setLoading(false)
        return
      }

      const [contactsRes, certsRes, buyersRes] = await Promise.all([
        supabase.from('supplier_contacts').select('*').eq('supplier_id', supplier.id),
        supabase.from('certifications').select('*').eq('supplier_id', supplier.id),
        supabase.from('buyer_relationships').select('*').eq('supplier_id', supplier.id),
      ])

      setData({
        supplier: supplier as Supplier,
        contacts: (contactsRes.data ?? []) as SupplierContact[],
        certifications: (certsRes.data ?? []) as Certification[],
        buyers: (buyersRes.data ?? []) as BuyerRelationship[],
      })
      setLoading(false)
    }

    loadProfile()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-64">
        <div className="text-slate-400 text-sm">Loading profile…</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error ?? 'Something went wrong.'}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Page header */}
      <div className="pb-2">
        <h1 className="text-2xl font-bold text-[#0F172A]">{data.supplier.company_name}</h1>
        {data.supplier.dba && (
          <p className="text-sm text-slate-500 mt-0.5">DBA: {data.supplier.dba}</p>
        )}
      </div>

      {/* Company info */}
      <CompanyInfoCard
        supplier={data.supplier}
        onUpdate={(updated) => setData((prev) => prev ? { ...prev, supplier: updated } : null)}
      />

      {/* Contacts */}
      <ContactCard contacts={data.contacts} />

      {/* Certifications */}
      <CertificationsCard
        items={data.certifications}
        category="certification"
        title="Certifications"
      />

      {/* Insurance */}
      <CertificationsCard
        items={data.certifications}
        category="insurance"
        title="Insurance"
      />

      {/* Diversity */}
      <CertificationsCard
        items={data.certifications}
        category="diversity"
        title="Diversity & Inclusion"
      />

      {/* Buyers */}
      <BuyerRelationshipsCard buyers={data.buyers} />
    </div>
  )
}
