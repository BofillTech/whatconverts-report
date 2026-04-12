module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  var token = process.env.WHATCONVERTS_TOKEN;
  var secret = process.env.WHATCONVERTS_SECRET;
  var lead_id = req.query.id;

  if (!lead_id) return res.status(400).json({ error: "Missing id param" });

  var url = "https://app.whatconverts.com/api/v1/leads/" + lead_id;
  var auth = Buffer.from(token + ":" + secret).toString("base64");

  try {
    var response = await fetch(url, {
      method: "GET",
      headers: { "Authorization": "Basic " + auth, "Accept": "application/json" }
    });
    var data = await response.json();

    // API wraps single lead in {leads: [...]} — unwrap it
    if (data.leads && data.leads.length > 0) {
      return res.status(200).json(data.leads[0]);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
