# ملقوف — Malgoof SaaS Platform

> نراقب الأداء .. نحقق النتائج

Field merchandiser management SaaS built with **Next.js 14 + Supabase + TypeScript + Tailwind CSS**.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Setup Supabase
1. Create project at [supabase.com](https://supabase.com)
2. Copy `.env.local.example` → `.env.local`
3. Fill in your Supabase URL and keys

### 3. Run database migrations
```bash
# Using Supabase CLI
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### 4. Start development
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
src/
├── app/
│   ├── (public)/          # Landing + Auth pages
│   │   ├── (auth)/        # login, signup, forgot-password
│   │   └── (marketing)/   # Landing page
│   └── (dashboard)/       # Protected app pages
│       ├── dashboard/
│       ├── visits/
│       ├── schedule/
│       ├── chains/
│       ├── places/
│       ├── users/
│       ├── products/
│       ├── templates/
│       └── reports/
├── components/
│   ├── ui/                # Base UI components (Button, Input, Modal…)
│   ├── layout/            # Sidebar, Topbar
│   ├── forms/             # Form components
│   ├── charts/            # Recharts wrappers
│   ├── tables/            # Data tables
│   └── shared/            # Shared (BrandLogo, etc.)
├── lib/
│   ├── supabase/          # Supabase clients (browser/server/middleware)
│   ├── i18n/              # Translations AR/EN
│   └── utils/             # cn(), format(), locale helpers
├── hooks/                 # useTranslation, useDir, etc.
├── services/              # API layer (visits, chains, places…)
├── store/                 # Zustand global state
├── types/                 # TypeScript types
└── middleware.ts           # Auth route protection
```

---

## 🗄️ Database

PostgreSQL on Supabase with full Row Level Security (multi-tenant via `company_id`).

Tables: `companies` · `users` · `company_users` · `chains` · `places` · `products` · `place_products` · `templates` · `schedules` · `visits` · `visit_products` · `expiring_products` · `subscriptions`

---

## 🚢 Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set environment variables in Vercel dashboard matching `.env.local.example`.

---

## 🎨 Design System

| Token       | Value     | Usage          |
|-------------|-----------|----------------|
| brand-500   | `#EF4444` | Primary red    |
| ink-900     | `#111827` | Dark text/bg   |
| ink-50      | `#F8FAFC` | Page bg        |

RTL-first · Arabic (IBM Plex Sans Arabic) · English (Inter)
