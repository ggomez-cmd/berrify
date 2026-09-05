import { useMemo, useState } from "react";
import "./App.css";

type Status = "ok" | "checking";

const FEATURES = [
  {
    icon: "⚡",
    title: "Instant dev loop",
    body: "Vite-powered HMR keeps the feedback loop under a blink.",
  },
  {
    icon: "🧩",
    title: "Typed by default",
    body: "React + TypeScript with strict settings, ready to grow.",
  },
  {
    icon: "☁️",
    title: "Cloud-ready",
    body: "Preconfigured Cursor Cloud Agent environment out of the box.",
  },
];

function App() {
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<Status>("ok");

  const bootedAt = useMemo(() => new Date().toLocaleTimeString(), []);

  const runHealthCheck = () => {
    setStatus("checking");
    window.setTimeout(() => setStatus("ok"), 600);
  };

  return (
    <div className="page">
      <div className="aurora" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <img src="/berry.svg" alt="" className="brand-mark" />
          <span>Berrify</span>
        </div>
        <span className={`pill pill--${status}`}>
          <span className="dot" />
          {status === "ok" ? "environment healthy" : "checking…"}
        </span>
      </header>

      <main className="hero">
        <p className="eyebrow">New project workspace</p>
        <h1>
          Your <span className="grad">Berrify</span> workspace is up and running.
        </h1>
        <p className="subtitle">
          This starter confirms the development environment builds, serves, and
          renders. Swap it out as the real stack and app code land.
        </p>

        <div className="cta-row">
          <button className="btn btn--primary" onClick={() => setCount((c) => c + 1)}>
            Interactions: {count}
          </button>
          <button className="btn btn--ghost" onClick={runHealthCheck}>
            Run health check
          </button>
        </div>

        <section className="cards">
          {FEATURES.map((f) => (
            <article key={f.title} className="card">
              <span className="card-icon" aria-hidden="true">
                {f.icon}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="footer">
        <span>Booted at {bootedAt}</span>
        <span>Vite • React • TypeScript</span>
      </footer>
    </div>
  );
}

export default App;
