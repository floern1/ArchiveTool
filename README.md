# Archiv-Tool

Eine flexible, leichtgewichtige Archivverwaltung für Geschichtsvereine und
kleine Sammlungen. Gedacht als kostengünstige, intuitive Alternative zu großen
Archivpaketen (z. B. ACTApro), ohne deren Komplexität.

## Funktionen

- **Frei definierbare Kategorien** (z. B. Bücher, Bilder, Filme, Dokumente …),
  jederzeit erweiterbar.
- **Eigene Felder pro Kategorie** – jede Kategorie kann ihre eigenen Attribute
  haben (Text, mehrzeiliger Text, Ganzzahl, Dezimalzahl, Datum, Ja/Nein,
  Auswahlliste). Beispiel: „Bücher“ mit *Autor*, *Erscheinungsjahr*, *ISBN*,
  *Zustand*.
- **Labels/Schlagwörter** mit Farbe, frei vergebbar und über Kategorien hinweg
  nutzbar.
- **Datei-Anhänge** (Scans, Fotos, Dokumente, Videos) werden in das Archiv
  kopiert und mit dem Objekt verknüpft.
- **Volltextsuche** über Titel, Inventarnummer, Standort und sämtliche
  Feldinhalte; zusätzlich Filterung nach Label.
- **CSV-Export** der aktuellen Ansicht (z. B. für Listen oder Inventur).
- **Eigene lokale Datenbank** (SQLite) – kein Server, keine Cloud, alle Daten
  bleiben im Verein.

## Datenablage

Alle Daten liegen in einem benutzereigenen, beschreibbaren Verzeichnis
(unter Windows `%APPDATA%\ArchiveTool\ArchiveTool`):

```
archive.sqlite        die Datenbank (Kategorien, Felder, Objekte, Labels …)
attachments/          die importierten Anhang-Dateien
```

Das Verzeichnis lässt sich in der Anwendung über **Datei → Datenverzeichnis
öffnen** anzeigen. Für eine Sicherung genügt es, diesen Ordner zu kopieren.

## Architektur

C++17 mit Qt 6 (Widgets) und SQLite (über das in Qt enthaltene `QtSql`-Modul,
Treiber `QSQLITE` – keine externe Datenbankbibliothek nötig). Sauber in
Schichten getrennt:

| Schicht       | Verzeichnis        | Aufgabe                                   |
|---------------|--------------------|-------------------------------------------|
| `model`       | `src/model`        | reine Datenstrukturen                     |
| `db`          | `src/db`           | Verbindung + versionierte Schema-Migration|
| `repository`  | `src/repository`   | CRUD-/SQL-Zugriff je Entität              |
| `ui`          | `src/ui`           | Hauptfenster und Dialoge (Qt Widgets)     |

Das Datenmodell ist vollflexibel (Entity-Attribute-Value): Objekte besitzen
ein paar eingebaute Felder (Titel, Inventarnummer, Standort, Notizen) sowie
beliebig viele benutzerdefinierte Feldwerte gemäß der Felddefinitionen ihrer
Kategorie.

## Bauen

### Voraussetzungen

- CMake ≥ 3.21
- Ein C++17-Compiler (MSVC, GCC oder Clang)
- Qt 6 (Komponenten `Core`, `Gui`, `Widgets`, `Sql`)

### Build (alle Plattformen)

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
```

Die ausführbare Datei liegt anschließend unter `build/ArchiveTool`
(bzw. `build/ArchiveTool.exe` unter Windows).

### Windows-Installer

Der Installer wird automatisch per GitHub Actions erzeugt
(`.github/workflows/build-windows.yml`): Auf einem Windows-Runner wird die
Anwendung gebaut, `windeployqt` bündelt **alle** Qt- und SQLite-Laufzeit-DLLs
in den Ordner `dist`, und **Inno Setup** packt daraus einen eigenständigen
Installer. Das Ergebnis benötigt auf dem Zielrechner keine Vorinstallation von
Qt oder sonstigen Abhängigkeiten.

Manuell unter Windows (in einer Developer-Eingabeaufforderung mit Qt im `PATH`):

```bat
cmake -S . -B build -G "Ninja" -DCMAKE_BUILD_TYPE=Release
cmake --build build
mkdir dist & copy build\ArchiveTool.exe dist\
windeployqt --release --no-translations dist\ArchiveTool.exe
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /DAppVersion=1.0.0 /DSourceDir=..\dist installer\archivetool.iss
```

Die fertige `ArchiveTool-Setup-<Version>.exe` liegt dann unter
`installer\Output`.

### Hinweis zu 32-Bit (x86)

Qt 6 stellt offiziell **nur 64-Bit-Windows-Binärdateien** bereit. Der oben
beschriebene Installer ist daher 64-Bit und läuft auf jedem aktuellen Windows
(Windows 10/11 sind ausschließlich 64-Bit). Ein echter 32-Bit-Build (x86) wäre
nur mit Qt 5 oder einem selbst kompilierten Qt 6 möglich – der Quellcode ist
weitgehend Qt-5-kompatibel. Falls 32-Bit zwingend benötigt wird, kann die
Toolchain entsprechend umgestellt werden.

## Lizenz

Siehe [LICENSE](LICENSE).
