// Shared call-classification logic used by /api/analyze (and reusable by any
// scheduled job). Two verticals:
//   hotel   -> BOOKED / HIGH_INTENT / INQUIRY / NOT_RELEVANT + estimated value
//   leadgen -> generic lead-quality scoring (HOT / WARM / COLD / NOT_RELEVANT)
//
// Per-account config lives in the Vercel env var ACCOUNT_CONFIG (JSON), keyed
// by WhatConverts account_id:
//   {
//     "51042": {"vertical":"hotel"},
//     "51100": {"vertical":"leadgen","note":"Boat dealer: new/used boats, service, slips. Good lead = wants to buy or see a specific boat."},
//     "51101": {"vertical":"leadgen","note":"Buys houses directly from homeowners, any condition, RI/MA. Good lead = homeowner who wants to sell."}
//   }
// Accounts not in ACCOUNT_CONFIG fall back to a name match against
// HOTEL_NAME_PATTERNS; anything else defaults to leadgen.

var HOTEL_NAME_PATTERNS = [
  "Abellona Inn", "Archway Fishtown", "Atlantic Inn", "Atlantic Oceanfront",
  "Briney Breezes", "Fun Hog", "Inn At Highway 1", "Little Sur Inn",
  "Montauk Manor", "Moonstone Landing", "Mount Nevis", "Old Orchard Beach",
  "Rhumb Line", "Rhumbline", "Rose Farm", "Sebastians BVI", "Sole East",
  "Southampton Inn", "Spring House", "Surf Lodge", "VBTS", "Village by the Sea",
  "Wavecrest", "White Bay Villas", "York Harbor Inn", "Beachcomber Resort",
  "Cove at Yarmouth"
];

var MODEL = "claude-sonnet-4-6";

function loadAccountConfig() {
  try { return JSON.parse(process.env.ACCOUNT_CONFIG || "{}"); }
  catch (e) { return {}; }
}

// Returns {vertical:"hotel"|"leadgen", note:string}
function resolveAccount(accountId, accountName) {
  var cfg = loadAccountConfig();
  var entry = accountId != null ? cfg[String(accountId)] : null;
  if (entry && (entry.vertical === "hotel" || entry.vertical === "leadgen")) {
    return { vertical: entry.vertical, note: entry.note || "" };
  }
  var n = (accountName || "").toLowerCase();
  var isHotel = HOTEL_NAME_PATTERNS.some(function (h) { return n.includes(h.toLowerCase()); });
  return { vertical: isHotel ? "hotel" : "leadgen", note: (entry && entry.note) || "" };
}

// ---------- Anthropic call + tolerant JSON extraction ----------

async function callClaude(apiKey, systemPrompt, userPrompt, maxTokens) {
  var r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    })
  });
  var data = await r.json();
  if (!r.ok) throw new Error("Anthropic " + r.status + ": " + JSON.stringify(data).substring(0, 300));
  var text = "";
  (data.content || []).forEach(function (c) { if (c.type === "text") text += c.text; });
  return text;
}

// The old code did JSON.parse(fullText). When the model wrote anything before
// the JSON object (e.g. answering the YES/NO checklist first) the parse threw
// and the call was silently recorded as INQUIRY. Pull out the object instead.
function extractJSON(text) {
  var cleaned = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  var start = cleaned.indexOf("{");
  var end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in response");
  return JSON.parse(cleaned.substring(start, end + 1));
}

// ---------- HOTEL (unchanged rules, more robust plumbing) ----------

var HOTEL_SYSTEM = "You classify hotel phone-call transcripts. Speech-to-text errors are common; read past misspellings. Respond with ONLY a single JSON object and no other text.";

function hotelPrompt(transcript, leadId, accountName) {
  return "Phone call for \"" + accountName + "\".\n\nTRANSCRIPT:\n" + transcript + "\n\nEND TRANSCRIPT.\n\n" +
    "Decide internally (do not write these out):\n" +
    "1. Did the caller give their NAME?\n" +
    "2. Did the agent quote a TOTAL dollar amount or nightly rate?\n" +
    "3. Did the agent CONFIRM a reservation? ('you are all set', 'booked', 'confirmed', 'I have you down for', 'send you a confirmation', 'we will see you')\n" +
    "4. Did the caller AGREE to book? ('that works', 'let's do it', 'book it', 'sounds good', 'go ahead')\n" +
    "5. Did the caller ask about SPECIFIC DATES for a stay?\n\n" +
    "Classification rules:\n" +
    "- 1+3 both YES, or 1+4 both YES = BOOKED\n" +
    "- 3 or 4 YES even without a name = BOOKED\n" +
    "- 5 YES but 3 and 4 NO = HIGH_INTENT\n" +
    "- Vendor, spam, wrong number, robocall, existing-reservation question, cancellation, or staff call = NOT_RELEVANT\n" +
    "- Everything else = INQUIRY\n\n" +
    "Value: use the exact total if quoted ('total is $473', 'comes to $500'; STT errors like 'for 73' may mean '$473'). Otherwise nightly rate x nights. If no rate mentioned, $350/night x 2 nights = $700. BOOKED must be above $0.\n\n" +
    "Respond with ONLY this JSON:\n" +
    "{\"lead_id\":\"" + leadId + "\",\"classification\":\"BOOKED|HIGH_INTENT|INQUIRY|NOT_RELEVANT\",\"estimated_value\":0,\"nights\":0,\"summary\":\"one sentence on what happened\"}";
}

function hotelCCPrompt(transcript, leadId) {
  return "This is a confirmed hotel booking call (a credit card was given). Extract ONLY the dollar amounts and number of nights.\n\n" +
    "Look for any total the agent quoted ('total is $473', 'comes to $500'), a nightly rate ('$190 a night'), and number of nights. STT errors are common ('for 73' may mean '$473').\n\n" +
    "TRANSCRIPT:\n" + transcript + "\n\nRespond with ONLY this JSON:\n" +
    "{\"lead_id\":\"" + leadId + "\",\"classification\":\"BOOKED\",\"estimated_value\":0,\"nights\":0,\"summary\":\"one sentence\"}\n\n" +
    "Rules: use the highest total quoted. If only a nightly rate, multiply by nights. If nothing found, use 2 x $350 = $700. Value must be above $0.";
}

function hotelFallback(leadId, summary) {
  return { lead_id: String(leadId), classification: "ERROR", estimated_value: 0, nights: 0, summary: summary };
}

async function classifyHotel(apiKey, t, accountName) {
  var transcript = (t.transcript || "").substring(0, 8000);
  var leadId = String(t.lead_id);
  var hasRedactedCC = (transcript.match(/###/g) || []).length >= 2;
  var hasRawCC = /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/.test(transcript);

  if (hasRedactedCC || hasRawCC) {
    try {
      var ccText = await callClaude(apiKey, HOTEL_SYSTEM, hotelCCPrompt(transcript, leadId), 300);
      var cc = extractJSON(ccText);
      cc.lead_id = leadId;
      cc.classification = "BOOKED";
      if (!cc.estimated_value || cc.estimated_value <= 0) cc.estimated_value = 700;
      return cc;
    } catch (err) {
      return { lead_id: leadId, classification: "BOOKED", estimated_value: 700, nights: 2, summary: "Credit card provided - booking confirmed" };
    }
  }

  try {
    var text = await callClaude(apiKey, HOTEL_SYSTEM, hotelPrompt(transcript, leadId, accountName), 600);
    var result = extractJSON(text);
    result.lead_id = leadId;
    if (["BOOKED", "HIGH_INTENT", "INQUIRY", "NOT_RELEVANT"].indexOf(result.classification) === -1) {
      result.classification = "INQUIRY";
    }
    if (result.classification === "BOOKED" && (!result.estimated_value || result.estimated_value <= 0)) result.estimated_value = 700;
    return result;
  } catch (err) {
    console.error("hotel classify failed", leadId, err.message);
    return hotelFallback(leadId, "Error: " + err.message.substring(0, 120));
  }
}

// ---------- LEADGEN (industry-agnostic) ----------

var LEADGEN_SYSTEM = "You score inbound sales leads (phone calls and website form submissions) for small businesses. The rubric is the same for every industry; a short business description tells you what a good lead looks like for this client. Speech-to-text errors are common; read past misspellings. Respond with ONLY a single JSON object and no other text.";

var LEADGEN_TIERS = ["HOT", "WARM", "COLD", "NOT_RELEVANT"];
var LEADGEN_INTENTS = ["ready_to_act", "evaluating", "information_only", "existing_customer", "not_a_lead"];

function leadgenPrompt(transcript, leadId, accountName, note, kind) {
  var isForm = kind === "form";
  var docLabel = isForm ? "FORM SUBMISSION" : "TRANSCRIPT";
  return "Business: \"" + accountName + "\"" + (note ? "\nWhat they do / what a good lead looks like: " + note : "") + "\n\n" +
    (isForm ? "This is a WEBSITE FORM submission (not a phone call). The fields are listed below.\n\n" : "") +
    docLabel + ":\n" + transcript + "\n\nEND " + docLabel + ".\n\n" +
    "Assess the " + (isForm ? "submitter" : "caller") + " on four signals:\n" +
    "- NEED CLARITY: did they describe a concrete need, or just poke around?\n" +
    "- FIT: does what they want match what this business actually sells or does?\n" +
    (isForm
      ? "- COMMITMENT: does the message contain a specific ask, address, timeline, or budget? (A detailed message with a real callback number is a commitment step.)\n"
      : "- COMMITMENT: did they take a step (appointment, callback request, gave an address, timeline, or budget)?\n") +
    (isForm
      ? "- REACHABILITY: did they provide a plausible name, phone, and/or email? (Gibberish names/emails suggest spam.)\n\n"
      : "- REACHABILITY: did they leave a name and/or number, or say they'd call back?\n\n") +
    "Tier rules:\n" +
    "- HOT = good fit AND a commitment step (appointment set, asked for a callback about something specific, gave timeline/budget/address)\n" +
    "- WARM = good fit with a clear need, but no commitment yet\n" +
    "- COLD = vague need, poor fit, or pure price-shopping with no follow-up\n" +
    "- NOT_RELEVANT = spam, bot/gibberish submission, robocall, vendor/sales pitch to the business, wrong number, job seeker, or an existing customer with a service/billing question\n\n" +
    "Intent (pick one): ready_to_act, evaluating, information_only, existing_customer, not_a_lead\n" +
    "Score: 1-10 (HOT 8-10, WARM 5-7, COLD 2-4, NOT_RELEVANT 1).\n" +
    "subject: what they asked about, in plain words (e.g. '3BR in Warwick they want to sell', 'used pontoon under $30k', 'oak removal in back yard').\n" +
    "next_action: what the business should do now, or empty if nothing.\n" +
    "contact_name: caller's name if stated, else empty.\n\n" +
    "Respond with ONLY this JSON:\n" +
    "{\"lead_id\":\"" + leadId + "\",\"tier\":\"HOT|WARM|COLD|NOT_RELEVANT\",\"score\":0,\"intent\":\"...\",\"subject\":\"...\",\"next_action\":\"...\",\"contact_name\":\"...\",\"summary\":\"one sentence on what happened\"}";
}

function leadgenFallback(leadId, summary) {
  return { lead_id: String(leadId), tier: "ERROR", score: 0, intent: "", subject: "", next_action: "", contact_name: "", summary: summary };
}

async function classifyLeadgen(apiKey, t, accountName, note) {
  var transcript = (t.transcript || "").substring(0, 8000);
  var leadId = String(t.lead_id);
  try {
    var text = await callClaude(apiKey, LEADGEN_SYSTEM, leadgenPrompt(transcript, leadId, accountName, note, t.kind), 600);
    var r = extractJSON(text);
    r.lead_id = leadId;
    if (LEADGEN_TIERS.indexOf(r.tier) === -1) r.tier = "COLD";
    if (LEADGEN_INTENTS.indexOf(r.intent) === -1) r.intent = "information_only";
    r.score = Math.max(1, Math.min(10, parseInt(r.score) || 1));
    ["subject", "next_action", "contact_name", "summary"].forEach(function (k) { r[k] = r[k] ? String(r[k]) : ""; });
    return r;
  } catch (err) {
    console.error("leadgen classify failed", leadId, err.message);
    return leadgenFallback(leadId, "Error: " + err.message.substring(0, 120));
  }
}

// ---------- entry point ----------

async function classifyBatch(apiKey, transcripts, accountName, accountId, override) {
  var acct = resolveAccount(accountId, accountName);
  // Caller-supplied override (e.g. the Apps Script control sheet) wins over env config.
  if (override && (override.vertical === "hotel" || override.vertical === "leadgen")) acct.vertical = override.vertical;
  if (override && override.note) acct.note = String(override.note).substring(0, 500);
  var fn = acct.vertical === "hotel"
    ? function (t) { return classifyHotel(apiKey, t, accountName); }
    : function (t) { return classifyLeadgen(apiKey, t, accountName, acct.note); };
  // Run the batch concurrently: 5 calls take ~6s instead of ~30s, which keeps
  // the function well inside Vercel's timeout.
  var results = await Promise.all(transcripts.map(fn));
  return { vertical: acct.vertical, results: results };
}

module.exports = {
  HOTEL_NAME_PATTERNS: HOTEL_NAME_PATTERNS,
  resolveAccount: resolveAccount,
  classifyBatch: classifyBatch,
  classifyHotel: classifyHotel,
  classifyLeadgen: classifyLeadgen,
  extractJSON: extractJSON
};
