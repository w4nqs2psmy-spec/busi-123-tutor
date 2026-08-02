import React, { useState, useMemo, useRef } from "react";
import {
  Play, Plus, Check, ChevronRight, ChevronLeft, Info, X, Sparkles, Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// DATA — 4 real BUSI1620 topics (verified) + 3 placeholders (edit me)
// difficulty anchors easy/medium/hard -> "episodes" E1/E2/E3
// ---------------------------------------------------------------------------
const RAW = [
  { id: "market-research", title: "Primary & Secondary Market Research",
    lo: ["LO1"], concepts: 6, rating: 1647, lastActive: 2, real: true,
    accent: ["#2C4A52", "#101E23"], genre: "RESEARCH",
    blurb: "Distinguish primary from secondary research, choose fit-for-purpose methods, and evaluate source credibility to size and shape a venture's target market." },
  { id: "pestel", title: "PESTEL Macro-Environment Analysis",
    lo: ["LO2"], concepts: 7, rating: 1523, lastActive: 5, real: true,
    accent: ["#33463A", "#111B15"], genre: "STRATEGY",
    blurb: "Use PESTEL to identify macro-environmental forces that shape a venture's opportunity and risk, and connect those forces to concrete strategic implications." },
  { id: "five-forces", title: "Porter's Five Forces & Industry Attractiveness",
    lo: ["LO2"], concepts: 6, rating: 1000, lastActive: null, real: true,
    accent: ["#5A2A24", "#26100D"], genre: "STRATEGY",
    blurb: "Analyse the five competitive forces to judge how attractive (profitable) an industry is and where a new venture is most exposed." },
  { id: "competitive-advantage", title: "Sustainable Competitive Advantage",
    lo: ["LO2", "LO3"], concepts: 6, rating: 1823, lastActive: 9, real: true,
    accent: ["#5E4A24", "#22190C"], genre: "STRATEGY",
    blurb: "Explain how a venture can build an advantage that competitors cannot easily copy, using generic strategies and resource-based reasoning (VRIO)." },
  { id: "business-model", title: "Business Model & Value Proposition",
    lo: ["LO3"], concepts: 6, rating: 1347, lastActive: 1, real: false,
    accent: ["#2E3E52", "#121A26"], genre: "BUILD",
    blurb: "Map a coherent business model and articulate a value proposition that a defined customer segment will pay for." },
  { id: "financial-forecasting", title: "Financial Forecasting & Break-even",
    lo: ["LO4"], concepts: 7, rating: 1000, lastActive: null, real: false,
    accent: ["#294A38", "#0D1F16"], genre: "FINANCE",
    blurb: "Build a defensible forecast, find the break-even point, and stress-test the assumptions a venture's viability rests on." },
  { id: "marketing-strategy", title: "Marketing Strategy & Segmentation",
    lo: ["LO1", "LO2"], concepts: 6, rating: 1947, lastActive: 14, real: false,
    accent: ["#4E2A3E", "#1E1019"], genre: "GROWTH",
    blurb: "Segment a market, target a viable segment, and position a venture so the offer lands with the people most likely to buy." },
];

function band(rating) {
  if (rating < 1400) return { key: "novice", label: "Novice", color: "#D66A5C" };
  if (rating < 1750) return { key: "developing", label: "Developing", color: "#D2A94A" };
  return { key: "proficient", label: "Proficient", color: "#6BAE7C" };
}
function progress(r) { return Math.max(0, Math.min(1, (r - 1000) / (2100 - 1000))); }
function started(t) { return t.lastActive !== null; }
function ago(d) {
  if (d === null) return "New";
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  if (d < 14) return "Last week";
  return `${Math.floor(d / 7)} weeks ago`;
}

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');`;

export default function StreamTutor() {
  const [active, setActive] = useState(null);
  const [myList, setMyList] = useState(() => new Set(["competitive-advantage"]));
  const toggleList = (id) =>
    setMyList((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const hero = useMemo(() => {
    const inProg = RAW.filter(started).filter((t) => progress(t.rating) < 0.95);
    inProg.sort((a, b) => a.lastActive - b.lastActive);
    return inProg[0] || RAW[0];
  }, []);

  const rows = useMemo(() => {
    const cont = RAW.filter(started).sort((a, b) => a.lastActive - b.lastActive);
    const fresh = RAW.filter((t) => !started(t));
    const lo2 = RAW.filter((t) => t.lo.includes("LO2"));
    const rec = [...RAW].sort((a, b) => a.rating - b.rating).slice(0, 5);
    return [
      { key: "continue", label: "Continue where you left off", items: cont, tall: true },
      { key: "rec", label: "Recommended for you", items: rec, reason: true },
      { key: "lo2", label: "Strategy track \u00b7 Learning outcome LO2", items: lo2 },
      { key: "fresh", label: "Haven't started", items: fresh },
    ].filter((r) => r.items.length);
  }, []);

  return (
    <div style={{ background: "#0A0A0C", minHeight: "100vh", color: "#E8E8EC", fontFamily: "Inter, system-ui, sans-serif" }}>
      <style>{FONTS}{CSS}</style>

      <header className="st-nav">
        <div className="st-brand"><span className="st-brand-mark">BUSI</span><span className="st-brand-num">1620</span></div>
        <nav className="st-links">
          <a className="st-link st-link-on">Home</a>
          <a className="st-link">My List</a>
          <a className="st-link">Progress</a>
        </nav>
        <div className="st-avatar" aria-hidden>AL</div>
      </header>

      <Hero topic={hero} onOpen={() => setActive(hero)} inList={myList.has(hero.id)} onList={() => toggleList(hero.id)} />

      <main className="st-rows">
        {rows.map((r) => (
          <Row key={r.key} row={r} onOpen={setActive} myList={myList} onList={toggleList} />
        ))}
        <p className="st-footnote">Prototype \u00b7 mastery data is simulated \u00b7 3 of 7 topics are placeholders you can swap for the real ones</p>
      </main>

      {active && (
        <Detail topic={active} inList={myList.has(active.id)} onList={() => toggleList(active.id)} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

function Hero({ topic, onOpen, inList, onList }) {
  const b = band(topic.rating);
  const p = progress(topic.rating);
  return (
    <section className="st-hero">
      <div className="st-hero-bg" style={{ background: `linear-gradient(115deg, ${topic.accent[0]} 0%, ${topic.accent[1]} 42%, #0A0A0C 78%)` }} />
      <div className="st-hero-grain" aria-hidden />
      <div className="st-hero-vignette" aria-hidden />
      <div className="st-hero-inner">
        <div className="st-hero-eyebrow">
          <span>{topic.genre}</span><i /><span>{started(topic) ? "Continue watching" : "New series"}</span>
        </div>
        <h1 className="st-hero-title">{topic.title}</h1>
        <div className="st-hero-meta">
          <span className="st-band" style={{ color: b.color }}>{b.label}</span>
          <span className="st-dot" /><span>{topic.lo.join(" \u00b7 ")}</span>
          <span className="st-dot" /><span>3 episodes</span>
          <span className="st-dot" /><span>{topic.concepts} key concepts</span>
        </div>
        <p className="st-hero-blurb">{topic.blurb}</p>
        {started(topic) && (
          <div className="st-hero-progress">
            <div className="st-hero-bar"><i style={{ width: `${p * 100}%`, background: b.color }} /></div>
            <span className="st-hero-progress-label">Mastery {Math.round(p * 100)}% \u00b7 last practised {ago(topic.lastActive).toLowerCase()}</span>
          </div>
        )}
        <div className="st-hero-actions">
          <button className="st-btn st-btn-play" onClick={onOpen}>
            <Play size={19} fill="#0A0A0C" strokeWidth={0} />{started(topic) ? "Resume" : "Start"}
          </button>
          <button className="st-btn st-btn-ghost" onClick={onList}>
            {inList ? <Check size={19} /> : <Plus size={19} />}My List
          </button>
          <button className="st-btn st-btn-ghost" onClick={onOpen}><Info size={19} /> Details</button>
        </div>
      </div>
    </section>
  );
}

function Row({ row, onOpen, myList, onList }) {
  const ref = useRef(null);
  const scroll = (dir) => { const el = ref.current; if (el) el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" }); };
  return (
    <section className="st-row">
      <h2 className="st-row-title">{row.label}</h2>
      <div className="st-row-wrap">
        <button className="st-arrow st-arrow-l" onClick={() => scroll(-1)} aria-label="Scroll left"><ChevronLeft size={26} /></button>
        <div className="st-track" ref={ref}>
          {row.items.map((t) => (
            <Card key={t.id} topic={t} tall={row.tall} reason={row.reason}
              inList={myList.has(t.id)} onOpen={() => onOpen(t)} onList={() => onList(t.id)} />
          ))}
        </div>
        <button className="st-arrow st-arrow-r" onClick={() => scroll(1)} aria-label="Scroll right"><ChevronRight size={26} /></button>
      </div>
    </section>
  );
}

function Card({ topic, tall, reason, inList, onOpen, onList }) {
  const b = band(topic.rating);
  const p = progress(topic.rating);
  return (
    <div className={`st-card ${tall ? "st-card-tall" : ""}`} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" ? onOpen() : null)}>
      <div className="st-poster" style={{ background: `linear-gradient(155deg, ${topic.accent[0]}, ${topic.accent[1]})` }}>
        <div className="st-poster-grain" />
        <div className="st-poster-sheen" />
        <span className="st-poster-watermark">{topic.lo.join("")}</span>
        <div className="st-poster-top">
          <span className="st-genre">{topic.genre}</span>
          {!topic.real && <span className="st-placeholder">DEMO</span>}
        </div>
        <div className="st-poster-title">{topic.title}</div>
        {started(topic) && (<div className="st-poster-bar"><i style={{ width: `${p * 100}%`, background: b.color }} /></div>)}
      </div>

      <div className="st-hovercard">
        <div className="st-hoverbar">
          <button className="st-mini st-mini-play" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label="Play"><Play size={15} fill="#0A0A0C" strokeWidth={0} /></button>
          <button className="st-mini" onClick={(e) => { e.stopPropagation(); onList(); }} aria-label="My list">{inList ? <Check size={15} /> : <Plus size={15} />}</button>
          <button className="st-mini st-mini-r" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label="Details"><ChevronRight size={15} /></button>
        </div>
        <div className="st-hovertitle">{topic.title}</div>
        <div className="st-hovermeta">
          <span style={{ color: b.color, fontWeight: 600 }}>{b.label}</span>
          <span className="st-dot" /><span>{topic.lo.join(" \u00b7 ")}</span><span className="st-dot" /><span>3 ep</span>
        </div>
        <div className="st-hovertag">
          {reason ? (<><Sparkles size={12} /> Lowest mastery \u2014 practise this next</>)
            : started(topic) ? (<><Clock size={12} /> {ago(topic.lastActive)}</>)
            : (<><Sparkles size={12} /> New series</>)}
        </div>
      </div>
    </div>
  );
}

function Detail({ topic, inList, onList, onClose }) {
  const b = band(topic.rating);
  const p = progress(topic.rating);
  const eps = [
    { n: 1, name: "Warm-up", diff: "Easy", done: p > 0.33 },
    { n: 2, name: "Applied", diff: "Medium", done: p > 0.66 },
    { n: 3, name: "Challenge", diff: "Hard", done: p > 0.9 },
  ];
  return (
    <div className="st-modal-scrim" onClick={onClose}>
      <div className="st-modal" onClick={(e) => e.stopPropagation()}>
        <button className="st-modal-x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <div className="st-modal-hero" style={{ background: `linear-gradient(155deg, ${topic.accent[0]}, ${topic.accent[1]})` }}>
          <div className="st-poster-grain" />
          <div className="st-modal-hero-fade" />
          <span className="st-modal-watermark">{topic.lo.join("")}</span>
          <div className="st-modal-hero-body">
            <span className="st-genre">{topic.genre}{!topic.real && " \u00b7 DEMO"}</span>
            <h3 className="st-modal-title">{topic.title}</h3>
            <div className="st-modal-actions">
              <button className="st-btn st-btn-play"><Play size={18} fill="#0A0A0C" strokeWidth={0} />{started(topic) ? "Resume" : "Start"}</button>
              <button className="st-btn st-btn-ghost st-btn-round" onClick={onList} aria-label="My list">{inList ? <Check size={18} /> : <Plus size={18} />}</button>
            </div>
          </div>
        </div>
        <div className="st-modal-content">
          <div className="st-modal-meta">
            <span className="st-band" style={{ color: b.color }}>{b.label}</span>
            <span className="st-dot" /><span>{topic.lo.join(" \u00b7 ")}</span>
            <span className="st-dot" /><span>{topic.concepts} key concepts</span>
            <span className="st-dot" /><span>{started(topic) ? ago(topic.lastActive) : "Not started"}</span>
          </div>
          <p className="st-modal-blurb">{topic.blurb}</p>
          {started(topic) && (
            <div className="st-modal-progress"><div className="st-hero-bar"><i style={{ width: `${p * 100}%`, background: b.color }} /></div><span>{Math.round(p * 100)}% mastery</span></div>
          )}
          <h4 className="st-eplist-title">Episodes</h4>
          <ul className="st-eplist">
            {eps.map((e) => (
              <li key={e.n} className="st-ep">
                <div className="st-ep-num" style={{ borderColor: e.done ? b.color : "#2C2C31", color: e.done ? b.color : "#78767F" }}>{e.done ? <Check size={16} /> : e.n}</div>
                <div className="st-ep-body"><div className="st-ep-name">Episode {e.n} \u00b7 {e.name}</div><div className="st-ep-diff">{e.diff} \u00b7 adaptive question generated live</div></div>
                <button className="st-ep-play" aria-label="Play episode"><Play size={16} fill="currentColor" strokeWidth={0} /></button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const CSS = `
* { box-sizing: border-box; }
.st-nav { position: sticky; top: 0; z-index: 40; display: flex; align-items: center; gap: 32px;
  padding: 16px 48px; background: linear-gradient(#0A0A0C, #0A0A0Ccc 60%, transparent); }
.st-brand { font-family: Sora, sans-serif; font-weight: 800; letter-spacing: -0.02em; font-size: 21px; }
.st-brand-mark { color: #F2F2F5; }
.st-brand-num { color: #9A9AA4; }
.st-links { display: flex; gap: 22px; }
.st-link { font-size: 14px; color: #9A9AA4; cursor: pointer; transition: color .15s; }
.st-link:hover, .st-link-on { color: #F2F2F5; }
.st-link-on { font-weight: 600; }
.st-avatar { margin-left: auto; width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center;
  background: #24242A; border: 1px solid #33333A; font-size: 12px; font-weight: 700; color: #D8D8DE; }

.st-hero { position: relative; min-height: 580px; display: flex; align-items: flex-end; overflow: hidden; }
.st-hero-bg, .st-hero-grain, .st-hero-vignette { position: absolute; inset: 0; }
.st-hero-vignette { background: radial-gradient(130% 130% at 70% 20%, transparent 30%, #0A0A0C 82%),
  linear-gradient(0deg, #0A0A0C 2%, transparent 40%); }
.st-hero-grain { opacity: .045; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.st-hero-inner { position: relative; z-index: 2; padding: 0 48px 68px; max-width: 720px; }
.st-hero-eyebrow { display: flex; align-items: center; gap: 10px; font-family: Sora, sans-serif; font-weight: 700;
  font-size: 11.5px; letter-spacing: .22em; text-transform: uppercase; color: #B4B4BC; margin-bottom: 18px; }
.st-hero-eyebrow i { width: 4px; height: 4px; border-radius: 50%; background: #6A6A72; }
.st-hero-title { font-family: Sora, sans-serif; font-weight: 800; font-size: clamp(34px, 5.2vw, 60px);
  line-height: 1.0; letter-spacing: -0.03em; margin: 0 0 20px; text-wrap: balance; }
.st-hero-meta { display: flex; align-items: center; gap: 12px; font-size: 13.5px; color: #B4B4BC; margin-bottom: 16px; flex-wrap: wrap; }
.st-band { font-weight: 700; }
.st-dot { width: 3px; height: 3px; border-radius: 50%; background: #55555E; }
.st-hero-blurb { font-size: 16px; line-height: 1.55; color: #BDBDC5; margin: 0 0 24px; max-width: 610px; }
.st-hero-progress { margin-bottom: 26px; max-width: 420px; }
.st-hero-bar { height: 5px; border-radius: 4px; background: #26262B; overflow: hidden; }
.st-hero-bar i, .st-poster-bar i { display: block; height: 100%; border-radius: 4px; transition: width .4s; }
.st-hero-progress-label { display: block; margin-top: 8px; font-size: 12.5px; color: #86868F; }
.st-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.st-btn { display: inline-flex; align-items: center; gap: 9px; padding: 12px 24px; border: none; border-radius: 6px;
  font-family: Inter, sans-serif; font-size: 15px; font-weight: 700; cursor: pointer; transition: transform .12s, background .15s; }
.st-btn:active { transform: scale(.97); }
.st-btn-play { background: #F2F2F5; color: #0A0A0C; }
.st-btn-play:hover { background: #fff; }
.st-btn-ghost { background: #26262Bcc; color: #E8E8EC; }
.st-btn-ghost:hover { background: #33333Acc; }
.st-btn-round { padding: 12px; border-radius: 50%; }

.st-rows { padding: 8px 0 40px; margin-top: -48px; position: relative; z-index: 3; }
.st-row { margin: 30px 0; }
.st-row-title { font-family: Sora, sans-serif; font-weight: 700; font-size: 17px; letter-spacing: -0.01em; margin: 0 0 12px; padding: 0 48px; color: #DCDCE2; }
.st-row-wrap { position: relative; }
.st-track { display: flex; gap: 12px; overflow-x: auto; padding: 8px 48px 44px; scroll-behavior: smooth; scrollbar-width: none; }
.st-track::-webkit-scrollbar { display: none; }
.st-arrow { position: absolute; top: 8px; bottom: 44px; width: 44px; z-index: 20; border: none; cursor: pointer;
  background: linear-gradient(90deg, #0A0A0Cee, #0A0A0C00); color: #E8E8EC; display: grid; place-items: center; opacity: 0; transition: opacity .2s; }
.st-arrow-r { right: 0; background: linear-gradient(270deg, #0A0A0Cee, #0A0A0C00); }
.st-arrow-l { left: 0; }
.st-row-wrap:hover .st-arrow { opacity: 1; }

.st-card { position: relative; flex: 0 0 auto; width: 236px; cursor: pointer; transition: transform .28s cubic-bezier(.2,.7,.2,1); }
.st-card-tall { width: 250px; }
.st-poster { position: relative; aspect-ratio: 16/10; border-radius: 8px; overflow: hidden; padding: 15px;
  display: flex; flex-direction: column; box-shadow: 0 10px 30px #00000066; border: 1px solid #ffffff10; }
.st-card-tall .st-poster { aspect-ratio: 3/4; }
.st-poster-grain { position: absolute; inset: 0; opacity: .07; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
.st-poster-sheen { position: absolute; inset: 0; background: radial-gradient(130% 90% at 78% 0%, #ffffff18, transparent 52%),
  linear-gradient(0deg, #00000055, transparent 45%); }
.st-poster-watermark { position: absolute; right: -6px; bottom: 22px; font-family: Sora, sans-serif; font-weight: 800;
  font-size: 88px; line-height: 1; letter-spacing: -0.05em; color: #ffffff0d; z-index: 1; user-select: none; }
.st-poster-top { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 2; }
.st-genre { font-family: Sora, sans-serif; font-weight: 700; font-size: 10px; letter-spacing: .2em; color: #ffffffc0; }
.st-placeholder { font-family: Sora, sans-serif; font-weight: 700; font-size: 9px; letter-spacing: .12em; color: #ffffffdd; background: #00000045; padding: 2px 6px; border-radius: 4px; }
.st-poster-title { margin-top: auto; position: relative; z-index: 2; font-family: Sora, sans-serif; font-weight: 700;
  font-size: 17px; line-height: 1.12; letter-spacing: -0.02em; color: #fff; text-shadow: 0 2px 10px #00000070; text-wrap: balance; }
.st-poster-bar { position: relative; z-index: 2; margin-top: 11px; height: 4px; border-radius: 3px; background: #00000050; overflow: hidden; }

.st-hovercard { position: absolute; left: 0; right: 0; top: 100%; margin-top: -6px; padding: 12px 14px 14px;
  background: #141416; border: 1px solid #26262B; border-top: none; border-radius: 0 0 8px 8px;
  opacity: 0; transform: translateY(-6px); pointer-events: none; transition: opacity .2s, transform .2s; box-shadow: 0 24px 44px #00000080; }
.st-card:hover { transform: scale(1.06) translateY(-4px); z-index: 30; }
.st-card:hover .st-hovercard { opacity: 1; transform: translateY(0); pointer-events: auto; }
.st-hoverbar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.st-mini { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid #48484F; background: transparent; color: #E8E8EC; display: grid; place-items: center; cursor: pointer; transition: border-color .15s; }
.st-mini:hover { border-color: #E8E8EC; }
.st-mini-play { background: #F2F2F5; border-color: #F2F2F5; color: #0A0A0C; }
.st-mini-play:hover { background: #fff; }
.st-mini-r { margin-left: auto; }
.st-hovertitle { font-family: Sora, sans-serif; font-weight: 700; font-size: 14px; line-height: 1.15; margin-bottom: 6px; }
.st-hovermeta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #9A9AA4; margin-bottom: 8px; }
.st-hovertag { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: #86868F; }

.st-modal-scrim { position: fixed; inset: 0; z-index: 60; background: #04040699; backdrop-filter: blur(4px); display: grid; place-items: start center; padding: 40px 16px; overflow-y: auto; animation: st-fade .2s ease; }
.st-modal { position: relative; width: min(760px, 100%); background: #101012; border: 1px solid #26262B; border-radius: 12px; overflow: hidden; box-shadow: 0 30px 80px #000000aa; animation: st-rise .25s cubic-bezier(.2,.7,.2,1); }
.st-modal-x { position: absolute; top: 16px; right: 16px; z-index: 5; width: 36px; height: 36px; border-radius: 50%; border: none; background: #101012cc; color: #E8E8EC; cursor: pointer; display: grid; place-items: center; }
.st-modal-hero { position: relative; aspect-ratio: 16/7; padding: 28px; display: flex; align-items: flex-end; overflow: hidden; }
.st-modal-hero-fade { position: absolute; inset: 0; background: linear-gradient(0deg, #101012, #10101200 55%); }
.st-modal-watermark { position: absolute; right: 4%; top: 8%; font-family: Sora, sans-serif; font-weight: 800; font-size: 150px; line-height: 1; letter-spacing: -0.05em; color: #ffffff0e; user-select: none; }
.st-modal-hero-body { position: relative; z-index: 2; }
.st-modal-title { font-family: Sora, sans-serif; font-weight: 800; font-size: clamp(24px, 3.6vw, 38px); letter-spacing: -0.03em; line-height: 1.02; margin: 8px 0 16px; max-width: 90%; }
.st-modal-actions { display: flex; gap: 10px; }
.st-modal-content { padding: 24px 28px 32px; }
.st-modal-meta { display: flex; align-items: center; gap: 10px; font-size: 13.5px; color: #B4B4BC; margin-bottom: 16px; flex-wrap: wrap; }
.st-modal-blurb { font-size: 15px; line-height: 1.6; color: #BDBDC5; margin: 0 0 20px; }
.st-modal-progress { display: flex; align-items: center; gap: 12px; margin-bottom: 26px; }
.st-modal-progress .st-hero-bar { flex: 1; }
.st-modal-progress span { font-size: 12.5px; color: #86868F; white-space: nowrap; }
.st-eplist-title { font-family: Sora, sans-serif; font-weight: 700; font-size: 16px; margin: 0 0 12px; }
.st-eplist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; }
.st-ep { display: flex; align-items: center; gap: 16px; padding: 14px 8px; border-top: 1px solid #1C1C20; transition: background .15s; cursor: pointer; }
.st-ep:hover { background: #16161A; }
.st-ep-num { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid; display: grid; place-items: center; font-weight: 700; font-size: 14px; }
.st-ep-body { flex: 1; }
.st-ep-name { font-size: 14.5px; font-weight: 600; color: #DCDCE2; }
.st-ep-diff { font-size: 12.5px; color: #86868F; margin-top: 2px; }
.st-ep-play { border: none; background: transparent; color: #C8C8CE; cursor: pointer; opacity: 0; transition: opacity .15s; }
.st-ep:hover .st-ep-play { opacity: 1; }

.st-footnote { text-align: center; font-size: 12px; color: #55555Eaa; margin: 30px 48px 0; }

@keyframes st-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes st-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }

@media (max-width: 640px) {
  .st-nav, .st-hero-inner, .st-row-title, .st-footnote { padding-left: 20px; padding-right: 20px; }
  .st-track { padding-left: 20px; padding-right: 20px; }
  .st-arrow { display: none; }
  .st-card { width: 160px; } .st-card-tall { width: 168px; }
}
@media (prefers-reduced-motion: reduce) { .st-card, .st-hovercard, .st-btn { transition: none; } }
`;
