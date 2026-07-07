/* ===================================================================
   D+J Consult SprachCoach — Client-Logik
   Web Speech API (STT + TTS), Timer, Gesprächsfluss, Analyse-Rendering
   =================================================================== */
(() => {
  "use strict";

  // ---------- DOM ----------
  const views = {
    start: document.getElementById("view-start"),
    conversation: document.getElementById("view-conversation"),
    analysis: document.getElementById("view-analysis"),
  };
  const el = {
    btnStart: document.getElementById("btn-start"),
    browserWarning: document.getElementById("browser-warning"),
    timer: document.getElementById("timer"),
    avatar: document.getElementById("avatar"),
    waveform: document.getElementById("waveform"),
    statusLine: document.getElementById("status-line"),
    toggleTranscript: document.getElementById("toggle-transcript"),
    liveTranscript: document.getElementById("live-transcript"),
    btnMic: document.getElementById("btn-mic"),
    micLabel: document.getElementById("mic-label"),
    btnEnd: document.getElementById("btn-end"),
    convHint: document.getElementById("conv-hint"),
    analysisLoading: document.getElementById("analysis-loading"),
    analysisError: document.getElementById("analysis-error"),
    analysisContent: document.getElementById("analysis-content"),
    analysisFooter: document.getElementById("analysis-footer"),
    btnExport: document.getElementById("btn-export"),
    btnRestart: document.getElementById("btn-restart"),
  };

  // ---------- Konstanten ----------
  const MIN_DURATION_SEC = 5 * 60; // 5 Minuten
  const FILLERS = ["ähm", "äh", "ehm", "hm", "halt", "sozusagen", "irgendwie",
    "quasi", "genau", "eigentlich", "also", "nun ja", "naja", "ja also"];

  // ---------- Zustand ----------
  const state = {
    messages: [],        // {role, content} für die API
    turns: [],           // {who:'coach'|'user', text} für Transkript
    startTime: null,
    elapsed: 0,
    timerId: null,
    recognizing: false,
    ended: false,
    userWordCount: 0,
    userSpeakingSec: 0,
    lastUserStart: null,
  };

  // ---------- Speech-Verfügbarkeit ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  let recognition = null;
  let germanVoice = null;

  function pickGermanVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    germanVoice =
      voices.find((v) => /de[-_]DE/i.test(v.lang) && /google/i.test(v.name)) ||
      voices.find((v) => /de[-_]DE/i.test(v.lang)) ||
      voices.find((v) => /^de/i.test(v.lang)) ||
      null;
  }
  if (synth) {
    pickGermanVoice();
    synth.addEventListener("voiceschanged", pickGermanVoice);
  }

  // Browser-Warnung, falls keine Spracherkennung verfügbar
  if (!SpeechRecognition) {
    el.browserWarning.hidden = false;
  }

  // ===================================================================
  //  View-Steuerung
  // ===================================================================
  function showView(name) {
    Object.values(views).forEach((v) => v.classList.remove("active"));
    views[name].classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ===================================================================
  //  Text-to-Speech
  // ===================================================================
  function speak(text) {
    return new Promise((resolve) => {
      if (!synth) { resolve(); return; }
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "de-DE";
      if (germanVoice) utter.voice = germanVoice;
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.onstart = () => setStatus("speaking");
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      synth.speak(utter);
    });
  }

  // ===================================================================
  //  Status-Anzeige
  // ===================================================================
  function setStatus(mode) {
    // mode: idle | listening | speaking | thinking
    el.avatar.classList.toggle("speaking", mode === "speaking");
    el.waveform.classList.toggle("active", mode === "listening" || mode === "speaking");
    const map = {
      idle: "Bereit …",
      listening: "Ich höre zu …",
      speaking: "Ich spreche …",
      thinking: "Einen Moment …",
    };
    el.statusLine.textContent = map[mode] || "";
  }

  // ===================================================================
  //  Timer
  // ===================================================================
  function startTimer() {
    state.startTime = Date.now();
    state.timerId = setInterval(tickTimer, 250);
  }
  function tickTimer() {
    state.elapsed = Math.floor((Date.now() - state.startTime) / 1000);
    const remaining = Math.max(0, MIN_DURATION_SEC - state.elapsed);
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    if (remaining > 0) {
      el.timer.textContent = `${m}:${s}`;
    } else {
      // Nach Ablauf: hochzählende Gesamtdauer anzeigen
      const tm = String(Math.floor(state.elapsed / 60)).padStart(2, "0");
      const ts = String(state.elapsed % 60).padStart(2, "0");
      el.timer.textContent = `${tm}:${ts}`;
      el.timer.classList.add("done");
      if (el.btnEnd.disabled) {
        el.btnEnd.disabled = false;
        el.convHint.textContent = "Mindestdauer erreicht – Sie können das Gespräch jetzt jederzeit beenden.";
      }
    }
  }

  // ===================================================================
  //  Transkript-Anzeige
  // ===================================================================
  function addTurn(who, text) {
    state.turns.push({ who, text });
    const div = document.createElement("div");
    div.className = `turn ${who}`;
    div.innerHTML = `<span class="who">${who === "coach" ? "SprachCoach" : "Sie"}</span>${escapeHtml(text)}`;
    el.liveTranscript.appendChild(div);
    el.liveTranscript.scrollTop = el.liveTranscript.scrollHeight;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ===================================================================
  //  Gesprächsfluss
  // ===================================================================
  async function coachTurn(phase) {
    setStatus("thinking");
    el.btnMic.disabled = true;
    let reply;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: state.messages, phase: phase || "main" }),
      });
      const data = await res.json();
      reply = data.reply || "Entschuldigung, könnten Sie das bitte wiederholen?";
    } catch (e) {
      reply = "Es scheint eine kurze technische Unterbrechung gegeben zu haben. Wo waren wir gerade?";
    }
    state.messages.push({ role: "assistant", content: reply });
    addTurn("coach", reply);
    await speak(reply);
    setStatus("idle");
    if (!state.ended) {
      el.btnMic.disabled = false;
    }
    return reply;
  }

  function handleUserUtterance(text) {
    const clean = text.trim();
    if (!clean) return;
    // Metriken erfassen
    const words = clean.split(/\s+/).filter(Boolean);
    state.userWordCount += words.length;
    state.messages.push({ role: "user", content: clean });
    addTurn("user", clean);
    coachTurn("main");
  }

  // ===================================================================
  //  Spracherkennung (STT)
  // ===================================================================
  function setupRecognition() {
    if (!SpeechRecognition) return null;
    const rec = new SpeechRecognition();
    rec.lang = "de-DE";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";

    rec.onstart = () => {
      state.recognizing = true;
      state.lastUserStart = Date.now();
      finalText = "";
      setStatus("listening");
      el.btnMic.classList.add("listening");
      el.micLabel.textContent = "⏹ Stopp";
    };
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      el.statusLine.textContent = "Ich höre zu … " + (finalText + interim).trim().slice(-80);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") {
        el.statusLine.textContent = "Ich habe nichts gehört – bitte erneut auf „Sprechen“ tippen.";
      } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        el.statusLine.textContent = "Kein Mikrofonzugriff. Bitte in den Browsereinstellungen erlauben.";
      }
    };
    rec.onend = () => {
      state.recognizing = false;
      el.btnMic.classList.remove("listening");
      el.micLabel.textContent = "🎤 Sprechen";
      if (state.lastUserStart) {
        state.userSpeakingSec += (Date.now() - state.lastUserStart) / 1000;
        state.lastUserStart = null;
      }
      const text = finalText.trim();
      if (text) {
        handleUserUtterance(text);
      } else {
        setStatus("idle");
      }
    };
    return rec;
  }

  function toggleMic() {
    if (!recognition) {
      // Kein STT: Text-Fallback per Prompt
      const typed = window.prompt("Spracherkennung ist in diesem Browser nicht verfügbar. Bitte tippen Sie Ihre Antwort:");
      if (typed) handleUserUtterance(typed);
      return;
    }
    if (state.recognizing) {
      recognition.stop();
    } else {
      if (synth) synth.cancel();
      try { recognition.start(); } catch (_) { /* bereits laufend */ }
    }
  }

  // ===================================================================
  //  Gespräch starten / beenden
  // ===================================================================
  async function startConversation() {
    // Mikrofon-Berechtigung anfragen (für saubere UX)
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch (_) {
        // Weiter – SpeechRecognition fragt ggf. selbst erneut
      }
    }
    recognition = setupRecognition();
    showView("conversation");
    startTimer();
    setStatus("idle");
    // Coach beginnt (Warm-up)
    await coachTurn("warmup");
  }

  async function endConversation() {
    if (state.ended) return;
    state.ended = true;
    if (state.recognizing && recognition) recognition.stop();
    if (synth) synth.cancel();
    clearInterval(state.timerId);
    el.btnMic.disabled = true;
    el.btnEnd.disabled = true;

    // Kurzer Abschluss durch den Coach (kein weiteres Warten auf Nutzer)
    setStatus("thinking");
    goToAnalysis();
  }

  // ===================================================================
  //  Analyse
  // ===================================================================
  function computeMetrics() {
    const durationMin = Math.max(0.1, state.elapsed / 60);
    const userText = state.turns.filter((t) => t.who === "user").map((t) => t.text).join(" ").toLowerCase();
    const words = userText.split(/\s+/).filter(Boolean);
    const unique = new Set(words);
    let fillerCount = 0;
    FILLERS.forEach((f) => {
      const re = new RegExp("(^|\\s)" + f.replace(/\s/g, "\\s") + "(\\s|$)", "g");
      const m = userText.match(re);
      if (m) fillerCount += m.length;
    });
    const speakMin = Math.max(0.1, state.userSpeakingSec / 60);
    return {
      gespraechsdauerMinuten: Number(durationMin.toFixed(1)),
      wortanzahlNutzer: state.userWordCount || words.length,
      unterschiedlicheWoerter: unique.size,
      typeTokenRatio: words.length ? Number((unique.size / words.length).toFixed(3)) : 0,
      fuellwoerterGesamt: fillerCount,
      fuellwoerterProMinute: Number((fillerCount / durationMin).toFixed(1)),
      sprechtempoWpm: Math.round((state.userWordCount || words.length) / speakMin),
      anzahlNutzerbeitraege: state.turns.filter((t) => t.who === "user").length,
    };
  }

  async function goToAnalysis() {
    showView("analysis");
    el.analysisLoading.hidden = false;
    el.analysisError.hidden = true;
    el.analysisContent.hidden = true;
    el.analysisFooter.hidden = true;

    const transcript = state.turns
      .map((t) => `${t.who === "coach" ? "SprachCoach" : "Nutzer"}: ${t.text}`)
      .join("\n");
    const metrics = computeMetrics();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript, metrics }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Fehler ${res.status}`);
      }
      const data = await res.json();
      renderAnalysis(data.analysis, metrics);
    } catch (e) {
      el.analysisLoading.hidden = true;
      el.analysisError.hidden = false;
      el.analysisError.innerHTML =
        `<h2>Analyse nicht möglich</h2><p>${escapeHtml(e.message)}</p>` +
        `<p style="margin-top:10px;color:#666">Hinweis: Für die KI-Analyse muss auf dem Server die Umgebungsvariable <code>ANTHROPIC_API_KEY</code> gesetzt sein.</p>`;
      el.analysisFooter.hidden = false;
    }
  }

  function bar(pct) {
    return `<div class="dim-bar"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
  }
  function stars(n) {
    const full = Math.max(0, Math.min(5, Math.round(n)));
    return "★".repeat(full) + "☆".repeat(5 - full);
  }

  function renderAnalysis(a, metrics) {
    el.analysisLoading.hidden = true;
    el.analysisError.hidden = true;
    el.analysisContent.hidden = false;
    el.analysisFooter.hidden = false;

    const dims = Array.isArray(a.dimensionen) ? a.dimensionen : [];
    const pct = Math.max(0, Math.min(100, a.gesamtScore || 0));

    let html = `
      <div class="result-header">
        <div class="brand-line">D+J Consult Sprachanalyse</div>
        <h1>Ihr persönliches Ergebnis</h1>
      </div>

      <div class="score-hero">
        <div class="score-ring" style="--pct:${pct}%">
          <div class="inner">
            <span class="num">${pct}</span>
            <span class="max">/ 100 Punkte</span>
          </div>
        </div>
        <div class="score-kat">${escapeHtml(a.kategorie || "")}</div>
        <p class="score-summary">${escapeHtml(a.zusammenfassung || "")}</p>
      </div>

      <div class="block dim-overview">
        <h2>📈 Dimensionsanalyse im Überblick</h2>
        ${dims.map((d) => `
          <div class="dim-row">
            <span class="dname">${escapeHtml(d.name || "")}</span>
            <span class="dscore">${d.score ?? "–"}/100</span>
            ${bar(d.score || 0)}
          </div>`).join("")}
      </div>

      <div class="block">
        <h2>🎯 Detailanalyse pro Dimension</h2>
        ${dims.map((d, i) => `
          <details class="dim-detail" ${i === 0 ? "open" : ""}>
            <summary>
              <span>${escapeHtml(d.name || "")}</span>
              <span class="meta"><span class="stars">${stars(d.sterne || 0)}</span> &nbsp; ${d.score ?? "–"}/100</span>
            </summary>
            <div class="dim-body">
              <h4>✅ Stärken</h4>
              <ul>${(d.staerken || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("") || "<li>–</li>"}</ul>
              <h4>⚠️ Entwicklungsfelder</h4>
              <ul>${(d.entwicklungsfelder || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("") || "<li>–</li>"}</ul>
              <h4>💡 Sofort umsetzbare Verbesserungsvorschläge</h4>
              ${(d.tipps || []).map((t) => `
                <div class="tipp">${escapeHtml(t.tipp || "")}
                  ${t.uebung ? `<div class="uebung">→ Übung: ${escapeHtml(t.uebung)}</div>` : ""}
                </div>`).join("") || "<p>–</p>"}
            </div>
          </details>`).join("")}
      </div>

      <div class="block">
        <h2>🏆 Top 3 Stärken</h2>
        <ol class="ranked">${(a.topStaerken || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      </div>

      <div class="block">
        <h2>📍 Prioritäre Entwicklungsfelder</h2>
        <ol class="ranked">${(a.prioritaereEntwicklungsfelder || []).map((f) =>
          `<li><strong>${escapeHtml(f.feld || "")}</strong><br>→ Empfohlene Maßnahme: ${escapeHtml(f.massnahme || "")}</li>`).join("")}</ol>
      </div>

      <div class="block">
        <h2>📋 Zusammenfassung &amp; nächste Schritte</h2>
        <ul class="checklist">${(a.naechsteSchritte || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
      </div>

      <div class="block" style="font-size:13px;color:#888">
        <em>Objektive Kennzahlen des Gesprächs:</em>
        Dauer ${metrics.gespraechsdauerMinuten} Min · ${metrics.wortanzahlNutzer} Wörter ·
        ${metrics.unterschiedlicheWoerter} unterschiedliche Wörter · Sprechtempo ~${metrics.sprechtempoWpm} WpM ·
        ${metrics.fuellwoerterProMinute} Füllwörter/Min.
      </div>
    `;
    el.analysisContent.innerHTML = html;
  }

  // ===================================================================
  //  Event-Listener
  // ===================================================================
  el.btnStart.addEventListener("click", () => {
    el.btnStart.disabled = true;
    startConversation().catch((e) => {
      console.error(e);
      el.btnStart.disabled = false;
    });
  });
  el.btnMic.addEventListener("click", toggleMic);
  el.btnEnd.addEventListener("click", endConversation);
  el.toggleTranscript.addEventListener("change", (e) => {
    el.liveTranscript.hidden = !e.target.checked;
  });
  el.btnExport.addEventListener("click", () => window.print());
  el.btnRestart.addEventListener("click", () => window.location.reload());

  // Manche Browser laden Stimmen erst nach Interaktion
  window.addEventListener("load", pickGermanVoice);
})();
