module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  var body = req.body;
  if (!body || !body.transcripts || !body.transcripts.length) {
    return res.status(400).json({ error: "Missing transcripts" });
  }

  var transcripts = body.transcripts.slice(0, 10);
  var accountName = body.account_name || "Unknown";

  var transcriptBlock = "";
  for (var i = 0; i < transcripts.length; i++) {
    var text = (transcripts[i].transcript || "").substring(0, 2000);
    transcriptBlock += "=== CALL " + (i + 1) + " (lead_id: " + transcripts[i].lead_id + ") ===\n" + text + "\n\n";
  }

  var requestBody = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: "You analyze phone call transcripts for a hospitality business called \"" + accountName + "\". For each call, determine if a booking/reservation was made or if the caller showed strong intent to book.\n\nClassify each as:\n- BOOKED: Reservation made or confirmed\n- HIGH_INTENT: Strong intent to book (checking specific dates, rates, providing payment info)\n- INQUIRY: General questions only\n- NOT_RELEVANT: Spam, vendor, cancellation, directions\n\nFor BOOKED and HIGH_INTENT, estimate value from any mentions of nights, rates, rooms. Use $0 if unknown.\n\nRespond ONLY with a JSON array, no other text:\n[{\"lead_id\": \"...\", \"classification\": \"BOOKED\", \"estimated_value\": 0, \"nights\": 0, \"summary\": \"one sentence\"}]\n\nTranscripts:\n\n" + transcriptBlock
      }
    ]
  };

  try {
    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    });

    var data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Anthropic " + response.status,
        detail: data
      });
    }

    var text = "";
    for (var j = 0; j < data.content.length; j++) {
      if (data.content[j].type === "text") text += data.content[j].text;
    }

    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    var results = JSON.parse(text);

    return res.status(200).json({ results: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
