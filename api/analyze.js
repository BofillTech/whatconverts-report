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
    var transcript = (t.transcript || "").substring(0, 5000);

    // FAST CHECK: If transcript contains ### it's a redacted credit card = definite booking
    var hasRedactedCC = (transcript.match(/###/g) || []).length >= 2;

    if (hasRedactedCC) {
      // Still send to AI but just for the value and summary
      try {
        var ccResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 300,
            messages: [{
              role: "user",
              content: "This is a confirmed hotel booking call (credit card was given). Read the transcript and extract ONLY the dollar amounts and number of nights.\n\nLook for:\n- Any total amount the agent quoted (e.g. 'total is $473', 'comes to $500', 'that will be $350')\n- Nightly rate (e.g. '$190 a night', '$200 per night')\n- Number of nights\n- Speech-to-text errors are common - 'for 73' might mean '$473', 'total died at' means 'total tied at'\n\nTRANSCRIPT:\n" + transcript + "\n\nRespond with ONLY this JSON, nothing else:\n{\"lead_id\":\"" + t.lead_id + "\",\"classification\":\"BOOKED\",\"estimated_value\":0,\"nights\":0,\"summary\":\"one sentence\"}\n\nRules: Use the highest total quoted. If only a nightly rate, multiply by nights. If nothing found, use 2 x $350 = $700. Value must be above $0."
            }]
          })
        });

        var ccData = await ccResponse.json();
        if (ccResponse.ok) {
          var ccText = "";
          for (var c = 0; c < ccData.content.length; c++) {
            if (ccData.content[c].type === "text") ccText += ccData.content[c].text;
          }
          ccText = ccText.replace(/```json/g, "").replace(/```/g, "").trim();
          var ccResult = JSON.parse(ccText);
          ccResult.classification = "BOOKED";
          if (!ccResult.estimated_value || ccResult.estimated_value <= 0) ccResult.estimated_value = 700;
          results.push(ccResult);
        } else {
          results.push({ lead_id: t.lead_id, classification: "BOOKED", estimated_value: 700, nights: 2, summary: "Credit card provided - booking confirmed" });
        }
      } catch (err) {
        results.push({ lead_id: t.lead_id, classification: "BOOKED", estimated_value: 700, nights: 2, summary: "Credit card provided - booking confirmed" });
      }
      continue;
    }

    // NO ### found - do full analysis
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
            content: "Read this phone call transcript for \"" + accountName + "\". Speech-to-text errors are common so read past misspellings.\n\nTRANSCRIPT:\n" + transcript + "\n\nEND TRANSCRIPT.\n\nAnswer YES or NO to each:\n1. Did the caller give their NAME to the agent?\n2. Did the agent quote a TOTAL dollar amount or nightly rate?\n3. Did the agent CONFIRM a reservation? (phrases like: 'you are all set', 'booked', 'confirmed', 'I have you down for', 'send you a confirmation', 'we will see you')\n4. Did the caller AGREE to book? ('that works', 'lets do it', 'book it', 'sounds good', 'yes', 'go ahead', 'that will work')\n5. Did the caller ask about SPECIFIC DATES for a stay?\n\nClassification rules:\n- If answers 1+3 are both YES, or 1+4 are both YES = BOOKED\n- If answer 3 or 4 is YES even without a name = BOOKED\n- If answer 5 is YES but 3 and 4 are NO = HIGH_INTENT\n- If the call is a vendor, spam, wrong number, robocall, existing reservation question, cancellation, or staff call = NOT_RELEVANT\n- Everything else = INQUIRY\n\nFor value: Use the exact total if one was quoted. Otherwise nightly rate x nights. If no rate mentioned, use $350/night x 2 nights = $700. BOOKED must be above $0.\n\nRespond with ONLY this JSON:\n{\"lead_id\":\"" + t.lead_id + "\",\"classification\":\"BOOKED\",\"estimated_value\":700,\"nights\":2,\"summary\":\"what happened\"}"
          }]
        })
      });

      var data = await response.json();

      if (!response.ok) {
        results.push({ lead_id: t.lead_id, classification: "INQUIRY", estimated_value: 0, nights: 0, summary: "API error" });
        continue;
      }

      var text = "";
      for (var j = 0; j < data.content.length; j++) {
        if (data.content[j].type === "text") text += data.content[j].text;
      }

      text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      var result = JSON.parse(text);
      if (result.classification === "BOOKED" && (!result.estimated_value || result.estimated_value <= 0)) {
        result.estimated_value = 700;
      }
      results.push(result);

    } catch (err) {
      results.push({ lead_id: t.lead_id, classification: "INQUIRY", estimated_value: 0, nights: 0, summary: "Error" });
    }
  }

  return res.status(200).json({ results: results });
};
