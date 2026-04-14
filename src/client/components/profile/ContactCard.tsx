import { User, Mail, Phone, Briefcase } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { SupplierContact } from '../../../types'

interface Props {
  contacts: SupplierContact[]
}

const typeLabel: Record<SupplierContact['type'], string> = {
  primary: 'Primary',
  ar: 'Accounts Receivable',
  legal: 'Legal',
  technical: 'Technical',
}

export default function ContactCard({ contacts }: Props) {
  if (contacts.length === 0) {
    return (
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-[#0369A1]" />
            <CardTitle className="text-base font-semibold text-[#0F172A]">Contacts</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-400">No contacts added yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-[#0369A1]" />
          <CardTitle className="text-base font-semibold text-[#0F172A]">Contacts</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {contacts.map((contact) => (
            <div key={contact.id} className="flex flex-col gap-1.5 pb-4 border-b border-slate-100 last:pb-0 last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-[#0F172A]">{contact.name}</span>
                <Badge variant="outline" className="text-xs font-normal border-slate-200 text-slate-500">
                  {typeLabel[contact.type]}
                </Badge>
              </div>
              {contact.title && (
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Briefcase className="w-3 h-3" />
                  {contact.title}
                </span>
              )}
              {contact.email && (
                <a
                  href={`mailto:${contact.email}`}
                  className="text-xs text-[#0369A1] flex items-center gap-1.5 hover:underline cursor-pointer"
                >
                  <Mail className="w-3 h-3" />
                  {contact.email}
                </a>
              )}
              {contact.phone && (
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Phone className="w-3 h-3" />
                  {contact.phone}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
