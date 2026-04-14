# Slice 1 — Foundation
## Task Brief for Claude Code

> Paste this entire file into your Claude Code session to start Slice 1.
> Read CLAUDE.md first for full project context.

---

## Your mission for Slice 1

Build the foundation of the Supplier Command Center:
- Project scaffolded and running locally
- Supabase auth working (signup + login + logout)
- Supplier profile: create and edit
- App shell with sidebar navigation
- Seeded with Acme Tech Solutions test data

**Done when:** You can log in, see the app shell, and view/edit Acme Tech Solutions' supplier profile.

---

## Step 1 — Project scaffold

```bash
# Create project
npm create vite@latest supplier-command-center -- --template react-ts
cd supplier-command-center

# Install core dependencies
npm install \
  @supabase/supabase-js \
  @tanstack/react-query \
  react-router-dom \
  axios \
  react-hook-form \
  zod \
  @hookform/resolvers \
  date-fns \
  lucide-react \
  clsx \
  tailwind-merge

# Install Tailwind
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p

# Install shadcn/ui
npx shadcn@latest init
# Choose: TypeScript, Default style, Slate base color, CSS variables yes

# Add shadcn components we need for Slice 1
npx shadcn@latest add button input label card form badge avatar
npx shadcn@latest add sidebar navigation-menu separator

# Backend deps
npm install express cors dotenv helmet morgan jsonwebtoken
npm install -D @types/express @types/cors @types/morgan @types/jsonwebtoken tsx nodemon

# Install UI UX Pro Max skill
npm install -g uipro-cli
uipro init --ai claude
```

---

## Step 2 — Environment setup

Create `.env` from `.env.example` (see CLAUDE.md for variable list).
Create `.env.example` and commit it.

---

## Step 3 — Supabase setup

1. Go to supabase.com, create new project: `supplier-command-center`
2. Copy URL and anon key into `.env`
3. Run this SQL in Supabase SQL editor to create the schema:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Suppliers table
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  dba text,
  founded_year integer,
  headquarters text,
  employees integer,
  annual_revenue text,
  website text,
  ein text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Supplier contacts
CREATE TABLE supplier_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  email text,
  phone text,
  is_primary boolean DEFAULT false,
  type text DEFAULT 'primary'
);

-- Certifications + insurance
CREATE TABLE certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  name text NOT NULL,
  issuer text,
  cert_number text,
  issued_date date,
  expiry_date date,
  status text DEFAULT 'active',
  category text DEFAULT 'certification',
  required_by text[] DEFAULT '{}'
);

-- Buyer relationships
CREATE TABLE buyer_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  buyer_name text NOT NULL,
  platform text,
  vendor_id text,
  since_date date,
  annual_spend text,
  status text DEFAULT 'approved'
);

-- Inbox requests
CREATE TABLE inbox_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  type text NOT NULL,
  priority text DEFAULT 'medium',
  deadline date,
  received_at timestamptz DEFAULT now(),
  from_buyer text,
  from_contact text,
  from_email text,
  from_platform text,
  subject text,
  body text,
  status text DEFAULT 'pending_response',
  tags text[] DEFAULT '{}',
  attachments text[] DEFAULT '{}'
);

-- AI responses
CREATE TABLE ai_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES inbox_requests(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE,
  draft_content text,
  final_content text,
  status text DEFAULT 'draft',
  tokens_used integer,
  created_at timestamptz DEFAULT now()
);

-- RLS Policies (Row Level Security)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_responses ENABLE ROW LEVEL SECURITY;

-- Suppliers: users can only see their own
CREATE POLICY "Users own their supplier" ON suppliers
  FOR ALL USING (auth.uid() = user_id);

-- All child tables: join through supplier
CREATE POLICY "Supplier contacts visible to owner" ON supplier_contacts
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "Certifications visible to owner" ON certifications
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "Buyer relationships visible to owner" ON buyer_relationships
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "Inbox requests visible to owner" ON inbox_requests
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );

CREATE POLICY "AI responses visible to owner" ON ai_responses
  FOR ALL USING (
    supplier_id IN (SELECT id FROM suppliers WHERE user_id = auth.uid())
  );
```

---

## Step 4 — Generate design system

Run this after installing UI UX Pro Max:

```bash
python3 .claude/skills/ui-ux-pro-max/scripts/search.py \
  "B2B SaaS procurement supplier portal enterprise dashboard" \
  --design-system \
  -p "SupplierCommandCenter" \
  --persist
```

This creates `design-system/MASTER.md`. Read it before building any UI.

---

## Step 5 — App structure to build

### 5a. Supabase client (`src/client/lib/supabase.ts`)
```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### 5b. Types (`src/client/types/index.ts`)
Define TypeScript interfaces matching the DB schema:
- `Supplier`
- `SupplierContact`
- `Certification`
- `BuyerRelationship`
- `InboxRequest`
- `AIResponse`

### 5c. Auth pages
- `/auth/login` — email + password form
- `/auth/signup` — email + password + company name
- Redirect to `/profile` after login

### 5d. App shell with sidebar
Sidebar items (with icons from lucide-react):
- Profile (Building2)
- Inbox (Inbox) + badge showing pending count
- Compliance (ShieldCheck) + badge showing critical count
- Dashboard (BarChart3)
- Settings (Settings)

### 5e. Profile hub page (`/profile`)
Sections:
1. Company info (name, HQ, founded, employees, website)
2. Primary contact
3. Certifications list (name, issuer, expiry, status badge)
4. Insurance list (same)
5. Active buyer relationships
6. Rate card (display only for now)

Edit mode: click Edit button → form fields appear inline.

---

## Step 6 — Seed test data

After Slice 1 is working, add a seed function that loads Acme Tech Solutions data from `/test-data/suppliers/acme_tech_solutions.json` into Supabase for the test user.

Create `/src/client/lib/seed.ts`:
```typescript
// Reads acme_tech_solutions.json and inserts into Supabase
// Only runs in development
// Call from a hidden /dev/seed route or browser console
```

---

## Acceptance criteria checklist

Before calling Slice 1 done, verify:

- [ ] `npm run dev` starts without errors
- [ ] Can reach login page at localhost:5173
- [ ] Can sign up with email + password
- [ ] After login, see app shell with sidebar
- [ ] Can navigate to Profile page
- [ ] Can see Acme Tech Solutions data (after seeding)
- [ ] Can edit company info and save
- [ ] Certifications show with correct status badges (active/expired/critical)
- [ ] Responsive: works on mobile width (375px)
- [ ] No TypeScript errors (`tsc --noEmit` passes)
- [ ] No console errors in browser

---

## Style guidance for Slice 1

Follow `design-system/MASTER.md` for colors/fonts. General rules:
- Enterprise, clean, professional — not consumer-grade colorful
- Use slate/gray as base, one accent color (likely blue or indigo)
- Status badges: red = critical/expired, amber = expiring soon, green = active
- Sidebar: dark background, white icons/text
- Cards for each profile section, subtle borders
- Table layout for certifications list

---

## When Slice 1 is complete

1. Check off all items in CLAUDE.md Build Slices section
2. Add to Decisions Log: any architectural decisions made during build
3. Commit: `feat(slice-1): foundation — auth, profile, app shell`
4. Come back to claude.ai to plan Slice 2
