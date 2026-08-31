// POST /api/config   body: { accounts:[{account_id, account_name}] }
// resp: { accounts:[{account_id, vertical}] }
// Lets the frontend know which report layout / analysis path applies to each
// account. Resolution order: ACCOUNT_CONFIG env var -> hotel name match -> leadgen.
var classify = require("../lib/classify");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  var accounts = (body && body.accounts) || [];
  var out = accounts.map(function (a) {
    var r = classify.resolveAccount(a.account_id, a.account_name);
    return { account_id: a.account_id, vertical: r.vertical, has_note: !!r.note };
  });
  return res.status(200).json({ accounts: out });
};
