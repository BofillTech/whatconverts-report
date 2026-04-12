module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  var apiKey = process.env.ANTHROPIC_API_KEY;

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
          content: "Analyze this call transcript. Respond ONLY with JSON array.\n\n=== CALL 1 (lead_id: 999) ===\nCaller: Hi, I'd like to book a room for two nights next weekend.\nRecipient: Sure, we have availability. That will be $250 per night.\nCaller: Perfect, let's do it. My name is John Smith.\nRecipient: Great, you're all set for Friday and Saturday.\n\n[{\"lead_id\":\"999\",\"classification\":\"BOOKED\",\"estimated_value\":500,\"nights\":2,\"summary\":\"Guest booked 2 nights at $250/night\"}]"
        }]
      })
    });

    var data = await response.json();

    return res.status(200).json({
      api_status: response.status,
      key_prefix: apiKey ? apiKey.substring(0, 12) + "..." : "NOT SET",
      raw_response: data
    });
  } catch (err) {
    return res.status(200).json({ error: err.message });
  }
};
