# TLB Management System

Internal operations management system for TLB Enterprise — inventory, sales, production, procurement, quality control, and finance.

## Tech Stack

- **Framework**: [TanStack Start](https://tanstack.com/start) (React 19, SSR)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + custom TLB design tokens
- **Database**: [Supabase](https://supabase.com/) (Postgres + Auth)
- **Charts**: [Recharts](https://recharts.org/)
- **Build**: [Vite](https://vite.dev/)
- **Hosting**: [Vercel](https://vercel.com/)

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run build
npm run preview
```

## Environment Variables

Create a `.env` file (see `.env.example`):

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
VITE_TLB_USE_SUPABASE=1
SUPABASE_URL=your_supabase_url
SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Live domain sync details: `src/lib/repo/README.md`.
