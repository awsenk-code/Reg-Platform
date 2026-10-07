// Team mode with Microsoft 365. Leave clientId empty to use the app on a single device only.
// See TEAM-SETUP.md for how IT obtains these values. None of them are secrets.
export const TEAM = {
  clientId: '', // Application (client) ID of the app registration in Microsoft Entra
  tenantId: '', // Directory (tenant) ID
  siteHostname: '', // e.g. 'contoso.sharepoint.com'
  sitePath: '', // e.g. '/sites/Eisenhower'
};
