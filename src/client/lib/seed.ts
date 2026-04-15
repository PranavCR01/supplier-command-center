/**
 * Dev seed — loads Acme Tech Solutions test data into Supabase.
 * Only call in development. Invoke from /dev/seed route or browser console:
 *   import { seedAcme } from '@/lib/seed'; seedAcme();
 */

import { supabase } from './supabase'
import acmeData from '../../../test_data/suppliers/acme_tech_solutions.json'
import inboxData from '../../../test_data/buyer-requests/inbox_messages.json'
import complianceData from '../../../test_data/compliance/compliance_tracker.json'

// Match a DB cert name to the compliance tracker's required_by list.
// Uses substring matching since names differ slightly (e.g. "Cyber Liability" vs "Cyber Liability Insurance").
function lookupRequiredBy(certName: string): string[] {
  const item = complianceData.compliance_items.find(
    (c) =>
      c.name.toLowerCase().includes(certName.toLowerCase()) ||
      certName.toLowerCase().includes(c.name.toLowerCase())
  )
  return item?.required_by ?? []
}

export async function seedAcme(): Promise<{ success: boolean; message: string }> {
  if (import.meta.env.PROD) {
    return { success: false, message: 'Seed only runs in development.' }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { success: false, message: 'Not authenticated.' }

  // Get or create supplier record
  let supplierId: string

  const { data: existingSupplier } = await supabase
    .from('suppliers')
    .select('id')
    .eq('user_id', session.user.id)
    .single()

  if (existingSupplier) {
    supplierId = existingSupplier.id
  } else {
    const { data: newSupplier, error: createError } = await supabase
      .from('suppliers')
      .insert({ user_id: session.user.id, company_name: acmeData.company.name })
      .select('id')
      .single()

    if (createError || !newSupplier) {
      return { success: false, message: `Failed to create supplier record: ${createError?.message ?? 'unknown error'}` }
    }

    supplierId = newSupplier.id
  }

  // Update company info
  await supabase.from('suppliers').update({
    company_name: acmeData.company.name,
    dba: acmeData.company.dba,
    founded_year: acmeData.company.founded,
    headquarters: acmeData.company.headquarters,
    employees: acmeData.company.employees,
    annual_revenue: acmeData.company.annual_revenue,
    website: acmeData.company.website,
    ein: acmeData.company.ein,
    updated_at: new Date().toISOString(),
  }).eq('id', supplierId)

  // Seed contacts (upsert by supplier)
  await supabase.from('supplier_contacts').delete().eq('supplier_id', supplierId)
  await supabase.from('supplier_contacts').insert([
    {
      supplier_id: supplierId,
      name: acmeData.contact.primary.name,
      title: acmeData.contact.primary.title,
      email: acmeData.contact.primary.email,
      phone: acmeData.contact.primary.phone,
      is_primary: true,
      type: 'primary',
    },
    {
      supplier_id: supplierId,
      name: acmeData.contact.ar_contact.name,
      title: acmeData.contact.ar_contact.title,
      email: acmeData.contact.ar_contact.email,
      phone: acmeData.contact.ar_contact.phone,
      is_primary: false,
      type: 'ar',
    },
  ])

  // Seed certifications
  await supabase.from('certifications').delete().eq('supplier_id', supplierId)
  const certs = acmeData.certifications.map((c) => ({
    supplier_id: supplierId,
    name: c.name,
    issuer: c.issuer,
    cert_number: c.cert_number,
    issued_date: c.issued,
    expiry_date: c.expires,
    status: c.status as 'active' | 'expired' | 'expiring_soon' | 'critical',
    category: 'certification' as const,
    required_by: lookupRequiredBy(c.name),
  }))

  const insurance = [
    { name: 'General Liability', issuer: acmeData.insurance.general_liability.carrier, cert_number: acmeData.insurance.general_liability.policy_number, expiry_date: '2027-06-30', status: acmeData.insurance.general_liability.status },
    { name: 'Professional Liability', issuer: acmeData.insurance.professional_liability.carrier, cert_number: acmeData.insurance.professional_liability.policy_number, expiry_date: '2027-06-30', status: acmeData.insurance.professional_liability.status },
    { name: 'Cyber Liability', issuer: acmeData.insurance.cyber_liability.carrier, cert_number: acmeData.insurance.cyber_liability.policy_number, expiry_date: acmeData.insurance.cyber_liability.expires, status: acmeData.insurance.cyber_liability.status },
    { name: 'Workers Compensation', issuer: acmeData.insurance.workers_comp.carrier, cert_number: acmeData.insurance.workers_comp.policy_number, expiry_date: '2027-12-31', status: acmeData.insurance.workers_comp.status },
  ].map((ins) => ({
    supplier_id: supplierId,
    name: ins.name,
    issuer: ins.issuer,
    cert_number: ins.cert_number,
    issued_date: null,
    expiry_date: ins.expiry_date,
    status: (ins.status.toLowerCase() === 'expiring_soon' ? 'expiring_soon' : ins.status.toLowerCase()) as 'active' | 'expired' | 'expiring_soon' | 'critical',
    category: 'insurance' as const,
    required_by: lookupRequiredBy(ins.name),
  }))

  const diversity = [{
    supplier_id: supplierId,
    name: acmeData.diversity.classifications.join(', '),
    issuer: acmeData.diversity.certifying_body,
    cert_number: acmeData.diversity.cert_number,
    issued_date: null,
    expiry_date: acmeData.diversity.expires,
    status: 'active' as const,
    category: 'diversity' as const,
    required_by: [],
  }]

  await supabase.from('certifications').insert([...certs, ...insurance, ...diversity])

  // Seed buyer relationships
  await supabase.from('buyer_relationships').delete().eq('supplier_id', supplierId)
  await supabase.from('buyer_relationships').insert(
    acmeData.active_buyers.map((b) => ({
      supplier_id: supplierId,
      buyer_name: b.buyer_name,
      platform: b.platform,
      vendor_id: b.vendor_id,
      since_date: b.since,
      annual_spend: b.annual_spend,
      status: b.status as 'preferred' | 'approved' | 'onboarding' | 'inactive',
    }))
  )

  // Seed inbox requests
  await supabase.from('inbox_requests').delete().eq('supplier_id', supplierId)
  await supabase.from('inbox_requests').insert(
    inboxData.map((msg) => ({
      supplier_id:   supplierId,
      type:          msg.type,
      priority:      msg.priority,
      deadline:      msg.deadline,
      received_at:   msg.received_at,
      from_buyer:    msg.from.buyer_name,
      from_contact:  msg.from.contact_name,
      from_email:    msg.from.contact_email,
      from_platform: msg.from.platform,
      subject:       msg.subject,
      body:          msg.body,
      status:        msg.status,
      tags:          msg.tags,
      attachments:   msg.attachments,
    }))
  )

  return { success: true, message: 'Acme Tech Solutions seeded successfully.' }
}
