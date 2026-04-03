/**
 * Vercel Serverless Proxy for WhatConverts API
 * 
 * Forwards requests to WhatConverts server-side to avoid CORS.
 * API credentials stored as Vercel environment variables:
 *   WHATCONVERTS_TOKEN
 *   WHATCONVERTS_SECRET
 * 
 * Usage: GET /api/whatconverts?endpoint=accounts&accounts_per_page=50
 *        GET /api/whatconverts?endpoint=leads&lead_type=phone_call&account_id=123&...
 */

export default async function handler(req, res) {
  // CORS headers for your frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.WHATCONVERTS_TOKEN;
  const secret = process.env.WHATCONVERTS_SECRET;

  if (!token || !secret) {
    return res.status(500).json({ error: "WhatConverts credentials not configured" });
  }

  // Extract endpoint and forward all other params
  const { endpoint, ...params } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: "Missing 'endpoint' parameter (e.g. accounts, leads)" });
  }

  // Whitelist allowed endpoints
  const allowed = ["accounts", "leads", "profiles"];
  if (!allowed.includes(endpoint)) {
    return res.status(400).json({ error: `Endpoint '${endpoint}' not allowed. Use: ${allowed.join(", ")}` });
  }

  // Build WhatConverts URL
  const url = new URL(`https://app.whatconverts.com/api/v1/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  // Forward request with Basic Auth
  const auth = Buffer.from(`${token}:${secret}`).toString("base64");

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: `WhatConverts returned ${response.status}`,
        details: data,
      });
    }

    // Cache for 5 minutes (data doesn't change that fast)
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to reach WhatConverts API", message: err.message });
  }
}
