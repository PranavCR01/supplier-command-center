import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, Pencil, X, Check, Globe, MapPin, Users, Calendar, DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import type { Supplier } from '../../../types'

const schema = z.object({
  company_name: z.string().min(1, 'Required'),
  dba: z.string().nullable(),
  headquarters: z.string().nullable(),
  founded_year: z.coerce.number().int().min(1800).max(2100).nullable(),
  employees: z.coerce.number().int().min(1).nullable(),
  annual_revenue: z.string().nullable(),
  website: z.string().nullable(),
  ein: z.string().nullable(),
})

type FormData = z.infer<typeof schema>

interface Props {
  supplier: Supplier
  onUpdate: (updated: Supplier) => void
}

export default function CompanyInfoCard({ supplier, onUpdate }: Props) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name: supplier.company_name,
      dba: supplier.dba,
      headquarters: supplier.headquarters,
      founded_year: supplier.founded_year,
      employees: supplier.employees,
      annual_revenue: supplier.annual_revenue,
      website: supplier.website,
      ein: supplier.ein,
    },
  })

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    setSaveError(null)
    const { data: updated, error } = await supabase
      .from('suppliers')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', supplier.id)
      .select()
      .single()

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    onUpdate(updated as Supplier)
    setEditing(false)
  }

  const handleCancel = () => {
    reset()
    setEditing(false)
    setSaveError(null)
  }

  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[#0369A1]" />
          <CardTitle className="text-base font-semibold text-[#0F172A]">Company Information</CardTitle>
        </div>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="text-[#334155] hover:text-[#0F172A] cursor-pointer h-8 px-2"
          >
            <Pencil className="w-3.5 h-3.5 mr-1.5" />
            Edit
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="Legal name" value={supplier.company_name} />
            <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="DBA" value={supplier.dba} />
            <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Headquarters" value={supplier.headquarters} />
            <InfoRow icon={<Calendar className="w-3.5 h-3.5" />} label="Founded" value={supplier.founded_year?.toString()} />
            <InfoRow icon={<Users className="w-3.5 h-3.5" />} label="Employees" value={supplier.employees?.toLocaleString()} />
            <InfoRow icon={<DollarSign className="w-3.5 h-3.5" />} label="Annual revenue" value={supplier.annual_revenue} />
            <InfoRow icon={<Globe className="w-3.5 h-3.5" />} label="Website" value={supplier.website} />
            <InfoRow icon={<Building2 className="w-3.5 h-3.5" />} label="EIN" value={supplier.ein} />
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {saveError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
                {saveError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Legal name" error={errors.company_name?.message}>
                <Input {...register('company_name')} />
              </FormField>
              <FormField label="DBA">
                <Input {...register('dba')} />
              </FormField>
              <FormField label="Headquarters">
                <Input {...register('headquarters')} placeholder="City, ST" />
              </FormField>
              <FormField label="Founded year" error={errors.founded_year?.message}>
                <Input {...register('founded_year')} type="number" />
              </FormField>
              <FormField label="Employees" error={errors.employees?.message}>
                <Input {...register('employees')} type="number" />
              </FormField>
              <FormField label="Annual revenue">
                <Input {...register('annual_revenue')} placeholder="$18.5M" />
              </FormField>
              <FormField label="Website">
                <Input {...register('website')} placeholder="www.company.com" />
              </FormField>
              <FormField label="EIN">
                <Input {...register('ein')} placeholder="XX-XXXXXXX" />
              </FormField>
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={saving}
                size="sm"
                className="bg-[#0369A1] hover:bg-[#0284C7] text-white cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 mr-1.5" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="cursor-pointer"
              >
                <X className="w-3.5 h-3.5 mr-1.5" />
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className="text-sm text-[#020617] font-medium">
        {value ?? <span className="text-slate-300 font-normal">—</span>}
      </span>
    </div>
  )
}

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
