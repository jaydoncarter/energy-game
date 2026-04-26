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
   GLOBAL STYLES (injected once on mount) – all design tokens as CSS variables
   ═══════════════════════════════════════════════════════════════ */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@400;600;700;800&family=Share+Tech+Mono&display=swap');

  :root {
    /* Backgrounds */
    --bg-body: #060b16;
    --bg-panel: rgba(10, 18, 35, 0.97);
    --bg-card: rgba(10, 18, 35, 0.85);
    --bg-card-hover: rgba(20, 30, 55, 0.9);
    --bg-header: rgba(6, 11, 22, 0.98);
    --bg-progress: #0e1525;
    --bg-tab-active: rgba(30, 58, 95, 0.5);
    --bg-tab-inactive: transparent;
    --bg-queue: rgba(14, 21, 37, 0.7);
    --bg-warning: rgba(239, 68, 68, 0.1);
    --bg-plant-item: rgba(14, 21, 37, 0.6);

    /* Borders */
    --border-default: rgba(30, 58, 95, 0.65);
    --border-light: rgba(30, 58, 95, 0.45);
    --border-lighter: rgba(30, 58, 95, 0.4);
    --border-tab: rgba(30, 58, 95, 0.4);
    --border-warning: rgba(239, 68, 68, 0.25);

    /* Text colors */
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --text-dim: #475569;
    --text-dark: #334155;
    --text-accent-blue: #3b82f6;
    --text-success: #22c55e;
    --text-warning: #fbbf24;
    --text-danger: #ef4444;
    --text-info: #7dd3fc;

    /* Status / Accent */
    --color-success: #22c55e;
    --color-warning: #fbbf24;
    --color-danger: #ef4444;
    --color-info: #3b82f6;

    /* Font sizes */
    --font-xxs: 9px;        /* was 7.5px */
--font-xxs2: 9.5px;     /* was 8px   */
--font-xs: 10.5px;      /* was 9px   */
--font-xs2: 11px;       /* was 9.5px */
--font-sm: 12px;        /* was 10px  */
--font-sm2: 13px;       /* was 11px  */
--font-base: 14px;      /* was 12px  */
--font-md: 15.5px;      /* was 13px  */
--font-lg: 16.5px;      /* was 14px  */
--font-xl: 17.5px;      /* was 15px  */
--font-2xl: 25px;       /* was 22px  */

/* Responsive clamps – raise both min and max */
--font-3xl:   clamp(3rem, 10vw, 6rem);    /* was 2.4rem, 8vw, 5rem */
--font-heading: clamp(2rem, 6vw, 3.8rem); /* was 1.6rem, 5vw, 3rem */
--font-grade:  clamp(4rem, 14vw, 8rem);   /* was 3.5rem, 12vw, 7rem */

    /* Spacing / Layout */
    --border-radius-sm: 2px;
    --border-radius: 4px;
    --border-radius-md: 6px;
    --panel-padding: 10px;
    --card-padding: 10px 12px;

    /* Shadows */
    --glow-green: 0 0 12px #22c55e, 0 0 24px #22c55e44;
    --glow-red: 0 0 14px #ef4444, 0 0 28px #ef444444;
    --glow-success: 0 0 32px rgba(34,197,94,0.38);
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body {
    background: var(--bg-body);
    color: var(--text-primary);
    font-family: 'Exo 2', system-ui, sans-serif;
    overflow: hidden;
  }
  .mono { font-family: 'Share Tech Mono', 'Courier New', monospace !important; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: var(--border-radius-sm); }

  /* Panel */
  .panel {
    background: var(--bg-panel);
    border: 1px solid var(--border-default);
    border-radius: var(--border-radius-md);
  }
  .panel-title {
    font-size: var(--font-xs2);
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--color-info);
    padding: 8px 12px 7px;
    border-bottom: 1px solid var(--border-light);
  }

  /* Shop card */
  .shop-card {
    border-radius: var(--border-radius-md);
    padding: var(--card-padding);
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    transition: border-color 0.2s, background 0.2s;
  }
  .shop-card:not(.card-disabled):hover {
    border-color: rgba(59, 130, 246, 0.45);
    background: var(--bg-card-hover);
  }
  .card-disabled { opacity: 0.45; }

  /* Buy button */
  .buy-btn {
    border: none;
    border-radius: var(--border-radius);
    cursor: pointer;
    font-family: 'Exo 2', sans-serif;
    font-weight: 700;
    font-size: var(--font-sm2);
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 5px 13px;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .buy-btn:hover:not(:disabled) { filter: brightness(1.25); transform: scale(1.04); }
  .buy-btn:disabled { opacity: 0.35; cursor: not-allowed; }

  /* Animations */
  .bar-fill   { transition: width 0.35s ease; }
  .timer-bar  { transition: width 0.25s linear; }
  .pulse      { animation: pulse  1.6s ease-in-out infinite; }
  .glow-green { text-shadow: var(--glow-green); }
  .glow-red   { text-shadow: var(--glow-red); }

  @keyframes pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
  @keyframes pop   { 0% { transform: scale(1); } 40% { transform: scale(1.18); } 100% { transform: scale(1); } }
  .pop { animation: pop 0.35s ease; }

  /* Mobile layout */
  .game-main { display: flex; overflow: hidden; flex: 1; min-height: 0; }
  .left-panel {
    width: 255px; flex-shrink: 0;
    border-right: 1px solid var(--border-lighter);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .right-panel { flex: 1; overflow: hidden; }
  .mobile-tabs { display: none; }

  @media (max-width: 700px) {
    body { overflow: auto; }
    html, body, #root { height: auto; }
    .game-main   { flex-direction: column; overflow: visible; flex: none; }
    .left-panel  { width: 100%; border-right: none; border-bottom: 1px solid var(--border-lighter); max-height: 60vh; overflow: hidden; }
    .right-panel { overflow: visible; }
    .game-container {
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
      textAlign: "center", background: "var(--bg-body)",
      backgroundImage: "radial-gradient(ellipse at 50% 25%, rgba(0,80,180,0.13) 0%, transparent 65%)",
    }}>
      <div className="mono" style={{ fontSize: "var(--font-sm)", letterSpacing: "4px", color: "var(--color-info)", marginBottom: "14px" }}>
        ENERGY &amp; SOCIETY // INTERACTIVE SIMULATION
      </div>
      <h1 style={{ fontSize: "var(--font-3xl)", fontWeight: 800, color: "#fff", marginBottom: "8px", letterSpacing: "-1px", lineHeight: 1 }}>
        ⚡ GRID OPERATOR
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "clamp(13px, 2.5vw, 15px)", maxWidth: "560px", lineHeight: 1.75, marginBottom: "32px" }}>
        You have <span style={{ color: "var(--text-warning)", fontWeight: 700 }}>10 minutes</span> to build an
        energy grid. Balance production volume, revenue, and environmental impact to maximize your{" "}
        <span style={{ color: "var(--text-success)", fontWeight: 700 }}>Energy Score</span>.
      </p>

      {/* Score formula panel */}
      <div className="panel" style={{ maxWidth: "480px", width: "100%", marginBottom: "16px" }}>
        <div className="panel-title">Score Formula</div>
        <div style={{ padding: "14px 18px", textAlign: "center" }}>
          <div className="mono" style={{ fontSize: "var(--font-xl)", color: "var(--text-primary)", marginBottom: "8px" }}>
            <span style={{ color: "var(--text-success)" }}>Clean Energy × 2</span>
            {"  +  "}
            <span style={{ color: "#f97316" }}>Fossil Energy × 0.05</span>
          </div>
          <p style={{ fontSize: "var(--font-base)", color: "var(--text-muted)", lineHeight: 1.65 }}>
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
              <span style={{ fontSize: "var(--font-md)", flexShrink: 0, marginTop: "2px" }}>{icon}</span>
              <span style={{ fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.55 }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={onStart}
        style={{
          background: "linear-gradient(135deg, var(--color-success), #16a34a)",
          color: "#fff", border: "none", padding: "15px 56px",
          fontSize: "var(--font-xl)", fontWeight: 700, borderRadius: "var(--border-radius-md)", cursor: "pointer",
          letterSpacing: "2.5px", textTransform: "uppercase",
          boxShadow: "var(--glow-success)", transition: "all 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.05)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        ▶  START SIMULATION
      </button>
      <div className="mono" style={{ marginTop: "14px", fontSize: "var(--font-sm2)", color: "var(--text-dark)" }}>
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
    <div className="game-container" style={{ display: "flex", flexDirection: "column", background: "var(--bg-body)" }}>

      {/* ── HEADER ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 16px", flexShrink: 0, flexWrap: "wrap", gap: "6px",
        background: "var(--bg-header)", borderBottom: "1px solid var(--border-light)",
      }}>
        <span style={{ fontSize: "var(--font-2xl)", fontWeight: 700, letterSpacing: "2.5px", color: "var(--color-info)", flexShrink: 0 }}>
          ⚡ GRID OPERATOR
        </span>
        <div className="desktop-header-stats" style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}>
          <HStat label="SCORE"  value={fmtNum(d.score)}          color="var(--text-success)" glow />
          <HStat label="BUDGET" value={fmt$(d.money)}             color="var(--text-warning)" />
          <HStat label="REV/S"  value={`+${fmt$(d.rev)}`}        color="var(--text-secondary)" />
          <HStat label="POWER"  value={`${Math.round(d.total)} u/s`} color="var(--text-info)" />
        </div>
        <div
          className={`mono ${urgent ? "glow-red" : ""}`}
          style={{ fontSize: "var(--font-2xl)", color: urgent ? "var(--color-danger)" : "var(--text-primary)", minWidth: "68px", textAlign: "right" }}
        >
          {fmtTime(d.timeLeft)}
        </div>
      </div>

      {/* ── TIMER BAR ── */}
      <div style={{ height: "3px", background: "var(--bg-progress)", flexShrink: 0 }}>
        <div
          className="timer-bar"
          style={{
            height: "100%", width: `${timePercent}%`,
            background: urgent ? "linear-gradient(90deg, var(--color-danger), #f97316)" : "linear-gradient(90deg, var(--color-success), var(--color-info))",
            boxShadow: urgent ? "0 0 8px var(--color-danger)" : "0 0 6px #22c55e55",
          }}
        />
      </div>

      {/* ── MOBILE TABS ── */}
      <div className="mobile-tabs" style={{ gap: "0", flexShrink: 0, borderBottom: "1px solid var(--border-tab)" }}>
        {[["grid", "📊 Grid"], ["market", "🛒 Market"]].map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setMobileTab(tab)}
            style={{
              flex: 1, padding: "8px", border: "none", cursor: "pointer",
              background: mobileTab === tab ? "var(--bg-tab-active)" : "var(--bg-tab-inactive)",
              color: mobileTab === tab ? "var(--text-primary)" : "var(--text-muted)",
              fontFamily: "inherit", fontSize: "var(--font-base)", fontWeight: 600,
              borderBottom: mobileTab === tab ? "2px solid var(--color-info)" : "2px solid transparent",
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
      <div style={{ fontSize: "var(--font-xxs2)", letterSpacing: "1.5px", color: "var(--text-dim)", textTransform: "uppercase" }}>{label}</div>
      <div className={`mono ${glow ? "glow-green" : ""}`} style={{ fontSize: "var(--font-lg)", color }}>{value}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GRID STATUS (left panel — top half)
   ═══════════════════════════════════════════════════════════════ */
function GridStatus({ d }) {
  const { total, clean, greenFrac, byType, elapsed, bat, cleanAcc, dirtyAcc, score } = d;
  const greenPct  = Math.round(greenFrac * 100);
  const envColor  = greenFrac > 0.65 ? "var(--text-success)" : greenFrac > 0.35 ? "var(--text-warning)" : "var(--color-danger)";
  const isDaytime = getSolarFactor(elapsed) > 0.05;
  const windLevel = getWindFactor(elapsed);

  return (
    <div style={{ padding: "var(--panel-padding)", borderBottom: "1px solid var(--border-lighter)", flexShrink: 0 }}>
      <div style={{ fontSize: "var(--font-xs)", letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--color-info)", marginBottom: "9px" }}>
        GRID STATUS
      </div>

      {/* Power mix bar */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--font-sm)", color: "var(--text-muted)", marginBottom: "3px" }}>
        <span>Power Mix</span>
        <span className="mono" style={{ color: envColor }}>{greenPct}% clean</span>
      </div>
      <div style={{ height: "7px", borderRadius: "var(--border-radius)", background: "var(--bg-progress)", overflow: "hidden", marginBottom: "10px", display: "flex" }}>
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
        <SRow label="Total Power"     value={`${Math.round(total)} u/s`}            color="var(--text-info)" />
        <SRow label="🌿 Clean score"  value={`+${fmtNum(Math.round(cleanAcc * 2))}`} color="var(--text-success)" />
        <SRow label="🏭 Fossil score" value={`+${fmtNum(Math.round(dirtyAcc * 0.05))}`} color="#f97316" />
        <div style={{ borderTop: "1px solid var(--border-lighter)", paddingTop: "4px", marginTop: "2px" }}>
          <SRow label="TOTAL SCORE" value={fmtNum(score)} color="var(--text-primary)" bold />
        </div>
      </div>

      {/* Intermittency meters */}
      {(d.active.solar > 0 || d.active.wind > 0) && (
        <div style={{ marginTop: "9px", borderTop: "1px solid var(--border-lighter)", paddingTop: "9px", display: "flex", flexDirection: "column", gap: "5px" }}>
          {d.active.solar > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}>
                {isDaytime ? "☀️" : "🌙"} Solar cap.
              </span>
              <CapBar value={getCapFactor("solar", elapsed, bat)} color="var(--text-warning)" />
            </div>
          )}
          {d.active.wind > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}>
                {windLevel > 0.6 ? "💨" : windLevel > 0.35 ? "🌬️" : "🍃"} Wind cap.
              </span>
              <CapBar value={getCapFactor("wind", elapsed, bat)} color="var(--text-info)" />
            </div>
          )}
          {bat > 0 && (
            <div style={{ fontSize: "var(--font-sm)", color: "#a78bfa" }}>
              🔋 {bat} battery bank{bat > 1 ? "s" : ""} active
            </div>
          )}
        </div>
      )}

      {/* Fossil warning */}
      {d.active.fossil >= 4 && (
        <div style={{ marginTop: "9px", background: "var(--bg-warning)", border: "1px solid var(--border-warning)", borderRadius: "var(--border-radius)", padding: "6px 8px" }}>
          <div style={{ fontSize: "var(--font-sm)", color: "#fca5a5", lineHeight: 1.5 }}>
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
      <span style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)", fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span className="mono" style={{ fontSize: bold ? "var(--font-base)" : "var(--font-sm2)", color, fontWeight: bold ? 700 : 400 }}>{value}</span>
    </div>
  );
}

function CapBar({ value, color }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
      <div style={{ width: "52px", height: "5px", background: "var(--bg-progress)", borderRadius: "var(--border-radius-sm)", overflow: "hidden" }}>
        <div className="bar-fill" style={{ width: `${pct}%`, height: "100%", background: color }} />
      </div>
      <span className="mono" style={{ fontSize: "var(--font-sm)", color, minWidth: "28px" }}>{pct}%</span>
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
    <div style={{ flex: 1, overflowY: "auto", padding: "var(--panel-padding)" }}>
      <div style={{ fontSize: "var(--font-xs)", letterSpacing: "2.5px", textTransform: "uppercase", color: "var(--color-info)", marginBottom: "8px" }}>
        YOUR PLANTS
      </div>

      {plants.length === 0 && (
        <div style={{ color: "var(--text-dark)", fontSize: "var(--font-base)", textAlign: "center", paddingTop: "18px" }}>
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
              background: isNew ? `${src.color}18` : "var(--bg-plant-item)",
              borderRadius: "var(--border-radius)", borderLeft: `2px solid ${src.color}`,
              transition: "background 0.5s",
            }}
          >
            <span style={{ fontSize: "var(--font-xl)", flexShrink: 0 }}>{src.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "var(--font-sm2)", fontWeight: 600, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {n}× {src.name}
              </div>
              <div className="mono" style={{ fontSize: "var(--font-sm)", color: src.color }}>
                {Math.round(pw)} u/s
                {src.intermittent && <span style={{ color: "var(--text-dim)" }}> ({Math.round(cap * 100)}%)</span>}
              </div>
            </div>
          </div>
        );
      })}

      {/* Build queue */}
      {building.length > 0 && (
        <div style={{ marginTop: "10px" }}>
          <div style={{ fontSize: "var(--font-xs)", letterSpacing: "1.5px", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: "5px" }}>
            UNDER CONSTRUCTION
          </div>
          {building.map((p) => {
            const src      = SOURCES[p.type];
            const progress = 1 - p.buildLeft / src.buildSec;
            return (
              <div
                key={p.id}
                style={{ marginBottom: "5px", padding: "6px 8px", background: "var(--bg-queue)", borderRadius: "var(--border-radius)", border: `1px solid ${src.color}33` }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span className="pulse" style={{ fontSize: "var(--font-base)", color: src.color }}>
                    {src.emoji} {src.name}
                  </span>
                  <span className="mono" style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}>
                    {fmtTime(p.buildLeft)}
                  </span>
                </div>
                <div style={{ height: "3px", background: "var(--bg-progress)", borderRadius: "var(--border-radius-sm)", overflow: "hidden" }}>
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
              <div style={{ fontSize: "var(--font-lg)", fontWeight: 700, color: src.color }}>{src.name}</div>
              <div style={{ fontSize: "var(--font-sm)", color: "var(--text-dim)" }}>{src.sub}</div>
            </div>
            {owned > 0 && (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div className="mono" style={{ fontSize: "var(--font-sm2)", color: src.color }}>{activeN} active</div>
                {inQueue > 0 && (
                  <div className="mono pulse" style={{ fontSize: "var(--font-sm)", color: "var(--text-muted)" }}>{inQueue} building</div>
                )}
              </div>
            )}
          </div>

          {/* Description */}
          <p style={{ fontSize: "var(--font-sm2)", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "8px" }}>{src.desc}</p>

          {/* Stats + buy */}
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
            {src.outputPerSec > 0 && <Chip label="Output" value={`${src.outputPerSec} u/s`} color="var(--text-info)" />}
            <Chip label="Build"  value={src.buildSec >= 60 ? `${src.buildSec / 60}m` : `${src.buildSec}s`} color="var(--text-secondary)" />
            {src.revPerSec > 0 && <Chip label="Rev/s"  value={`+${fmt$(src.revPerSec)}`} color="var(--text-warning)" />}
            {src.maxOwned && <Chip label="Sites" value={`${owned}/${src.maxOwned}`} color={maxed ? "var(--color-danger)" : "var(--text-success)"} />}
            {src.intermittent && <Chip label="Cap" value={`${Math.round(cap * 100)}%`} color={cap > 0.55 ? "var(--text-success)" : "var(--text-warning)"} />}

            {/* Env tag */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "42px" }}>
              <span style={{ fontSize: "var(--font-xxs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>Env</span>
              <span style={{ fontSize: "var(--font-sm)", fontWeight: 700, color: src.envColor }}>{src.envTag}</span>
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
                  color: canAfford && !maxed ? "#000" : "var(--text-dim)",
                }}
              >
                {maxed ? "MAXED" : `${fmt$(cost)}`}
              </button>
            </div>
          </div>

          {/* Real-world fact (shown when owned) */}
          {owned > 0 && (
            <div style={{ marginTop: "6px", fontSize: "var(--font-sm)", color: "var(--text-dark)", fontStyle: "italic", borderTop: "1px solid var(--border-lighter)", paddingTop: "5px" }}>
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
      <span style={{ fontSize: "var(--font-xxs)", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
      <span className="mono" style={{ fontSize: "var(--font-sm2)", color }}>{value}</span>
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
  const gradeColor = { S: "var(--text-success)", A: "#a3e635", B: "var(--text-warning)", C: "#f97316", D: "var(--color-danger)" }[grade];
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
      minHeight: "100vh", background: "var(--bg-body)", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "28px 20px", textAlign: "center",
      backgroundImage: "radial-gradient(ellipse at 50% 50%, rgba(34,197,94,0.07) 0%, transparent 70%)",
    }}>
      <div className="mono" style={{ fontSize: "var(--font-sm)", letterSpacing: "4px", color: "var(--color-info)", marginBottom: "14px" }}>
        SIMULATION COMPLETE
      </div>
      <h1 style={{ fontSize: "var(--font-heading)", fontWeight: 800, marginBottom: "8px" }}>
        FINAL SCORE:{" "}
        <span className="mono glow-green" style={{ color: "var(--text-success)" }}>
          {fmtNum(score)}
        </span>
      </h1>

      <div style={{
        fontSize: "var(--font-grade)", fontWeight: 800, lineHeight: 1,
        color: gradeColor, textShadow: `0 0 40px ${gradeColor}77`, marginBottom: "8px",
      }}>
        {grade}
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--font-lg)", maxWidth: "420px", lineHeight: 1.7, marginBottom: "28px" }}>
        {gradeMsg}
      </p>

      {/* Breakdown */}
      <div className="panel" style={{ maxWidth: "430px", width: "100%", marginBottom: "14px", textAlign: "left" }}>
        <div className="panel-title">Score Breakdown</div>
        <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: "9px" }}>
          <ERow label="🌿 Clean energy produced" formula={`${fmtNum(Math.round(cleanAcc))} × 2`} value={cleanScore}    color="var(--text-success)" />
          <ERow label="🏭 Fossil energy produced" formula={`${fmtNum(Math.round(dirtyAcc))} × 0.05`} value={dirtyScore} color="#f97316" />
          <div style={{ borderTop: "1px solid var(--border-lighter)", paddingTop: "9px" }}>
            <ERow label="TOTAL" formula="" value={score} color="var(--text-primary)" bold />
          </div>
        </div>
      </div>

      {/* Portfolio */}
      <div className="panel" style={{ maxWidth: "430px", width: "100%", marginBottom: "26px", textAlign: "left" }}>
        <div className="panel-title">Your Portfolio ({plants.length} plants built · {greenPct}% clean at end)</div>
        <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {plants.length === 0 ? (
            <span style={{ fontSize: "var(--font-base)", color: "var(--text-dim)" }}>No plants built.</span>
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
                  <span style={{ fontSize: "var(--font-md)" }}>{src.emoji}</span>
                  <span style={{ fontSize: "var(--font-base)", color: src.color, fontWeight: 600 }}>
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
            background: "linear-gradient(135deg, var(--color-info), #1d4ed8)", color: "#fff",
            border: "none", padding: "13px 40px", fontSize: "var(--font-md)", fontWeight: 700,
            borderRadius: "var(--border-radius-md)", cursor: "pointer", letterSpacing: "2px", textTransform: "uppercase",
          }}
        >
          ↺ PLAY AGAIN
        </button>
      </div>

      <div style={{ marginTop: "28px", maxWidth: "480px", fontSize: "var(--font-base)", color: "var(--text-dark)", lineHeight: 1.7 }}>
        <strong style={{ color: "var(--text-dim)" }}>Reflection:</strong> The optimal strategy mirrors real-world energy policy —
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
        <span style={{ fontSize: "var(--font-md)", color: "var(--text-secondary)", fontWeight: bold ? 700 : 400 }}>{label}</span>
        {formula && (
          <span className="mono" style={{ fontSize: "var(--font-sm)", color: "var(--text-dark)", marginLeft: "6px" }}>({formula})</span>
        )}
      </div>
      <span className="mono" style={{ fontSize: bold ? "var(--font-xl)" : "var(--font-md)", color, fontWeight: bold ? 700 : 400 }}>
        {fmtNum(value)}
      </span>
    </div>
  );
}