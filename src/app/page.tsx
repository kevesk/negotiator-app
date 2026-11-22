"use client";
import { useEffect, useRef, useState } from "react";
import { T, STEP_OF, type Lang } from "./ui-text";
import { newState, type SessionState } from "@/orchestrator/state";
import { toSummary } from "@/orchestrator/summary";
import { Markdown } from "./markdown";

interface Msg { role: "user" | "assistant"; content: string; error?: boolean; brief?: boolean }

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<SessionState | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [next, setNext] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [rated, setRated] = useState(false);
  const [printText, setPrintText] = useState<string | null>(null);
  // access code for the test version (D108): asked once on the start screen, remembered in this browser only
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const t = T[lang];

  useEffect(() => { try { const l = navigator.language.toLowerCase().startsWith("sv") ? "sv" : "en"; setLang(l); } catch { /* default */ } }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);
  useEffect(() => {
    try { setCode(localStorage.getItem("negotiator_access") ?? ""); } catch { /* storage blocked: the code is asked again */ }
    fetch("/api/access").then((r) => r.json()).then((j) => setNeedCode(j.required === true)).catch(() => { /* if unsure, the chat answer will tell */ });
  }, []);
  const fill = (s: string, m: unknown) => s.replace("{m}", String(typeof m === "number" ? m : 60));
  async function begin() {
    if (!needCode) return start();
    setCodeError("");
    try {
      const r = await fetch("/api/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { try { localStorage.setItem("negotiator_access", code.trim()); } catch { /* kept in memory for this visit */ } start(); }
      else setCodeError(r.status === 429 ? fill(t.accessTooMany, j.retryAfterMinutes) : t.accessWrong);
    } catch { setCodeError(t.errors.generic); }
  }

  const start = () => {
    const s = newState(lang); s.messages.push({ role: "assistant", content: t.opening });
    setState(s); setLog([{ role: "assistant", content: t.opening }]); setStep(0); setNext(t.openingNext); setChips([...t.openingChips]); setStarted(true);
  };
  const reset = () => { setStarted(false); setState(null); setLog([]); setText(""); setChips([]); setNext(""); };

  async function send(override?: string) {
    const message = (override ?? text).trim(); if (!message || busy || !state) return;
    setText(""); setChips([]); setBusy(true); setLog((l) => [...l, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-access-code": code.trim() }, body: JSON.stringify({ message, state }) });
      const j = await res.json();
      if (!res.ok) { const e = fill((T[lang].errors as Record<string, string>)[j.error] ?? t.errors.generic, j.retryAfterMinutes); if (j.error === "access_required") { setNeedCode(true); try { localStorage.removeItem("negotiator_access"); } catch { /* nothing stored */ } } setLog((l) => [...l, { role: "assistant", content: e, error: true }]); }
      else { setState(j.state); setStep(STEP_OF[j.stage] ?? 0); setNext(j.next ?? ""); setChips(Array.isArray(j.suggestions) ? j.suggestions.slice(0, 3) : []); setLog((l) => [...l, { role: "assistant", content: j.reply, brief: j.brief === true }]); if (j.brief) setRated(false); }
    } catch { setLog((l) => [...l, { role: "assistant", content: t.errors.generic, error: true }]); }
    finally { setBusy(false); }
  }
  async function copy(i: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500); } catch { /* clipboard blocked: the text can still be selected by hand */ }
  }
  function pdf(text: string) { setPrintText(text); setTimeout(() => { window.print(); setPrintText(null); }, 100); }
  async function rate(value: "useful" | "somewhat" | "not_useful") {
    setRated(true); // anonymous counter only: no message content, no session id
    try { await fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "rating", value }) }); } catch { /* counters never block the user */ }
  }
  function download() {
    if (!state) return;
    const url = URL.createObjectURL(new Blob([toSummary(state)], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "negotiator-summary.txt"; a.click(); URL.revokeObjectURL(url);
  }
  const toggle = (
    <div className="seg" role="group" aria-label={t.language}>
      {(["en", "sv"] as const).map((l) => (<button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} disabled={started}>{l === "en" ? "English" : "Svenska"}</button>))}
    </div>
  );

  if (!started) return (
    <main className="shell">
      <div className="top"><h1>{t.title}</h1>{toggle}</div>
      <section className="card terms">
        <h2>{t.termsHead}</h2><p className="tag">{t.tagline}</p>
        <ul>{t.terms.map((x) => <li key={x}>{x}</li>)}</ul>
        {needCode && (
          <div className="access">
            <label htmlFor="access-code">{t.accessLabel}</label>
            <p className="hint">{t.accessHint}</p>
            <input id="access-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void begin(); }} aria-invalid={!!codeError} aria-describedby={codeError ? "access-error" : undefined} />
            {codeError && <p id="access-error" className="error" role="alert">{codeError}</p>}
          </div>
        )}
        <div><button className="btn primary" onClick={() => void begin()} disabled={needCode && !code.trim()}>{t.start}</button></div>
      </section>
    </main>
  );
  return (
    <main className="shell">
      {printText !== null && <div className="print-only"><Markdown text={printText} /></div>}
      <div className="top"><h1>{t.title}</h1><div className="row">{state && Object.keys(state.slots).length > 0 && <button className="btn" onClick={download}>{t.summary}</button>}<button className="btn" onClick={reset}>{t.newSession}</button></div></div>
      <div className="main">
        <ol className="steps" aria-label="Progress">{t.steps.map((s, i) => <li key={s} data-on={i === step} data-done={i < step}>{s}</li>)}</ol>
        <section className="chat">
          <div className="log" aria-live="polite">
            <div className="notice" role="note">{t.notice} <a href="/privacy" target="_blank" rel="noreferrer">{t.privacy}</a></div>
            {log.map((m, i) => (
              <div key={i} className={`msgwrap ${m.role === "user" ? "user" : ""}`}>
                <div className={`msg ${m.role === "user" ? "user" : ""} ${m.error ? "err" : ""} ${m.brief ? "brief" : ""}`}>
                  {m.brief && <div className="brieftag">{t.briefReady}</div>}
                  {m.role === "user" || m.error ? m.content : <Markdown text={m.content} />}
                </div>
                {m.role === "assistant" && !m.error && i > 0 && (
                  <div className="actions">
                    <button className="link" onClick={() => void copy(i, m.content)}>{copied === i ? t.copied : t.copy}</button>
                    {m.brief && <button className="link" onClick={() => pdf(m.content)}>{t.savePdf}</button>}
                    {m.brief && (rated ? <span className="thanks">{t.ratingThanks}</span> : (
                      <span className="rate">{t.ratingQ} {(["useful", "somewhat", "not_useful"] as const).map((v) => <button key={v} className="link" onClick={() => void rate(v)}>{t.ratings[v]}</button>)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="msg" aria-busy="true">{t.thinking}</div>}
            <div ref={end} />
          </div>
          {next && !busy && (
            <div className="next" role="status">
              <span className="nextlabel">{t.nextLabel} · {t.stepOf.replace("{n}", String(step + 1)).replace("{total}", String(t.steps.length))}</span>
              <span className="nexttext">{next}{step + 1 < t.steps.length && <span className="then"> {t.then}: {t.steps[step + 1]}</span>}</span>
            </div>
          )}
          {chips.length > 0 && !busy && (
            <div className="chips" role="group" aria-label={t.suggestLabel}>
              {chips.map((c) => <button key={c} className="chip" onClick={() => void send(c)}>{c}</button>)}
            </div>
          )}
          <div className="compose">
            <textarea value={text} placeholder={t.placeholder} rows={2} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <button className="btn primary" onClick={() => void send()} disabled={busy || !text.trim()}>{t.send}</button>
          </div>
          <div className="foot">{t.disclaimer}</div>
        </section>
      </div>
    </main>
  );
}
