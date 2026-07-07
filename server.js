import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ----------------------------------------------------------------------------
// Konfiguration
// ----------------------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
// Modelle konfigurierbar per Env – schnelle Antworten im Gespräch, starke Analyse.
const CHAT_MODEL = process.env.CHAT_MODEL || "claude-sonnet-5";
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

// ----------------------------------------------------------------------------
// System-Prompts
// ----------------------------------------------------------------------------
const CONVERSATION_SYSTEM_PROMPT = `Du bist "D+J SprachCoach", ein professioneller KI-Gesprächspartner der Firma D+J Consult.
Du führst ein natürliches, adaptives Gespräch auf Deutsch, um anschließend die Sprachkompetenz des Nutzers zu analysieren.

DEINE ROLLE IM GESPRÄCH:
- Sei natürlich, warm und professionell – wie ein echter, interessierter Mensch, nicht roboterhaft.
- Reagiere IMMER inhaltlich auf das, was der Nutzer tatsächlich sagt. Baue auf vorherigen Aussagen auf.
- Stelle vertiefende Nachfragen zu konkreten Inhalten, die der Nutzer erwähnt.
- Variiere Fragentypen: offene Fragen, Meinungsfragen, hypothetische Szenarien, Begründungsfragen, Reflexionsfragen.
- Demonstriere aktives Zuhören ("Sie sagten gerade ...", "Das knüpft an ... an").
- Halte deine eigenen Beiträge KURZ (1–3 Sätze). Keine langen Monologe. Der Nutzer soll möglichst viel sprechen.
- Zeige echtes Interesse, keine oberflächlichen "Ja, interessant"-Reaktionen.

GESPRÄCHSPHASEN:
1. Warm-up (Beginn): Freundliche Begrüßung, kurze Vorstellung, einfache Einstiegsfrage.
2. Hauptgespräch: Adaptives, vertiefendes Gespräch über berufliche/persönliche Themen, Meinungen, Szenarien.
3. Abschluss: Wenn dir signalisiert wird, dass das Gespräch endet, leite höflich zum Abschluss über und danke.

WICHTIG:
- Antworte ausschließlich mit deiner nächsten gesprochenen Gesprächsantwort (Text, der vorgelesen wird).
- Keine Meta-Kommentare, keine Bühnenanweisungen, keine Aufzählungszeichen. Nur natürliche gesprochene Sprache.`;

const ANALYSIS_SYSTEM_PROMPT = `Du bist der Sprachanalyse-Experte von D+J Consult. Analysiere das folgende Gesprächstranskript auf höchstem professionellem Niveau.

Der Nutzer hat per Sprache (Speech-to-Text) gesprochen; das Transkript kann daher Erkennungsungenauigkeiten enthalten. Prosodische/stimmliche und nonverbale Merkmale sind nur eingeschränkt aus dem Text ableitbar – nutze dafür die mitgelieferten Metriken (Sprechtempo, Füllwörter, Pausen) und markiere Einschätzungen dazu vorsichtig, aber liefere trotzdem eine fundierte Bewertung.

Analysiere folgende 7 Dimensionen:
1. Stimmliche Qualität (Prosodie/Tonlage) – Modulation, Tempo, Melodie, Betonung, Stimmkraft, emotionale Färbung
2. Wortschatz (Lexikalisch) – Breite, Tiefe, Füllwörter, Wiederholungen, Fach- vs. Alltagssprache, bildhafte Sprache
3. Satzgestaltung (Syntaktisch) – Komplexität, Vollständigkeit, Länge/Variation, Grammatik, Satzverbindungen
4. Kommunikative Kompetenz (Pragmatisch) – Kohärenz, Kohäsion, Dialogfähigkeit, Argumentation, Perspektivwechsel, Relevanz
5. Rhetorik – Überzeugungskraft, Strukturierung, Beispielgebung, Zuhörerorientierung, Spannungsaufbau
6. Emotionale Intelligenz – Empathie, Selbstoffenbarung, Beziehungsgestaltung, Emotionsregulation, positive Sprache
7. Nonverbale Sprachmerkmale – Atemführung, Pausen (strategisch vs. unsicher), Lautstärke-Variation, unbewusste Laute (soweit ableitbar)

Antworte AUSSCHLIESSLICH mit gültigem JSON (kein Markdown, keine Code-Fences) in exakt dieser Struktur:
{
  "gesamtScore": <0-100 int>,
  "kategorie": "<Exzellent|Sehr gut|Gut|Befriedigend|Ausbaufähig|Intensivförderung>",
  "zusammenfassung": "<2-3 Sätze Gesamteinschätzung>",
  "dimensionen": [
    {
      "name": "Stimmliche Qualität",
      "score": <0-100 int>,
      "sterne": <1-5 int>,
      "staerken": ["<konkrete Stärke mit Beispiel/Zitat aus dem Gespräch>", "..."],
      "entwicklungsfelder": ["<konkretes Entwicklungsfeld mit Beispiel>", "..."],
      "tipps": [
        { "tipp": "<konkreter Verbesserungsvorschlag>", "uebung": "<praktische Übung>" }
      ]
    }
    // ... alle 7 Dimensionen in dieser Reihenfolge
  ],
  "topStaerken": ["<größte Stärke mit Begründung>", "<zweite>", "<dritte>"],
  "prioritaereEntwicklungsfelder": [
    { "feld": "<wichtigstes Entwicklungsfeld>", "massnahme": "<empfohlene Maßnahme>" }
  ],
  "naechsteSchritte": ["<konkrete Empfehlung 1>", "<2>", "<3>"]
}

Alle 7 Dimensionen müssen enthalten sein. Belege Stärken und Entwicklungsfelder mit konkreten Bezügen/Zitaten aus dem Transkript. Sei präzise, professionell und ermutigend.`;

// ----------------------------------------------------------------------------
// Anthropic-Aufruf
// ----------------------------------------------------------------------------
async function callAnthropic({ model, system, messages, maxTokens, temperature }) {
  if (!ANTHROPIC_API_KEY) {
    const err = new Error("ANTHROPIC_API_KEY ist nicht gesetzt.");
    err.code = "NO_API_KEY";
    throw err;
  }
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Anthropic API-Fehler ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}

// ----------------------------------------------------------------------------
// Fallback-Gesprächslogik (falls kein API-Key konfiguriert ist)
// ----------------------------------------------------------------------------
const FALLBACK_QUESTIONS = [
  "Herzlich willkommen bei D+J Consult! Ich bin Ihr virtueller Gesprächspartner für die heutige Sprachanalyse. Bevor wir beginnen – was hat Sie dazu bewogen, Ihre Sprachkompetenz heute analysieren zu lassen?",
  "Das ist ein interessanter Ausgangspunkt. Erzählen Sie mir doch: Was machen Sie beruflich, und welche Rolle spielt Kommunikation dabei?",
  "Können Sie mir ein konkretes Beispiel aus Ihrem Alltag beschreiben, in dem gute Kommunikation den Unterschied gemacht hat?",
  "Interessant. Wenn Sie einem Fachfremden erklären müssten, warum dieses Thema wichtig ist – wie würden Sie beginnen?",
  "Angenommen, Sie hätten unbegrenzte Möglichkeiten, etwas an Ihrer Kommunikation zu verändern – was wäre Ihr erster Schritt?",
  "Das klingt durchdacht. Gab es einen Moment, der Sie in dieser Hinsicht besonders geprägt hat?",
  "Wie würden Sie selbst Ihre größten Stärken beim Sprechen und Zuhören beschreiben?",
  "Wir kommen langsam zum Ende. Was nehmen Sie aus unserem Gespräch heute für sich mit?",
];

app.post("/api/chat", async (req, res) => {
  const { messages = [], phase = "main" } = req.body || {};
  try {
    let systemPrompt = CONVERSATION_SYSTEM_PROMPT;
    if (phase === "closing") {
      systemPrompt +=
        "\n\nHINWEIS: Das Gespräch soll jetzt zum Abschluss kommen. Frage, ob der Nutzer noch etwas ergänzen möchte, und leite freundlich zum Abschluss über.";
    }
    const text = await callAnthropic({
      model: CHAT_MODEL,
      system: systemPrompt,
      messages,
      maxTokens: 400,
      temperature: 0.8,
    });
    res.json({ reply: text.trim(), source: "ai" });
  } catch (e) {
    if (e.code === "NO_API_KEY") {
      // Regelbasierter Fallback: nächste Frage anhand der Anzahl bisheriger KI-Antworten
      const aiTurns = messages.filter((m) => m.role === "assistant").length;
      const idx = Math.min(aiTurns, FALLBACK_QUESTIONS.length - 1);
      return res.json({ reply: FALLBACK_QUESTIONS[idx], source: "fallback" });
    }
    console.error("chat error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/analyze", async (req, res) => {
  const { transcript = "", metrics = {} } = req.body || {};
  try {
    const userContent = `GESPRÄCHSTRANSKRIPT:\n${transcript}\n\nOBJEKTIVE METRIKEN (clientseitig gemessen):\n${JSON.stringify(
      metrics,
      null,
      2
    )}\n\nErstelle nun die vollständige Sprachanalyse als JSON.`;

    const text = await callAnthropic({
      model: ANALYSIS_MODEL,
      system: ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 4000,
      temperature: 0.4,
    });

    const analysis = extractJson(text);
    if (!analysis) {
      return res.status(502).json({ error: "Analyse konnte nicht als JSON gelesen werden." });
    }
    res.json({ analysis, source: "ai" });
  } catch (e) {
    if (e.code === "NO_API_KEY") {
      return res.status(503).json({
        error:
          "Für die KI-Analyse muss die Umgebungsvariable ANTHROPIC_API_KEY gesetzt sein.",
        code: "NO_API_KEY",
      });
    }
    console.error("analyze error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Robust: extrahiert das erste vollständige JSON-Objekt aus einer Antwort.
function extractJson(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Entferne evtl. Code-Fences.
  cleaned = cleaned.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", aiConfigured: Boolean(ANTHROPIC_API_KEY) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`D+J SprachCoach läuft auf Port ${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn(
      "⚠  ANTHROPIC_API_KEY nicht gesetzt – Gespräch läuft im Fallback-Modus, Analyse ist deaktiviert."
    );
  }
});
