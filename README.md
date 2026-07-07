# D+J Consult — SprachCoach

Eine interaktive **Sprachanalyse-Plattform** von D+J Consult. Der virtuelle
Gesprächspartner führt ein mindestens fünfminütiges, adaptives Gespräch auf
Deutsch und erstellt anschließend eine umfassende Analyse der Sprachkompetenz
über **sieben Dimensionen** – mit konkreten, sofort umsetzbaren
Verbesserungsvorschlägen.

## Funktionen

- 🎙️ **Echtzeit-Sprachgespräch** über die Web Speech API (Speech-to-Text `de-DE`)
- 🔊 **Natürliche deutsche Sprachausgabe** über **ElevenLabs** (mit automatischem Browser-TTS-Fallback)
- ⏱️ **5-Minuten-Timer** – der Beenden-Button wird erst nach Ablauf aktiv
- 🧠 **Adaptiver Gesprächsverlauf** – die KI reagiert inhaltlich auf jede Aussage
- 📊 **Analyse-Dashboard** mit allen 7 Dimensionen, Gesamtscore und Sternebewertung
- 💡 **Verbesserungsvorschläge** mit praktischen Übungen
- 📄 **PDF-Export** (Druckansicht)
- 🎨 **D+J Consult Corporate Identity** (Gold `#c9a961`, responsives Design)

### Die sieben Analyse-Dimensionen

1. Stimmliche Qualität (Prosodie) 2. Wortschatz 3. Satzgestaltung
4. Kommunikative Kompetenz 5. Rhetorik 6. Emotionale Intelligenz
7. Nonverbale Sprachmerkmale

## Architektur

| Ebene | Technik |
|-------|---------|
| Frontend | Statische SPA (`public/`) – HTML/CSS/JS, Web Speech API |
| Backend  | Node.js + Express (`server.js`) |
| KI       | Claude API (Anthropic) für Gespräch & Analyse |

Das Frontend erledigt Spracherkennung und -ausgabe direkt im Browser. Der
Server proxyt lediglich die KI-Aufrufe, damit der API-Key **niemals** im
Browser landet.

- `POST /api/chat` — nächste Gesprächsantwort des Coaches
- `POST /api/analyze` — vollständige Sprachanalyse als JSON
- `POST /api/tts` — Sprachausgabe via ElevenLabs (liefert `audio/mpeg`)
- `GET /api/health` — Statusendpunkt (auch für Render Health-Check)

### Sprachausgabe (ElevenLabs)

Für eine natürliche Stimme werden zwei Umgebungsvariablen benötigt:

| Variable | Bedeutung |
|----------|-----------|
| `ELEVENLABS_API_KEY`  | Dein ElevenLabs API-Key |
| `ELEVENLABS_VOICE_ID` | Die ID der gewünschten Stimme |
| `ELEVENLABS_MODEL`    | optional, Standard `eleven_multilingual_v2` |

Der Server erkennt die Werte zusätzlich anhand aller `ELEVEN*`-Variablen, falls
die Benennung leicht abweicht. Ist ElevenLabs nicht konfiguriert, fällt die
Anwendung automatisch auf die deutsche Browser-Stimme zurück.

## Lokal starten

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # oder .env anlegen (siehe .env.example)
npm start
# → http://localhost:3000
```

> **Hinweis:** Ohne `ANTHROPIC_API_KEY` läuft das Gespräch in einem
> regelbasierten Fallback-Modus; die KI-Analyse ist dann deaktiviert.

## Deployment auf Render

Dieses Repository enthält ein `render.yaml` (Blueprint).

1. Render-Dashboard → **New → Blueprint** → dieses Repository auswählen.
2. Render liest `render.yaml` und legt den Web-Service `dj-sprachcoach` an.
3. Unter **Environment** den geheimen Wert **`ANTHROPIC_API_KEY`** eintragen
   (in `render.yaml` als `sync: false` markiert, also nicht eingecheckt).
4. **Deploy** – Build (`npm install`) und Start (`npm start`) laufen automatisch.
5. Health-Check: `/api/health`.

Alternativ manuell: **New → Web Service**, Runtime `Node`,
Build `npm install`, Start `npm start`, Env-Variable `ANTHROPIC_API_KEY` setzen.

## Browser-Empfehlung

Die Spracherkennung (`SpeechRecognition`) wird am zuverlässigsten von
**Google Chrome** und **Microsoft Edge** (Desktop) unterstützt. In Browsern
ohne Unterstützung steht ein Text-Eingabe-Fallback zur Verfügung.

## Datenschutz

Die Analyse dient ausschließlich der Verbesserung der kommunikativen
Fähigkeiten. Es findet keine dauerhafte serverseitige Speicherung des
Transkripts statt; die Auswertung geschieht pro Session.

---

**D+J Consult** · ZIELE ERREICHEN · [www.djconsult.de](https://www.djconsult.de)
