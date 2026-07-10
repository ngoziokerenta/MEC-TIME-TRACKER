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

// Firebase config from environment variables
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

  // Load from Firebase
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
    setStatus("idle
