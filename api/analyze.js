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

var userMsg = "You are listening to real hotel front desk phone calls. Read each transcript carefully word by word as if you are listening to the actual call. Your job is to determine the outcome of each call.\n\nAnalyze these " + transcripts.length + " calls for \"" + accountName + "\".\n\nListen for these BOOKING CONFIRMATION signals from the hotel agent:\n- Agent states a total amount: 'your total comes to', 'that will be', 'total is', 'comes out to'\n- Agent confirms the reservation: 'you are all set', 'you are booked', 'I have you down for', 'we will see you', 'confirmation number', 'I will send you a confirmation'\n- Agent takes payment: any mention of credit card, last four digits, card number, billing address\n- Agent reads back details: repeating dates, guest name, room type, and rate back to the caller\n- Agent says 'let me book that for you', 'let me put that in', 'I am putting you in'\n- The call ends with the caller and agent both satisfied after discussing dates, room, and rate\n\nAlso count these as BOOKED:\n- Voicemails where caller leaves name, dates, phone number, and asks to book or reserve a room\n- Calls where caller says 'I would like to book', 'please reserve', 'go ahead and book it' and agent does not refuse\n\nListen for these HIGH INTENT signals:\n- Caller asks about specific dates but says 'let me think about it', 'I will call back', 'I need to check'\n- Caller asks for rates on specific dates but does not commit\n- Caller asks agent to hold a room or check back\n\nNOT RELEVANT calls:\n- Vendor or sales calls (someone selling a product or service TO the hotel)\n- Wrong numbers\n- Calls about existing reservations (changes, cancellations, questions about an upcoming stay)\n- Internal calls between staff\n- Automated/robocalls\n- Calls where no one answers or just dead air\n\nEverything else is INQUIRY (general questions, directions, restaurant hours, event info, etc.)\n\nVALUE ESTIMATION - THIS IS CRITICAL:\n- If the agent states the total on the call, USE THAT EXACT AMOUNT\n- If a nightly rate is mentioned, multiply by number of nights\n- If only nights are mentioned with no rate, use $350/night as default\n- If it is clearly a booking but no rate or nights discussed, estimate 2 nights x $350 = $700\n- For charter/fishing/tour bookings, estimate based on party size: $200-500 per person\n- NEVER put $0 for a BOOKED call\n\nRespond ONLY with a JSON array, no markdown, no explanation:\n[{\"lead_id\":\"123\",\"classification\":\"BOOKED\",\"estimated_value\":700,\"nights\":2,\"summary\":\"Agent confirmed 2 nights at $350, total $700, took credit card\"}]\n\n" + transcriptBlock;
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
