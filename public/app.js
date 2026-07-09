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
    btnRecord: document.getElementById("btn-record"),
    recordLabel: document.getElementById("record-label"),
    btnSend: document.getElementById("btn-send"),
    draftBox: document.getElementById("draft-box"),
    draftText: document.getElementById("draft-text"),
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
    recognizing: false,  // Spracherkennung läuft technisch
    recording: false,    // Nutzer ist im (selbstbestimmten) Aufnahmemodus
    pendingSend: false,  // Abschicken wartet auf sauberes Ende der Erkennung
    draft: "",           // bisher erkannter Text des aktuellen Redebeitrags
    ended: false,
    userWordCount: 0,
    userSpeakingSec: 0,
    lastUserStart: null,
    ttsAvailable: false, // ElevenLabs serverseitig konfiguriert?
    currentAudio: null,  // laufende ElevenLabs-Wiedergabe
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
  //  Text-to-Speech — ElevenLabs (bevorzugt) mit Browser-Fallback
  // ===================================================================
  async function speak(text) {
    if (!text || !text.trim()) return;
    // 1) ElevenLabs versuchen, falls serverseitig konfiguriert.
    if (state.ttsAvailable) {
      try {
        setStatus("speaking");
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const played = await playAudio(url, text);
          URL.revokeObjectURL(url);
          if (played) return;
          // Wiedergabe blockiert → einmalig Browser-TTS, aber ElevenLabs
          // grundsätzlich aktiv lassen.
          return browserSpeak(text);
        }
        // 503/andere Fehler → dauerhaft auf Browser-TTS umschalten.
        if (res.status === 503) state.ttsAvailable = false;
      } catch (_) {
        // Netzwerkfehler → Fallback
      }
    }
    // 2) Fallback: Browser-Sprachsynthese.
    return browserSpeak(text);
  }

  // Spielt die Audio-URL ab. Auflösung: true = erfolgreich abgespielt,
  // false = Wiedergabe wurde blockiert (Aufrufer soll Fallback nutzen).
  function playAudio(url) {
    return new Promise((resolve) => {
      stopSpeaking();
      const audio = new Audio(url);
      state.currentAudio = audio;
      setStatus("speaking");
      audio.onended = () => { state.currentAudio = null; resolve(true); };
      audio.onerror = () => { state.currentAudio = null; resolve(true); };
      audio.play()
        .then(() => { /* läuft; Auflösung via onended */ })
        .catch(() => { state.currentAudio = null; resolve(false); });
    });
  }

  function browserSpeak(text) {
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

  // Stoppt jede laufende Sprachausgabe (ElevenLabs-Audio oder Browser-TTS).
  function stopSpeaking() {
    if (state.currentAudio) {
      try { state.currentAudio.pause(); } catch (_) {}
      state.currentAudio = null;
    }
    if (synth) synth.cancel();
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

  // Feste, deterministische Eröffnung – erklärt Ablauf, Bedienung und Einstiegsthema.
  const INTRO_MESSAGE =
    "Herzlich willkommen bei D+J Consult! Ich bin Ihr persönlicher SprachCoach. " +
    "Wir führen jetzt gemeinsam ein lockeres Gespräch von etwa fünf Minuten – ganz natürlich, wie mit einem echten Gesprächspartner. " +
    "Anschließend werte ich Ihre Sprachkompetenz aus und gebe Ihnen konkrete Tipps. " +
    "Und so bedienen Sie das Ganze: Tippen Sie auf „Aufnahme starten“, sprechen Sie in Ruhe und so lange Sie möchten – auch Denkpausen sind kein Problem – und schicken Sie Ihren Beitrag erst dann mit „Abschicken“ ab. Erst danach antworte ich Ihnen, ich falle Ihnen also nie ins Wort. " +
    "Lassen Sie uns direkt beginnen: Erzählen Sie mir doch zum Einstieg kurz, was Sie beruflich machen – und was Sie heute zu dieser Sprachanalyse führt.";

  // ===================================================================
  //  Gesprächsfluss
  // ===================================================================
  // Eröffnung: fester Begrüßungstext, ohne KI-Aufruf – der Einstieg ist so
  // immer korrekt, verständlich und unabhängig von der API-Verfügbarkeit.
  async function coachIntro() {
    el.btnRecord.disabled = true;
    el.btnSend.disabled = true;
    // Nur anzeigen/vorlesen – NICHT in den API-Verlauf legen, damit dieser
    // (wie von der Anthropic-API verlangt) mit der ersten Nutzer-Nachricht beginnt.
    addTurn("coach", INTRO_MESSAGE);
    await speak(INTRO_MESSAGE);
    setStatus("idle");
    if (!state.ended) {
      el.btnRecord.disabled = false;
      el.statusLine.textContent = "Sie sind dran – tippen Sie auf „Aufnahme starten“.";
    }
  }

  async function coachTurn(phase) {
    setStatus("thinking");
    el.btnRecord.disabled = true;
    el.btnSend.disabled = true;
    let reply = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: state.messages, phase: phase || "main" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.reply) {
        reply = data.reply;
      } else {
        // API nicht verfügbar/Fehler: Gespräch mit neutraler Rückfrage am Laufen halten.
        reply =
          "Danke, das ist ein spannender Punkt. Können Sie das an einem konkreten Beispiel etwas genauer ausführen?";
        console.warn("chat API nicht ok:", res.status, data && data.error);
      }
    } catch (e) {
      reply =
        "Danke für Ihre Ausführung. Erzählen Sie mir gern noch etwas mehr dazu – was war Ihnen dabei besonders wichtig?";
    }
    state.messages.push({ role: "assistant", content: reply });
    addTurn("coach", reply);
    await speak(reply);
    setStatus("idle");
    if (!state.ended) {
      el.btnRecord.disabled = false;
      el.statusLine.textContent = "Sie sind dran – tippen Sie auf „Aufnahme starten“.";
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
  //  Spracherkennung (STT) — kontinuierlich, vom Nutzer gesteuert
  // ===================================================================
  let currentInterim = "";

  function setupRecognition() {
    if (!SpeechRecognition) return null;
    const rec = new SpeechRecognition();
    rec.lang = "de-DE";
    rec.continuous = true;      // läuft weiter – bricht nicht bei Sprechpausen ab
    rec.interimResults = true;

    rec.onstart = () => {
      state.recognizing = true;
      state.lastUserStart = Date.now();
    };
    rec.onresult = (event) => {
      currentInterim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) state.draft += r[0].transcript + " ";
        else currentInterim += r[0].transcript;
      }
      renderDraft();
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        state.recording = false;
        el.statusLine.textContent = "Kein Mikrofonzugriff. Bitte in den Browsereinstellungen erlauben.";
      }
      // "no-speech" ignorieren: onend startet ggf. neu, solange aufgenommen wird.
    };
    rec.onend = () => {
      state.recognizing = false;
      if (state.lastUserStart) {
        state.userSpeakingSec += (Date.now() - state.lastUserStart) / 1000;
        state.lastUserStart = null;
      }
      // Abschicken wurde ausgelöst → jetzt (nach Finalisierung) senden.
      if (state.pendingSend) {
        state.pendingSend = false;
        flushSend();
        return;
      }
      // Erkennung im Aufnahmemodus unerwartet beendet → automatisch fortsetzen.
      if (state.recording && !state.ended) {
        try { rec.start(); } catch (_) { /* Neustart folgt beim nächsten Tick */ }
      }
    };
    return rec;
  }

  // Zeigt den bisher erkannten Text im editierbaren Aufnahme-Feld.
  function renderDraft() {
    if (state.recognizing) {
      el.draftText.value = (state.draft + currentInterim).replace(/\s+/g, " ").trimStart();
    }
    const hasText = el.draftText.value.trim().length > 0;
    el.btnSend.disabled = !hasText;
    el.statusLine.textContent = state.recording
      ? "Aufnahme läuft … Sie bestimmen, wann Sie fertig sind."
      : "Aufnahme pausiert – „Abschicken“ oder erneut aufnehmen.";
  }

  // ---------- Aufnahme-Steuerung ----------
  function startRecording() {
    if (state.ended) return;
    stopSpeaking();                 // Coach soll nicht in die Aufnahme sprechen
    state.recording = true;
    setStatus("listening");
    el.draftBox.hidden = false;
    el.btnRecord.classList.add("recording");
    el.recordLabel.textContent = "⏸ Aufnahme pausieren";
    if (recognition) {
      try { recognition.start(); } catch (_) { /* läuft bereits */ }
      renderDraft();
    } else {
      // Kein STT im Browser → reine Texteingabe.
      el.draftText.removeAttribute("readonly");
      el.draftText.focus();
      el.statusLine.textContent = "Bitte tippen Sie Ihren Beitrag und klicken Sie auf „Abschicken“.";
    }
  }

  function pauseRecording() {
    state.recording = false;
    el.btnRecord.classList.remove("recording");
    el.recordLabel.textContent = "🎤 Aufnahme fortsetzen";
    if (recognition && state.recognizing) recognition.stop();
    setStatus("idle");
    renderDraft();
  }

  function toggleRecord() {
    if (state.recording) pauseRecording();
    else startRecording();
  }

  // Beitrag abschicken: Aufnahme sauber beenden, dann an die KI übergeben.
  function sendDraft() {
    if (el.btnSend.disabled) return;
    state.recording = false;
    el.btnRecord.classList.remove("recording");
    el.recordLabel.textContent = "🎤 Aufnahme starten";
    if (recognition && state.recognizing) {
      state.pendingSend = true;   // flushSend läuft in rec.onend nach Finalisierung
      recognition.stop();
    } else {
      flushSend();
    }
  }

  function flushSend() {
    const text = el.draftText.value.trim();
    // Feld zurücksetzen
    state.draft = "";
    currentInterim = "";
    el.draftText.value = "";
    el.draftBox.hidden = true;
    el.btnSend.disabled = true;
    if (text) {
      handleUserUtterance(text);
    } else {
      setStatus("idle");
      if (!state.ended) el.btnRecord.disabled = false;
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
    // TTS-Verfügbarkeit klären (ElevenLabs?).
    try {
      const h = await fetch("/api/health").then((r) => r.json());
      state.ttsAvailable = Boolean(h.ttsConfigured);
    } catch (_) {
      state.ttsAvailable = false;
    }
    showView("conversation");
    startTimer();
    setStatus("idle");
    // Coach beginnt mit fester, verständlicher Eröffnung (kein KI-Aufruf).
    await coachIntro();
  }

  async function endConversation() {
    if (state.ended) return;
    state.ended = true;
    state.recording = false;
    state.pendingSend = false;
    if (state.recognizing && recognition) recognition.stop();
    stopSpeaking();
    clearInterval(state.timerId);
    el.btnRecord.disabled = true;
    el.btnSend.disabled = true;
    el.btnEnd.disabled = true;
    el.draftBox.hidden = true;

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
  el.btnRecord.addEventListener("click", toggleRecord);
  el.btnSend.addEventListener("click", sendDraft);
  el.btnEnd.addEventListener("click", endConversation);
  // Manuelle Korrekturen im Aufnahme-Feld aktivieren den Abschicken-Button.
  el.draftText.addEventListener("input", () => {
    if (!state.recognizing) state.draft = el.draftText.value;
    el.btnSend.disabled = el.draftText.value.trim().length === 0;
  });
  el.toggleTranscript.addEventListener("change", (e) => {
    el.liveTranscript.hidden = !e.target.checked;
  });
  el.btnExport.addEventListener("click", () => window.print());
  el.btnRestart.addEventListener("click", () => window.location.reload());

  // Manche Browser laden Stimmen erst nach Interaktion
  window.addEventListener("load", pickGermanVoice);
})();
