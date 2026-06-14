// Locked, single-account gateway for client-facing report links.
// A client link looks like:  https://<your-app>/?token=sh-7f3a9b2e1c
// The token maps (server-side only) to exactly ONE WhatConverts account_id.
// The client can NEVER see other accounts: account_id is forced here, not
// trusted from the request, and single-lead lookups are ownership-checked.
//
// Configure tokens via the Vercel env var CLIENT_TOKENS (JSON), e.g.:
//   {"sh-7f3a9b2e1c":{"account_id":123456,"label":"Southampton Inn"}}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var token = process.env.WHATCONVERTS_TOKEN;
  var secret = process.env.WHATCONVERTS_SECRET;
  if (!token || !secret) {
    return res.status(500).json({ error: "WhatConverts credentials not configured" });
  }

  // --- Resolve the client token to a locked account ---
  var map = {};
  try {
    map = JSON.parse(process.env.CLIENT_TOKENS || "{}");
  } catch (e) {
    return res.status(500).json({ error: "CLIENT_TOKENS is not valid JSON" });
  }

  var clientToken = req.query.token;
  var locked = clientToken ? map[clientToken] : null;
  if (!locked || locked.account_id == null) {
    return res.status(403).json({ error: "Invalid or expired report link" });
  }
  var lockedId = String(locked.account_id);

  var endpoint = req.query.endpoint;
  if (endpoint !== "accounts" && endpoint !== "leads") {
    return res.status(403).json({ error: "Not permitted" });
  }

  var auth = Buffer.from(token + ":" + secret).toString("base64");
  function wc(path) {
    return fetch("https://app.whatconverts.com/api/v1/" + path, {
      method: "GET",
      headers: { "Authorization": "Basic " + auth, "Accept": "application/json" }
    });
  }

  try {
    // ===== accounts: return ONLY the locked account (with its profiles) =====
    if (endpoint === "accounts") {
      var r = await wc("accounts?accounts_per_page=250");
      var d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: "WhatConverts " + r.status, details: d });
      var mine = (d.accounts || []).filter(function (a) {
        return String(a.account_id) === lockedId;
      });
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({ accounts: mine, total_pages: 1, total_results: mine.length });
    }

    // ===== single lead detail: fetch, then verify ownership =====
    var leadId = req.query.lead_id;
    if (leadId) {
      var lr = await wc("leads/" + encodeURIComponent(leadId));
      var ld = await lr.json();
      if (!lr.ok) return res.status(lr.status).json({ error: "WhatConverts " + lr.status });
      var lead = (ld.leads && ld.leads.length > 0) ? ld.leads[0] : ld;
      if (String(lead.account_id) !== lockedId) {
        return res.status(403).json({ error: "Not permitted" });
      }
      return res.status(200).json(lead); // same shape as /api/lead
    }

    // ===== leads list: FORCE account_id, pass through the safe params =====
    var allowParams = [
      "start_date", "end_date", "leads_per_page", "page_number",
      "lead_type", "profile_id"
    ];
    var parts = ["account_id=" + encodeURIComponent(lockedId)];
    allowParams.forEach(function (k) {
      if (req.query[k] != null) {
        parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(req.query[k]));
      }
    });
    var lr2 = await wc("leads?" + parts.join("&"));
    var ld2 = await lr2.json();
    if (!lr2.ok) return res.status(lr2.status).json({ error: "WhatConverts " + lr2.status, details: ld2 });
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(ld2);
  } catch (err) {
    return res.status(500).json({ error: "Failed to reach WhatConverts API", message: err.message });
  }
};
