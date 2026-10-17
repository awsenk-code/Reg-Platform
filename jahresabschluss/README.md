# Jahresabschluss-Reader

Web-App, die HGB-Jahresabschlüsse (Bilanz und Gewinn- und Verlustrechnung) aus PDF-Dateien liest und alle Werte in eine Excel-Tabelle mit fester HGB-Gliederung überträgt. Alles läuft lokal im Browser, die PDFs verlassen den Rechner nicht.

## Funktionen

- **Digitale PDFs und Scans**: Seiten mit Textebene werden mit pdf.js gelesen. Seiten ohne Text (Scans) werden per Texterkennung (Tesseract OCR, Deutsch) erkannt, typische OCR-Fehler werden bereinigt. Optional lässt sich die Texterkennung für alle Seiten erzwingen.
- **Feste HGB-Vorlage**: Bilanz nach § 266 HGB (vollständige Gliederung) und GuV nach § 275 Abs. 2 HGB (Gesamtkostenverfahren), inklusive Bilanzgewinn sowie Erträgen und Aufwendungen aus Ergebnisabführung.
- **Geschäftsjahr und Vorjahr**: Beide Spalten werden übernommen. Vor- und Hauptspalten (Unterpositionen und Gruppensummen), Anhang-Spalten und nebeneinander stehende Aktiva/Passiva werden erkannt.
- **Erkennung**: Firmenname, Geschäftsjahr, Einheit (EUR, TEUR, Mio. EUR), Vorzeichen (Verlustvortrag, Jahresfehlbetrag, mit Minus gedruckte Aufwendungen), mehrdeutige Bezeichnungen über die Reihenfolge der Gliederung (z. B. „Geleistete Anzahlungen“ im Anlage- oder Umlaufvermögen). „davon“-Vermerke werden ignoriert.
- **Prüfansicht**: Alle Werte sind editierbar. Farbig markiert werden berechnete Summen, manuelle Korrekturen, unsicher zugeordnete Werte und abweichende Zwischensummen. Beim Überfahren einer Zelle wird die Quellzeile im PDF angezeigt.
- **Plausibilitätsprüfungen**: Aktiva = Passiva, Zwischensummen gegen Unterpositionen, GuV-Rechnung bis zum Jahresüberschuss, Jahresüberschuss in GuV und Bilanz, nicht zugeordnete Zeilen mit Beträgen.
- **Mehrere Abschlüsse**: Jedes PDF wird zu einer Spalte (GJ/VJ) nebeneinander, z. B. für Firmen- oder Jahresvergleiche.
- **Excel-Export** (EUR oder TEUR) mit den Blättern
  - *Bilanz* und *GuV*: feste Gliederung, eine Spalte pro Abschluss und Jahr
  - *Kennzahlen*: Kapitalstruktur (EK-/FK-Quote, Verschuldungsgrad, Anlagenintensität, Anlagendeckung I/II), Liquidität (1./2./3. Grades, Working Capital), Rentabilität (Gesamtleistung, EBIT, EBITDA, Umsatz-, EK-, GK-Rendite, EBIT-Marge, Material- und Personalquote)
  - *Veränderung VJ*: Abweichung absolut und in % je Position
  - *Prüfung*: Prüfprotokoll, erkannte Seiten und nicht zugeordnete Zeilen

  Kennzahlen und Veränderungen sind Excel-Formeln. Korrekturen in den Blättern Bilanz und GuV rechnen sich durch.

## Starten

```bash
cd jahresabschluss
npm start          # http://localhost:8081 (python3 -m http.server)
npm test           # Unit-Tests der Erkennungslogik (Node ≥ 20)
```

Beim ersten Öffnen lädt der Browser die Bibliotheken pdf.js, ExcelJS und für Scans Tesseract mit dem deutschen Sprachmodell (ca. 5 MB) in festen Versionen von cdn.jsdelivr.net. Der Service Worker speichert sie zwischen, danach funktioniert die App auch offline. Für einen Betrieb ganz ohne CDN können die Dateien lokal abgelegt und die Pfade in `js/pdf.js` (`LIBS`) angepasst werden.

Die App kann auf jedem statischen Webserver betrieben werden (z. B. GitHub Pages oder ein interner Server). Service Worker benötigen `localhost` oder HTTPS.

## Muster-PDFs

`samples/` enthält drei fiktive Jahresabschlüsse zum Ausprobieren:

| Datei | Merkmale |
| --- | --- |
| `muster-pharma-gmbh.pdf` | EUR mit Cent, Vor- und Hauptspalte, umbrochene Bezeichnungen, „davon“-Vermerke, Anhang mit Störzahlen |
| `beispiel-maschinenbau-ag.pdf` | TEUR, Querformat mit Aktiva und Passiva nebeneinander, Aufwendungen mit Minus, Anhang-Spalte |
| `muster-pharma-gmbh-scan.pdf` | gescannte Fassung (nur Bilder), wird per Texterkennung gelesen |

```bash
python3 tools/make_samples.py                              # Muster neu erzeugen (pip install reportlab pymupdf)
npm install --no-save pdfjs-dist@4.10.38 && node tools/check_samples.mjs   # Regressionstest gegen samples/expected.json
```

## Grenzen

- Unterstützt wird die HGB-Gliederung mit Gesamtkostenverfahren. Umsatzkostenverfahren, verkürzte Gliederungen kleiner Gesellschaften (Rohergebnis) und IFRS-Abschlüsse werden nicht gezielt zugeordnet. Solche Zeilen erscheinen unter „nicht zugeordnet“ in der Prüfung.
- Die Erkennung ist regelbasiert. Ungewöhnliche Layouts oder schlechte Scans können Fehlzuordnungen erzeugen. Deshalb vor dem Export die Prüfansicht durchsehen; die Prüfungen zeigen Abweichungen an.
- Das kurzfristige Fremdkapital ist eine Näherung (Rückstellungen ohne Pensionen + Verbindlichkeiten ohne Anleihen + passive RAP), da Restlaufzeiten aus dem Anhang nicht ausgewertet werden.

## Aufbau

```
jahresabschluss/
├── index.html            Oberfläche
├── css/styles.css        Layout, Hell-/Dunkelmodus
├── js/schema.js          HGB-Gliederung mit Erkennungsmustern
├── js/parse.js           Zahlen, Zeilen, Spalten, Zuordnung (ohne DOM, getestet)
├── js/analysis.js        Summen, Prüfungen, Kennzahlen (ohne DOM, getestet)
├── js/excel.js           Excel-Export mit ExcelJS
├── js/pdf.js             PDF-Text (pdf.js) und Texterkennung (Tesseract)
├── js/app.js             Upload, Prüfansicht, Export
├── sw.js                 Offline-Cache
├── samples/              Muster-PDFs und Sollwerte
├── tools/                Mustergenerator und Regressionstest
└── tests/                node:test Unit-Tests
```

Bei Änderungen an gecachten Dateien `CACHE` in `sw.js` hochzählen.
