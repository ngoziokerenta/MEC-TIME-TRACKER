import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Play,
  Coffee,
  Square,
  GraduationCap,
  Clock,
  X,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  CalendarDays,
} from "lucide-react";
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

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);
const app = hasFirebaseConfig ? initializeApp(firebaseConfig) : null;
const database = app ? getDatabase(app) : null;

const LOCAL_STORAGE_PREFIX = "mec-time-log:";

function todayKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateKey, amount) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return todayKey(date);
}

function readLocalDay(day) {
  try {
    const value = window.localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${day}`);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Local history read error", error);
    return [];
  }
}

function writeLocalDay(day, entriesArr) {
  try {
    window.localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${day}`, JSON.stringify(entriesArr));
    return true;
  } catch (error) {
    console.error("Local history write error", error);
    return false;
  }
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

function effectiveEnd(entry, dateKey, currentTime) {
  if (entry.end) return new Date(entry.end).getTime();
  if (dateKey === todayKey()) return currentTime;
  return new Date(dateKey + "T23:59:59").getTime();
}

async function writeDayEntries(day, entriesArr) {
  writeLocalDay(day, entriesArr);
  if (!database) throw new Error("Firebase is not configured");
  const dbRef = ref(database, `entries/${day}`);
  await set(dbRef, entriesArr);
}

export default function TimeTracker() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");
  const [activeId, setActiveId] = useState(null);
  const [coachName, setCoachName] = useState("");
  const [showCoachModal, setShowCoachModal] = useState(false);
  const [showMidnightPrompt, setShowMidnightPrompt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [viewMode, setViewMode] = useState("today");
  const [syncStatus, setSyncStatus] = useState("checking");
  const [syncMessage, setSyncMessage] = useState("");
  const dateKey = selectedDate;

  const activeEntry = entries.find((e) => e.id === activeId && !e.end);

  const activeEntryRef = useRef(null);
  const entriesRef = useRef([]);
  const promptedRef = useRef(false);
  const autoCloseTimerRef = useRef(null);
  const selectedDateRef = useRef(selectedDate);
  const isLiveRef = useRef(true);

  useEffect(() => {
    activeEntryRef.current = activeEntry;
  }, [activeEntry]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    const t = setInterval(() => setRefreshKey((k) => k + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const cachedEntries = readLocalDay(dateKey);
      if (!cancelled) setEntries(cachedEntries);

      try {
        if (!database) throw new Error("Firebase is not configured");
        const dbRef = ref(database, `entries/${dateKey}`);
        const snapshot = await get(dbRef);
        let data = snapshot.exists() ? snapshot.val() : [];
        data = Array.isArray(data) ? data : [];

        // If an earlier cloud save failed, restore the local copy to Firebase
        // instead of replacing valid local history with an empty response.
        if (!data.length && cachedEntries.length) {
          await set(dbRef, cachedEntries);
          data = cachedEntries;
        }

        if (cancelled) return;
        setEntries(data);
        writeLocalDay(dateKey, data);
        setSyncStatus("synced");
        setSyncMessage("");
        const active = data.find((e) => !e.end);
        if (active && dateKey === todayKey()) {
          setStatus(active.type === "break" ? "break" : active.type === "coaching" ? "coaching" : "working");
          setActiveId(active.id);
          if (active.coachee) setCoachName(active.coachee);
        } else {
          setStatus("idle");
          setActiveId(null);
        }
      } catch (e) {
        console.error("Firebase load error", e);
        if (cancelled) return;
        setEntries(cachedEntries);
        setSyncStatus("local");
        setSyncMessage(
          cachedEntries.length
            ? "Cloud sync is unavailable. Your history is still saved on this device."
            : "Cloud sync is unavailable. New entries will be saved on this device."
        );

        const active = cachedEntries.find((entry) => !entry.end);
        if (active && dateKey === todayKey()) {
          setStatus(active.type === "break" ? "break" : active.type === "coaching" ? "coaching" : "working");
          setActiveId(active.id);
          if (active.coachee) setCoachName(active.coachee);
        } else {
          setStatus("idle");
          setActiveId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  const persist = useCallback(
    async (next) => {
      setEntries(next);
      const savedLocally = writeLocalDay(dateKey, next);
      setSyncStatus("saving");
      setSyncMessage("");
      try {
        if (!database) throw new Error("Firebase is not configured");
        const dbRef = ref(database, `entries/${dateKey}`);
        await set(dbRef, next);
        setSyncStatus("synced");
      } catch (e) {
        console.error("Firebase save error", e);
        setSyncStatus(savedLocally ? "local" : "error");
        setSyncMessage(
          savedLocally
            ? "Saved on this device, but cloud sync failed. Check your Firebase settings."
            : "This entry could not be saved. Please try again."
        );
      }
    },
    [dateKey]
  );

  const deleteEntry = (id) => {
    if (!window.confirm("Delete this time entry? This cannot be undone.")) return;
    const next = entries.filter((e) => e.id !== id);
    persist(next);
    if (id === activeId) {
      setActiveId(null);
      setStatus("idle");
    }
  };

  function requestNotificationPermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }

  function switchSegment(newType, coachee) {
    requestNotificationPermission();
    const nowIso = new Date().toISOString();
    const newId = `${Date.now()}`;

    let next = entries;
    if (activeId) {
      next = next.map((e) => (e.id === activeId ? { ...e, end: nowIso } : e));
    }
    const entry = { id: newId, type: newType, start: nowIso, end: null, ...(coachee ? { coachee } : {}) };
    next = [...next, entry];

    persist(next);
    setActiveId(newId);
    setStatus(newType === "break" ? "break" : newType === "coaching" ? "coaching" : "working");
  }

  function stopActive() {
    if (!activeId) return;
    const nowIso = new Date().toISOString();
    const next = entries.map((e) => (e.id === activeId ? { ...e, end: nowIso } : e));
    persist(next);
    setActiveId(null);
    setStatus("idle");
  }

  function handleCoachSubmit() {
    if (!coachName.trim()) return;
    setShowCoachModal(false);
    switchSegment("coaching", coachName.trim());
  }

  // Midnight rollover watcher: checks every 30s whether the active entry
  // started on a day that is no longer "today". If so, prompt the user
  // both in-app and via a system notification, and auto-close after 10 min
  // if there's no response.
  useEffect(() => {
    function check() {
      const entry = activeEntryRef.current;

      // If idle and just sitting on "today" as it rolls over, quietly
      // move the view forward to the new day (only when the user hasn't
      // manually browsed to a specific past date).
      if (!entry && isLiveRef.current && selectedDateRef.current !== todayKey()) {
        setSelectedDate(todayKey());
      }

      if (!entry || promptedRef.current) return;
      const entryDay = todayKey(new Date(entry.start));
      if (entryDay !== todayKey()) {
        promptedRef.current = true;
        setShowMidnightPrompt(true);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            const n = new Notification("👀 Still burning the midnight oil?", {
              body: "It's a new day and MEC Time Log still has you clocked in! Pop back in to confirm — otherwise I'll tuck yesterday into bed in 10 minutes.",
              requireInteraction: true,
            });
            n.onclick = () => {
              window.focus();
            };
          } catch (err) {
            console.error("Notification error", err);
          }
        }
        autoCloseTimerRef.current = setTimeout(() => {
          finalizeCarryOver(false);
        }, 10 * 60 * 1000);
      }
    }
    const interval = setInterval(check, 30000);
    check();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function finalizeCarryOver(stillWorking) {
    setShowMidnightPrompt(false);
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    const entry = activeEntryRef.current;
    if (!entry) {
      promptedRef.current = false;
      return;
    }
    const entryDay = todayKey(new Date(entry.start));
    const closedEnd = new Date(entryDay + "T23:59:59").toISOString();
    const oldDayEntries = entriesRef.current.map((e) => (e.id === entry.id ? { ...e, end: closedEnd } : e));
    try {
      await writeDayEntries(entryDay, oldDayEntries);
      setSyncStatus("synced");
      setSyncMessage("");
    } catch (error) {
      console.error("Midnight history sync error", error);
      setSyncStatus("local");
      setSyncMessage("The midnight update is saved on this device, but cloud sync failed.");
    }

    if (stillWorking) {
      const newDay = todayKey();
      const newId = `${Date.now()}`;
      const newEntry = {
        id: newId,
        type: entry.type,
        start: new Date().toISOString(),
        end: null,
        ...(entry.coachee ? { coachee: entry.coachee } : {}),
      };
      try {
        await writeDayEntries(newDay, [newEntry]);
      } catch (error) {
        console.error("New day sync error", error);
        setSyncStatus("local");
        setSyncMessage("The new day is saved on this device, but cloud sync failed.");
      }
      isLiveRef.current = true;
      setViewMode("today");
      setSelectedDate(newDay);
    } else {
      setStatus("idle");
      setActiveId(null);
      if (selectedDate === entryDay) {
        setEntries(oldDayEntries);
      }
    }
    promptedRef.current = false;
  }

  const currentTime = Date.now();
  const isToday = dateKey === todayKey();

  const totals = entries.reduce((acc, e) => {
    const start = new Date(e.start).getTime();
    const end = effectiveEnd(e, dateKey, currentTime);
    const dur = Math.max(0, end - start);
    acc[e.type] = (acc[e.type] || 0) + dur;
    return acc;
  }, {});

  const dayStart = entries.length ? new Date(entries[0].start) : null;
  const clockInTime = dayStart ? fmtTime(dayStart.toISOString()) : null;

  const statusMeta = {
    idle: {
      label: entries.length ? (isToday ? "Clocked out" : "Day completed") : isToday ? "Not clocked in" : "No saved activity",
      sub: isToday ? "Ready when you are" : entries.length ? "Review the day's activity below" : "Choose another date to review",
    },
    working: { label: "Working", sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
    break: { label: "On break", sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
    coaching: { label: `Coaching · ${activeEntry?.coachee || coachName}`, sub: activeEntry ? `Since ${fmtTime(activeEntry.start)}` : "" },
  }[status];

  const totalSpan =
    entries.length > 0
      ? effectiveEnd(entries[entries.length - 1], dateKey, currentTime) - new Date(entries[0].start).getTime()
      : 0;

  return (
    <div style={{ fontFamily: "'Montserrat', -apple-system, sans-serif", background: "#FBF9FD", minHeight: "100vh", padding: "24px 16px", color: COLORS.purple }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Viga&family=Montserrat:wght@400;500;600;700&display=swap');
        .viga { font-family: 'Viga', sans-serif; }
        * { box-sizing: border-box; }
        button { font-family: inherit; cursor: pointer; }
        button:disabled { cursor: not-allowed; opacity: 0.4; }
        .btn { transition: transform 0.1s ease, box-shadow 0.15s ease; }
        .btn:active:not(:disabled) { transform: scale(0.97); }
        .tab { transition: background 0.15s ease, color 0.15s ease; }
        .fade-in { animation: fadeIn 0.3s ease; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px);} to { opacity: 1; transform: translateY(0);} }
        input:focus { outline: 2px solid ${COLORS.purple}; outline-offset: 1px; }
        @media (max-width: 420px) {
          .date-label { display: none; }
        }
      `}</style>

      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div className="viga" style={{ fontSize: 22, letterSpacing: 0.3 }}>MEC Time Log</div>
            <SyncBadge status={syncStatus} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: COLORS.lavender, borderRadius: 12, padding: 4, marginTop: 14 }}>
            <button
              className="tab"
              onClick={() => {
                setViewMode("today");
                setSelectedDate(todayKey());
                isLiveRef.current = true;
              }}
              style={{ border: "none", borderRadius: 9, padding: "9px 12px", background: viewMode === "today" ? "white" : "transparent", color: COLORS.purple, fontWeight: 700, boxShadow: viewMode === "today" ? "0 2px 8px rgba(54,11,92,0.08)" : "none" }}
            >
              Today
            </button>
            <button
              className="tab"
              onClick={() => {
                setViewMode("history");
                isLiveRef.current = false;
              }}
              style={{ border: "none", borderRadius: 9, padding: "9px 12px", background: viewMode === "history" ? "white" : "transparent", color: COLORS.purple, fontWeight: 700, boxShadow: viewMode === "history" ? "0 2px 8px rgba(54,11,92,0.08)" : "none" }}
            >
              History
            </button>
          </div>

          {viewMode === "history" ? (
            <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 40px", alignItems: "center", gap: 8, marginTop: 12 }}>
              <button aria-label="Previous day" onClick={() => setSelectedDate(shiftDate(selectedDate, -1))} style={{ height: 38, borderRadius: 10, border: `1px solid ${COLORS.lavender}`, background: "white", color: COLORS.purple, display: "grid", placeItems: "center" }}><ChevronLeft size={18} /></button>
              <label style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <CalendarDays size={16} style={{ position: "absolute", left: 12, color: COLORS.slate, pointerEvents: "none" }} />
                <input aria-label="History date" type="date" value={selectedDate} max={todayKey()} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: "100%", height: 38, padding: "6px 10px 6px 38px", borderRadius: 10, border: `1px solid ${COLORS.mauve}`, fontSize: 13, color: COLORS.purple, fontWeight: 600, background: "white" }} />
              </label>
              <button aria-label="Next day" disabled={selectedDate >= todayKey()} onClick={() => setSelectedDate(shiftDate(selectedDate, 1))} style={{ height: 38, borderRadius: 10, border: `1px solid ${COLORS.lavender}`, background: "white", color: COLORS.purple, display: "grid", placeItems: "center" }}><ChevronRight size={18} /></button>
            </div>
          ) : null}

          <div className="date-label" style={{ fontSize: 13, color: COLORS.slate, marginTop: 8 }}>
            {new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>

        {syncMessage && (
          <div role="status" style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "#FFF7E8", color: "#704C00", border: "1px solid #F2D28F", borderRadius: 12, padding: "10px 12px", fontSize: 12, lineHeight: 1.45, marginBottom: 14 }}>
            <CloudOff size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
            <span>{syncMessage}</span>
          </div>
        )}

        <div style={{ background: `linear-gradient(135deg, ${COLORS.purple}, ${COLORS.plum})`, borderRadius: 20, padding: "24px 22px", color: "white", marginBottom: 16, boxShadow: "0 8px 24px rgba(54,11,92,0.25)" }} key={refreshKey}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: 0.85, textTransform: "uppercase", letterSpacing: 1 }}>
            <Clock size={14} />
            {loading ? "Loading…" : clockInTime ? `First clock-in at ${clockInTime}` : isToday ? "No activity yet today" : "No activity saved for this date"}
          </div>
          <div className="viga fade-in" key={statusMeta.label} style={{ fontSize: 26, marginTop: 8, lineHeight: 1.2 }}>{statusMeta.label}</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>{statusMeta.sub}</div>
        </div>

        {viewMode === "today" && isToday ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
            <ActionButton icon={<Play size={18} />} label="Clock in" onClick={() => switchSegment("work")} disabled={status !== "idle"} color={COLORS.purple} />
            <ActionButton icon={<Coffee size={18} />} label={status === "break" ? "End break" : "Take a break"} onClick={() => switchSegment(status === "break" ? "work" : "break")} disabled={status === "idle" || status === "coaching"} color={COLORS.mauve} />
            <ActionButton icon={<GraduationCap size={18} />} label={status === "coaching" ? "End session" : "Start coaching"} onClick={() => (status === "coaching" ? stopActive() : setShowCoachModal(true))} disabled={status === "idle"} color="#8E5FB8" />
            <ActionButton icon={<Square size={16} />} label="Clock out" onClick={stopActive} disabled={status === "idle"} color={COLORS.slate} />
          </div>
        ) : null}

        {viewMode === "history" && entries.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            <SummaryCard label="WORK + COACHING" value={fmtDuration((totals.work || 0) + (totals.coaching || 0))} />
            <SummaryCard label="BREAKS" value={fmtDuration(totals.break || 0)} />
            <SummaryCard label="FIRST IN" value={clockInTime || "—"} />
            <SummaryCard label="DAY SPAN" value={fmtDuration(totalSpan)} />
          </div>
        )}

        {entries.length > 0 && (
          <div style={{ marginBottom: 16 }} key={`timeline-${refreshKey}`}>
            <div style={{ fontSize: 12, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>TIMELINE</div>
            <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", background: COLORS.lavender }}>
              {entries.map((e) => {
                const start = new Date(e.start).getTime();
                const end = effectiveEnd(e, dateKey, currentTime);
                const dur = Math.max(0, end - start);
                const pct = totalSpan > 0 ? (dur / totalSpan) * 100 : 0;
                return <div key={e.id} title={`${SEGMENT_LABEL[e.type]} · ${fmtDuration(dur)}`} style={{ width: `${pct}%`, background: SEGMENT_COLOR[e.type], minWidth: pct > 0 ? 2 : 0 }} />;
              })}
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontSize: 11, color: COLORS.slate, flexWrap: "wrap" }}>
              {["work", "break", "coaching"].map((t) =>
                totals[t] ? <div key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: SEGMENT_COLOR[t], display: "inline-block" }} />{SEGMENT_LABEL[t]}: {fmtDuration(totals[t])}</div> : null
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: COLORS.slate, marginBottom: 6, fontWeight: 600 }}>ENTRIES</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }} key={`entries-${refreshKey}`}>
          {entries.length === 0 && !loading && <div style={{ fontSize: 13, color: COLORS.slate, background: COLORS.lavender, borderRadius: 12, padding: 16, textAlign: "center" }}>{isToday ? "No entries yet. Clock in to start your day." : "No saved entries for this date."}</div>}
          {[...entries].reverse().map((e) => {
            const startTime = new Date(e.start).getTime();
            const endTime = effectiveEnd(e, dateKey, currentTime);
            const dur = Math.max(0, endTime - startTime);
            const stillOpen = !e.end;
            return (
              <div key={e.id} style={{ background: "white", border: `1px solid ${COLORS.lavender}`, borderLeft: `4px solid ${SEGMENT_COLOR[e.type]}`, borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{e.type === "coaching" ? `Coaching — ${e.coachee}` : SEGMENT_LABEL[e.type]}</div>
                  <div style={{ fontSize: 12, color: COLORS.slate }}>{fmtTime(e.start)} – {e.end ? fmtTime(e.end) : "now"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: e.end ? COLORS.slate : SEGMENT_COLOR[e.type], minWidth: 60, textAlign: "right" }}>{fmtDuration(dur)}{stillOpen && dateKey === todayKey() && " ●"}</div>
                  <button onClick={() => deleteEntry(e.id)} style={{ background: "none", border: "none", color: COLORS.slate, cursor: "pointer", padding: "4px", display: "flex", alignItems: "center" }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showCoachModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(54,11,92,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={() => setShowCoachModal(false)}>
          <div className="fade-in" style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="viga" style={{ fontSize: 18 }}>Start coaching session</div>
              <X size={18} onClick={() => setShowCoachModal(false)} style={{ cursor: "pointer", color: COLORS.slate }} />
            </div>
            <label style={{ fontSize: 12, color: COLORS.slate, fontWeight: 600 }}>COACHEE'S NAME</label>
            <input autoFocus value={coachName} onChange={(e) => setCoachName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCoachSubmit()} placeholder="e.g. Client or participant name" style={{ width: "100%", marginTop: 6, padding: "10px 12px", borderRadius: 10, border: `1px solid ${COLORS.mauve}`, fontSize: 14, marginBottom: 16 }} />
            <button className="btn" onClick={handleCoachSubmit} disabled={!coachName.trim()} style={{ width: "100%", padding: "12px", borderRadius: 10, border: "none", background: COLORS.purple, color: "white", fontWeight: 600, fontSize: 14 }}>Start session</button>
          </div>
        </div>
      )}

      {showMidnightPrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(54,11,92,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60 }}>
          <div className="fade-in" style={{ background: "white", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380 }}>
            <div className="viga" style={{ fontSize: 18, marginBottom: 8 }}>👀 Still going?</div>
            <div style={{ fontSize: 13, color: COLORS.slate, marginBottom: 20, lineHeight: 1.5 }}>
              Midnight came and went and you're still clocked in! Are you genuinely still at it, or did the day just quietly slip away? If I don't hear from you in 10 minutes, I'll close yesterday out for you at 11:59 PM.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn" onClick={() => finalizeCarryOver(false)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: `1px solid ${COLORS.mauve}`, background: "white", color: COLORS.purple, fontWeight: 600, fontSize: 14 }}>🌙 No, done for the day</button>
              <button className="btn" onClick={() => finalizeCarryOver(true)} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "none", background: COLORS.purple, color: "white", fontWeight: 600, fontSize: 14 }}>☕ Yes, still working</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, color }) {
  return (
    <button className="btn" onClick={onClick} disabled={disabled} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 10px", borderRadius: 14, border: "none", background: disabled ? "#EDE7F3" : color, color: disabled ? "#B8A4C8" : "white", fontSize: 13, fontWeight: 600, boxShadow: disabled ? "none" : "0 4px 10px rgba(54,11,92,0.15)" }}>
      {icon}
      {label}
    </button>
  );
}

function SyncBadge({ status }) {
  const meta = {
    checking: { label: "Checking", icon: <Cloud size={14} />, background: COLORS.lavender, color: COLORS.slate },
    saving: { label: "Saving", icon: <Cloud size={14} />, background: COLORS.lavender, color: COLORS.slate },
    synced: { label: "Synced", icon: <Cloud size={14} />, background: "#EAF7EF", color: "#25613B" },
    local: { label: "On device", icon: <CloudOff size={14} />, background: "#FFF7E8", color: "#704C00" },
    error: { label: "Not saved", icon: <CloudOff size={14} />, background: "#FDECEC", color: "#8B2525" },
  }[status];

  return (
    <div title={status === "local" ? "Cloud sync unavailable; using this device's storage" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 999, background: meta.background, color: meta.color, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>
      {meta.icon}
      {meta.label}
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div style={{ background: "white", border: `1px solid ${COLORS.lavender}`, borderRadius: 12, padding: "11px 12px" }}>
      <div style={{ fontSize: 10, color: COLORS.slate, fontWeight: 700, letterSpacing: 0.45 }}>{label}</div>
      <div className="viga" style={{ fontSize: 17, color: COLORS.purple, marginTop: 3 }}>{value}</div>
    </div>
  );
}
