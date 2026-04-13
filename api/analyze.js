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
  var results = [];

  for (var i = 0; i < transcripts.length; i++) {
    var t = transcripts[i];
    var transcript = (t.transcript || "").substring(0, 4000);

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
          max_tokens: 500,
          messages: [{
            role: "user",
            content: "You are listening to a phone call at \"" + accountName + "\". Read every word of this transcript carefully.\n\nYour ONLY job: did this call result in a booking/reservation, or not?\n\nRead the full transcript below, then tell me:\n1. What did the caller want?\n2. What did the agent/recipient do?\n3. Was a reservation made? Look for: agent taking a name and dates, agent quoting a total, agent saying 'you are all set' or 'booked' or 'confirmed', caller providing credit card info, agent reading back reservation details.\n4. If a dollar amount or rate was mentioned by ANYONE on the call, what was it?\n\nTranscript:\n" + transcript + "\n\nNow classify this call. Respond with ONLY a JSON object, no other text:\n{\"lead_id\":\"" + t.lead_id + "\",\"classification\":\"BOOKED or HIGH_INTENT or INQUIRY or NOT_RELEVANT\",\"estimated_value\":0,\"nights\":0,\"summary\":\"what happened on the call in one sentence\"}\n\nRules:\n- BOOKED = a reservation was made, confirmed, or processed on this call\n- HIGH_INTENT = caller wanted to book but did not finalize (said they would call back, needed to check dates, etc)\n- INQUIRY = general questions, no booking intent\n- NOT_RELEVANT = spam, vendor, wrong number, existing reservation change, robocall\n- For estimated_value: use the exact total if the agent stated one. Otherwise use the nightly rate x nights. If no rate mentioned, use $350/night. If no nights mentioned, assume 2. BOOKED calls must have a value above $0.\n- For charter/tour calls, estimate based on what was discussed."
          }]
        })
      });

      var data = await response.json();

      if (!response.ok) {
        results.push({ lead_id: t.lead_id, classification: "INQUIRY", estimated_value: 0, nights: 0, summary: "API error: " + response.status });
        continue;
      }

      var text = "";
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === "text") text += data.content[j].text;
      }

      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(text);
      results.push(result);

    } catch (err) {
      results.push({ lead_id: t.lead_id, classification: "INQUIRY", estimated_value: 0, nights: 0, summary: "Parse error" });
    }
  }

  return res.status(200).json({ results: results });
};
