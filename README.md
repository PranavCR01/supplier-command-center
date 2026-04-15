# Supplier Command Center

The supplier-side complement to Valorant's Astra procurement platform.

![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=white&labelColor=20232A) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white) ![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat&logo=vite&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat&logo=tailwindcss&logoColor=white) ![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat&logo=supabase&logoColor=white) ![Anthropic](https://img.shields.io/badge/Anthropic-Claude%20Haiku-D97706?style=flat) ![License](https://img.shields.io/badge/License-MIT-green?style=flat)

**Live demo:** https://supplier-command-center.vercel.app

---

## The Problem

Every procurement AI tool built in the last three years has been buyer-side. Astra accelerates procurement teams — but the suppliers receiving those RFPs, compliance requests, and onboarding checklists are still managing responses manually across 10+ fragmented portals.

The average mid-market supplier spends $260K per year on procurement response overhead: chasing deadlines across Coupa, Ariba, and email; rewriting the same capability statements; letting certifications expire because no one flagged them in time.

Astra creates faster, smarter buyers. Supplier Command Center creates suppliers who can keep up.

---

## What It Does

**Supplier Profile Hub**
Structured company profile: certifications, insurance, diversity classifications, buyer relationships, and key contacts — all in one place. The source of truth that feeds AI-generated responses.

**Smart Inbox**
All buyer requests in a single view — RFPs, RFQs, compliance notices, onboarding checklists, surveys. Filterable by type and priority, with live deadline countdowns and a priority summary bar.

**AI Response Generator**
One click drafts a structured response using the supplier's actual profile data. Built on the Claude API with SSE streaming, prompt caching, and request-type-aware context selection. Renders formatted markdown with tables and headers. 1,500 token cap keeps responses concise and cost-controlled.

**Compliance Tracker and Buyer Dashboard**
Real-time compliance health across certifications, insurance, and diversity credentials — status computed from expiry dates, not stale DB fields. Buyer relationship cards show active request counts and per-buyer compliance gaps.

---

## Strategic Positioning

Supplier Command Center does not compete with Astra. It feeds it.

When suppliers have clean, structured, up-to-date profiles, the data flowing into Astra's buyer-side AI improves. Response times drop. Compliance gaps are resolved before they block purchase orders. The supplier network becomes a resource rather than a bottleneck.

The natural expansion path: API integration between Supplier Command Center and Astra's supplier data layer, so buyer-initiated requests appear directly in the supplier's inbox and AI-generated responses submit back through the platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript (strict) |
| Styling | Tailwind CSS, shadcn/ui |
| Backend | Node.js, Express |
| Database | Supabase (PostgreSQL, Auth, RLS) |
| AI | Claude API — Haiku model, SSE streaming, prompt caching |
| Deploy | Vercel (frontend), Railway (backend) |

---

## Architecture

**Vertical slices.** Each feature was built end-to-end (frontend, backend, database) before the next began. Every slice is independently demonstrable.

**AI design decisions:**

- *System prompt caching:* The procurement system prompt is marked `cache_control: ephemeral` and loaded once at server startup. It is billed once per five-minute TTL window rather than on every API call.
- *Minimal context per request type:* A `contextBuilder` selects only the supplier data relevant to the request — certifications and contacts for onboarding, certification subset for compliance, rate data for RFQs. The full profile is never sent wholesale.
- *SSE streaming via fetch:* The browser uses `fetch` with a `ReadableStream` reader rather than `EventSource`, because `EventSource` does not support custom headers and the API requires a Bearer token.
- *Status computed at render time:* Certification and compliance status is derived from `expiry_date` at render, not read from the database status field. This prevents stale data from showing incorrect badges.

---

## Local Development

**Prerequisites:** Node.js 20+, a Supabase project, an Anthropic API key.

```bash
git clone https://github.com/PranavCR01/supplier-command-center.git
cd supplier-command-center
npm install
cp .env.example .env   # fill in Supabase and Anthropic keys
npm run dev            # starts Vite (port 5173) and Express (port 3001) concurrently
```

Run the schema in `docs/schema.sql` against your Supabase project via the SQL editor. Navigate to `/dev/seed` while logged in to load test data.

---

## Screenshots

| Page | Description |
|---|---|
| `/profile` | Supplier profile — company info, certifications, buyer relationships |
| `/inbox` | Smart inbox — all buyer requests with priority summary bar and filters |
| `/inbox` (detail) | Request detail panel with AI draft generation |
| `/compliance` | Compliance tracker — grouped by category with action notes |
| `/dashboard` | Buyer dashboard — health score, per-buyer cards, compliance gaps |
