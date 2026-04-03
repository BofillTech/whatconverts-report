# WhatConverts Call Booking Report

Monthly phone call booking revenue report by client. Pulls data from WhatConverts API, classifies bookings, and breaks down Google Ads attribution.

Built for Bofill Technologies client reporting.

## Live URL

Once deployed: `https://whatconverts-report.vercel.app` (or your custom domain)

## Deploy to Vercel (5 minutes)

### 1. Create GitHub repo

- Go to github.com → New Repository → name it `whatconverts-report`
- Upload all files from this project (or push via git)
- For folders, use GitHub's "Create new file" and type the path with slash: `src/App.jsx`, `api/whatconverts.js`, etc.

### 2. Deploy on Vercel

- Go to vercel.com → "Add New Project"
- Import the `whatconverts-report` GitHub repo
- Framework Preset: **Vite**
- Add Environment Variables:
  - `WHATCONVERTS_TOKEN` = `2584-0d16aa3bf468100f`
  - `WHATCONVERTS_SECRET` = `530e50baf67beff23f37f48944c7a9c3`
- Click **Deploy**

### 3. Use it

- Open your Vercel URL
- Pick a month
- Click "Run Report"
- Export CSV for client reports

## Project Structure

```
whatconverts-report/
├── api/
│   └── whatconverts.js     ← Vercel serverless proxy (avoids CORS)
├── src/
│   ├── App.jsx             ← React frontend
│   ├── App.css             ← Styles
│   └── main.jsx            ← Entry point
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── README.md
```

## How it works

1. Browser calls `/api/whatconverts?endpoint=accounts` (your Vercel serverless function)
2. Serverless function adds your API credentials and forwards to WhatConverts API
3. Response passes back to browser — no CORS issues
4. React app classifies bookings using WhatConverts' built-in fields (sales_value, quote_value, lead_status, quotable, AI analysis, spotted keywords)
5. Results split by total calls vs Google Ads calls for client reporting

## Booking Classification

The app identifies bookings via multiple signals (in priority order):
1. **sales_value** — manually or AI-set sale amount
2. **quote_value** — quoted value on the lead
3. **lead_status** — contains "qualified", "converted", "booked", etc.
4. **quotable** — marked as "Yes"
5. **AI Intent** — WhatConverts AI detected purchase/booking intent
6. **Spotted Keywords** — call contained booking-related keywords

## Notes

- WhatConverts master API key allows 10,000 requests/day
- Results cached for 5 minutes via Vercel edge caching
- Spam and duplicate calls are automatically excluded
