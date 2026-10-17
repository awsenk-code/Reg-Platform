"""Generates fictitious sample annual reports (HGB) for trying out and testing the reader.

    pip install reportlab pymupdf
    python3 tools/make_samples.py            # writes samples/*.pdf and samples/expected.json

1. muster-pharma-gmbh.pdf      EUR with cents, portrait, inner/outer columns, wrapped labels, "davon" lines, notes
2. beispiel-maschinenbau-ag.pdf TEUR, landscape with Aktiva and Passiva side by side, expenses printed negative
3. muster-pharma-gmbh-scan.pdf  page images of sample 1 without a text layer (needs OCR)
"""

import json
import os
import random

import pymupdf
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), '..', 'samples')


def de(v, dec=2):
    s = f'{abs(v):,.{dec}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('-' if v < 0 else '') + s


# --- Sample 1: Muster Pharma GmbH (EUR) ---------------------------------------------------------------

def pharma_data():
    gj = {
        'akt.A.I.2': 184_350.00, 'akt.A.I.3': 95_000.00,
        'akt.A.II.1': 2_450_800.00, 'akt.A.II.2': 1_312_455.50, 'akt.A.II.3': 418_920.30, 'akt.A.II.4': 77_400.00,
        'akt.A.III.3': 250_000.00,
        'akt.B.I.1': 612_334.12, 'akt.B.I.2': 143_210.00, 'akt.B.I.3': 988_765.43,
        'akt.B.II.1': 1_734_560.88, 'akt.B.II.2': 120_000.00, 'akt.B.II.4': 86_432.19,
        'akt.B.IV': 1_045_678.90, 'akt.C': 23_456.78,
        'pas.A.I': 500_000.00, 'pas.A.II': 750_000.00, 'pas.A.III.4': 1_200_000.00, 'pas.A.IV': 812_345.67,
        'pas.B.1': 645_000.00, 'pas.B.2': 98_765.00, 'pas.B.3': 356_789.12,
        'pas.C.3': 45_000.00, 'pas.C.4': 812_456.33, 'pas.C.6': 210_000.00, 'pas.C.8': 167_543.21,
        'guv.1': 14_823_456.78, 'guv.2': -123_456.00, 'guv.3': 45_000.00, 'guv.4': 234_567.89,
        'guv.5a': 5_432_109.87, 'guv.5b': 812_345.00, 'guv.6a': 4_123_456.00, 'guv.6b': 876_543.21,
        'guv.7a': 612_345.00, 'guv.8': 1_987_654.32, 'guv.11': 12_345.67, 'guv.13': 98_765.43,
        'guv.14': 512_345.00, 'guv.16': 23_456.00,
    }
    vj = {k: round(v * f, 2) for k, v, f in [(k, v, random.Random(k).uniform(0.82, 1.08)) for k, v in gj.items()]}
    for d in (gj, vj):
        d['guv.5'] = round(d['guv.5a'] + d['guv.5b'], 2)
        d['guv.6'] = round(d['guv.6a'] + d['guv.6b'], 2)
        d['guv.7'] = d['guv.7a']
        d['guv.15'] = round(d['guv.1'] + d['guv.2'] + d['guv.3'] + d['guv.4'] - d['guv.5'] - d['guv.6'] - d['guv.7']
                            - d['guv.8'] + d['guv.11'] - d['guv.13'] - d['guv.14'], 2)
        d['guv.17'] = round(d['guv.15'] - d['guv.16'], 2)
        d['pas.A.V'] = d['guv.17']
        sums(d)
        # Balance with the bank loans.
        d['pas.C.2'] = round(d['akt.SUM'] - sum(v for k, v in d.items() if k.startswith('pas.') and k.count('.') >= 2
                                                 and k not in ('pas.A.III',)), 2)
        sums(d)
    return gj, vj


def sums(d):
    groups = {
        'akt.A.I': ['akt.A.I.1', 'akt.A.I.2', 'akt.A.I.3', 'akt.A.I.4'],
        'akt.A.II': ['akt.A.II.1', 'akt.A.II.2', 'akt.A.II.3', 'akt.A.II.4'],
        'akt.A.III': ['akt.A.III.1', 'akt.A.III.2', 'akt.A.III.3', 'akt.A.III.4', 'akt.A.III.5', 'akt.A.III.6'],
        'akt.A': ['akt.A.I', 'akt.A.II', 'akt.A.III'],
        'akt.B.I': ['akt.B.I.1', 'akt.B.I.2', 'akt.B.I.3', 'akt.B.I.4'],
        'akt.B.II': ['akt.B.II.1', 'akt.B.II.2', 'akt.B.II.3', 'akt.B.II.4'],
        'akt.B': ['akt.B.I', 'akt.B.II', 'akt.B.III', 'akt.B.IV'],
        'akt.SUM': ['akt.A', 'akt.B', 'akt.C', 'akt.D'],
        'pas.A.III': ['pas.A.III.1', 'pas.A.III.4'],
        'pas.A': ['pas.A.I', 'pas.A.II', 'pas.A.III', 'pas.A.IV', 'pas.A.V'],
        'pas.B': ['pas.B.1', 'pas.B.2', 'pas.B.3'],
        'pas.C': ['pas.C.1', 'pas.C.2', 'pas.C.3', 'pas.C.4', 'pas.C.5', 'pas.C.6', 'pas.C.7', 'pas.C.8'],
        'pas.SUM': ['pas.A', 'pas.B', 'pas.C', 'pas.D', 'pas.E'],
    }
    for g, kids in groups.items():
        if any(k in d for k in kids):
            d[g] = round(sum(d.get(k, 0) for k in kids), 2)


def pharma_pdf(path, gj, vj):
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    c.setTitle('Jahresabschluss 2024 Muster Pharma GmbH')
    # Cover page
    c.setFont('Helvetica-Bold', 20)
    c.drawString(70, H - 200, 'Muster Pharma GmbH, Berlin')
    c.setFont('Helvetica', 14)
    c.drawString(70, H - 230, 'Jahresabschluss zum 31. Dezember 2024')
    c.drawString(70, H - 250, 'Inhalt: Bilanz, Gewinn- und Verlustrechnung, Anhang')
    c.showPage()

    xi, xo, xv = 440, 505, 565  # right edges of inner, outer, prior-year column

    def header(title):
        c.setFont('Helvetica-Bold', 13)
        c.drawString(50, H - 60, 'Muster Pharma GmbH, Berlin')
        c.drawString(50, H - 78, title)
        c.setFont('Helvetica-Bold', 9)
        c.drawRightString(xo, H - 105, '31.12.2024')
        c.drawRightString(xv, H - 105, '31.12.2023')
        c.drawRightString(xo, H - 116, 'EUR')
        c.drawRightString(xv, H - 116, 'EUR')
        return H - 140

    def row(y, indent, text, inner=None, outer=None, prior=None, bold=False):
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 9)
        c.drawString(50 + indent, y, text)
        c.setFont('Helvetica', 9)
        if inner is not None: c.drawRightString(xi, y, de(inner))
        if outer is not None: c.drawRightString(xo, y, de(outer))
        if prior is not None: c.drawRightString(xv, y, de(prior))
        return y - 14

    def items(y, ids_labels, group):
        last = len(ids_labels) - 1
        for i, (pid, label) in enumerate(ids_labels):
            if isinstance(label, tuple):  # wrapped label, amounts on the second line
                y = row(y, 24, label[0])
                label = label[1]
            y = row(y, 24, label, gj[pid], gj[group] if i == last else None, vj[pid])
        return y

    # Aktiva
    y = header('Bilanz zum 31. Dezember 2024 - AKTIVA')
    y = row(y, 0, 'A. Anlagevermögen', bold=True)
    y = row(y, 12, 'I. Immaterielle Vermögensgegenstände')
    y = items(y, [('akt.A.I.2', ('1. Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte und ähnliche',
                                  'Rechte und Werte sowie Lizenzen an solchen Rechten und Werten')),
                  ('akt.A.I.3', '2. Geschäfts- oder Firmenwert')], 'akt.A.I')
    y = row(y, 12, 'II. Sachanlagen')
    y = items(y, [('akt.A.II.1', '1. Grundstücke, grundstücksgleiche Rechte und Bauten'),
                  ('akt.A.II.2', '2. Technische Anlagen und Maschinen'),
                  ('akt.A.II.3', '3. Andere Anlagen, Betriebs- und Geschäftsausstattung'),
                  ('akt.A.II.4', '4. Geleistete Anzahlungen und Anlagen im Bau')], 'akt.A.II')
    y = row(y, 12, 'III. Finanzanlagen')
    y = items(y, [('akt.A.III.3', '1. Beteiligungen')], 'akt.A.III')
    y = row(y, 0, '', None, gj['akt.A'], vj['akt.A'])
    y -= 6
    y = row(y, 0, 'B. Umlaufvermögen', bold=True)
    y = row(y, 12, 'I. Vorräte')
    y = items(y, [('akt.B.I.1', '1. Roh-, Hilfs- und Betriebsstoffe'),
                  ('akt.B.I.2', '2. Unfertige Erzeugnisse, unfertige Leistungen'),
                  ('akt.B.I.3', '3. Fertige Erzeugnisse und Waren')], 'akt.B.I')
    y = row(y, 12, 'II. Forderungen und sonstige Vermögensgegenstände')
    y = items(y, [('akt.B.II.1', '1. Forderungen aus Lieferungen und Leistungen'),
                  ('akt.B.II.2', '2. Forderungen gegen verbundene Unternehmen'),
                  ('akt.B.II.4', '3. Sonstige Vermögensgegenstände')], 'akt.B.II')
    y = row(y, 12, 'III. Kassenbestand, Guthaben bei Kreditinstituten', None, gj['akt.B.IV'], vj['akt.B.IV'])
    y = row(y, 0, '', None, gj['akt.B'], vj['akt.B'])
    y -= 6
    y = row(y, 0, 'C. Rechnungsabgrenzungsposten', None, gj['akt.C'], vj['akt.C'], bold=True)
    y -= 6
    row(y, 0, 'Summe Aktiva', None, gj['akt.SUM'], vj['akt.SUM'], bold=True)
    c.showPage()

    # Passiva
    y = header('Bilanz zum 31. Dezember 2024 - PASSIVA')
    y = row(y, 0, 'A. Eigenkapital', bold=True)
    y = row(y, 12, 'I. Gezeichnetes Kapital', None, gj['pas.A.I'], vj['pas.A.I'])
    y = row(y, 12, 'II. Kapitalrücklage', None, gj['pas.A.II'], vj['pas.A.II'])
    y = row(y, 12, 'III. Gewinnrücklagen')
    y = items(y, [('pas.A.III.4', '1. Andere Gewinnrücklagen')], 'pas.A.III')
    y = row(y, 12, 'IV. Gewinnvortrag', None, gj['pas.A.IV'], vj['pas.A.IV'])
    y = row(y, 12, 'V. Jahresüberschuss', None, gj['pas.A.V'], vj['pas.A.V'])
    y = row(y, 0, '', None, gj['pas.A'], vj['pas.A'])
    y -= 6
    y = row(y, 0, 'B. Rückstellungen', bold=True)
    y = items(y, [('pas.B.1', '1. Rückstellungen für Pensionen und ähnliche Verpflichtungen'),
                  ('pas.B.2', '2. Steuerrückstellungen'),
                  ('pas.B.3', '3. Sonstige Rückstellungen')], 'pas.B')
    y -= 6
    y = row(y, 0, 'C. Verbindlichkeiten', bold=True)
    y = items(y, [('pas.C.2', '1. Verbindlichkeiten gegenüber Kreditinstituten'),
                  ('pas.C.3', '2. Erhaltene Anzahlungen auf Bestellungen'),
                  ('pas.C.4', '3. Verbindlichkeiten aus Lieferungen und Leistungen'),
                  ('pas.C.6', '4. Verbindlichkeiten gegenüber verbundenen Unternehmen'),
                  ('pas.C.8', '5. Sonstige Verbindlichkeiten')], 'pas.C')
    c.setFont('Helvetica', 8)
    c.drawString(86, y, f'- davon aus Steuern EUR {de(54_321.00)} (Vorjahr EUR {de(49_876.00)})')
    y -= 12
    c.drawString(86, y, f'- davon im Rahmen der sozialen Sicherheit EUR {de(12_345.00)} (Vorjahr EUR {de(11_234.00)})')
    y -= 20
    row(y, 0, 'Summe Passiva', None, gj['pas.SUM'], vj['pas.SUM'], bold=True)
    c.showPage()

    # GuV
    c.setFont('Helvetica-Bold', 13)
    c.drawString(50, H - 60, 'Muster Pharma GmbH, Berlin')
    c.drawString(50, H - 78, 'Gewinn- und Verlustrechnung für die Zeit vom 1. Januar bis 31. Dezember 2024')
    c.setFont('Helvetica-Bold', 9)
    c.drawRightString(xo, H - 105, '2024')
    c.drawRightString(xv, H - 105, '2023')
    c.drawRightString(xo, H - 116, 'EUR')
    c.drawRightString(xv, H - 116, 'EUR')
    y = H - 140
    y = row(y, 0, '1. Umsatzerlöse', None, gj['guv.1'], vj['guv.1'])
    y = row(y, 0, '2. Verminderung des Bestands an fertigen und unfertigen Erzeugnissen', None, gj['guv.2'], vj['guv.2'])
    y = row(y, 0, '3. Andere aktivierte Eigenleistungen', None, gj['guv.3'], vj['guv.3'])
    y = row(y, 0, '4. Sonstige betriebliche Erträge', None, gj['guv.4'], vj['guv.4'])
    y = row(y, 0, '5. Materialaufwand')
    y = row(y, 12, 'a) Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren', gj['guv.5a'], None, vj['guv.5a'])
    y = row(y, 12, 'b) Aufwendungen für bezogene Leistungen', gj['guv.5b'], gj['guv.5'], vj['guv.5b'])
    y = row(y, 0, '6. Personalaufwand')
    y = row(y, 12, 'a) Löhne und Gehälter', gj['guv.6a'], None, vj['guv.6a'])
    y = row(y, 12, 'b) Soziale Abgaben und Aufwendungen für Altersversorgung', gj['guv.6b'], gj['guv.6'], vj['guv.6b'])
    y = row(y, 12, '- davon für Altersversorgung EUR 123.456,00 (Vorjahr EUR 110.000,00)')
    y = row(y, 0, '7. Abschreibungen auf immaterielle Vermögensgegenstände des Anlagevermögens und Sachanlagen', None, gj['guv.7a'], vj['guv.7a'])
    y = row(y, 0, '8. Sonstige betriebliche Aufwendungen', None, gj['guv.8'], vj['guv.8'])
    y = row(y, 0, '9. Sonstige Zinsen und ähnliche Erträge', None, gj['guv.11'], vj['guv.11'])
    y = row(y, 0, '10. Zinsen und ähnliche Aufwendungen', None, gj['guv.13'], vj['guv.13'])
    y = row(y, 0, '11. Steuern vom Einkommen und vom Ertrag', None, gj['guv.14'], vj['guv.14'])
    y = row(y, 0, '12. Ergebnis nach Steuern', None, gj['guv.15'], vj['guv.15'], bold=True)
    y = row(y, 0, '13. Sonstige Steuern', None, gj['guv.16'], vj['guv.16'])
    row(y, 0, '14. Jahresüberschuss', None, gj['guv.17'], vj['guv.17'], bold=True)
    c.showPage()

    # Notes with distracting figures
    c.setFont('Helvetica-Bold', 13)
    c.drawString(50, H - 60, 'Anhang für das Geschäftsjahr 2024')
    c.setFont('Helvetica', 9)
    text = [
        'Die Umsatzerlöse stiegen gegenüber dem Vorjahr um 6 % auf 14,8 Mio. EUR.',
        'Die sonstigen Rückstellungen betreffen im Wesentlichen Urlaubs- und Bonusverpflichtungen.',
        'Verbindlichkeitenspiegel:',
    ]
    y = H - 90
    for t in text:
        c.drawString(50, y, t)
        y -= 14
    for label, vals in [('Verbindlichkeiten gegenüber Kreditinstituten', (100_000, 200_000, 300_000, 400_000, 500_000)),
                        ('Sonstige Verbindlichkeiten', (1_000, 2_000, 3_000, 4_000, 5_000))]:
        c.drawString(50, y, label)
        for i, v in enumerate(vals):
            c.drawRightString(330 + i * 55, y, de(v, 0))
        y -= 14
    y -= 10
    c.drawString(50, y, 'Die durchschnittliche Zahl der Arbeitnehmer betrug 87 (Vorjahr 82).')
    c.showPage()
    c.save()


# --- Sample 2: Beispiel Maschinenbau AG (TEUR, side by side) ----------------------------------------

def maschinenbau_data():
    gj = {
        'akt.A.I': 1_234, 'akt.A.II': 18_765, 'akt.A.III': 2_500,
        'akt.B.I': 9_876, 'akt.B.II': 7_654, 'akt.B.IV': 3_210, 'akt.C': 123,
        'pas.A.I': 5_000, 'pas.A.II': 3_000, 'pas.A.III': 6_500, 'pas.A.VI': 2_345,
        'pas.B': 4_321,
        'pas.C': None, 'pas.D': 55,
        'guv.1': 54_321, 'guv.2': 432, 'guv.4': 1_234, 'guv.5': 28_765, 'guv.6': 15_432, 'guv.7': 2_345, 'guv.8': 5_678,
        'guv.9': 150, 'guv.11': 23, 'guv.13': 456, 'guv.14': 987, 'guv.16': 45,
    }
    vj = {k: (None if v is None else round(v * random.Random(k + 'v').uniform(0.85, 1.05))) for k, v in gj.items()}
    for d in (gj, vj):
        d['akt.A'] = d['akt.A.I'] + d['akt.A.II'] + d['akt.A.III']
        d['akt.B'] = d['akt.B.I'] + d['akt.B.II'] + d['akt.B.IV']
        d['akt.SUM'] = d['akt.A'] + d['akt.B'] + d['akt.C']
        d['pas.A'] = d['pas.A.I'] + d['pas.A.II'] + d['pas.A.III'] + d['pas.A.VI']
        d['pas.C'] = d['akt.SUM'] - d['pas.A'] - d['pas.B'] - d['pas.D']
        d['pas.SUM'] = d['akt.SUM']
        d['guv.15'] = (d['guv.1'] + d['guv.2'] + d['guv.4'] - d['guv.5'] - d['guv.6'] - d['guv.7'] - d['guv.8']
                       + d['guv.9'] + d['guv.11'] - d['guv.13'] - d['guv.14'])
        d['guv.17'] = d['guv.15'] - d['guv.16']
    return gj, vj


def maschinenbau_pdf(path, gj, vj):
    size = landscape(A4)
    W, H = size
    c = canvas.Canvas(path, pagesize=size)
    c.setFont('Helvetica-Bold', 14)
    c.drawString(40, H - 45, 'Beispiel Maschinenbau AG, Stuttgart')
    c.setFont('Helvetica', 11)
    c.drawString(40, H - 62, 'Bilanz zum 30. September 2024 (in TEUR)')
    c.setFont('Helvetica-Bold', 10)
    c.drawString(40, H - 90, 'AKTIVA')
    c.drawString(440, H - 90, 'PASSIVA')
    c.setFont('Helvetica', 8)
    for x in (300, 370, 710, 780):
        c.drawRightString(x, H - 104, '30.09.2024' if x in (300, 710) else '30.09.2023')

    def side(x0, xg, xv, rows):
        y = H - 122
        for label, pid, bold in rows:
            c.setFont('Helvetica-Bold' if bold else 'Helvetica', 9)
            c.drawString(x0, y, label)
            if pid:
                c.setFont('Helvetica', 9)
                c.drawRightString(xg, y, de(gj[pid], 0))
                c.drawRightString(xv, y, de(vj[pid], 0))
            y -= 15

    side(40, 300, 370, [
        ('A. Anlagevermögen', 'akt.A', True),
        ('I. Immaterielle Vermögensgegenstände', 'akt.A.I', False),
        ('II. Sachanlagen', 'akt.A.II', False),
        ('III. Finanzanlagen', 'akt.A.III', False),
        ('B. Umlaufvermögen', 'akt.B', True),
        ('I. Vorräte', 'akt.B.I', False),
        ('II. Forderungen und sonstige Vermögensgegenstände', 'akt.B.II', False),
        ('III. Kassenbestand, Guthaben bei Kreditinstituten', 'akt.B.IV', False),
        ('C. Rechnungsabgrenzungsposten', 'akt.C', True),
        ('', None, False),
        ('Bilanzsumme', 'akt.SUM', True),
    ])
    side(440, 710, 780, [
        ('A. Eigenkapital', 'pas.A', True),
        ('I. Gezeichnetes Kapital', 'pas.A.I', False),
        ('II. Kapitalrücklage', 'pas.A.II', False),
        ('III. Gewinnrücklagen', 'pas.A.III', False),
        ('IV. Bilanzgewinn', 'pas.A.VI', False),
        ('B. Rückstellungen', 'pas.B', True),
        ('C. Verbindlichkeiten', 'pas.C', True),
        ('D. Rechnungsabgrenzungsposten', 'pas.D', True),
        ('', None, False),
        ('', None, False),
        ('Bilanzsumme', 'pas.SUM', True),
    ])
    c.showPage()

    # GuV with a note column and expenses printed negative
    c.setFont('Helvetica-Bold', 14)
    c.drawString(40, H - 45, 'Beispiel Maschinenbau AG, Stuttgart')
    c.setFont('Helvetica', 11)
    c.drawString(40, H - 62, 'Gewinn- und Verlustrechnung vom 1. Oktober 2023 bis 30. September 2024 (TEUR)')
    c.setFont('Helvetica-Bold', 8)
    c.drawRightString(470, H - 90, 'Anhang')
    c.drawRightString(600, H - 90, '2023/2024')
    c.drawRightString(700, H - 90, 'Vorjahr')
    rows = [
        ('1. Umsatzerlöse', 'guv.1', 1, 1),
        ('2. Erhöhung des Bestands an fertigen und unfertigen Erzeugnissen', 'guv.2', 1, None),
        ('3. Sonstige betriebliche Erträge', 'guv.4', 1, 2),
        ('4. Materialaufwand', 'guv.5', -1, 3),
        ('5. Personalaufwand', 'guv.6', -1, 4),
        ('6. Abschreibungen', 'guv.7', -1, None),
        ('7. Sonstige betriebliche Aufwendungen', 'guv.8', -1, 5),
        ('8. Erträge aus Beteiligungen', 'guv.9', 1, None),
        ('9. Sonstige Zinsen und ähnliche Erträge', 'guv.11', 1, None),
        ('10. Zinsen und ähnliche Aufwendungen', 'guv.13', -1, 6),
        ('11. Steuern vom Einkommen und vom Ertrag', 'guv.14', -1, None),
        ('12. Ergebnis nach Steuern', 'guv.15', 1, None),
        ('13. Sonstige Steuern', 'guv.16', -1, None),
        ('14. Jahresüberschuss', 'guv.17', 1, None),
    ]
    y = H - 110
    for label, pid, s, note in rows:
        c.setFont('Helvetica', 9)
        c.drawString(40, y, label)
        if note: c.drawRightString(470, y, str(note))
        c.drawRightString(600, y, de(s * gj[pid], 0))
        c.drawRightString(700, y, de(s * vj[pid], 0))
        y -= 16
    c.showPage()
    c.save()


def scan(src, dst, dpi=200):
    """Rasterises every page in greyscale into an image-only PDF (no text layer)."""
    doc = pymupdf.open(src)
    out = pymupdf.open()
    for page in doc:
        pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY)
        out.new_page(width=page.rect.width, height=page.rect.height).insert_image(page.rect, stream=pix.tobytes('png'))
    out.save(dst, deflate=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    expected = {}
    gj, vj = pharma_data()
    pharma_pdf(os.path.join(OUT, 'muster-pharma-gmbh.pdf'), gj, vj)
    expected['muster-pharma-gmbh.pdf'] = {'company': 'Muster Pharma GmbH', 'year': 2024, 'scale': 1, 'gj': gj, 'vj': vj}
    scan(os.path.join(OUT, 'muster-pharma-gmbh.pdf'), os.path.join(OUT, 'muster-pharma-gmbh-scan.pdf'))
    expected['muster-pharma-gmbh-scan.pdf'] = expected['muster-pharma-gmbh.pdf']
    gj2, vj2 = maschinenbau_data()
    maschinenbau_pdf(os.path.join(OUT, 'beispiel-maschinenbau-ag.pdf'), gj2, vj2)
    expected['beispiel-maschinenbau-ag.pdf'] = {
        'company': 'Beispiel Maschinenbau AG', 'year': 2024, 'scale': 1000,
        'gj': {k: v * 1000 for k, v in gj2.items()}, 'vj': {k: v * 1000 for k, v in vj2.items()},
    }
    with open(os.path.join(OUT, 'expected.json'), 'w', encoding='utf-8') as f:
        json.dump(expected, f, indent=1, ensure_ascii=False, sort_keys=True)
    print('written to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
