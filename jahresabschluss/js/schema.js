// HGB template: balance sheet (§ 266 HGB, full format) and income statement (§ 275 Abs. 2 HGB, nature of expense method).
// Every position has a stable id, its official number and label, its parent (for totals) and the patterns
// that recognise it in a normalised PDF line (see normalizeLabel in parse.js: lower case, umlauts as ae/oe/ue, no punctuation).
//
// sign (income statement only): +1 = income, -1 = expense (stored as a positive amount), 0 = keeps the printed sign.

const P = (id, nr, label, parent, patterns, extra = {}) => ({ id, nr, label, parent, patterns, ...extra });

export const AKTIVA = [
  P('akt.A', 'A.', 'Anlagevermögen', 'akt.SUM', [/^anlagevermoegen\b/]),
  P('akt.A.I', 'I.', 'Immaterielle Vermögensgegenstände', 'akt.A', [/^immaterielle vermoegens/]),
  P('akt.A.I.1', '1.', 'Selbst geschaffene gewerbliche Schutzrechte und ähnliche Rechte und Werte', 'akt.A.I', [/^selbst ?geschaffene/]),
  P('akt.A.I.2', '2.', 'Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte und ähnliche Rechte und Werte sowie Lizenzen', 'akt.A.I', [/entgeltlich erworbene/, /^konzessionen/, /^(gewerbliche )?schutzrechte/, /^software\b/, /^lizenzen/]),
  P('akt.A.I.3', '3.', 'Geschäfts- oder Firmenwert', 'akt.A.I', [/geschaefts ?oder firmenwert/, /^firmenwert/, /^geschaeftswert/]),
  P('akt.A.I.4', '4.', 'Geleistete Anzahlungen', 'akt.A.I', [/^geleistete anzahlungen$/]),
  P('akt.A.II', 'II.', 'Sachanlagen', 'akt.A', [/^sachanlagen$/]),
  P('akt.A.II.1', '1.', 'Grundstücke, grundstücksgleiche Rechte und Bauten', 'akt.A.II', [/^grundstuecke/, /^bauten\b/]),
  P('akt.A.II.2', '2.', 'Technische Anlagen und Maschinen', 'akt.A.II', [/^technische anlagen/]),
  P('akt.A.II.3', '3.', 'Andere Anlagen, Betriebs- und Geschäftsausstattung', 'akt.A.II', [/^andere anlagen/, /^betriebs ?und geschaeftsausstattung/, /geschaeftsausstattung/]),
  P('akt.A.II.4', '4.', 'Geleistete Anzahlungen und Anlagen im Bau', 'akt.A.II', [/anlagen im bau/, /^geleistete anzahlungen$/]),
  P('akt.A.III', 'III.', 'Finanzanlagen', 'akt.A', [/^finanzanlagen$/]),
  P('akt.A.III.1', '1.', 'Anteile an verbundenen Unternehmen', 'akt.A.III', [/^anteile an verbundenen/]),
  P('akt.A.III.2', '2.', 'Ausleihungen an verbundene Unternehmen', 'akt.A.III', [/^ausleihungen an verbundene/]),
  P('akt.A.III.3', '3.', 'Beteiligungen', 'akt.A.III', [/^beteiligungen$/]),
  P('akt.A.III.4', '4.', 'Ausleihungen an Unternehmen, mit denen ein Beteiligungsverhältnis besteht', 'akt.A.III', [/^ausleihungen an unternehmen mit denen/]),
  P('akt.A.III.5', '5.', 'Wertpapiere des Anlagevermögens', 'akt.A.III', [/^wertpapiere des anlagevermoegens/]),
  P('akt.A.III.6', '6.', 'Sonstige Ausleihungen', 'akt.A.III', [/^sonstige ausleihungen/]),
  P('akt.B', 'B.', 'Umlaufvermögen', 'akt.SUM', [/^umlaufvermoegen\b/]),
  P('akt.B.I', 'I.', 'Vorräte', 'akt.B', [/^vorraete$/]),
  P('akt.B.I.1', '1.', 'Roh-, Hilfs- und Betriebsstoffe', 'akt.B.I', [/^roh ?hilfs/]),
  P('akt.B.I.2', '2.', 'Unfertige Erzeugnisse, unfertige Leistungen', 'akt.B.I', [/^unfertige (erzeugnisse|leistungen)/]),
  P('akt.B.I.3', '3.', 'Fertige Erzeugnisse und Waren', 'akt.B.I', [/^fertige erzeugnisse/, /^waren$/]),
  P('akt.B.I.4', '4.', 'Geleistete Anzahlungen', 'akt.B.I', [/^geleistete anzahlungen$/]),
  P('akt.B.II', 'II.', 'Forderungen und sonstige Vermögensgegenstände', 'akt.B', [/^forderungen und sonstige vermoegens/]),
  P('akt.B.II.1', '1.', 'Forderungen aus Lieferungen und Leistungen', 'akt.B.II', [/^forderungen aus lieferungen/]),
  P('akt.B.II.2', '2.', 'Forderungen gegen verbundene Unternehmen', 'akt.B.II', [/^forderungen gegen(ueber)? verbundene/]),
  P('akt.B.II.3', '3.', 'Forderungen gegen Unternehmen, mit denen ein Beteiligungsverhältnis besteht', 'akt.B.II', [/^forderungen gegen(ueber)? unternehmen mit denen/]),
  P('akt.B.II.4', '4.', 'Sonstige Vermögensgegenstände', 'akt.B.II', [/^sonstige vermoegensgegenstaende/]),
  P('akt.B.III', 'III.', 'Wertpapiere', 'akt.B', [/^wertpapiere$/]),
  P('akt.B.III.1', '1.', 'Anteile an verbundenen Unternehmen', 'akt.B.III', [/^anteile an verbundenen/]),
  P('akt.B.III.2', '2.', 'Sonstige Wertpapiere', 'akt.B.III', [/^sonstige wertpapiere/]),
  P('akt.B.IV', 'IV.', 'Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten und Schecks', 'akt.B', [/^kassenbestand/, /guthaben bei kreditinstituten/, /^(liquide|fluessige) mittel/]),
  P('akt.C', 'C.', 'Rechnungsabgrenzungsposten', 'akt.SUM', [/^(aktive )?rechnungsabgrenzungsposten/]),
  P('akt.D', 'D.', 'Aktive latente Steuern', 'akt.SUM', [/^aktive latente steuern/]),
  P('akt.E', 'E.', 'Aktiver Unterschiedsbetrag aus der Vermögensverrechnung', 'akt.SUM', [/^aktiver unterschiedsbetrag/]),
  P('akt.F', 'F.', 'Nicht durch Eigenkapital gedeckter Fehlbetrag', 'akt.SUM', [/^nicht durch eigenkapital gedeckter fehlbetrag/]),
  P('akt.SUM', '', 'Summe Aktiva (Bilanzsumme)', null, [/^summe aktiva/, /^aktiva (gesamt|insgesamt|summe)/, /^bilanzsumme/, /^summe der aktiva/]),
];

export const PASSIVA = [
  P('pas.A', 'A.', 'Eigenkapital', 'pas.SUM', [/^eigenkapital$/]),
  P('pas.A.I', 'I.', 'Gezeichnetes Kapital', 'pas.A', [/^gezeichnetes kapital/, /^stammkapital/, /^grundkapital/]),
  P('pas.A.II', 'II.', 'Kapitalrücklage', 'pas.A', [/^kapitalruecklage/]),
  P('pas.A.III', 'III.', 'Gewinnrücklagen', 'pas.A', [/^gewinnruecklagen$/]),
  P('pas.A.III.1', '1.', 'Gesetzliche Rücklage', 'pas.A.III', [/^gesetzliche ruecklage/]),
  P('pas.A.III.2', '2.', 'Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen', 'pas.A.III', [/^ruecklage fuer anteile/]),
  P('pas.A.III.3', '3.', 'Satzungsmäßige Rücklagen', 'pas.A.III', [/^satzungsmaessige ruecklage/]),
  P('pas.A.III.4', '4.', 'Andere Gewinnrücklagen', 'pas.A.III', [/^andere gewinnruecklagen/]),
  P('pas.A.IV', 'IV.', 'Gewinnvortrag / Verlustvortrag', 'pas.A', [/^(gewinnvortrag|verlustvortrag)/], { negativeIf: /^verlustvortrag$/ }),
  P('pas.A.V', 'V.', 'Jahresüberschuss / Jahresfehlbetrag', 'pas.A', [/^(jahresueberschuss|jahresfehlbetrag)/], { negativeIf: /^jahresfehlbetrag$/ }),
  P('pas.A.VI', '', 'Bilanzgewinn / Bilanzverlust (bei Gewinnverwendung)', 'pas.A', [/^(bilanzgewinn|bilanzverlust)/], { negativeIf: /^bilanzverlust$/ }),
  P('pas.B', 'B.', 'Rückstellungen', 'pas.SUM', [/^rueckstellungen$/]),
  P('pas.B.1', '1.', 'Rückstellungen für Pensionen und ähnliche Verpflichtungen', 'pas.B', [/pensionen/]),
  P('pas.B.2', '2.', 'Steuerrückstellungen', 'pas.B', [/^steuerrueckstellungen/]),
  P('pas.B.3', '3.', 'Sonstige Rückstellungen', 'pas.B', [/^sonstige rueckstellungen/]),
  P('pas.C', 'C.', 'Verbindlichkeiten', 'pas.SUM', [/^verbindlichkeiten$/]),
  P('pas.C.1', '1.', 'Anleihen', 'pas.C', [/^anleihen/]),
  P('pas.C.2', '2.', 'Verbindlichkeiten gegenüber Kreditinstituten', 'pas.C', [/^verbindlichkeiten gegen(ueber)? kreditinstitute/]),
  P('pas.C.3', '3.', 'Erhaltene Anzahlungen auf Bestellungen', 'pas.C', [/^erhaltene anzahlungen/]),
  P('pas.C.4', '4.', 'Verbindlichkeiten aus Lieferungen und Leistungen', 'pas.C', [/^verbindlichkeiten aus lieferungen/]),
  P('pas.C.5', '5.', 'Verbindlichkeiten aus der Annahme gezogener Wechsel und der Ausstellung eigener Wechsel', 'pas.C', [/^verbindlichkeiten aus (der )?annahme/, /wechsel/]),
  P('pas.C.6', '6.', 'Verbindlichkeiten gegenüber verbundenen Unternehmen', 'pas.C', [/^verbindlichkeiten gegen(ueber)? verbundene/]),
  P('pas.C.7', '7.', 'Verbindlichkeiten gegenüber Unternehmen, mit denen ein Beteiligungsverhältnis besteht', 'pas.C', [/^verbindlichkeiten gegen(ueber)? unternehmen mit denen/]),
  P('pas.C.8', '8.', 'Sonstige Verbindlichkeiten', 'pas.C', [/^sonstige verbindlichkeiten/]),
  P('pas.D', 'D.', 'Rechnungsabgrenzungsposten', 'pas.SUM', [/^(passive )?rechnungsabgrenzungsposten/]),
  P('pas.E', 'E.', 'Passive latente Steuern', 'pas.SUM', [/^passive latente steuern/]),
  P('pas.SUM', '', 'Summe Passiva (Bilanzsumme)', null, [/^summe passiva/, /^passiva (gesamt|insgesamt|summe)/, /^bilanzsumme/, /^summe der passiva/]),
];

export const GUV = [
  P('guv.1', '1.', 'Umsatzerlöse', null, [/^umsatzerloese/], { sign: 1 }),
  P('guv.2', '2.', 'Erhöhung oder Verminderung des Bestands an fertigen und unfertigen Erzeugnissen', null, [/bestand(es|s)? an (fertigen|unfertigen)/, /^bestandsveraenderung/, /^(erhoehung|verminderung) (oder|bzw|und) (erhoehung|verminderung)/], { sign: 0 }),
  P('guv.3', '3.', 'Andere aktivierte Eigenleistungen', null, [/aktivierte eigenleistungen/], { sign: 1 }),
  P('guv.4', '4.', 'Sonstige betriebliche Erträge', null, [/^sonstige betriebliche ertraege/], { sign: 1 }),
  P('guv.5', '5.', 'Materialaufwand', null, [/^materialaufwand/], { sign: -1 }),
  P('guv.5a', 'a)', 'Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren', 'guv.5', [/^(aufwendungen fuer )?roh ?hilfs/, /fuer bezogene waren/], { sign: -1 }),
  P('guv.5b', 'b)', 'Aufwendungen für bezogene Leistungen', 'guv.5', [/^(aufwendungen fuer )?bezogene leistungen/], { sign: -1 }),
  P('guv.6', '6.', 'Personalaufwand', null, [/^personalaufwand/], { sign: -1 }),
  P('guv.6a', 'a)', 'Löhne und Gehälter', 'guv.6', [/^loehne und gehaelter/], { sign: -1 }),
  P('guv.6b', 'b)', 'Soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung', 'guv.6', [/^soziale abgaben/], { sign: -1 }),
  P('guv.7', '7.', 'Abschreibungen', null, [/^abschreibungen$/], { sign: -1 }),
  P('guv.7a', 'a)', 'auf immaterielle Vermögensgegenstände des Anlagevermögens und Sachanlagen', 'guv.7', [/^(abschreibungen )?auf immaterielle/], { sign: -1 }),
  P('guv.7b', 'b)', 'auf Vermögensgegenstände des Umlaufvermögens, soweit diese die üblichen Abschreibungen überschreiten', 'guv.7', [/^(abschreibungen )?auf vermoegensgegenstaende des umlauf/], { sign: -1 }),
  P('guv.8', '8.', 'Sonstige betriebliche Aufwendungen', null, [/^sonstige betriebliche aufwendungen/], { sign: -1 }),
  P('guv.9', '9.', 'Erträge aus Beteiligungen', null, [/^ertraege aus beteiligungen/], { sign: 1 }),
  P('guv.9a', '', 'Erträge aus Gewinnabführungsverträgen', null, [/ertraege aus gewinnabfuehrung/, /gewinnabfuehrungsvertr\w* erhaltene gewinne/], { sign: 1 }),
  P('guv.10', '10.', 'Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens', null, [/^ertraege aus anderen wertpapieren/], { sign: 1 }),
  P('guv.11', '11.', 'Sonstige Zinsen und ähnliche Erträge', null, [/^sonstige zinsen/, /^zinsertraege/], { sign: 1 }),
  P('guv.12', '12.', 'Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens', null, [/^abschreibungen auf finanzanlagen/], { sign: -1 }),
  P('guv.12a', '', 'Aufwendungen aus Verlustübernahme', null, [/^aufwendungen aus verlustuebernahme/], { sign: -1 }),
  P('guv.13', '13.', 'Zinsen und ähnliche Aufwendungen', null, [/^zinsen und aehnliche aufwendungen/, /^zinsaufwendungen/], { sign: -1 }),
  P('guv.14', '14.', 'Steuern vom Einkommen und vom Ertrag', null, [/^steuern vom einkommen/], { sign: -1 }),
  P('guv.15', '15.', 'Ergebnis nach Steuern', null, [/^ergebnis nach steuern/], { sign: 0 }),
  P('guv.16', '16.', 'Sonstige Steuern', null, [/^sonstige steuern/], { sign: -1 }),
  P('guv.16a', '', 'Aufgrund eines Gewinnabführungsvertrags abgeführte Gewinne', null, [/abgefuehrte gewinne/], { sign: -1 }),
  P('guv.17', '17.', 'Jahresüberschuss / Jahresfehlbetrag', null, [/^(jahresueberschuss|jahresfehlbetrag|jahresergebnis)/], { sign: 0, negativeIf: /^jahresfehlbetrag$/ }),
];

export const STATEMENTS = [
  { key: 'aktiva', title: 'Aktiva', positions: AKTIVA },
  { key: 'passiva', title: 'Passiva', positions: PASSIVA },
  { key: 'guv', title: 'Gewinn- und Verlustrechnung', positions: GUV },
];

// Flat list in template order; `order` is the index inside its statement (used to follow the printed sequence).
export const POSITIONS = STATEMENTS.flatMap((s) => s.positions.map((p, order) => ({ ...p, statement: s.key, order })));
export const BY_ID = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));

export const CHILDREN = {};
for (const p of POSITIONS) if (p.parent) (CHILDREN[p.parent] ||= []).push(p.id);

// Nesting depth for indentation (0 = top level).
export function depth(id) {
  let d = 0;
  for (let p = BY_ID[id]; p?.parent && BY_ID[p.parent]?.parent; p = BY_ID[p.parent]) d++;
  return d;
}

export function ancestors(id) {
  const out = [];
  for (let p = BY_ID[id]?.parent; p; p = BY_ID[p]?.parent) out.push(p);
  return out;
}
