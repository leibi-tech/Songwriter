# Songwriter

Notiz-App fürs Songschreiben – läuft im Handy-Browser und lässt sich wie eine App auf den Homescreen legen.

## Was sie kann

- Startseite mit zwei Tabs: **Songs** und **Ideen**.
- **Neuer Song** öffnet eine leere Notiz – einfach losschreiben. Oben lässt sich der **Capo** einstellen.
- **Ideen:** „Neue Idee“ (Text) oder „Sprachmemo“ (startet sofort die Aufnahme).
  Später „In Song verschieben“ (Inhalt wird an einen Song angehängt) oder „Zu eigenem Song machen“.
- Mit **+** fügst du hinzu:
  - **Songteile** (Intro, Vers, Pre-Chorus, Refrain, Bridge, Solo, Outro) mit Text und Akkorden.
    Cursor an die Stelle setzen, Akkord antippen → er erscheint über dem Text.
  - **Akkordfolge** – Akkorde antippen oder eintippen (`Am F C G`), Taktstriche, umsortieren.
  - **Gitarren-Tab** – frei editierbar oder per Eingabehilfe: Saite wählen, Bund antippen.
    „Mehrere Saiten“ für Griffe in einer Spalte.
  - **Aufnahme** – ● nimmt auf. Nochmal ● nimmt eine **zweite Spur** auf, während die erste läuft (Overdub).
    Pro Spur: stumm, Lautstärke, Timing verschieben, als Datei teilen. „Mix exportieren“ ergibt eine WAV-Datei.
- Teile verschieben, duplizieren, löschen (⋯), Song als Text teilen, Suche auf der Startseite.
- Alles wird lokal gespeichert und funktioniert offline. Mit **Cloud-Sync** (optional, Supabase) sind Songs,
  Ideen und Aufnahmen auf allen Geräten gleich.

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

## Cloud-Sync einrichten (einmalig, ca. 10 Minuten)

Der Sync läuft über [Supabase](https://supabase.com) (Gratis-Stufe reicht: 500 MB Datenbank, 1 GB für Aufnahmen ≈ 3 Stunden WAV).

1. Bei supabase.com ein kostenloses Konto anlegen → **New project** (Region z. B. Frankfurt), Passwort notieren.
2. Im Projekt **SQL Editor** → **New query** → Inhalt von `supabase/schema.sql` einfügen → **Run**.
   Das legt die Tabelle `songs` und den privaten Speicher `audio` an; jede Person sieht nur ihre eigenen Daten.
3. **Authentication → URL Configuration → Site URL** auf die Adresse der App setzen (z. B. die GitHub-Pages-URL),
   damit der Bestätigungslink aus der E-Mail richtig landet.
   Wer keine Bestätigungs-Mail will: **Authentication → Sign In / Providers → Email → „Confirm email“ aus**.
4. **Project Settings → API**: *Project URL* und den *anon public* Key kopieren und
   - entweder in `config.js` eintragen (gilt dann für alle Geräte automatisch),
   - oder in der App unter ⚙︎ → Cloud-Sync eingeben.
5. In der App ⚙︎ → **Konto erstellen**, danach auf jedem weiteren Gerät mit derselben E-Mail **Anmelden**.

So funktioniert der Abgleich:
- Gespeichert wird zuerst lokal, der Sync folgt ein paar Sekunden später im Hintergrund (Wolke oben: grün = aktuell, ↻ = läuft, ⚠︎ = Fehler).
- Offline-Änderungen werden nachgeholt, sobald wieder Netz da ist.
- Wird derselbe Song auf zwei Geräten gleichzeitig geändert, gewinnt die neuere Änderung.
- Gratis-Projekte pausiert Supabase nach 7 Tagen ohne Nutzung; im Supabase-Dashboard mit einem Klick wieder starten.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html`, `styles.css` | Seite und Aussehen |
| `app.js` | App: Songs, Ideen, Blöcke, Akkorde, Tabs, Aufnahme |
| `sync.js` | Cloud-Sync mit Supabase |
| `config.js` | Supabase-Verbindung (optional) |
| `supabase/schema.sql` | Datenbank-Setup für Supabase |
| `vendor/supabase.js` | Supabase-Bibliothek v2.45.4 (lokal, damit die App offline startet) |
| `sw.js` | Offline-Cache |
