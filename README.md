# 🏛️ ArchivTool

Flexible Archivverwaltung für kleine Geschichtsvereine – als eigenständige
Desktop-Anwendung für **Windows, macOS und Linux** (jeweils x64 und ARM),
ohne laufende Kosten und ohne externe Abhängigkeiten zur Laufzeit.

Die gesamte Datenbank ist **eine einzige SQLite-Datei**, die typischerweise
auf dem Netzlaufwerk des Vereins liegt. Mehrere Mitglieder können gleichzeitig
damit arbeiten.

## Funktionen

- **Benutzerkonten mit Passwort** – jedes Vereinsmitglied meldet sich mit
  eigenem Konto an (Rollen: Administrator / Mitglied). Passwörter werden
  ausschließlich als scrypt-Hash gespeichert.
- **Schutz vor gleichzeitigem Schreiben** – jeder Eintrag trägt eine
  Versionsnummer (optimistisches Locking). Speichern zwei Mitglieder denselben
  Eintrag, bekommt das zweite eine verständliche Konfliktmeldung („zwischenzeitlich
  von Karl Weber geändert“) und kann den aktuellen Stand laden oder bewusst
  überschreiben. Zusätzlich sichert SQLite-Dateisperrung die Datenbank selbst ab.
- **Versionierung / Änderungshistorie** – jede Anlage, Änderung und Löschung
  wird mit Benutzer, Zeitstempel und vollständigem Daten-Schnappschuss
  protokolliert. Pro Eintrag lässt sich Feld für Feld nachvollziehen,
  *wer was wann* geändert hat (alt → neu). Gespeichert wird platzsparend nur
  bei tatsächlichen Änderungen, nicht periodisch.
- **Flexible Dokumenttypen** – Typen wie *Bücher*, *Bilder*, *Filme* werden in
  der Anwendung selbst definiert, mit frei wählbaren Eingabefeldern und
  passenden Datentypen:
  Text (ein-/mehrzeilig), Zahl, Datum, **Datei-Pfad** (mit „Durchsuchen“ und
  „Öffnen“), Ja/Nein und Auswahlliste.
- **Pflichtfeld Archiv-ID** – jeder Eintrag braucht eine eindeutige
  alphanumerische ID (z. B. `FOTO-1952-001`); Eindeutigkeit wird von der
  Datenbank erzwungen (Groß-/Kleinschreibung wird ignoriert).
- **Standard-Datenbankfunktionen** – Volltextsuche über alle Felder, Filter je
  Eingabefeld, Sortierung, Seitenweise Anzeige, Anlegen, Bearbeiten, Löschen.
- **Dashboard** – Kennzahlen, Einträge pro Dokumenttyp, Neuzugänge der letzten
  12 Monate, aktivste Mitglieder und die letzten Aktivitäten.
- **Moderne Oberfläche** – Electron-Anwendung mit deutschsprachiger,
  aufgeräumter Benutzeroberfläche.

## Erste Schritte (für den Verein)

1. Installationspaket für das jeweilige Betriebssystem installieren
   (siehe [Builds erstellen](#builds-erstellen)).
2. Beim ersten Start **„Neue Datenbank anlegen“** wählen und die Datei auf dem
   gemeinsamen Netzlaufwerk speichern, z. B. `V:\Verein\vereinsarchiv.sqlite`.
3. Das erste **Administratorkonto** anlegen.
4. Unter **Benutzer** Konten für die anderen Mitglieder anlegen.
5. Unter **Dokumenttypen** die ersten Typen (z. B. „Bücher“, „Bilder“) mit den
   gewünschten Feldern definieren – danach können alle Mitglieder Einträge
   erfassen. Auf den anderen PCs wählt man beim ersten Start einfach
   **„Bestehende Datenbank öffnen“** und dieselbe Datei.

### Hinweise zum Netzlaufwerk

- Die Anwendung öffnet die Datenbank bewusst **ohne WAL-Modus**
  (`journal_mode=DELETE`, `synchronous=FULL`) – das ist die für
  Netzwerk-Dateisysteme sichere Betriebsart. Kurzzeitig gleichzeitige
  Schreibvorgänge warten bis zu 15 Sekunden aufeinander.
- Empfohlen sind **SMB-Freigaben** (klassisches Windows-Netzlaufwerk, NAS).
  Von NFS-Freigaben mit fehlerhafter Datei-Sperrung wird abgeraten.
- **Datensicherung**: Die gesamte Datenbank ist eine Datei – regelmäßig
  kopieren genügt (am besten, wenn niemand angemeldet ist).
- Dateien (Scans, Fotos, Filme) werden nicht in die Datenbank kopiert, sondern
  über Felder vom Typ *Datei-Pfad* referenziert. Damit alle Mitglieder die
  Pfade öffnen können, sollten die Dateien ebenfalls auf dem Netzlaufwerk
  liegen (idealerweise unter demselben Laufwerksbuchstaben/Mount).

## Entwicklung

Voraussetzungen: [Node.js](https://nodejs.org) ≥ 20 (nur zum Entwickeln/Bauen –
die fertige Anwendung benötigt **kein** installiertes Node, Python o. Ä.).

```bash
npm install        # Abhängigkeiten installieren (kompiliert SQLite für Electron)
npm start          # Anwendung im Entwicklungsmodus starten
npm test           # Testsuite (Datenbankschicht, Konflikte, Historie) ausführen
```

### Builds erstellen

```bash
npm run dist:win     # Windows: Installer (x64 + ARM64) und portable EXE
npm run dist:mac     # macOS:   DMG/ZIP (Intel + Apple Silicon)
npm run dist:linux   # Linux:   AppImage/DEB (x64 + ARM64)
```

Die Pakete landen in `dist/`. Builds werden je Plattform auf dem jeweiligen
Betriebssystem erstellt; der mitgelieferte GitHub-Actions-Workflow
(`.github/workflows/build.yml`) baut bei jedem Push alle Plattformen
automatisch und legt die Installer als Artefakte ab.

### Technik

| Baustein   | Wahl                                                              |
| ---------- | ----------------------------------------------------------------- |
| Oberfläche | Electron, Vanilla-JS/CSS (kein Build-Schritt im Renderer)         |
| Datenbank  | SQLite über `better-sqlite3` (einzige native Abhängigkeit)        |
| Passwörter | Node-eigenes `crypto.scrypt` (keine Zusatzbibliothek)             |
| Sicherheit | `contextIsolation`, Sandbox-Renderer, schmale IPC-Schnittstelle, Rechteprüfung im Main-Prozess |

Datenmodell (vereinfacht): `users`, `doc_types` + `doc_type_fields`
(Felddefinitionen je Typ), `records` (Eintrag mit eindeutiger `archive_id`,
JSON-Felddaten und `version`-Zähler) sowie `record_history`
(Schnappschüsse aller Änderungen mit Benutzer und Zeitstempel).

## Lizenz

MIT – siehe [LICENSE](LICENSE).
