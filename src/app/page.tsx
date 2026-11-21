"use client";
import { useEffect, useRef, useState } from "react";
import { T, STEP_OF, type Lang } from "./ui-text";
import { newState, type SessionState } from "@/orchestrator/state";
import { toSummary } from "@/orchestrator/summary";

interface Msg { role: "user" | "assistant"; content: string; error?: boolean }

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [started, setStarted] = useState(false);
  const [state, setState] = useState<SessionState | null>(null);
  const [log, setLog] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  const t = T[lang];

  useEffect(() => { try { const l = navigator.language.toLowerCase().startsWith("sv") ? "sv" : "en"; setLang(l); } catch { /* default */ } }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  const start = () => {
    const s = newState(lang); s.messages.push({ role: "assistant", content: t.opening });
    setState(s); setLog([{ role: "assistant", content: t.opening }]); setStep(0); setStarted(true);
  };
  const reset = () => { setStarted(false); setState(null); setLog([]); setText(""); };

  async function send() {
    const message = text.trim(); if (!message || busy || !state) return;
    setText(""); setBusy(true); setLog((l) => [...l, { role: "user", content: message }]);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, state }) });
      const j = await res.json();
      if (!res.ok) { const e = (T[lang].errors as Record<string, string>)[j.error] ?? t.errors.generic; setLog((l) => [...l, { role: "assistant", content: e, error: true }]); }
      else { setState(j.state); setStep(STEP_OF[j.stage] ?? 0); setLog((l) => [...l, { role: "assistant", content: j.reply }]); }
    } catch { setLog((l) => [...l, { role: "assistant", content: t.errors.generic, error: true }]); }
    finally { setBusy(false); }
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
        <div><button className="btn primary" onClick={start}>{t.start}</button></div>
      </section>
    </main>
  );
  return (
    <main className="shell">
      <div className="top"><h1>{t.title}</h1><div className="row">{state && Object.keys(state.slots).length > 0 && <button className="btn" onClick={download}>{t.summary}</button>}<button className="btn" onClick={reset}>{t.newSession}</button></div></div>
      <div className="main">
        <ol className="steps" aria-label="Progress">{t.steps.map((s, i) => <li key={s} data-on={i === step} data-done={i < step}>{s}</li>)}</ol>
        <section className="chat">
          <div className="log" aria-live="polite">
            {log.map((m, i) => <div key={i} className={`msg ${m.role === "user" ? "user" : ""} ${m.error ? "err" : ""}`}>{m.content}</div>)}
            {busy && <div className="msg" aria-busy="true">{t.thinking}</div>}
            <div ref={end} />
          </div>
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
