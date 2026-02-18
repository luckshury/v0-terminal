# Collapsable sidebar

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/kayas-projects-27164a21/v0-collapsable-sidebar)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/gjjcgMZgDm3)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/kayas-projects-27164a21/v0-collapsable-sidebar](https://vercel.com/kayas-projects-27164a21/v0-collapsable-sidebar)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/gjjcgMZgDm3](https://v0.app/chat/gjjcgMZgDm3)**

## Environment Setup

### Required Environment Variables

Create a `.env.local` file in the root directory with the following:

```bash
# Hydromancer API Key (required for Screener page)
# Get your API key from: https://hydromancer.xyz/
HYDROMANCER_API_KEY=your_api_key_here

# Supabase Configuration (optional - enables historical % change data)
# Get these from: https://supabase.com
SUPABASE_URL=your_project_url
SUPABASE_ANON_KEY=your_anon_key
```

### Screener Page Setup

The Screener page displays live cryptocurrency prices from all DEXs (including HIP-3 tokens) with:
- **Live prices** - Updates every 1 second via Hydromancer API (no rate limits)
- **Historical % changes** - Requires Supabase setup (see below)

### Supabase Setup for Historical Data (Optional)

If you want to display DAY %, WEEK %, and 52W % columns, set up Supabase:

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is sufficient)

2. **Run this SQL in the Supabase SQL Editor:**
   ```sql
   -- Create price snapshots table
   create table price_snapshots (
     id bigserial primary key,
     symbol text not null,
     price numeric not null,
     timestamp timestamptz not null default now()
   );

   -- Create index for fast queries
   create index idx_symbol_timestamp on price_snapshots(symbol, timestamp desc);

   -- Optional: Enable Row Level Security (RLS)
   alter table price_snapshots enable row level security;

   -- Create policy to allow inserts from server
   create policy "Enable insert for service role" on price_snapshots
     for insert with check (true);

   -- Create policy to allow reads
   create policy "Enable read for all" on price_snapshots
     for select using (true);
   ```

3. **Get your credentials:**
   - Go to Project Settings → API
   - Copy `Project URL` → Use as `SUPABASE_URL`
   - Copy `anon/public` key → Use as `SUPABASE_ANON_KEY`

4. **Add to `.env.local`** and restart your dev server

**Timeline for data availability:**
- After 24 hours: DAY % column will populate
- After 7 days: WEEK % column will populate
- After 52 weeks: 52W HIGH column will populate

The screener works immediately with live prices even without Supabase - historical columns will just show `--` until data accumulates.

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository