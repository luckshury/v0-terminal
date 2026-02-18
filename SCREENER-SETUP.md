# Screener Page Setup Guide

## Quick Start

### 1. Environment Variables

Create or update `.env.local` in the project root:

```bash
# Required: Hydromancer API Key
HYDROMANCER_API_KEY=your_api_key_here

# Optional: Supabase for historical data
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
```

**Get Hydromancer API Key:** https://hydromancer.xyz/

### 2. Run the Dev Server

```bash
pnpm dev
```

Navigate to: http://localhost:4200/screener

### 3. Supabase Setup (Optional - For Historical % Data)

The screener works immediately with live prices. To enable DAY %, WEEK %, and 52W % columns:

#### Step 1: Create Supabase Project
- Go to https://supabase.com
- Create a new project (free tier is fine)

#### Step 2: Run SQL Setup
- Go to SQL Editor in Supabase dashboard
- Copy contents of `supabase-setup.sql` file
- Run the SQL

#### Step 3: Get Credentials
- Project Settings → API
- Copy `Project URL` → `SUPABASE_URL`
- Copy `anon public` key → `SUPABASE_ANON_KEY`

#### Step 4: Restart Server
```bash
# Stop the dev server (Ctrl+C)
pnpm dev
```

## Features

### Live Price Updates
- ✅ Updates every 1 second from Hydromancer API
- ✅ Covers 400-500+ tokens including HIP-3 DEX tokens
- ✅ No rate limits
- ✅ Price flash effects (green up, red down)

### Columns
- **SYMBOL** - Token symbol (sortable, searchable)
- **PRICE** - Current price with live updates
- **DAY %** - 24-hour price change (requires Supabase)
- **WEEK %** - 7-day price change (requires Supabase)
- **Z-SCORE** - Statistical deviation (placeholder)
- **VWAP %** - VWAP deviation (placeholder)
- **RVOL** - Relative volume (placeholder)
- **ADR %** - Average Daily Range (placeholder)
- **52W HIGH** - Distance from 52-week high (placeholder)
- **VOL 24H** - 24-hour volume (placeholder)

### Market Breadth
- Total assets count
- % Up vs % Down
- Average change across all tokens
- Strong movers (>5% or <-5%)
- Visual progress bar

### Performance
- Virtualized rendering (handles 1000s of rows smoothly)
- Memoized components for minimal re-renders
- 75ms client polling for smooth updates
- Dense terminal aesthetic

## Data Timeline

Without Supabase, you get live prices immediately.

With Supabase, historical columns populate over time:
- **Hour 1**: First snapshot stored
- **24 hours**: DAY % column starts showing data
- **7 days**: WEEK % column starts showing data
- **52 weeks**: 52W HIGH column complete

Snapshots are stored hourly, so you'll gradually see more tokens with historical data.

## Architecture

```
Hydromancer API (ALL_DEXS)
    ↓ 1s polling
Server Singleton (/api/hydromancer-prices)
    ↓ Stores snapshots hourly
Supabase (price_snapshots table)
    ↓ 75ms client polling
Screener UI (virtualized table)
```

## Troubleshooting

### "OFFLINE" status
- Check `HYDROMANCER_API_KEY` is set correctly
- Verify API key is valid at https://hydromancer.xyz/
- Check server logs for errors

### No historical data (all showing --)
- Verify Supabase credentials are correct
- Check Supabase SQL was run successfully
- Wait 24 hours for first DAY % data to appear

### Performance issues
- Reduce polling interval in `/app/api/hydromancer-prices/route.ts` if needed
- Disable filters when viewing large datasets
- Use search to narrow down visible tokens

## Future Enhancements

Advanced metrics (Z-SCORE, VWAP, RVOL, ADR) can be added by:
1. Calculating statistics from stored snapshots
2. Integrating volume data from exchange APIs
3. Computing rolling averages and standard deviations

The foundation is built - just add the calculations!




