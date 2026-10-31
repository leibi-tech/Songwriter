# Songwriter

Notiz-App fürs Songschreiben – läuft im Handy-Browser und lässt sich wie eine App auf den Homescreen legen.

## Was sie kann

- **Neuer Song** öffnet eine leere Notiz – einfach losschreiben.
- Mit **+** fügst du hinzu:
  - **Songteile** (Intro, Vers, Pre-Chorus, Refrain, Bridge, Solo, Outro) mit Text und Akkorden.
    Cursor an die Stelle setzen, Akkord antippen → er erscheint über dem Text.
  - **Akkordfolge** – Akkorde antippen oder eintippen (`Am F C G`), Taktstriche, umsortieren.
  - **Gitarren-Tab** – frei editierbar oder per Eingabehilfe: Saite wählen, Bund antippen.
    „Mehrere Saiten“ für Griffe in einer Spalte.
  - **Aufnahme** – ● nimmt auf. Nochmal ● nimmt eine **zweite Spur** auf, während die erste läuft (Overdub).
    Pro Spur: stumm, Lautstärke, Timing verschieben, als Datei teilen. „Mix exportieren“ ergibt eine WAV-Datei.
- Teile verschieben, duplizieren, löschen (⋯), Song als Text teilen, Suche auf der Startseite.
- Alles wird **nur lokal** auf dem Gerät gespeichert und funktioniert offline.

Tipp: Für die 2. Spur Kopfhörer benutzen, sonst nimmt das Mikrofon die erste Spur mit auf.
Wenn neue Spuren immer leicht zu spät liegen: ⚙︎ → Latenz-Ausgleich erhöhen.

## Starten

Keine Installation, kein Build. Lokal z. B.:

```sh
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Mikrofon-Zugriff funktioniert nur über `https://` oder `localhost`.

## Aufs Handy

Über GitHub Pages veröffentlichen (Workflow liegt in `.github/workflows/pages.yml`):
Repo → Settings → Pages → Source: **GitHub Actions**, dann nach `main` mergen.
Die Seite am Handy öffnen → Teilen → **Zum Home-Bildschirm**.
