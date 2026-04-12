module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  var token = process.env.WHATCONVERTS_TOKEN;
  var secret = process.env.WHATCONVERTS_SECRET;
  var auth = Buffer.from(token + ":" + secret).toString("base64");
  var headers = { "Authorization": "Basic " + auth, "Accept": "application/json" };

  try {
    var r1 = await fetch("https://app.whatconverts.com/api/v1/accounts?accounts_per_page=50", { headers: headers });
    var accounts = await r1.json();

    var acct = null;
    var pid = null;
    for (var i = 0; i < accounts.accounts.length; i++) {
      var a = accounts.accounts[i];
      if (a.account_name && a.account_name.toLowerCase().includes("york harbor")) {
        acct = a;
        pid = a.profiles && a.profiles[0] ? a.profiles[0].profile_id : null;
        break;
      }
    }

    if (!acct) return res.status(200).json({ error: "Could not find York Harbor Inn account" });

    var r2 = await fetch("https://app.whatconverts.com/api/v1/leads?lead_type=phone_call&leads_per_page=1&account_id=" + acct.account_id + "&profile_id=" + pid, { headers: headers });
    var leads = await r2.json();

    if (!leads.leads || !leads.leads.length) return res.status(200).json({ error: "No leads found", raw: leads });

    var lead = leads.leads[0];

    var r3 = await fetch("https://app.whatconverts.com/api/v1/leads/" + lead.lead_id, { headers: headers });
    var detail = await r3.json();

    var longFields = {};
    Object.keys(detail).forEach(function(k) {
      if (typeof detail[k] === "string" && detail[k].length > 30) {
        longFields[k] = detail[k].substring(0, 120);
      }
    });

    return res.status(200).json({
      account: acct.account_name,
      lead_id: lead.lead_id,
      detail_status: r3.status,
      detail_field_count: Object.keys(detail).length,
      all_detail_fields: Object.keys(detail),
      long_string_fields: longFields,
      has_call_transcription: !!detail.call_transcription,
      has_call_transcript: !!detail.call_transcript,
      has_transcript: !!detail.transcript
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
};
