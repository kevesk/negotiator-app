"use client";
import { useEffect, useRef, useState } from "react";
import { T, STEP_OF, type Lang } from "./ui-text";
import { newState, type SessionState } from "@/orchestrator/state";
import { toSummary } from "@/orchestrator/summary";
import { Markdown } from "./markdown";
import { DealLine } from "./deal-line";
import { cleanForReader } from "./reader";

interface Msg { role: "user" | "assistant"; content: string; error?: boolean; brief?: boolean }
/** One step back: everything the screen shows after a reply, so "Undo last answer" can restore it exactly. */
interface Snap { state: SessionState; log: Msg[]; step: number; next: string; chips: string[]; canSkip: boolean; finished: boolean }

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
  const [canSkip, setCanSkip] = useState(false);
  const [finished, setFinished] = useState(false);
  const [history, setHistory] = useState<Snap[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [rated, setRated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  // access code for the test version (D108): asked once on the start screen, remembered in this browser only
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const t = T[lang];

  useEffect(() => { try { const l = navigator.language.toLowerCase().startsWith("sv") ? "sv" : "en"; setLang(l); } catch { /* default */ } }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log, busy]);
  useEffect(() => {
    try { setCode(localStorage.getItem("negotiator_access") ?? ""); } catch { /* storage blocked: the code is asked again */ }
    fetch("/api/access").then((r) => r.json()).then((j) => setNeedCode(j.required === true)).catch(() => { /* if unsure, the chat answer will tell */ });
  }, []);
  const fill = (s: string, m: unknown) => s.replace("{m}", String(typeof m === "number" ? m : 60));
  const lastBrief = [...log].reverse().find((m) => m.brief)?.content;

  const start = () => {
    const s = newState(lang); s.messages.push({ role: "assistant", content: t.opening });
    setState(s); setLog([{ role: "assistant", content: t.opening }]); setStep(0); setNext(t.openingNext); setChips([...t.openingChips]); setCanSkip(false); setFinished(false); setHistory([]); setRated(false); setStarted(true);
  };
  const reset = () => { setStarted(false); setState(null); setLog([]); setText(""); setChips([]); setNext(""); setHistory([]); setFinished(false); };
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

  async function send(override?: string, skip = false) {
    const message = (skip ? t.skipSent : override ?? text).trim(); if (!message || busy || !state) return;
    const snap: Snap = { state, log, step, next, chips, canSkip, finished };
    setText(""); setChips([]); setBusy(true); setLog((l) => [...l, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-access-code": code.trim() }, body: JSON.stringify({ message, state, skip }) });
      const j = await res.json();
      if (!res.ok) {
        const e = fill((T[lang].errors as Record<string, string>)[j.error] ?? t.errors.generic, j.retryAfterMinutes);
        if (j.error === "access_required") { setNeedCode(true); try { localStorage.removeItem("negotiator_access"); } catch { /* nothing stored */ } }
        setLog((l) => [...l, { role: "assistant", content: e, error: true }]); setChips(snap.chips);
      } else {
        setHistory((h) => [...h, snap]);
        setState(j.state); setStep(STEP_OF[j.stage] ?? 0); setNext(j.next ?? ""); setChips(Array.isArray(j.suggestions) ? j.suggestions.slice(0, 3) : []);
        setCanSkip(j.canSkip === true); setFinished(j.finished === true);
        setLog((l) => [...l, { role: "assistant", content: j.reply, brief: j.brief === true }]);
      }
    } catch { setLog((l) => [...l, { role: "assistant", content: t.errors.generic, error: true }]); setChips(snap.chips); }
    finally { setBusy(false); setTimeout(() => input.current?.focus(), 0); }
  }
  function undo() {
    const s = history[history.length - 1]; if (!s || busy) return;
    setHistory((h) => h.slice(0, -1)); setState(s.state); setLog(s.log); setStep(s.step); setNext(s.next); setChips(s.chips); setCanSkip(s.canSkip); setFinished(s.finished);
    const lastUser = [...log].reverse().find((m) => m.role === "user"); if (lastUser) setText(lastUser.content === t.skipSent ? "" : lastUser.content);
    setTimeout(() => input.current?.focus(), 0);
  }
  async function copy(id: string, value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500); } catch { /* clipboard blocked: the text can still be selected by hand */ }
  }
  async function savePdf() {
    if (!state || saving) return; setSaving(true);
    try {
      const { makePdf } = await import("./pdf");
      const blob = await makePdf({ lang, state, brief: lastBrief });
      const url = URL.createObjectURL(blob); const a = document.createElement("a");
      a.href = url; a.download = `${lang === "sv" ? "forhandlingsunderlag" : "negotiation-brief"}-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch { setLog((l) => [...l, { role: "assistant", content: t.errors.generic, error: true }]); }
    finally { setSaving(false); }
  }
  async function rate(value: "useful" | "somewhat" | "not_useful") {
    setRated(true); // anonymous counter only: no message content, no session id
    try { await fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "rating", value }) }); } catch { /* counters never block the user */ }
  }

  const toggle = (
    <div className="seg" role="group" aria-label={t.language}>
      {(["en", "sv"] as const).map((l) => (<button key={l} aria-pressed={lang === l} onClick={() => setLang(l)} disabled={started}>{l === "en" ? "English" : "Svenska"}</button>))}
    </div>
  );
  const exampleDeal = (() => { const s = newState(lang); s.slots.walk_away = { value: 46000, source: "user", setAt: 0 }; s.slots.own_target = { value: 50000, source: "user", setAt: 0 }; s.slots.first_offer = { value: 53500, source: "user", setAt: 0 }; s.slots.market_range = { value: { p25: 44000, median: 49000, p75: 55000 }, source: "researcher", setAt: 0 }; return s; })();

  if (!started) return (
    <main className="start">
      <header className="topbar"><span className="wordmark">{t.title}</span>{toggle}</header>
      <section className="hero">
        <div className="hero-copy">
          <h1>{t.heroLine}</h1>
          <p className="lede">{t.heroSub}</p>
        </div>
        <div className="hero-deal" aria-hidden="true"><DealLine state={exampleDeal} lang={lang} labels={t.deal} /></div>
      </section>
      <section className="terms" aria-labelledby="terms-h">
        <h2 id="terms-h">{t.termsHead}</h2>
        <ul>{t.terms.map((x) => <li key={x}>{x}</li>)}</ul>
        {needCode && (
          <div className="access">
            <label htmlFor="access-code">{t.accessLabel}</label>
            <p className="hint">{t.accessHint}</p>
            <input id="access-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void begin(); }} aria-invalid={!!codeError} aria-describedby={codeError ? "access-error" : undefined} />
            {codeError && <p id="access-error" className="error" role="alert">{codeError}</p>}
          </div>
        )}
        <button className="btn btn-primary btn-large" onClick={() => void begin()} disabled={needCode && !code.trim()}>{t.start}</button>
        <p className="fine">{t.disclaimer} <a href="/privacy">{t.privacy}</a></p>
      </section>
    </main>
  );

  const hasFacts = !!state && Object.keys(state.slots).length > 0;
  return (
    <main className="app">
      <header className="topbar">
        <span className="wordmark">{t.title}</span>
        <div className="top-actions">
          {history.length > 0 && !busy && <button className="btn btn-quiet" onClick={undo}>{t.undo}</button>}
          {hasFacts && <button className={`btn ${lastBrief || finished ? "btn-save" : "btn-quiet"}`} onClick={() => void savePdf()} disabled={saving}>{saving ? t.saving : t.savePdf}</button>}
          <button className="btn btn-quiet" onClick={reset}>{t.newSession}</button>
        </div>
      </header>

      <div className="layout">
        <aside className="rail" aria-label={t.stepOf.replace("{n}", String(step + 1)).replace("{total}", String(t.steps.length))}>
          <ol className="steps">
            {t.steps.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} data-state={i < step || finished ? "done" : i === step ? "now" : "later"}><span className="step-dot" aria-hidden="true" />{s}</li>)}
          </ol>
          <div className="progress-mobile" aria-hidden="true">
            <span>{t.stepOf.replace("{n}", String(step + 1)).replace("{total}", String(t.steps.length))}: <strong>{t.steps[step]}</strong></span>
            <span className="bar"><span style={{ width: `${((finished ? t.steps.length : step + 1) / t.steps.length) * 100}%` }} /></span>
            <button className="btn btn-quiet btn-small" onClick={() => setDealOpen((o) => !o)} aria-expanded={dealOpen}>{t.deal.title}</button>
          </div>
          <div className={`rail-deal${dealOpen ? " open" : ""}`}><DealLine state={state} lang={lang} labels={t.deal} compact /></div>
        </aside>

        <section className="conversation">
          <p className="notice" role="note">{t.notice} <a href="/privacy" target="_blank" rel="noreferrer">{t.privacy}</a></p>
          <div className="log" aria-live="polite">
            {log.map((m, i) => m.role === "user" ? (
              <div key={i} className="turn turn-user"><p className="bubble">{m.content}</p></div>
            ) : m.error ? (
              <div key={i} className="turn turn-error" role="alert"><p>{m.content}</p></div>
            ) : m.brief ? (
              <article key={i} className="turn brief-doc">
                <div className="brief-head">
                  <span className="brief-kicker">{t.briefReady}</span>
                  <button className="btn btn-save" onClick={() => void savePdf()} disabled={saving}>{saving ? t.saving : t.savePdf}</button>
                </div>
                <Markdown text={cleanForReader(m.content, lang)} assumedLabel={t.assumed} className="md brief-body" sections />
                <div className="brief-foot">
                  <p className="save-ask">{t.saveAsk}</p>
                  <button className="btn btn-save btn-large" onClick={() => void savePdf()} disabled={saving}>{saving ? t.saving : t.savePdf}</button>
                  <button className="btn btn-quiet" onClick={() => void copy(`b${i}`, m.content)}>{copied === `b${i}` ? t.copied : t.copy}</button>
                  {rated ? <span className="thanks">{t.ratingThanks}</span> : (
                    <span className="rate">{t.ratingQ} {(["useful", "somewhat", "not_useful"] as const).map((v) => <button key={v} className="btn btn-quiet btn-small" onClick={() => void rate(v)}>{t.ratings[v]}</button>)}</span>
                  )}
                </div>
              </article>
            ) : (
              <div key={i} className="turn turn-coach">
                <Markdown text={cleanForReader(m.content, lang)} assumedLabel={t.assumed} />
                {i > 0 && <button className="copy" onClick={() => void copy(`m${i}`, cleanForReader(m.content, lang))}>{copied === `m${i}` ? t.copied : t.copy}</button>}
              </div>
            ))}
            {busy && <div className="turn turn-coach thinking" aria-busy="true"><span className="dots" aria-hidden="true"><i /><i /><i /></span>{t.thinking}</div>}
          </div>

          {finished ? (
            <section className="done" aria-live="polite">
              <h2>{t.done.title}</h2>
              <p>{t.done.body}</p>
              <div className="done-actions">
                <button className="btn btn-save btn-large" onClick={() => void savePdf()} disabled={saving}>{saving ? t.saving : t.savePdf}</button>
                <button className="btn btn-quiet" onClick={reset}>{t.done.again}</button>
                <button className="btn btn-quiet" onClick={() => state && void copy("session", toSummary(state))} title={t.copySessionHint}>{copied === "session" ? t.copied : t.copySession}</button>
              </div>
            </section>
          ) : (
            <div className="dock">
              {next && !busy && <p className="next" role="status"><span className="next-label">{t.nextLabel}</span>{next}</p>}
              {(chips.length > 0 || canSkip) && !busy && (
                <div className="chips" role="group" aria-label={t.suggestLabel}>
                  {chips.map((c) => <button key={c} className="chip" onClick={() => void send(c)}>{c}</button>)}
                  {canSkip && <button className="chip chip-skip" onClick={() => void send(undefined, true)}>{t.skip}</button>}
                </div>
              )}
              <div className="compose">
                <label htmlFor="msg" className="sr-only">{t.placeholder}</label>
                <textarea id="msg" ref={input} value={text} placeholder={t.placeholder} rows={1} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
                <button className="btn btn-primary" onClick={() => void send()} disabled={busy || !text.trim()}>{t.send}</button>
              </div>
            </div>
          )}
          <div ref={end} />
        </section>
      </div>
    </main>
  );
}
