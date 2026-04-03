import { useState, useRef, useCallback } from "react";
import "./App.css";

// ── Point to our Vercel proxy ──
const API_PROXY = "/api/whatconverts";

// ── Booking classification logic ──
function classifyBooking(lead) {
  const sv = parseFloat(lead.sales_value) || 0;
  if (sv > 0) return { isBooking: true, value: sv, method: "sales_value" };
  const qv = parseFloat(lead.quote_value) || 0;
  if (qv > 0) return { isBooking: true, value: qv, method: "quote_value" };
  const status = (lead.lead_status || "").toLowerCase();
  if (["qualified","converted","closed","won","booked","reservation","sale"].some(s => status.includes(s)))
    return { isBooking: true, value: 0, method: "lead_status" };
  if ((lead.quotable || "").toLowerCase() === "yes")
    return { isBooking: true, value: 0, method: "quotable" };
  if (lead.ai_analysis && typeof lead.ai_analysis === "object") {
    const intent = (lead.ai_analysis["Intent Detection"] || "").toLowerCase();
    if (["purchase","book","reserve","buy"].some(w => intent.includes(w)))
      return { isBooking: true, value: 0, method: "ai_intent" };
  }
  const spotted = (lead.spotted_keywords || "").toLowerCase();
  if (["book","reserve","reservation","room","stay","night","check-in","availability"].some(kw => spotted.includes(kw)))
    return { isBooking: true, value: 0, method: "spotted_keywords" };
  return { isBooking: false, value: 0, method: "none" };
}

function isGoogleAds(lead) {
  const src = (lead.lead_source || "").toLowerCase();
  const med = (lead.lead_medium || "").toLowerCase();
  return src.includes("google") && ["cpc","paid","ppc"].includes(med);
}

function getMonthRange(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2,"0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2,"0")}-${String(last).padStart(2,"0")}`;
  const label = new Date(y, m - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, label };
}

function fmt(v) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Stat Card ──
function StatCard({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Expanded Row Detail ──
function BookingDetail({ bookings }) {
  if (!bookings.length) return <div className="detail-empty">No individual bookings recorded</div>;
  return (
    <div className="detail-table-wrap">
      <table className="detail-table">
        <thead>
          <tr>
            <th>Date</th><th>Value</th><th>Source / Medium</th><th>Campaign</th><th>Location</th><th>Status</th><th>Method</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b, i) => (
            <tr key={i}>
              <td>{b.date ? new Date(b.date).toLocaleDateString() : "—"}</td>
              <td className="mono">{b.value > 0 ? fmt(b.value) : "—"}</td>
              <td>{b.source}{b.medium ? ` / ${b.medium}` : ""}</td>
              <td>{b.campaign || "—"}</td>
              <td>{[b.city, b.state].filter(Boolean).join(", ") || "—"}</td>
              <td>{b.status || "—"}</td>
              <td><span className="method-tag">{b.method}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main App ──
export default function App() {
  const [month, setMonth] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,"0")}`;
  });
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, account: "" });
  const [expanded, setExpanded] = useState({});
  const abortRef = useRef(false);

  const addLog = useCallback((msg) => setLog(p => [...p, `${new Date().toLocaleTimeString()} — ${msg}`]), []);

  const apiFetch = useCallback(async (endpoint, params = {}) => {
    const url = new URL(API_PROXY, window.location.origin);
    url.searchParams.set("endpoint", endpoint);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const resp = await fetch(url.toString());
    if (resp.status === 401) throw new Error("AUTH_FAILED");
    if (resp.status === 429) {
      addLog("Rate limited — waiting 30s...");
      await new Promise(r => setTimeout(r, 30000));
      return apiFetch(endpoint, params);
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `API returned ${resp.status}`);
    }
    return resp.json();
  }, [addLog]);

  const fetchAllPages = useCallback(async (endpoint, params = {}, itemKey) => {
    let all = [], page = 1;
    while (!abortRef.current) {
      const data = await apiFetch(endpoint, { ...params, page_number: page });
      const key = itemKey || Object.keys(data).find(k => Array.isArray(data[k]));
      const items = data[key] || [];
      if (!items.length) break;
      all = all.concat(items);
      if (page >= (data.total_pages || 1)) break;
      page++;
      await new Promise(r => setTimeout(r, 100));
    }
    return all;
  }, [apiFetch]);

  const runReport = useCallback(async () => {
    setRunning(true); setError(null); setResults(null); setLog([]); setExpanded({});
    abortRef.current = false;
    const { start, end, label } = getMonthRange(month);
    addLog(`Starting report for ${label} (${start} → ${end})`);

    try {
      addLog("Fetching accounts...");
      const accounts = await fetchAllPages("accounts", { accounts_per_page: 50 }, "accounts");
      addLog(`Found ${accounts.length} accounts`);
      setProgress({ current: 0, total: accounts.length, account: "" });

      const reportData = [];

      for (let i = 0; i < accounts.length; i++) {
        if (abortRef.current) { addLog("Cancelled."); break; }
        const acct = accounts[i];
        const name = acct.account_name || `Account ${acct.account_id}`;
        setProgress({ current: i + 1, total: accounts.length, account: name });
        addLog(`[${i+1}/${accounts.length}] ${name}`);

        const totals = {
          account_name: name, account_id: acct.account_id,
          total_calls: 0, total_bookings: 0, total_value: 0,
          google_ads_calls: 0, google_ads_bookings: 0, google_ads_value: 0,
          calls_with_value: 0, bookings: [],
        };

        for (const profile of (acct.profiles || [])) {
          if (abortRef.current) break;
          try {
            const leads = await fetchAllPages("leads", {
              lead_type: "phone_call", start_date: start, end_date: end,
              leads_per_page: 250, account_id: acct.account_id, profile_id: profile.profile_id,
            }, "leads");
            addLog(`  ${profile.profile_name}: ${leads.length} calls`);
            totals.total_calls += leads.length;

            for (const lead of leads) {
              if (lead.spam || lead.duplicate) continue;
              const gads = isGoogleAds(lead);
              if (gads) totals.google_ads_calls++;
              const { isBooking, value, method } = classifyBooking(lead);
              if (isBooking) {
                totals.total_bookings++;
                totals.total_value += value;
                if (value > 0) totals.calls_with_value++;
                if (gads) { totals.google_ads_bookings++; totals.google_ads_value += value; }
                totals.bookings.push({
                  date: lead.date_created || "", value, method,
                  source: lead.lead_source || "", medium: lead.lead_medium || "",
                  campaign: lead.lead_campaign || "", duration: lead.call_duration || "",
                  city: lead.city || "", state: lead.state || "", status: lead.lead_status || "",
                });
              }
            }
          } catch (e) {
            addLog(`  ⚠ Error on profile ${profile.profile_name}: ${e.message}`);
          }
        }

        totals.booking_rate = totals.total_calls > 0 ? (totals.total_bookings / totals.total_calls * 100) : 0;
        totals.avg_value = totals.calls_with_value > 0 ? totals.total_value / totals.calls_with_value : 0;
        reportData.push(totals);
        addLog(`  → ${totals.total_bookings} bookings, ${fmt(totals.total_value)}`);
      }

      reportData.sort((a, b) => b.total_value - a.total_value);
      setResults({ data: reportData, month: label });
      addLog("✓ Report complete");
    } catch (e) {
      setError(e.message);
      addLog(`✗ Error: ${e.message}`);
    }
    setRunning(false);
  }, [month, addLog, fetchAllPages]);

  // CSV export
  const exportCSV = useCallback(() => {
    if (!results) return;
    const rows = [["Account","Total Calls","Bookings","Booking Rate %","Total Value","Avg Booking Value","Google Ads Calls","Google Ads Bookings","Google Ads Revenue"]];
    for (const a of results.data) {
      rows.push([a.account_name, a.total_calls, a.total_bookings, a.booking_rate.toFixed(1), a.total_value.toFixed(2), a.avg_value.toFixed(2), a.google_ads_calls, a.google_ads_bookings, a.google_ads_value.toFixed(2)]);
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `call_bookings_${month}.csv`; a.click();
  }, [results, month]);

  // Detail CSV
  const exportDetailCSV = useCallback(() => {
    if (!results) return;
    const rows = [["Account","Date","Value","Source","Medium","Campaign","City","State","Status","Method"]];
    for (const acct of results.data) {
      for (const b of acct.bookings) {
        rows.push([acct.account_name, b.date, b.value.toFixed(2), b.source, b.medium, b.campaign, b.city, b.state, b.status, b.method]);
      }
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `call_bookings_detail_${month}.csv`; a.click();
  }, [results, month]);

  const grand = results ? results.data.reduce((t, a) => ({
    calls: t.calls + a.total_calls, bookings: t.bookings + a.total_bookings,
    value: t.value + a.total_value, gc: t.gc + a.google_ads_calls,
    gb: t.gb + a.google_ads_bookings, gv: t.gv + a.google_ads_value,
  }), { calls:0, bookings:0, value:0, gc:0, gb:0, gv:0 }) : null;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="7" fill="#0f4c75"/>
            <text x="8" y="23" fill="#bbe1fa" fontSize="20" fontWeight="700" fontFamily="sans-serif">B</text>
          </svg>
          <div>
            <h1>Call Booking Report</h1>
            <p>Monthly phone booking revenue by client</p>
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="controls">
        <div className="control-row">
          <div className="field">
            <label>Report Month</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} />
          </div>
          <div className="buttons">
            <button className="btn-primary" onClick={runReport} disabled={running}>
              {running ? `Processing ${progress.current}/${progress.total}...` : "Run Report"}
            </button>
            {running && <button className="btn-cancel" onClick={() => abortRef.current = true}>Cancel</button>}
            {results && <button className="btn-export" onClick={exportCSV}>Summary CSV</button>}
            {results && <button className="btn-export" onClick={exportDetailCSV}>Detail CSV</button>}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {running && progress.total > 0 && (
        <div className="progress-wrap">
          <div className="progress-info">
            <span>{progress.account}</span>
            <span>{progress.current} / {progress.total}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div className="error-box">{error}</div>}

      {/* Results */}
      {results && (
        <>
          <div className="stats-grid">
            <StatCard label="Total Calls" value={grand.calls.toLocaleString()} sub={`${grand.gc} from Google Ads`} />
            <StatCard label="Phone Bookings" value={grand.bookings.toLocaleString()} sub={`${grand.gb} from Google Ads`} />
            <StatCard label="Booking Revenue" value={fmt(grand.value)} sub={`${fmt(grand.gv)} from Google Ads`} />
          </div>

          <div className="table-container">
            <div className="table-header">
              <h2>By Client — {results.month}</h2>
              <span className="table-meta">{results.data.filter(a => a.total_calls > 0).length} active clients</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="left">Client</th>
                    <th>Calls</th><th>Bookings</th><th>Rate</th><th>Revenue</th><th>Avg</th>
                    <th className="gads">GAds Calls</th><th className="gads">GAds Book</th><th className="gads">GAds Rev</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.data.filter(a => a.total_calls > 0).map((a, i) => (
                    <>
                      <tr key={a.account_id} className={i % 2 === 0 ? "even" : "odd"}>
                        <td className="left name">{a.account_name}</td>
                        <td className="mono">{a.total_calls}</td>
                        <td className={`mono ${a.total_bookings > 0 ? "positive" : "muted"}`}>{a.total_bookings}</td>
                        <td className="mono">{a.booking_rate.toFixed(0)}%</td>
                        <td className={`mono bold ${a.total_value > 0 ? "" : "muted"}`}>{a.total_value > 0 ? fmt(a.total_value) : "—"}</td>
                        <td className="mono">{a.avg_value > 0 ? fmt(a.avg_value) : "—"}</td>
                        <td className="mono gads-val">{a.google_ads_calls || "—"}</td>
                        <td className={`mono gads-val ${a.google_ads_bookings > 0 ? "positive" : ""}`}>{a.google_ads_bookings || "—"}</td>
                        <td className="mono gads-val bold">{a.google_ads_value > 0 ? fmt(a.google_ads_value) : "—"}</td>
                        <td>
                          {a.total_bookings > 0 && (
                            <button className="expand-btn" onClick={() => setExpanded(p => ({ ...p, [a.account_id]: !p[a.account_id] }))}>
                              {expanded[a.account_id] ? "▾" : "▸"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expanded[a.account_id] && (
                        <tr key={`${a.account_id}-detail`} className="detail-row">
                          <td colSpan={10}>
                            <BookingDetail bookings={a.bookings} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {results.data.filter(a => a.total_calls === 0).length > 0 && (
            <div className="no-activity">
              <strong>No calls recorded: </strong>
              {results.data.filter(a => a.total_calls === 0).map(a => a.account_name).join(", ")}
            </div>
          )}
        </>
      )}

      {/* Log */}
      {log.length > 0 && (
        <details className="log-section" open={running || !!error}>
          <summary>Activity Log ({log.length})</summary>
          <div className="log-output">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </details>
      )}
    </div>
  );
}
