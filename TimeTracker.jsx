import React, { useState, useEffect, useCallback } from "react";
import { Play, Coffee, Square, GraduationCap, Clock, X } from "lucide-react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, set } from "firebase/database";

const COLORS = {
  purple: "#360B5C",
  plum: "#573473",
  lavender: "#F3EAFD",
  mauve: "#B8A4C8",
  slate: "#7A6485",
};

const SEGMENT_COLOR = {
  work: COLORS.purple,
  break: COLORS.mauve,
  coaching: "#8E5FB8",
};

const SEGMENT_LABEL = {
  work: "Working",
  break: "Break",
  coaching: "Coaching",
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

function todayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export default function TimeTracker() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");
  const [activeId, setActiveId] = useState(null);
  const [coachName, setCoachName] = useState("");
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const dateKey = selectedDate;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const dbRef = ref(database, `entries/${dateKey}`);
        const snapshot = await get(dbRef);
        const data = snapshot.exists() ? snapshot.val() : [];
        setEntries(data);
        const active = data.find((e) => !e.end);
        if (active) {
          setStatus(active.type === "break" ? "break" : active.type === "coaching" ? "coaching" : "working");
          setActiveId(active.id);
          if (active.coachee) setCoachName(active.coachee);
        }
      } catch (e) {
        console.error("Firebase load error", e);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [dateKey]);

  const persist = useCallback(
    async (next) => {
      setEntries(next);
      try {
        const dbRef = ref(database, `entries/${dateKey}`);
        await set(dbRef, next);
      } catch (e) {
        console.error("Firebase save error", e);
      }
    },
    [dateKey]
  );

  const activeEntry = entries.find((e) => e.id === activeId && !e.end);

  function startSegment(type, coachee) {
    const id = `${Date.now()}`;
    const entry = { id, type, start: new Date().toISOString(), end: null, ...(coachee ? { coachee } : {}) };
    const next = [...entries, entry];
    persist(next);
    setActiveId(id);
    setStatus(type === "break" ? "break" : type === "coaching" ? "coaching" : "working");
  }

  function endSegment() {
    if (!activeId) return;
    const next = entries.map((e) => (e.id === activeId ? { ...e, end: new Date().toISOString() } : e));
    persist(next);
    setActiveId(null);
    setStatus("idle");
  }

  function handleCoachSubmit() {
    if (!coachName.trim()) return;
    setShowCoachModal(false);
    startSegment("coaching", coachName.trim());
  }

  const totals = entries.reduce(
    (acc, e) => {
      const end = e.end ? new Date(e.end).getTime() : now;
      const start = new Date(e.start).getTime();
      const dur = end - start;
      acc[e.type] = (acc[e.type] || 0) + dur;
      return acc;
    },
    {}
  );

  const dayStart = entries.length ? new Date(entries[0].start) : null;
  const clockInTime = dayStart ? fmtTime(dayStart.toISOString()) : null;

  const statusMeta = {
    idle: { label: entries.length ? "Clocked out" : "Not clocked in", sub: "Ready when you are" },
    working: { label: "Working", sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
    break: { label: "On break", sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
    coaching: { label: `Coaching · ${activeEntry?.coachee || coachName}`, sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
  }[status];

  const totalSpan =
    entries.length > 0
      ? (entries[entries.length - 1].end ? new Date(entries[entries.length - 1].end).getTime() : now) -
        new Date(entries[0].start).getTime()
      : 0;

  return (
    <div
      style={{
        fontFamily: "'Montserrat', -apple-system, sans-serif",
        background: "#FBF9FD",
        minHeight: "100vh",
        padding: "24px 16px",
        color: COLORS.purple,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Viga&family=Montserrat:wght@400;500;600;700&display=swap');
        .viga { font-family: 'Viga', sans-serif; }
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: 0.4; }
        .btn { transition: transform 0.1s ease, box-shadow 0.15s ease; }
        .btn:active:not(:disabled) { transform: scale(0.97); }
        .fade-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
        input:focus { outline: 2px solid ${COLORS.purple}; outline-offset: 1px; }
      `}</style>

      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div className="viga" style={{ fontSize: 22, letterSpacing: 0.3 }}>
            MEC Time Log
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${COLORS.mauve}`,
                fontSize: 13,
                color: COLORS.purple,
                fontWeight: 600,
                background: "white",
              }}
            />
            <button
              onClick={() => setSelectedDate(todayKey())}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "none",
                background: COLORS.purple,
                color: "white",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Today
            </button>
          </div>
          <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 6 }}>
            {new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>

        <div
          style={{
            background: `linear-gradient(135deg, ${COLORS.purple}, ${COLORS.plum})`,
            borderRadius: 20,
            padding: "24px 22px",
            color: "white",
            marginBottom: 16,
            boxShadow: "0 8px 24px rgba(54,11,92,0.25)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: 1 }}>
            <Clock size={14} />
            {loading ? "Loading…" : clockInTime ? `Clocked in at ${clockInTime}` : "No activity yet today"}
          </div>
          <div className="viga fade-in" key={statusMeta.label} style={{ fontSize: 26, marginTop: 8, lineHeight: 1.2 }}>
            {statusMeta.label}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{statusMeta.sub}</div>
        </div>

        {selectedDate === todayKey() ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <ActionButton
              icon={<Play size={18} />}
              label="Clock in"
              onClick={() => startSegment("work")}
              disabled={status !== "idle"}
              color={COLORS.purple}
            />
            <ActionButton
              icon={<Coffee size={18} />}
              label={status === "break" ? "End break" : "Take a break"}
              onClick={() => (status === "break" ? (endSegment(), startSegment("work")) : (endSegment(), startSegment("break")))}
              disabled={status === "idle" || status === "coaching"}
              color={COLORS.mauve}
            />
            <ActionButton
              icon={<GraduationCap size={18} />}
              label={status === "coaching" ? "End session" : "Start coaching"}
              onClick={() => (status === "coaching" ? endSegment() : setShowCoachModal(true))}
              disabled={status === "idle"}
              color="#8E5FB8"
            />
            <ActionButton
              icon={<Square size={16} />}
              label="Clock out"
              onClick={endSegment}
              disabled={status === "idle"}
              color={COLORS.slate}
            />
          </div>
        ) : (
          <div style={{ background: COLORS.lavender, borderRadius: 12, padding: 12, marginBottom: 16, textAlign: "center", fontSize: 13, color: COLORS.slate }}>
            Viewing past logs — time tracking only available for today
          </div>
        )}

        {entries.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>TIMELINE</div>
            <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", background: COLORS.lavender }}>
              {entries.map((e) => {
                const end = e.end ? new Date(e.end).getTime() : now;
                const dur = end - new Date(e.start).getTime();
                const pct = totalSpan > 0 ? (dur / totalSpan) * 100 : 0;
                return (
                  <div
                    key={e.id}
                    title={`${SEGMENT_LABEL[e.type]} · ${fmtDuration(dur)}`}
                    style={{ width: `${pct}%`, background: SEGMENT_COLOR[e.type], minWidth: pct > 0 ? 2 : 0 }}
                  />
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: COLORS.slate, flexWrap: "wrap" }}>
              {["work", "break", "coaching"].map((t) =>
                totals[t] ? (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: SEGMENT_COLOR[t], display: "inline-block" }} />
                    {SEGMENT_LABEL[t]}: {fmtDuration(totals[t])}
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>ENTRIES</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: COLORS.slate, background: COLORS.lavender, borderRadius: 12, padding: 16, textAlign: "center" }}>
              No entries yet. Clock in to start your day.
            </div>
          )}
          {[...entries].reverse().map((e) => {
            const end = e.end ? new Date(e.end).getTime() : now;
            const dur = end - new Date(e.start).getTime();
            return (
              <div
                key={e.id}
                style={{
                  background: "white",
                  border: `1px solid ${COLORS.lavender}`,
                  borderLeft: `4px solid ${SEGMENT_COLOR[e.type]}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {e.type === "coaching" ? `Coaching — ${e.coachee}` : SEGMENT_LABEL[e.type]}
                  </div>
                  <div style={{ fontSize: 12, color: COLORS.slate }}>
                    {fmtTime(e.start)} – {e.end ? fmtTime(e.end) : "now"}
                  </div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: e.end ? COLORS.slate : SEGMENT_COLOR[e.type] }}>
                  {fmtDuration(dur)}
                  {!e.end && " ●"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCoachModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(54,11,92,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 50,
          }}
          onClick={() => setShowCoachModal(false)}
        >
          <div
            className="fade-in"
            style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="viga" style={{ fontSize: 18 }}>Start coaching session</div>
              <X size={18} onClick={() => setShowCoachModal(false)} style={{ cursor: "pointer", color: COLORS.slate }} />
            </div>
            <label style={{ fontSize: 12, color: COLORS.slate, fontWeight: 600 }}>COACHEE'S NAME</label>
            <input
              autoFocus
              value={coachName}
              onChange={(e) => setCoachName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCoachSubmit()}
              placeholder="e.g. Boluwatife Adegboyega"
              style={{
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${COLORS.mauve}`,
                fontSize: 14,
                marginBottom: 16,
              }}
            />
            <button
              className="btn"
              onClick={handleCoachSubmit}
              disabled={!coachName.trim()}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                border: "none",
                background: COLORS.purple,
                color: "white",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Start session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, color }) {
  return (
    <button
      className="btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "14px 10px",
        borderRadius: 14,
        border: "none",
        background: disabled ? "#EDE7F3" : color,
        color: disabled ? "#B8A4C8" : "white",
        fontSize: 13,
        fontWeight: 600,
        boxShadow: disabled ? "none" : "0 4px 10px rgba(54,11,92,0.15)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}


