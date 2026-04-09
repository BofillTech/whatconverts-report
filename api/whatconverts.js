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

  var endpoint = req.query.endpoint;
  var lead_id = req.query.lead_id;

  if (!endpoint) {
    return res.status(400).json({ error: "Missing endpoint parameter" });
  }

  var allowed = ["accounts", "leads", "profiles"];
  if (!allowed.includes(endpoint)) {
    return res.status(400).json({ error: "Endpoint not allowed" });
  }

  // Build the path - individual lead if lead_id provided
  var path = endpoint;
  if (endpoint === "leads" && lead_id) {
    path = "leads/" + lead_id;
  }

  // Build query string from remaining params
  var queryParts = [];
  var skip = ["endpoint", "lead_id"];
  Object.keys(req.query).forEach(function(k) {
    if (skip.indexOf(k) === -1) {
      queryParts.push(encodeURIComponent(k) + "=" + encodeURIComponent(req.query[k]));
    }
  });

  var url = "https://app.whatconverts.com/api/v1/" + path;
  if (queryParts.length > 0) url += "?" + queryParts.join("&");

  var auth = Buffer.from(token + ":" + secret).toString("base64");

  try {
    var response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Basic " + auth,
        "Accept": "application/json"
      }
    });

    var data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "WhatConverts returned " + response.status,
        details: data
      });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: "Failed to reach WhatConverts API", message: err.message });
  }
};
