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

  var transcripts = body.transcripts.slice(0, 5);
  var accountName = body.account_name || "Unknown";

  var transcriptBlock = "";
  for (var i = 0; i < transcripts.length; i++) {
    var text = (transcripts[i].transcript || "").substring(0, 1500);
    transcriptBlock += "=== CALL " + (i + 1) + " (lead_id: " + transcripts[i].lead_id + ") ===\n" + text + "\n\n";
  }

  var userMsg = "Analyze these " + transcripts.length + " phone call transcripts for \"" + accountName + "\".\n\nFor each call classify as: BOOKED (reservation made), HIGH_INTENT (strong interest), INQUIRY (general question), or NOT_RELEVANT (spam/vendor/other).\n\nEstimate booking value if possible. Respond ONLY with a JSON array:\n[{\"lead_id\":\"123\",\"classification\":\"BOOKED\",\"estimated_value\":0,\"nights\":0,\"summary\":\"one sentence\"}]\n\n" + transcriptBlock;

  var models = ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"];

  for (var m = 0; m < models.length; m++) {
    try {
      var response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: models[m],
          max_tokens: 2000,
          messages: [{ role: "user", content: userMsg }]
        })
      });

      var data = await response.json();

      if (!response.ok) {
        if (m < models.length - 1) continue;
        return res.status(200).json({
          error: "Anthropic " + response.status + ": " + JSON.stringify(data),
          results: []
        });
      }

      var resultText = "";
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === "text") resultText += data.content[j].text;
      }

      resultText = resultText.replace(/```json/g, "").replace(/```/g, "").trim();
      var results = JSON.parse(resultText);
      return res.status(200).json({ results: results });

    } catch (err) {
      if (m < models.length - 1) continue;
      return res.status(200).json({ error: err.message, results: [] });
    }
  }
};
