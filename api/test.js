module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  var token = process.env.WHATCONVERTS_TOKEN;
  var secret = process.env.WHATCONVERTS_SECRET;
  var auth = Buffer.from(token + ":" + secret).toString("base64");
  var headers = { "Authorization": "Basic " + auth, "Accept": "application/json" };

  try {
    // Step 1: Get first account
    var r1 = await fetch("https://app.whatconverts.com/api/v1/accounts?accounts_per_page=1", { headers: headers });
    var accounts = await r1.json();
    var acct = accounts.accounts[0];

    // Step 2: Get one phone call lead
    var r2 = await fetch("https://app.whatconverts.com/api/v1/leads?lead_type=phone_call&leads_per_page=1&account_id=" + acct.account_id + "&profile_id=" + acct.profiles[0].profile_id, { headers: headers });
    var leads = await r2.json();
    var lead = leads.leads[0];
    var leadId = lead.lead_id;

    // Step 3: Fetch individual lead detail
    var r3 = await fetch("https://app.whatconverts.com/api/v1/leads/" + leadId, { headers: headers });
    var detail = await r3.json();

    // Return everything
    return res.status(200).json({
      account: acct.account_name,
      lead_id: leadId,
      list_fields: Object.keys(lead),
      list_has_transcription: lead.call_transcription ? "YES: " + String(lead.call_transcription).substring(0, 100) : "NO",
      list_has_transcript: lead.call_transcript ? "YES" : "NO",
      detail_fields: Object.keys(detail),
      detail_has_transcription: detail.call_transcription ? "YES: " + String(detail.call_transcription).substring(0, 100) : "NO",
      detail_has_transcript: detail.call_transcript ? "YES" : "NO",
      detail_status: r3.status,
      long_string_fields: Object.keys(detail).filter(function(k) { return typeof detail[k] === "string" && detail[k].length > 40; })
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
};
