# Team-Modus einrichten (Microsoft 365)

Anleitung für die IT. Aufwand: ca. 15 Minuten, einmalig.

## Ergebnis

- Teammitglieder melden sich mit ihrem **Microsoft-Firmenkonto** an (Entra ID, inkl. MFA/Conditional Access).
- Projekte und Aufgaben liegen in **drei SharePoint-Listen** einer Team-Website (`EisenhowerProjects`, `EisenhowerTasks`, `EisenhowerMembers`). Die App legt sie beim ersten Start selbst an.
- Als „privat“ markierte Aufgaben liegen im **OneDrive des jeweiligen Nutzers** (`Apps/Eisenhower Matrix/eisenhower-private.json`) und sind für andere nicht sichtbar.
- Es fließen keine Daten zu Dritten: Die App ist eine statische Web-App, alle Daten bleiben im eigenen Tenant.

## 1. SharePoint-Website

1. Eine Team-Website anlegen (oder eine bestehende nutzen), z. B. `https://contoso.sharepoint.com/sites/Eisenhower`.
2. Alle Teammitglieder als **Mitglieder** (Berechtigungsstufe *Bearbeiten*) hinzufügen.

## 2. App-Registrierung in Microsoft Entra

1. <https://entra.microsoft.com> → **Anwendungen** → **App-Registrierungen** → **Neue Registrierung**
2. Name: `Eisenhower Matrix`
3. Unterstützte Kontotypen: **Nur Konten in diesem Organisationsverzeichnis**
4. Umleitungs-URI: Plattform **Single-Page-Anwendung (SPA)**, URI:
   `https://awsenk-code.github.io/Reg-Platform/eisenhower/`
   (exakt so, mit `/` am Ende; bei anderem Hosting die dortige Adresse)
5. **Registrieren**

## 3. Berechtigungen

In der App-Registrierung → **API-Berechtigungen** → **Berechtigung hinzufügen** → **Microsoft Graph** → **Delegierte Berechtigungen**:

| Berechtigung | Wofür |
| --- | --- |
| `User.Read` | Name und E-Mail des angemeldeten Nutzers |
| `Sites.ReadWrite.All` | Projekte und Aufgaben in den SharePoint-Listen lesen und schreiben |
| `Sites.Manage.All` | Einmaliges Anlegen der drei Listen beim ersten Start |
| `Files.ReadWrite.AppFolder` | Private Aufgaben im eigenen App-Ordner in OneDrive (kein Zugriff auf andere Dateien) |

Danach **Administratorzustimmung für <Organisation> erteilen** klicken.

> Alle Berechtigungen sind *delegiert*: Die App kann nur das, was der angemeldete Nutzer selbst darf. Ohne Mitgliedschaft auf der Team-Website sieht man keine Teamdaten.
> `Sites.Manage.All` kann nach dem ersten erfolgreichen Start wieder entfernt werden.

Optional, um die Nutzung auf das Team zu beschränken: **Unternehmensanwendungen** → `Eisenhower Matrix` → **Eigenschaften** → *Zuweisung erforderlich* = **Ja**, dann unter **Benutzer und Gruppen** das Team zuweisen.

## 4. Werte eintragen

Aus der Übersicht der App-Registrierung:

- **Anwendungs-ID (Client-ID)**
- **Verzeichnis-ID (Mandanten-ID)**

Diese zusammen mit Hostname und Pfad der Website in `eisenhower/js/config.js` eintragen:

```js
export const TEAM = {
  clientId: '00000000-0000-0000-0000-000000000000',
  tenantId: '00000000-0000-0000-0000-000000000000',
  siteHostname: 'contoso.sharepoint.com',
  sitePath: '/sites/Eisenhower',
};
```

Nach dem Veröffentlichen (Merge nach `main`) zeigt die App beim nächsten Öffnen „Sign in with Microsoft“.

> Hinweis: Das Repository ist öffentlich. Client-ID, Mandanten-ID und SharePoint-Adresse sind keine Geheimnisse (ohne Anmeldung und Berechtigung kommt niemand an Daten), werden aber sichtbar. Wer das nicht möchte, macht das Repository privat (GitHub Pages benötigt dann einen kostenpflichtigen GitHub-Plan) oder hostet die App z. B. als Azure Static Web App.

## 5. Erster Start

1. Eine Person mit Mitglieds-Rechten auf der Website meldet sich zuerst an. Die App legt die drei Listen an.
2. Danach melden sich die anderen an. Jedes Mitglied erscheint automatisch mit eigener Farbe.
3. Auf iPhone/iPad: App aus Safari zum Home-Bildschirm hinzufügen und **aus dem Home-Bildschirm heraus** anmelden. Die Anmeldung öffnet kurz die Microsoft-Seite innerhalb der App und kehrt dann zurück.

## Fehlerbehebung

| Meldung | Ursache |
| --- | --- |
| `AADSTS50011` (Redirect URI mismatch) | Umleitungs-URI in Schritt 2 weicht von der Adresse der App ab (Schrägstrich am Ende?) oder ist nicht als *SPA* registriert. |
| `AADSTS65001` (consent) | Administratorzustimmung in Schritt 3 fehlt. |
| `Access denied` / 403 beim Sync | Nutzer ist kein Mitglied der SharePoint-Website. |
| Sync-Punkt oben rechts rot | In den Einstellungen steht die genaue Fehlermeldung. |
