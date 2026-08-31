// POST /api/analyze
// body: { transcripts:[{lead_id, transcript, ...}], account_name, account_id }
// resp: { vertical:"hotel"|"leadgen", results:[...] }
//   hotel   result: {lead_id, classification, estimated_value, nights, summary}
//   leadgen result: {lead_id, tier, score, intent, subject, next_action, contact_name, summary}
// Failed classifications return classification/tier "ERROR" (never a fake INQUIRY).
var classify = require("../lib/classify");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !body.transcripts || !body.transcripts.length) {
    return res.status(400).json({ error: "Missing transcripts" });
  }

  var transcripts = body.transcripts.slice(0, 5);
  var accountName = body.account_name || "Unknown";
  var accountId = body.account_id != null ? body.account_id : null;

  try {
    var out = await classify.classifyBatch(apiKey, transcripts, accountName, accountId);
    return res.status(200).json(out);
  } catch (err) {
    console.error("analyze failed", err);
    return res.status(500).json({ error: err.message });
  }
};
