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

  var userMsg = "You are an expert at analyzing hotel front desk phone calls. Your job is to determine if the caller ended up booking a room.\n\nAnalyze these " + transcripts.length + " call transcripts for \"" + accountName + "\".\n\nHow hotel phone bookings typically sound:\n- Caller asks about availability for specific dates\n- Front desk checks availability and quotes a rate\n- Caller agrees to the rate or asks to proceed\n- Front desk takes the caller's name, sometimes credit card\n- Front desk confirms the reservation with dates and a confirmation number\n- Sometimes the booking is quick: 'Do you have anything for Saturday?' 'Yes, $299.' 'Great, book it under Smith.'\n- Sometimes the caller leaves a voicemail with their name, dates, and phone number asking to be booked\n\nSigns a booking WAS made:\n- Front desk says 'you are all set', 'you are booked', 'I have you down for', 'confirmation number is', 'we will see you on'\n- Caller provides their name AND dates AND the conversation ends positively\n- Caller provides credit card information\n- Staff reads back reservation details\n- Caller says 'book it', 'yes please', 'lets do it', 'that works'\n- The call has a natural conclusion after discussing dates and rates (no 'let me think about it')\n\nSigns a booking was NOT made:\n- Caller says 'let me think about it', 'I will call back', 'I need to check with my spouse'\n- Caller is only asking about pricing without committing\n- Caller hangs up mid-conversation\n- Call is about an existing reservation (modification, cancellation, question)\n- Call is from a vendor, sales rep, or wrong number\n\nClassify each call:\n- BOOKED: Based on the conversation flow, a reservation was made or is being processed\n- HIGH_INTENT: Caller discussed specific dates and rates but did not commit on this call\n- INQUIRY: General questions, no specific dates\n- NOT_RELEVANT: Vendor, spam, existing reservation, wrong number, internal call\n\nValue rules:\n- Use the nightly rate if mentioned. Otherwise assume $350/night.\n- Use the number of nights if mentioned. Weekend = 2 nights. Week = 7 nights. If unclear, assume 2 nights.\n- BOOKED calls must always have a value estimate, minimum $350.\n- For charter/tour businesses, estimate $500-2000 based on party size.\n\nRespond ONLY with a JSON array:\n[{\"lead_id\":\"123\",\"classification\":\"BOOKED\",\"estimated_value\":700,\"nights\":2,\"summary\":\"Caller booked 2 nights for Saturday-Sunday at $350/night\"}]\n\n" + transcriptBlock;

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
