/**
 * Vercel Serverless Function — Transcript Analyzer
 * 
 * Receives a batch of call transcripts and uses Claude to classify
 * whether each call resulted in a booking and estimate the value.
 * 
 * Requires ANTHROPIC_API_KEY environment variable.
 * 
 * POST /api/analyze
 * Body: { transcripts: [{ lead_id, transcript, account_name }] }
 */
 
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
 
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
 
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured in Vercel" });
  }
 
  var body = req.body;
  if (!body || !body.transcripts || !body.transcripts.length) {
    return res.status(400).json({ error: "Missing transcripts array" });
  }
 
  // Limit batch size to 10 transcripts per request
  var transcripts = body.transcripts.slice(0, 10);
  var accountName = body.account_name || "Unknown";
 
  // Build the prompt with all transcripts
  var transcriptBlock = transcripts.map(function(t, i) {
    // Truncate very long transcripts to keep token usage reasonable
    var text = (t.transcript || "").substring(0, 2000);
    return "=== CALL " + (i + 1) + " (lead_id: " + t.lead_id + ") ===\n" + text;
  }).join("\n\n");
 
  var systemPrompt = "You analyze phone call transcripts for a hospitality/hotel/inn business called \"" + accountName + "\". " +
    "For each call, determine if a room booking or reservation was made, confirmed, or if the caller committed to booking. " +
    "Also identify calls where someone is seriously inquiring about availability with intent to book (not just general questions). " +
    "\n\nClassify each call as:\n" +
    "- BOOKED: A reservation was made or confirmed on the call\n" +
    "- HIGH_INTENT: Caller showed strong intent to book (checking dates, asking rates for specific dates, providing credit card, etc.)\n" +
    "- INQUIRY: General questions, no booking made\n" +
    "- NOT_RELEVANT: Spam, vendor calls, existing reservation changes, cancellations, directions, etc.\n" +
    "\n\nFor BOOKED and HIGH_INTENT calls, estimate the booking value based on any mentions of:\n" +
    "- Number of nights\n" +
    "- Room type or rate\n" +
    "- Number of rooms\n" +
    "- If no value clues, use $0\n" +
    "\n\nRespond ONLY with a JSON array, no other text. Each element:\n" +
    "{\"lead_id\": \"...\", \"classification\": \"BOOKED|HIGH_INTENT|INQUIRY|NOT_RELEVANT\", \"estimated_value\": 0, \"nights\": 0, \"summary\": \"1 sentence summary\"}";
 
  try {
    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          { role: "user", content: "Analyze these call transcripts:\n\n" + transcriptBlock }
        ]
      })
    });
 
    if (!response.ok) {
      var errData = await response.json().catch(function() { return {}; });
      return res.status(response.status).json({
        error: "Anthropic API error " + response.status,
        details: errData
      });
    }
 
    var data = await response.json();
    var text = "";
    for (var i = 0; i < data.content.length; i++) {
      if (data.content[i].type === "text") {
        text += data.content[i].text;
      }
    }
 
    // Clean and parse JSON
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    var results = JSON.parse(text);
 
    return res.status(200).json({ results: results });
  } catch (err) {
    return res.status(500).json({ error: "Analysis failed", message: err.message });
  }
};
