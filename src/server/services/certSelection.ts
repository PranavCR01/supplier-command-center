export interface CertLike {
  name: string
  category: string
}

const MAX_CERTS = 5

// Compliance requests get only the certifications their tags point at; if no tag matches,
// the first few certifications are sent instead of none. (The old inline version used
// `matches.slice(0, 5) || certs.slice(0, 5)`, whose fallback never ran: [] is truthy.)
export function relevantComplianceCerts<T extends CertLike>(certs: T[], tags: string[]): T[] {
  const matches = certs.filter((c) =>
    tags.some((tag) =>
      tag.toLowerCase().includes(c.category) ||
      c.name.toLowerCase().includes(tag.toLowerCase())
    )
  )
  return (matches.length > 0 ? matches : certs).slice(0, MAX_CERTS)
}
