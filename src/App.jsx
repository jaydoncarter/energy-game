import { useState, useEffect, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════
   GAME CONFIGURATION — tune these constants to adjust balance
   ═══════════════════════════════════════════════════════════════ */
const GAME_DURATION = 600;   // 10 minutes in seconds
const TICK_MS       = 250;   // tick rate (4 ticks/second)
const TICK_S        = TICK_MS / 1000;
const INITIAL_MONEY = 1500;  // $M starting budget

/**
 * SCORE FORMULA:
 *   Score = cleanEnergy × 2  +  fossilEnergy × 0.05
 *
 * Fossil earns strong revenue to fund clean sources, but is worth
 * only 1/20th of clean energy in the final score. The "aha moment":
 * you NEED fossil early to afford the clean transition.
 */

const SOURCES = {
  fossil: {
    name: "Fossil Fuels",   sub: "Coal & Natural Gas",
    emoji: "🏭",            color: "#f97316",
    outputPerSec: 90,       revPerSec: 14,
    buildSec: 8,            cost: 400,      costGrowth: 1.28,
    maxOwned: null,         intermittent: false,
    envTag: "HARMFUL",      envColor: "#ef4444",
    desc: "Cheapest and fastest. Heavy CO₂ emissions mean fossil energy is worth only 0.05× in your final score — but it's how you fund everything else.",
    fact: "Coal & gas provide ~60% of global electricity today.",
  },
  nuclear: {
    name: "Nuclear Fission", sub: "Uranium Reactor",
    emoji: "⚛️",             color: "#a3e635",
    outputPerSec: 350,       revPerSec: 52,
    buildSec: 120,           cost: 6500,    costGrowth: 1.32,
    maxOwned: null,          intermittent: false,
    envTag: "OK",            envColor: "#fbbf24",
    desc: "The highest single-plant output in the game. Low emissions score. But it costs $6.5B and takes 2 full minutes to come online — plan ahead.",
    fact: "Real nuclear plants take 10–20 years and $10–30B to build.",
  },
  solar: {
    name: "Solar PV",        sub: "Photovoltaic Array",
    emoji: "☀️",             color: "#fbbf24",
    outputPerSec: 48,        revPerSec: 7,
    buildSec: 15,            cost: 580,     costGrowth: 1.14,
    maxOwned: null,          intermittent: true,
    envTag: "CLEAN",         envColor: "#22c55e",
    desc: "Clean and relatively affordable. The day/night cycle (70s period) cuts output to zero at 'night' unless you have battery storage offsetting that loss.",
    fact: "Global average solar capacity factor: ~20% due to night & clouds.",
  },
  wind: {
    name: "Wind Power",      sub: "Turbine Array",
    emoji: "💨",             color: "#7dd3fc",
    outputPerSec: 38,        revPerSec: 6,
    buildSec: 12,            cost: 470,     costGrowth: 1.14,
    maxOwned: null,          intermittent: true,
    envTag: "CLEAN",         envColor: "#22c55e",
    desc: "Variable output from simulated wind patterns. Output fluctuates 10–95%. Each battery bank adds +15% to effective capacity factor.",
    fact: "Onshore wind capacity factor: typically 25–45%.",
  },
  hydro: {
    name: "Hydropower",      sub: "River Dam",
    emoji: "💧",             color: "#22d3ee",
    outputPerSec: 145,       revPerSec: 22,
    buildSec: 45,            cost: 2800,    costGrowth: 1.75,
    maxOwned: 2,             intermittent: false,
    envTag: "CLEAN",          envColor: "#22c55e",
    desc: "Reliable, high-output, and clean. However only 2 viable river dam sites exist in your region — once they're built, no more hydro.",
    fact: "Hydropower provides ~16% of global electricity.",
  },
  geothermal: {
    name: "Geothermal",      sub: "Steam Plant",
    emoji: "🌋",             color: "#f43f5e",
    outputPerSec: 115,       revPerSec: 17,
    buildSec: 60,            cost: 3600,    costGrowth: 2.2,
    maxOwned: 2,             intermittent: false,
    envTag: "CLEAN",         envColor: "#22c55e",
    desc: "The cleanest option per MW. Extremely steady output. But only 2 geothermal hotspots exist in your region, and the 2nd site costs significantly more.",
    fact: "Iceland sources 25% of electricity from geothermal.",
  },
  battery: {
    name: "Grid Storage",    sub: "Battery Bank",
    emoji: "🔋",             color: "#a78bfa",
    outputPerSec: 0,         revPerSec: 0,
    buildSec: 20,            cost: 1400,    costGrowth: 1.25,
    maxOwned: null,          intermittent: false,
    envTag: "SUPPORT",       envColor: "#a78bfa",
    desc: "No power output on its own. Each bank adds +25% solar capacity and +15% wind capacity. Critical for high-renewable grids.",
    fact: "Grid-scale batteries are essential for renewable-heavy grids.",
  },
};

const ORDERED = ["fossil", "nuclear", "solar", "wind", "hydro", "geothermal", "battery"];

/* ═══════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */
const getCost   = (type, n)  => Math.round(SOURCES[type].cost * Math.pow(SOURCES[type].costGrowth, n));
const fmt$      = (m)        => m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`;
const fmtTime   = (s)        => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
const fmtNum    = (n)        => Math.round(n).toLocaleString();
const computeScore = (c, d)  => Math.round(c * 2 + d * 0.05);

/** Solar: 70-second cycle, 45s day / 25s night, smooth sine transitions */
const getSolarFactor = (e) => {
  const pos = e % 70;
  return pos < 45 ? Math.max(0, Math.sin((pos / 45) * Math.PI)) : 0;
};

/** Wind: multi-frequency pseudo-noise, stays between 10–95% */
const getWindFactor = (e) =>
  Math.max(0.1, Math.min(0.95,
    0.5 + 0.22 * Math.sin(e * 0.13) +
          0.14 * Math.sin(e * 0.31 + 0.8) +
          0.08 * Math.sin(e * 0.57 + 1.7) +
          0.04 * Math.sin(e * 1.1 + 0.3)
  ));

const getCapFactor = (type, elapsed, batteries) => {
  if (type === "solar") return Math.min(1, getSolarFactor(elapsed) + batteries * 0.25);
  if (type === "wind")  return Math.min(1, getWindFactor(elapsed)  + batteries * 0.15);
  return 1;
};

/* ═══════════════════════════════════════════════════════════════
   GLOBAL STYLES (injected once on mount)
   ═══════════════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;700;800&family=Share+Tech+Mono&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body {
    background: #060b16; color: #e2e8f0;
    font-family: 'Exo 2', system-ui, sans-serif;
    overflow: hidden;
  }
  .mono { font-family: 'Share Tech Mono', 'Courier New', monospace !important; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }

  /* Panel */
  .panel {
    background: rgba(10, 18, 35, 0.97);
    border: 1px solid rgba(30, 58, 95, 0.65);
    border-radius: 6px;
  }
  .panel-title {
    font-size: 9.5px; letter-spacing: 2.5px; text-transform: uppercase;
    color: #3b82f6; padding: 8px 12px 7px;
    border-bottom: 1px solid rgba(30, 58, 95, 0.45);
  }

  /* Shop card */
  .shop-card {
    border-radius: 6px; padding: 10px 12px;
    background: rgba(10, 18, 35, 0.85);
    border: 1px solid rgba(30, 58, 95, 0.5);
    transition: border-color 0.2s, background 0.2s;
  }
  .shop-card:not(.card-disabled):hover {
    border-color: rgba(59, 130, 246, 0.45);
    background: rgba(20, 30, 55, 0.9);
  }
  .card-disabled { opacity: 0.45; }

  /* Buy button */
  .buy-btn {
    border: none; border-radius: 4px; cursor: pointer;
    font-family: 'Exo 2', sans-serif; font-weight: 700; font-size: 10.5px;
    letter-spacing: 0.8px; text-transform: uppercase;
    padding: 5px 13px; white-space: nowrap; transition: all 0.15s;
  }
  .buy-btn:hover:not(:disabled) { filter: brightness(1.25); transform: scale(1.04); }
  .buy-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Animations */
  .bar-fill   { transition: width 0.35s ease; }
  .timer-bar  { transition: width 0.25s linear; }
  .pulse      { animation: pulse  1.6s ease-in-out infinite; }
  .glow-green { text-shadow: 0 0 12px #22c55e, 0 0 24px #22c55e44; }
  .glow-red   { text-shadow: 0 0 14px #ef4444, 0 0 28px #ef444444; }

  @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes pop   { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
  .pop { animation: pop 0.35s ease; }

  /* Mobile layout */
  .game-main { display: flex; overflow: hidden; flex: 1; min-height: 0; }
  .left-panel {
    width: 255px; flex-shrink: 0;
    border-right: 1px solid rgba(30,58,95,0.4);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .right-panel { flex: 1; overflow: hidden; }
  .mobile-tabs { display: none; }

  @media (max-width: 700px) {
    body { overflow: auto; }
    html, body, #root { height: auto; }
    .game-main   { flex-direction: column; overflow: visible; flex: none; }
    .left-panel  { width: 100%; border-right: none; border-bottom: 1px solid rgba(30,58,95,0.4); max-height: 60vh; overflow: hidden; }
    .right-panel { overflow: visible; }
    .game-container {            /* the root div from GameBoard */
    height: auto !important;
    min-height: 100vh;
    overflow: visible !important;
  }
    .mobile-tabs { display: flex; }
    .desktop-header-stats { gap: 10px !important; }
  }
`;

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [phase,   setPhase]   = useState("intro");
  const [display, setDisplay] = useState(null);
  const gRef    = useRef(null);  // mutable game state (source of truth)
  const iRef    = useRef(null);  // interval ref

  // Inject global CSS once
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);

  /* ── snapshot: derive display-safe data from mutable ref ── */
  const snap = (g) => {
    const counts = {}, active = {};
    ORDERED.forEach((t) => { counts[t] = 0; active[t] = 0; });
    g.plants.forEach((p) => {
      counts[p.type]++;
      if (p.buildLeft <= 0) active[p.type]++;
    });

    const bat = active.battery;
    let total = 0, clean = 0, rev = 0;
    const byType = {};
    ORDERED.forEach((t) => {
      if (t === "battery") { byType[t] = 0; return; }
      const cap = getCapFactor(t, g.elapsed, bat);
      const pw  = active[t] * SOURCES[t].outputPerSec * cap;
      byType[t] = pw;
      total += pw;
      if (t !== "fossil") clean += pw;
      rev += active[t] * SOURCES[t].revPerSec * cap;
    });

    return {
      money:   g.money,
      elapsed: g.elapsed,
      timeLeft: g.timeLeft,
      plants:  [...g.plants],
      counts,  active, bat,
      total,   clean, rev, byType,
      greenFrac: total > 0 ? clean / total : 0,
      score:   computeScore(g.cleanAcc, g.dirtyAcc),
      cleanAcc: g.cleanAcc,
      dirtyAcc: g.dirtyAcc,
    };
  };

  /* ── tick: advance game state by TICK_S ── */
  const tick = () => {
    const g = gRef.current;
    if (!g) return false;
    g.elapsed  += TICK_S;
    g.timeLeft  = Math.max(0, g.timeLeft - TICK_S);

    // Advance build timers; mark completions
    g.plants.forEach((p) => {
      if (p.buildLeft > 0) {
        p.buildLeft = Math.max(0, p.buildLeft - TICK_S);
        if (p.buildLeft === 0) p.completedAt = g.elapsed;
      }
    });

    // Tally active counts
    const active = {};
    ORDERED.forEach((t) => { active[t] = 0; });
    g.plants.forEach((p) => { if (p.buildLeft <= 0) active[p.type]++; });

    const bat = active.battery;
    ORDERED.forEach((t) => {
      if (t === "battery") return;
      const cap = getCapFactor(t, g.elapsed, bat);
      const pw  = active[t] * SOURCES[t].outputPerSec * cap;
      const rv  = active[t] * SOURCES[t].revPerSec    * cap;
      g.money += rv * TICK_S;
      if (t === "fossil") g.dirtyAcc += pw * TICK_S;
      else                g.cleanAcc += pw * TICK_S;
    });

    return g.timeLeft > 0;
  };

  /* ── startGame ── */
  const startGame = () => {
    gRef.current = {
      money: INITIAL_MONEY, elapsed: 0, timeLeft: GAME_DURATION,
      plants: [], nextId: 0, cleanAcc: 0, dirtyAcc: 0,
    };
    setDisplay(snap(gRef.current));
    setPhase("playing");
  };

  /* ── game loop ── */
  useEffect(() => {
    if (phase !== "playing") return;
    iRef.current = setInterval(() => {
      const running = tick();
      setDisplay(snap(gRef.current));
      if (!running) { clearInterval(iRef.current); setPhase("ended"); }
    }, TICK_MS);
    return () => clearInterval(iRef.current);
  }, [phase]); // eslint-disable-line

  /* ── buy plant ── */
  const buy = (type) => {
    const g = gRef.current;
    if (!g || phase !== "playing") return;
    const src      = SOURCES[type];
    const ownedNow = g.plants.filter((p) => p.type === type).length;
    if (src.maxOwned !== null && ownedNow >= src.maxOwned) return;
    const cost = getCost(type, ownedNow);
    if (g.money < cost) return;
    g.money -= cost;
    g.plants.push({ id: g.nextId++, type, buildLeft: src.buildSec, completedAt: null });
    setDisplay(snap(g));
  };

  if (phase === "intro")            return <IntroScreen onStart={startGame} />;
  if (phase === "ended" && display) return <EndScreen d={display} onRestart={startGame} />;
  if (!display)                     return null;
  return <GameBoard d={display} onBuy={buy} />;
}

/* ═══════════════════════════════════════════════════════════════
   INTRO SCREEN
   ═══════════════════════════════════════════════════════════════ */
function IntroScreen({ onStart }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "28px 20px",
      textAlign: "center", background: "#060b16",
      backgroundImage: "radial-gradient(ellipse at 50% 25%, rgba(0,80,180,0.13) 0%, transparent 65%)",
    }}>
      <div className="mono" style={{ fontSize: "10px", letterSpacing: "4px", color: "#3b82f6", marginBottom: "14px" }}>
        ENERGY &amp; SOCIETY // INTERACTIVE SIMULATION
      </div>
      <h1 style={{ fontSize: "clamp(2.4rem, 8vw, 5rem)", fontWeight: 800, color: "#fff", marginBottom: "8px", letterSpacing: "-1px", lineHeight: 1 }}>
        ⚡ GRID OPERATOR
      </h1>
      <p style={{ color: "#64748b", fontSize: "clamp(13px, 2.5vw, 15px)", maxWidth: "560px", lineHeight: 1.75, marginBottom: "32px" }}>
        You have <span style={{ color: "#fbbf24", fontWeight: 700 }}>10 minutes</span> to build an
        energy grid. Balance production volume, revenue, and environmental impact to maximize your{" "}
        <span style={{ color: "#22c55e", fontWeight: 700 }}>Energy Score</span>.
      </p>

      {/* Score formula panel */}
      <div className="panel" style={{ maxWidth: "480px", width: "100%", marginBottom: "16px" }}>
        <div className="panel-title">Score Formula</div>
        <div style={{ padding: "14px 18px", textAlign: "center" }}>
          <div className="mono" style={{ fontSize: "15px", color: "#e2e8f0", marginBottom: "8px" }}>
            <span style={{ color: "#22c55e" }}>Clean Energy × 2</span>
            {"  +  "}
            <span style={{ color: "#f97316" }}>Fossil Energy × 0.05</span>
          </div>
          <p style={{ fontSize: "12px", color: "#64748b", lineHeight: 1.65 }}>
            Fossil fuels earn strong revenue to fund your grid, but score only 1/20th of what clean
            energy does. The winning strategy: use fossil early to afford the transition — then go clean.
          </p>
        </div>
      </div>

      {/* Rules panel */}
      <div className="panel" style={{ maxWidth: "480px", width: "100%", marginBottom: "28px", textAlign: "left" }}>
        <div className="panel-title">Key Rules</div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "9px" }}>
          {[
            ["⚡", "Buy sources to generate power. Revenue funds future purchases."],
            ["🕐", "Nuclear takes 2 minutes to build. Start saving early."],
            ["☀️", "Solar only works in daylight (70s cycle). Wind fluctuates."],
            ["🔋", "Battery banks offset solar/wind intermittency (+25%/+15% cap factor each)."],
            ["📍", "Hydropower: max 3 sites. Geothermal: max 2. Choose wisely."],
            ["⏱", "10 minutes is not enough to buy everything. Every decision matters."],
          ].map(([icon, text]) => (
            <div key={text} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "13px", flexShrink: 0, marginTop: "2px" }}>{icon}</span>
              <span style={{ fontSize: "12.5px", color: "#94a3b8", lineHeight: 1.55 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onStart}
        style={{
          background: "linear-gradient(135deg, #22c55e, #16a34a)",
          color: "#fff", border: "none", padding: "15px 56px",
          fontSize: "15px", fontWeight: 700, borderRadius: "6px", cursor: "pointer",
          letterSpacing: "2.5px", textTransform: "uppercase",
          boxShadow: "0 0 32px rgba(34,197,94,0.38)", transition: "all 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        ▶  START SIMULATION
      </button>
      <div className="mono" style={{ marginTop: "14px", fontSize: "11px", color: "#334155" }}>
        STARTING BUDGET: $1,500M · DURATION: 10:00 · TECHNOLOGIES: 7
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GAME BOARD
   ═══════════════════════════════════════════════════════════════ */
function GameBoard({ d, onBuy }) {
  const [mobileTab, setMobileTab] = useState("market");
  const urgent      = d.timeLeft < 60;
  const timePercent = (d.timeLeft / GAME_DURATION) * 100;

  return (
    <div className="game-container" style={{ display: "flex", flexDirection: "column", background: "#060b16"}}>

      {/* ── HEADER ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", flexShrink: 0, flexWrap: "wrap", gap: "6px",
        background: "rgba(6,11,22,0.98)", borderBottom: "1px solid rgba(30,58,95,0.55)",
      }}>
        <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "2.5px", color: "#3b82f6", flexShrink: 0 }}>
          ⚡ GRID OPERATOR
        </span>
        <div className="desktop-header-stats" style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
          <HStat label="SCORE"  value={fmtNum(d.score)}          color="#22c55e" glow />
          <HStat label="BUDGET" value={fmt$(d.money)}             color="#fbbf24" />
          <HStat label="REV/S"  value={`+${fmt$(d.rev)}`}        color="#94a3b8" />
          <HStat label="POWER"  value={`${Math.round(d.total)} u/s`} color="#7dd3fc" />
        </div>
        <div
          className={`mono ${urgent ? "glow-red" : ""}`}
          style={{ fontSize: "22px", color: urgent ? "#ef4444" : "#e2e8f0", minWidth: "68px", textAlign: "right" }}
        >
          {fmtTime(d.timeLeft)}
        </div>
      </div>

      {/* ── TIMER BAR ── */}
      <div style={{ height: "3px", background: "#0e1525", flexShrink: 0 }}>
        <div
          className="timer-bar"
          style={{
            height: "100%", width: `${timePercent}%`,
            background: urgent ? "linear-gradient(90deg, #ef4444, #f97316)" : "linear-gradient(90deg, #22c55e, #3b82f6)",
            boxShadow: urgent ? "0 0 8px #ef4444" : "0 0 6px #22c55e55",
          }}
        />
      </div>

      {/* ── MOBILE TABS ── */}
      <div className="mobile-tabs" style={{ gap: "0", flexShrink: 0, borderBottom: "1px solid rgba(30,58,95,0.4)" }}>
        {[["grid", "📊 Grid"], ["market", "🛒 Market"]].map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              background: mobileTab === tab ? "rgba(30,58,95,0.5)" : "transparent",
              color: mobileTab === tab ? "#e2e8f0" : "#64748b",
              fontFamily: "inherit", fontSize: "12px", fontWeight: 600,
              borderBottom: mobileTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── MAIN CONTENT ── */}
      <div className="game-main">
        {/* LEFT PANEL */}
        <div
          className="left-panel"
          style={{ display: mobileTab === "grid" || typeof window !== "undefined" && window.innerWidth > 700 ? "flex" : undefined }}
        >
          <div style={{ display: mobileTab !== "grid" ? "none" : "contents" }} className="mobile-grid-show">
            <GridStatus d={d} />
            <PlantsList d={d} />
          </div>
          {/* On desktop always show */}
          <style>{`.left-panel .mobile-grid-show { display: contents !important; } @media (max-width:700px) { .left-panel .mobile-grid-show { display: ${mobileTab === "grid" ? "contents" : "none"} !important; } }`}</style>
        </div>

        {/* RIGHT PANEL */}
        <div className="right-panel" style={{ display: mobileTab !== "market" && typeof window !== "undefined" && window.innerWidth <= 700 ? "none" : "block" }}>
          <style>{`@media (max-width:700px) { .right-panel { display: ${mobileTab === "market" ? "block" : "none"} !important; } }`}</style>
          <Shop d={d} onBuy={onBuy} />
        </div>
      </div>
    </div>
  );
}

function HStat({ label, value, color, glow }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "8px", letterSpacing: "1.5px", color: "#475569", textTransform: "uppercase" }}>{label}</div>
      <div className={`mono ${glow ? "glow-green" : ""}`} style={{ fontSize: "14px", color }}>{value}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GRID STATUS (left panel — top half)
   ═══════════════════════════════════════════════════════════════ */
function GridStatus({ d }) {
  const { total, clean, greenFrac, byType, elapsed, bat, cleanAcc, dirtyAcc, score } = d;
  const greenPct  = Math.round(greenFrac * 100);
  const envColor  = greenFrac > 0.65 ? "#22c55e" : greenFrac > 0.35 ? "#fbbf24" : "#ef4444";
  const isDaytime = getSolarFactor(elapsed) > 0.05;
  const windLevel = getWindFactor(elapsed);

  return (
    <div style={{ padding: "10px", borderBottom: "1px solid rgba(30,58,95,0.4)", flexShrink: 0 }}>
      <div style={{ fontSize: "9px", letterSpacing: "2.5px", textTransform: "uppercase", color: "#3b82f6", marginBottom: "9px" }}>
        GRID STATUS
      </div>

      {/* Power mix bar */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#64748b", marginBottom: "3px" }}>
        <span>Power Mix</span>
        <span className="mono" style={{ color: envColor }}>{greenPct}% clean</span>
      </div>
      <div style={{ height: "7px", borderRadius: "4px", background: "#0e1525", overflow: "hidden", marginBottom: "10px", display: "flex" }}>
        {ORDERED.filter((t) => t !== "battery" && byType[t] > 0).map((t) => (
          <div
            key={t}
            className="bar-fill"
            style={{ height: "100%", width: `${total > 0 ? (byType[t] / total) * 100 : 0}%`, background: SOURCES[t].color }}
          />
        ))}
      </div>

      {/* Score rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        <SRow label="Total Power"     value={`${Math.round(total)} u/s`}            color="#7dd3fc" />
        <SRow label="🌿 Clean score"  value={`+${fmtNum(Math.round(cleanAcc * 2))}`} color="#22c55e" />
        <SRow label="🏭 Fossil score" value={`+${fmtNum(Math.round(dirtyAcc * 0.05))}`} color="#f97316" />
        <div style={{ borderTop: "1px solid rgba(30,58,95,0.35)", paddingTop: "4px", marginTop: "2px" }}>
          <SRow label="TOTAL SCORE" value={fmtNum(score)} color="#e2e8f0" bold />
        </div>
      </div>

      {/* Intermittency meters */}
      {(d.active.solar > 0 || d.active.wind > 0) && (
        <div style={{ marginTop: "9px", borderTop: "1px solid rgba(30,58,95,0.3)", paddingTop: "9px", display: "flex", flexDirection: "column", gap: "5px" }}>
          {d.active.solar > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10px", color: "#64748b" }}>
                {isDaytime ? "☀️" : "🌙"} Solar cap.
              </span>
              <CapBar value={getCapFactor("solar", elapsed, bat)} color="#fbbf24" />
            </div>
          )}
          {d.active.wind > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "10px", color: "#64748b" }}>
                {windLevel > 0.6 ? "💨" : windLevel > 0.35 ? "🌬️" : "🍃"} Wind cap.
              </span>
              <CapBar value={getCapFactor("wind", elapsed, bat)} color="#7dd3fc" />
            </div>
          )}
          {bat > 0 && (
            <div style={{ fontSize: "10px", color: "#a78bfa" }}>
              🔋 {bat} battery bank{bat > 1 ? "s" : ""} active
            </div>
          )}
        </div>
      )}

      {/* Fossil warning */}
      {d.active.fossil >= 4 && (
        <div style={{ marginTop: "9px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "4px", padding: "6px 8px" }}>
          <div style={{ fontSize: "10px", color: "#fca5a5", lineHeight: 1.5 }}>
            ⚠️ Heavy fossil dependency. Your score multiplier for fossil is only 0.05×. Invest in clean energy!
          </div>
        </div>
      )}
    </div>
  );
}

function SRow({ label, value, color, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: "10px", color: "#64748b", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span className="mono" style={{ fontSize: bold ? "12px" : "11px", color, fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}

function CapBar({ value, color }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
      <div style={{ width: "52px", height: "5px", background: "#0e1525", borderRadius: "3px", overflow: "hidden" }}>
        <div className="bar-fill" style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span className="mono" style={{ fontSize: "10px", color, minWidth: "28px" }}>{pct}%</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PLANTS LIST (left panel — bottom half)
   ═══════════════════════════════════════════════════════════════ */
function PlantsList({ d }) {
  const { plants, active, counts, bat, elapsed } = d;
  const building = plants.filter((p) => p.buildLeft > 0).sort((a, b) => a.buildLeft - b.buildLeft);
  const recent   = plants.filter((p) => p.completedAt && elapsed - p.completedAt < 4);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
      <div style={{ fontSize: "9px", letterSpacing: "2.5px", textTransform: "uppercase", color: "#3b82f6", marginBottom: "8px" }}>
        YOUR PLANTS
      </div>

      {plants.length === 0 && (
        <div style={{ color: "#334155", fontSize: "12px", textAlign: "center", paddingTop: "18px" }}>
          No plants yet.<br />Buy something →
        </div>
      )}

      {/* Active summary */}
      {ORDERED.map((type) => {
        const n = active[type];
        if (!n) return null;
        const src = SOURCES[type];
        const cap = getCapFactor(type, elapsed, bat);
        const pw  = n * src.outputPerSec * cap;
        const isNew = recent.some((p) => p.type === type);
        return (
          <div
            key={type}
            className={isNew ? "pop" : ""}
            style={{
              display: "flex", alignItems: "center", gap: "7px",
              padding: "5px 7px", marginBottom: "4px",
              background: isNew ? `${src.color}18` : "rgba(14,21,37,0.6)",
              borderRadius: "4px", borderLeft: `2px solid ${src.color}`,
              transition: "background 0.5s",
            }}
          >
            <span style={{ fontSize: "15px", flexShrink: 0 }}>{src.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "11px", fontWeight: 600, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n}× {src.name}
              </div>
              <div className="mono" style={{ fontSize: "10px", color: src.color }}>
                {Math.round(pw)} u/s
                {src.intermittent && <span style={{ color: "#475569" }}> ({Math.round(cap * 100)}%)</span>}
              </div>
            </div>
          </div>
        );
      })}

      {/* Build queue */}
      {building.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div style={{ fontSize: "9px", letterSpacing: "1.5px", color: "#475569", textTransform: "uppercase", marginBottom: "5px" }}>
            UNDER CONSTRUCTION
          </div>
          {building.map((p) => {
            const src      = SOURCES[p.type];
            const progress = 1 - p.buildLeft / src.buildSec;
            return (
              <div
                key={p.id}
                style={{ marginBottom: "5px", padding: "6px 8px", background: "rgba(14,21,37,0.7)", borderRadius: "4px", border: `1px solid ${src.color}33` }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span className="pulse" style={{ fontSize: "12px", color: src.color }}>
                    {src.emoji} {src.name}
                  </span>
                  <span className="mono" style={{ fontSize: "10px", color: "#64748b" }}>
                    {fmtTime(p.buildLeft)}
                  </span>
                </div>
                <div style={{ height: "3px", background: "#0e1525", borderRadius: "2px", overflow: "hidden" }}>
                  <div
                    className="bar-fill"
                    style={{ width: `${progress * 100}%`, height: "100%", background: src.color, boxShadow: `0 0 5px ${src.color}` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHOP
   ═══════════════════════════════════════════════════════════════ */
function Shop({ d, onBuy }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="panel-title" style={{ flexShrink: 0 }}>ENERGY MARKET</div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }}>
        {ORDERED.map((type) => (
          <ShopCard key={type} type={type} d={d} onBuy={onBuy} />
        ))}
      </div>
    </div>
  );
}

function ShopCard({ type, d, onBuy }) {
  const { money, counts, active, bat, elapsed } = d;
  const src      = SOURCES[type];
  const owned    = counts[type];
  const activeN  = active[type];
  const inQueue  = owned - activeN;
  const cost     = getCost(type, owned);
  const canAfford = money >= cost;
  const maxed     = src.maxOwned !== null && owned >= src.maxOwned;
  const disabled  = !canAfford || maxed;

  const cap = getCapFactor(type, elapsed, bat);

  return (
    <div
      className={`shop-card ${disabled ? "card-disabled" : ""}`}
      style={{ borderColor: !disabled ? `${src.color}40` : undefined }}
    >
      <div style={{ display: "flex", gap: "11px", alignItems: "flex-start" }}>
        {/* Emoji */}
        <span style={{ fontSize: "26px", flexShrink: 0, lineHeight: 1.1 }}>{src.emoji}</span>

        {/* Body */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px", marginBottom: "2px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: src.color }}>{src.name}</div>
              <div style={{ fontSize: "10px", color: "#475569" }}>{src.sub}</div>
            </div>
            {owned > 0 && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: "11px", color: src.color }}>{activeN} active</div>
                {inQueue > 0 && (
                  <div className="mono pulse" style={{ fontSize: "10px", color: "#64748b" }}>{inQueue} building</div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          <p style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5, marginBottom: "8px" }}>{src.desc}</p>

          {/* Stats + buy */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
            {src.outputPerSec > 0 && <Chip label="Output" value={`${src.outputPerSec} u/s`} color="#7dd3fc" />}
            <Chip label="Build"  value={src.buildSec >= 60 ? `${src.buildSec / 60}m` : `${src.buildSec}s`} color="#94a3b8" />
            {src.revPerSec > 0 && <Chip label="Rev/s"  value={`+${fmt$(src.revPerSec)}`} color="#fbbf24" />}
            {src.maxOwned && <Chip label="Sites" value={`${owned}/${src.maxOwned}`} color={maxed ? "#ef4444" : "#22c55e"} />}
            {src.intermittent && <Chip label="Cap" value={`${Math.round(cap * 100)}%`} color={cap > 0.55 ? "#22c55e" : "#fbbf24"} />}

            {/* Env tag */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "42px" }}>
              <span style={{ fontSize: "7.5px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>Env</span>
              <span style={{ fontSize: "10px", fontWeight: 700, color: src.envColor }}>{src.envTag}</span>
            </div>

            {/* Buy button */}
            <div style={{ marginLeft: "auto" }}>
              <button
                className="buy-btn"
                onClick={() => onBuy(type)}
                disabled={disabled}
                style={{
                  background: canAfford && !maxed
                    ? `linear-gradient(135deg, ${src.color}, ${src.color}cc)`
                    : "#1e293b",
                  color: canAfford && !maxed ? "#000" : "#475569",
                }}
              >
                {maxed ? "MAXED" : `${fmt$(cost)}`}
              </button>
            </div>
          </div>

          {/* Real-world fact (shown when owned) */}
          {owned > 0 && (
            <div style={{ marginTop: "6px", fontSize: "10px", color: "#334155", fontStyle: "italic", borderTop: "1px solid rgba(30,58,95,0.3)", paddingTop: "5px" }}>
              💡 {src.fact}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "36px" }}>
      <span style={{ fontSize: "7.5px", color: "#475569", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      <span className="mono" style={{ fontSize: "11px", color }}>{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   END SCREEN
   ═══════════════════════════════════════════════════════════════ */
function EndScreen({ d, onRestart }) {
  const { score, cleanAcc, dirtyAcc, plants, greenFrac } = d;
  const cleanScore = Math.round(cleanAcc * 2);
  const dirtyScore = Math.round(dirtyAcc * 0.05);

  const grade = score > 500000 ? "S" :
              score > 250000 ? "A" :
              score > 100000 ? "B" :
              score > 40000  ? "C" : "D";
  const gradeColor = { S: "#22c55e", A: "#a3e635", B: "#fbbf24", C: "#f97316", D: "#ef4444" }[grade];
  const gradeMsg = {
    S: "Outstanding grid operator. Exceptional clean output and smart financing.",
    A: "Great work — your grid is clean, efficient, and highly productive.",
    B: "Solid performance. More early investment in clean energy would help.",
    C: "Your grid worked, but heavy fossil reliance suppressed your final score.",
    D: "Fossil-heavy grid. Remember: fossil earns revenue, but clean energy wins.",
  }[grade];

  const finalCounts = {};
  ORDERED.forEach((t) => { finalCounts[t] = 0; });
  plants.forEach((p) => finalCounts[p.type]++);

  const greenPct = Math.round(greenFrac * 100);

  return (
    <div style={{
      minHeight: "100vh", background: "#060b16", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "28px 20px", textAlign: "center",
      backgroundImage: "radial-gradient(ellipse at 50% 50%, rgba(34,197,94,0.07) 0%, transparent 70%)",
    }}>
      <div className="mono" style={{ fontSize: "10px", letterSpacing: "4px", color: "#3b82f6", marginBottom: "14px" }}>
        SIMULATION COMPLETE
      </div>
      <h1 style={{ fontSize: "clamp(1.6rem, 5vw, 3rem)", fontWeight: 800, marginBottom: "8px" }}>
        FINAL SCORE:{" "}
        <span className="mono glow-green" style={{ color: "#22c55e" }}>
          {fmtNum(score)}
        </span>
      </h1>

      <div style={{
        fontSize: "clamp(3.5rem, 12vw, 7rem)", fontWeight: 800, lineHeight: 1,
        color: gradeColor, textShadow: `0 0 40px ${gradeColor}77`, marginBottom: "8px",
      }}>
        {grade}
      </div>
      <p style={{ color: "#64748b", fontSize: "14px", maxWidth: "420px", lineHeight: 1.7, marginBottom: "28px" }}>
        {gradeMsg}
      </p>

      {/* Breakdown */}
      <div className="panel" style={{ maxWidth: "430px", width: "100%", marginBottom: "14px", textAlign: "left" }}>
        <div className="panel-title">Score Breakdown</div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: "9px" }}>
          <ERow label="🌿 Clean energy produced" formula={`${fmtNum(Math.round(cleanAcc))} × 2`} value={cleanScore}    color="#22c55e" />
          <ERow label="🏭 Fossil energy produced" formula={`${fmtNum(Math.round(dirtyAcc))} × 0.05`} value={dirtyScore} color="#f97316" />
          <div style={{ borderTop: "1px solid rgba(30,58,95,0.4)", paddingTop: "9px" }}>
            <ERow label="TOTAL" formula="" value={score} color="#e2e8f0" bold />
          </div>
        </div>
      </div>

      {/* Portfolio */}
      <div className="panel" style={{ maxWidth: "430px", width: "100%", marginBottom: "26px", textAlign: "left" }}>
        <div className="panel-title">Your Portfolio ({plants.length} plants built · {greenPct}% clean at end)</div>
        <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {plants.length === 0 ? (
            <span style={{ fontSize: "12px", color: "#475569" }}>No plants built.</span>
          ) : (
            ORDERED.map((t) => {
              if (!finalCounts[t]) return null;
              const src = SOURCES[t];
              return (
                <div
                  key={t}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    background: `${src.color}1a`, border: `1px solid ${src.color}44`,
                    borderRadius: "20px", padding: "4px 11px",
                  }}
                >
                  <span style={{ fontSize: "13px" }}>{src.emoji}</span>
                  <span style={{ fontSize: "12px", color: src.color, fontWeight: 600 }}>
                    {finalCounts[t]}× {src.name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
        <button
          onClick={onRestart}
          style={{
            background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", color: "#fff",
            border: "none", padding: "13px 40px", fontSize: "13px", fontWeight: 700,
            borderRadius: "6px", cursor: "pointer", letterSpacing: "2px", textTransform: "uppercase",
          }}
        >
          ↺ PLAY AGAIN
        </button>
      </div>

      <div style={{ marginTop: "28px", maxWidth: "480px", fontSize: "12px", color: "#334155", lineHeight: 1.7 }}>
        <strong style={{ color: "#475569" }}>Reflection:</strong> The optimal strategy mirrors real-world energy policy —
        fossil fuels provide cheap capital to bootstrap the transition, but long-term success requires committing
        to clean sources despite their higher upfront cost and intermittency challenges.
      </div>
    </div>
  );
}

function ERow({ label, formula, value, color, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <span style={{ fontSize: "13px", color: "#94a3b8", fontWeight: bold ? 700 : 400 }}>{label}</span>
        {formula && (
          <span className="mono" style={{ fontSize: "10px", color: "#334155", marginLeft: "6px" }}>({formula})</span>
        )}
      </div>
      <span className="mono" style={{ fontSize: bold ? "15px" : "13px", color, fontWeight: bold ? 700 : 400 }}>
        {fmtNum(value)}
      </span>
    </div>
  );
}
