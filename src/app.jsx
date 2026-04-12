import { useState, useRef, useCallback } from "react";
import "./App.css";

var API_PROXY = "/api/whatconverts";
var ANALYZE_URL = "/api/analyze";
var LEAD_URL = "/api/lead";

var HOTEL_ACCOUNTS = [
  "Abellona Inn",
  "Archway Fishtown",
  "Atlantic Inn",
  "Atlantic Oceanfront Motel",
  "Briney Breezes",
  "Fun Hog Charters",
  "Inn At Highway 1",
  "Little Sur Inn",
  "Montauk Manor",
  "Moonstone Landing",
  "Mount Nevis Hotel",
  "Old Orchard Beach",
  "Rhumb Line",
  "Rose Farm Inn",
  "Sebastians BVI",
  "Sole East",
  "Southampton Inn",
  "Spring House",
  "Surf Lodge",
  "Village by the Sea",
  "Wavecrest on Ocean",
  "White Bay Villas",
  "York Harbor Inn"
];

function isHotelAccount(name) {
  var n = name.toLowerCase();
  return HOTEL_ACCOUNTS.some(function(h) { return n.includes(h.toLowerCase()); });
}

var MIN_CALL_DURATION = 20;

function classifyFromFields(lead) {
  var sv = parseFloat(lead.sales_value) || 0;
  if (sv > 0) return { isBooking: true, value: sv, method: "sales_value" };
  var qv = parseFloat(lead.quote_value) || 0;
  if (qv > 0) return { isBooking: true, value: qv, method: "quote_value" };
  var status = (lead.lead_status || "").toLowerCase();
  if (["qualified","converted","closed","won","booked","reservation","sale"].some(function(s) { return status.includes(s); }))
    return { isBooking: true, value: 0, method: "lead_status" };
  if ((lead.quotable || "").toLowerCase() === "yes")
    return { isBooking: true, value: 0, method: "quotable" };
  if (lead.ai_analysis && typeof lead.ai_analysis === "object") {
    var intent = (lead.ai_analysis["Intent Detection"] || "").toLowerCase();
    if (["purchase","book","reserve","buy"].some(function(w) { return intent.includes(w); }))
      return { isBooking: true, value: 0, method: "ai_intent" };
  }
  return { isBooking: false, value: 0, method: "none" };
}

function isGoogleAds(lead) {
  var src = (lead.lead_source || "").toLowerCase();
  var med = (lead.lead_medium || "").toLowerCase();
  return src.includes("google") && ["cpc","paid","ppc"].includes(med);
}

function getMonthRange(monthStr) {
  var parts = monthStr.split("-");
  var y = parseInt(parts[0]), m = parseInt(parts[1]);
  var start = y + "-" + String(m).padStart(2,"0") + "-01";
  var last = new Date(y, m, 0).getDate();
  var end = y + "-" + String(m).padStart(2,"0") + "-" + String(last).padStart(2,"0");
  var label = new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start: start, end: end, label: label };
}

function fmt(v) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function BookingDetail({ bookings }) {
  if (!bookings.length) return <div className="detail-empty">No bookings identified</div>;
  return (
    <div className="detail-table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Value</th><th>Source</th><th>Campaign</th><th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map(function(b, i) {
            return (
              <tr key={i}>
                <td>{b.date ? new Date(b.date).toLocaleDateString() : "—"}</td>
                <td><span className={"type-tag " + (b.classification || "").toLowerCase()}>{b.classification || b.method}</span></td>
                <td className="mono">{b.value > 0 ? fmt(b.value) : "—"}</td>
                <td>{b.source}{b.medium ? " / " + b.medium : ""}</td>
                <td>{b.campaign || "—"}</td>
                <td className="summary-cell">{b.summary || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function App() {
  var now = new Date();
  now.setMonth(now.getMonth() - 1);
  var defaultMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2,"0");

  var [month, setMonth] = useState(defaultMonth);
  var [running, setRunning] = useState(false);
  var [phase, setPhase] = useState("");
  var [log, setLog] = useState([]);
  var [results, setResults] = useState(null);
  var [error, setError] = useState(null);
  var [progress, setProgress] = useState({ current: 0, total: 0, account: "" });
  var [expanded, setExpanded] = useState({});
  var abortRef = useRef(false);

  var addLog = useCallback(function(msg) {
    setLog(function(p) { return p.concat(new Date().toLocaleTimeString() + " — " + msg); });
  }, []);

  var apiFetch = useCallback(function(endpoint, params) {
    params = params || {};
    var url = new URL(API_PROXY, window.location.origin);
    url.searchParams.set("endpoint", endpoint);
    Object.keys(params).forEach(function(k) { url.searchParams.set(k, params[k]); });
    return fetch(url.toString()).then(function(resp) {
      if (resp.status === 401) throw new Error("AUTH_FAILED");
      if (resp.status === 429) {
        addLog("Rate limited — waiting 30s...");
        return new Promise(function(r) { setTimeout(r, 30000); }).then(function() {
          return apiFetch(endpoint, params);
        });
      }
      if (!resp.ok) {
        return resp.json().catch(function() { return {}; }).then(function(err) {
          throw new Error(err.error || "API returned " + resp.status);
        });
      }
      return resp.json();
    });
  }, [addLog]);

  var fetchAllPages = useCallback(function(endpoint, params, itemKey) {
    params = params || {};
    var all = [];
    var page = 1;
    function fetchPage() {
      if (abortRef.current) return Promise.resolve(all);
      var p = Object.assign({}, params, { page_number: page });
      return apiFetch(endpoint, p).then(function(data) {
        var key = itemKey;
        if (!key) {
          Object.keys(data).forEach(function(k) { if (Array.isArray(data[k])) key = k; });
        }
        var items = data[key] || [];
        if (!items.length) return all;
        all = all.concat(items);
        if (page >= (data.total_pages || 1)) return all;
        page++;
        return new Promise(function(r) { setTimeout(r, 100); }).then(fetchPage);
      });
    }
    return fetchPage();
  }, [apiFetch]);

  // THIS IS THE KEY FIX - uses /api/lead endpoint directly
  var fetchLeadDetail = useCallback(function(leadId) {
    return fetch(LEAD_URL + "?id=" + leadId).then(function(r) { return r.json(); });
  }, []);

  var analyzeTranscripts = useCallback(function(batch, accountName) {
    return fetch(ANALYZE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcripts: batch, account_name: accountName })
    }).then(function(resp) {
      if (!resp.ok) {
        return resp.json().catch(function() { return {}; }).then(function(err) {
          throw new Error(err.error || "Analyze failed");
        });
      }
      return resp.json();
    }).then(function(data) {
      return data.results || [];
    });
  }, []);

  var runReport = useCallback(function() {
    setRunning(true);
    setError(null);
    setResults(null);
    setLog([]);
    setExpanded({});
    abortRef.current = false;

    var range = getMonthRange(month);
    addLog("Starting report for " + range.label);
    addLog("Filtering to hotel accounts (" + HOTEL_ACCOUNTS.length + " properties)");
    setPhase("Pulling call data...");

    addLog("Fetching accounts...");
    fetchAllPages("accounts", { accounts_per_page: 50 }, "accounts").then(function(allAccounts) {
      var accounts = allAccounts.filter(function(a) { return isHotelAccount(a.account_name || ""); });
      // Sort alphabetically
      accounts.sort(function(a, b) { return (a.account_name || "").localeCompare(b.account_name || ""); });
      addLog("Found " + allAccounts.length + " total, " + accounts.length + " hotel accounts");
      setProgress({ current: 0, total: accounts.length, account: "" });

      var reportData = [];
      var accountIndex = 0;

      function processNextAccount() {
        if (accountIndex >= accounts.length || abortRef.current) return Promise.resolve();

        var acct = accounts[accountIndex];
        var name = acct.account_name || "Account " + acct.account_id;
        setProgress({ current: accountIndex + 1, total: accounts.length, account: name });
        addLog("[" + (accountIndex + 1) + "/" + accounts.length + "] " + name);

        var totals = {
          account_name: name,
          account_id: acct.account_id,
          total_calls: 0, booked: 0, high_intent: 0, total_value: 0,
          google_ads_calls: 0, google_ads_booked: 0, google_ads_high_intent: 0, google_ads_value: 0,
          bookings: [], leads_to_analyze: []
        };

        var profiles = acct.profiles || [];
        var profileIndex = 0;

        function processNextProfile() {
          if (profileIndex >= profiles.length || abortRef.current) return Promise.resolve();
          var profile = profiles[profileIndex];
          profileIndex++;

          return fetchAllPages("leads", {
            lead_type: "phone_call", start_date: range.start, end_date: range.end,
            leads_per_page: 250, account_id: acct.account_id, profile_id: profile.profile_id
          }, "leads").then(function(leads) {
            addLog("  " + (profile.profile_name || "Profile") + ": " + leads.length + " calls");
            totals.total_calls += leads.length;

            leads.forEach(function(lead) {
              if (lead.spam || lead.duplicate) return;
              var gads = isGoogleAds(lead);
              if (gads) totals.google_ads_calls++;

              var fieldResult = classifyFromFields(lead);
              if (fieldResult.isBooking) {
                totals.booked++;
                totals.total_value += fieldResult.value;
                if (gads) { totals.google_ads_booked++; totals.google_ads_value += fieldResult.value; }
                totals.bookings.push({
                  lead_id: lead.lead_id, date: lead.date_created || "", value: fieldResult.value,
                  method: fieldResult.method, classification: "BOOKED",
                  source: lead.lead_source || "", medium: lead.lead_medium || "",
                  campaign: lead.lead_campaign || "", summary: "From " + fieldResult.method,
                  is_google_ads: gads
                });
                return;
              }

              var duration = parseInt(lead.call_duration_seconds) || 0;
              if (duration >= MIN_CALL_DURATION) {
                totals.leads_to_analyze.push({
                  lead_id: lead.lead_id, date: lead.date_created || "",
                  source: lead.lead_source || "", medium: lead.lead_medium || "",
                  campaign: lead.lead_campaign || "", duration: duration, is_google_ads: gads
                });
              }
            });

            return processNextProfile();
          }).catch(function(e) {
            addLog("  Error: " + e.message);
            return processNextProfile();
          });
        }

        return processNextProfile().then(function() {
          reportData.push(totals);
          addLog("  -> " + totals.total_calls + " calls, " + totals.leads_to_analyze.length + " queued for AI");
          accountIndex++;
          return processNextAccount();
        });
      }

      return processNextAccount().then(function() {
        setPhase("Fetching transcripts & analyzing...");
        var totalToAnalyze = 0;
        reportData.forEach(function(a) { totalToAnalyze += a.leads_to_analyze.length; });
        addLog("");
        addLog("=== TRANSCRIPT FETCH & AI ANALYSIS ===");
        addLog("Total leads to analyze: " + totalToAnalyze);

        if (totalToAnalyze === 0) {
          addLog("No qualifying calls found");
          return reportData;
        }

        var acctIdx = 0;
        var globalFetched = 0;

        function processNextAccountTranscripts() {
          if (acctIdx >= reportData.length || abortRef.current) return Promise.resolve();

          var acct = reportData[acctIdx];
          var leadsToAnalyze = acct.leads_to_analyze;
          acctIdx++;

          if (!leadsToAnalyze.length) return processNextAccountTranscripts();

          addLog("Fetching transcripts: " + acct.account_name + " (" + leadsToAnalyze.length + " calls)");
          setPhase("Transcripts: " + acct.account_name);

          var transcriptsForAI = [];
          var leadIdx = 0;

          function fetchNextTranscript() {
            if (leadIdx >= leadsToAnalyze.length || abortRef.current) return Promise.resolve();

            var lead = leadsToAnalyze[leadIdx];
            leadIdx++;
            globalFetched++;
            setProgress({ current: globalFetched, total: totalToAnalyze, account: acct.account_name + " (transcripts)" });

            return fetchLeadDetail(lead.lead_id).then(function(detail) {
              // Log fields for first lead of first account to debug
              if (globalFetched === 1) {
                addLog("  DEBUG lead fields: " + Object.keys(detail).join(", "));
                // Log any string field longer than 40 chars
                Object.keys(detail).forEach(function(k) {
                  if (typeof detail[k] === "string" && detail[k].length > 40) {
                    addLog("  DEBUG " + k + ": " + detail[k].substring(0, 80) + "...");
                  }
                });
              }

              // Try every possible transcript field name
              var transcript = "";
              var tryFields = ["call_transcription", "call_transcript", "transcript", "transcription", "recording_transcription"];
              for (var i = 0; i < tryFields.length; i++) {
                if (detail[tryFields[i]] && typeof detail[tryFields[i]] === "string" && detail[tryFields[i]].length > 20) {
                  transcript = detail[tryFields[i]];
                  if (globalFetched === 1) addLog("  DEBUG found transcript in: " + tryFields[i]);
                  break;
                }
              }

              // Fallback: check any long string field
              if (!transcript) {
                Object.keys(detail).forEach(function(k) {
                  if (!transcript && typeof detail[k] === "string" && detail[k].length > 80 &&
                      k !== "lead_url" && k !== "landing_url" && k !== "recording_url" && k !== "recording") {
                    transcript = detail[k];
                    if (globalFetched === 1) addLog("  DEBUG fallback transcript in: " + k);
                  }
                });
              }

              if (transcript && transcript.length > 30) {
                transcriptsForAI.push({
                  lead_id: String(lead.lead_id), transcript: transcript,
                  date: lead.date, source: lead.source, medium: lead.medium,
                  campaign: lead.campaign, is_google_ads: lead.is_google_ads
                });
              }

              return new Promise(function(r) { setTimeout(r, 120); }).then(fetchNextTranscript);
            }).catch(function(e) {
              if (globalFetched === 1) addLog("  DEBUG fetch error: " + e.message);
              return new Promise(function(r) { setTimeout(r, 120); }).then(fetchNextTranscript);
            });
          }

          return fetchNextTranscript().then(function() {
            addLog("  Got " + transcriptsForAI.length + " transcripts out of " + leadsToAnalyze.length + " calls");

            if (!transcriptsForAI.length) return processNextAccountTranscripts();

            setPhase("AI analyzing: " + acct.account_name);
            var batchIdx = 0;

            function processNextBatch() {
              if (batchIdx >= transcriptsForAI.length || abortRef.current) return Promise.resolve();

              var batch = transcriptsForAI.slice(batchIdx, batchIdx + 10);
              batchIdx += batch.length;
              addLog("  Analyzing batch " + Math.ceil(batchIdx / 10) + "...");

              return analyzeTranscripts(batch, acct.account_name).then(function(aiResults) {
                aiResults.forEach(function(r) {
                  if (r.classification === "BOOKED" || r.classification === "HIGH_INTENT") {
                    var original = transcriptsForAI.find(function(t) { return String(t.lead_id) === String(r.lead_id); });
                    if (!original) return;
                    var val = parseFloat(r.estimated_value) || 0;

                    if (r.classification === "BOOKED") {
                      acct.booked++;
                      acct.total_value += val;
                      if (original.is_google_ads) { acct.google_ads_booked++; acct.google_ads_value += val; }
                    } else {
                      acct.high_intent++;
                      if (original.is_google_ads) acct.google_ads_high_intent++;
                    }

                    acct.bookings.push({
                      lead_id: r.lead_id, date: original.date, value: val,
                      method: "ai_transcript", classification: r.classification,
                      source: original.source, medium: original.medium,
                      campaign: original.campaign, summary: r.summary || "",
                      is_google_ads: original.is_google_ads
                    });
                  }
                });

                return new Promise(function(r) { setTimeout(r, 500); }).then(processNextBatch);
              }).catch(function(e) {
               addLog("  Batch error: " + (e.message || JSON.stringify(e)));
                return new Promise(function(r) { setTimeout(r, 1000); }).then(processNextBatch);
              });
            }

            return processNextBatch().then(function() {
              addLog("  Result: " + acct.booked + " booked, " + acct.high_intent + " high-intent");
              return processNextAccountTranscripts();
            });
          });
        }

        return processNextAccountTranscripts().then(function() { return reportData; });
      });
    }).then(function(reportData) {
      // Sort alphabetically
      reportData.sort(function(a, b) { return (a.account_name || "").localeCompare(b.account_name || ""); });
      setResults({ data: reportData, month: getMonthRange(month).label });
      setPhase("");
      addLog("Done!");
    }).catch(function(e) {
      setError(e.message);
      addLog("Error: " + e.message);
      setPhase("");
    }).finally(function() {
      setRunning(false);
    });
  }, [month, addLog, fetchAllPages, fetchLeadDetail, analyzeTranscripts]);

  var exportCSV = useCallback(function() {
    if (!results) return;
    var rows = [["Account","Total Calls","Booked","High Intent","Booking Rate %","Revenue","Google Ads Calls","GAds Booked","GAds High Intent","GAds Revenue"]];
    results.data.forEach(function(a) {
      var rate = a.total_calls > 0 ? ((a.booked / a.total_calls) * 100).toFixed(1) : "0";
      rows.push([a.account_name, a.total_calls, a.booked, a.high_intent, rate, a.total_value.toFixed(2), a.google_ads_calls, a.google_ads_booked, a.google_ads_high_intent || 0, a.google_ads_value.toFixed(2)]);
    });
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + c + '"'; }).join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "call_bookings_" + month + ".csv"; a.click();
  }, [results, month]);

  var exportDetailCSV = useCallback(function() {
    if (!results) return;
    var rows = [["Account","Date","Classification","Value","Source","Medium","Campaign","Summary","Google Ads"]];
    results.data.forEach(function(acct) {
      acct.bookings.forEach(function(b) {
        rows.push([acct.account_name, b.date, b.classification, b.value.toFixed(2), b.source, b.medium, b.campaign, (b.summary || "").replace(/"/g, "'"), b.is_google_ads ? "Yes" : "No"]);
      });
    });
    var csv = rows.map(function(r) { return r.map(function(c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "call_bookings_detail_" + month + ".csv"; a.click();
  }, [results, month]);

  var grand = results ? results.data.reduce(function(t, a) {
    return { calls: t.calls + a.total_calls, booked: t.booked + a.booked, highIntent: t.highIntent + a.high_intent,
      value: t.value + a.total_value, gc: t.gc + a.google_ads_calls, gb: t.gb + a.google_ads_booked,
      ghi: t.ghi + (a.google_ads_high_intent || 0), gv: t.gv + a.google_ads_value };
  }, { calls:0, booked:0, highIntent:0, value:0, gc:0, gb:0, ghi:0, gv:0 }) : null;

  return (
    <div className="app">
      <header className="header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#0f4c75"/>
            <text x="8" y="23" fill="#bbe1fa" fontSize="20" fontWeight="700" fontFamily="sans-serif">B</text>
          </svg>
          <div>
            <h1>Call Booking Report</h1>
            <p>AI-powered phone booking analysis — hotel accounts</p>
          </div>
        </div>
      </header>

      <div className="controls">
        <div className="control-row">
          <div className="field">
            <label>Report Month</label>
            <input type="month" value={month} onChange={function(e) { setMonth(e.target.value); }} />
          </div>
          <div className="buttons">
            <button className="btn-primary" onClick={runReport} disabled={running}>
              {running ? phase || "Processing..." : "Run Report"}
            </button>
            {running && <button className="btn-cancel" onClick={function() { abortRef.current = true; }}>Cancel</button>}
            {results && <button className="btn-export" onClick={exportCSV}>Summary CSV</button>}
            {results && <button className="btn-export" onClick={exportDetailCSV}>Detail CSV</button>}
          </div>
        </div>
      </div>

      {running && progress.total > 0 && (
        <div className="progress-wrap">
          <div className="progress-info">
            <span>{progress.account}</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: (progress.current / progress.total * 100) + "%" }} />
          </div>
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {results && (
        <>
          <div className="stats-grid four">
            <StatCard label="Total Calls" value={grand.calls.toLocaleString()} sub={grand.gc + " from Google Ads"} />
            <StatCard label="Confirmed Bookings" value={grand.booked.toLocaleString()} sub={grand.gb + " from Google Ads"} />
            <StatCard label="High Intent Calls" value={grand.highIntent.toLocaleString()} sub={grand.ghi + " from Google Ads"} />
            <StatCard label="Booking Revenue" value={fmt(grand.value)} sub={fmt(grand.gv) + " from Google Ads"} />
          </div>

          <div className="table-container">
            <div className="table-header">
              <h2>By Client — {results.month}</h2>
              <span className="table-meta">{results.data.filter(function(a) { return a.total_calls > 0; }).length} active hotels</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="left">Hotel</th><th>Calls</th><th>Booked</th><th>High Intent</th>
                    <th>Rate</th><th>Revenue</th>
                    <th className="gads">GAds Calls</th><th className="gads">GAds Book</th><th className="gads">GAds Rev</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.filter(function(a) { return a.total_calls > 0; }).map(function(a, i) {
                    var rate = a.total_calls > 0 ? (a.booked / a.total_calls * 100).toFixed(0) : "0";
                    return [
                      <tr key={a.account_id} className={i % 2 === 0 ? "even" : "odd"}>
                        <td className="left name">{a.account_name}</td>
                        <td className="mono">{a.total_calls}</td>
                        <td className={"mono " + (a.booked > 0 ? "positive" : "muted")}>{a.booked}</td>
                        <td className={"mono " + (a.high_intent > 0 ? "intent" : "muted")}>{a.high_intent}</td>
                        <td className="mono">{rate}%</td>
                        <td className={"mono bold " + (a.total_value > 0 ? "" : "muted")}>{a.total_value > 0 ? fmt(a.total_value) : "—"}</td>
                        <td className="mono gads-val">{a.google_ads_calls || "—"}</td>
                        <td className={"mono gads-val " + (a.google_ads_booked > 0 ? "positive" : "")}>{a.google_ads_booked || "—"}</td>
                        <td className="mono gads-val bold">{a.google_ads_value > 0 ? fmt(a.google_ads_value) : "—"}</td>
                        <td>
                          {(a.booked > 0 || a.high_intent > 0) && (
                            <button className="expand-btn" onClick={function() { setExpanded(function(p) { var n = {}; n[a.account_id] = !p[a.account_id]; return Object.assign({}, p, n); }); }}>
                              {expanded[a.account_id] ? "▾" : "▸"}
                            </button>
                          )}
                        </td>
                      </tr>,
                      expanded[a.account_id] ? (
                        <tr key={a.account_id + "-detail"} className="detail-row">
                          <td colSpan={10}><BookingDetail bookings={a.bookings} /></td>
                        </tr>
                      ) : null
                    ];
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {results.data.filter(function(a) { return a.total_calls === 0; }).length > 0 && (
            <div className="no-activity">
              <strong>No calls recorded: </strong>
              {results.data.filter(function(a) { return a.total_calls === 0; }).map(function(a) { return a.account_name; }).join(", ")}
            </div>
          )}
        </>
      )}

      {log.length > 0 && (
        <details className="log-section" open={running || !!error}>
          <summary>Activity Log ({log.length})</summary>
          <div className="log-output">
            {log.map(function(l, i) { return <div key={i}>{l}</div>; })}
          </div>
        </details>
      )}
    </div>
  );
}
