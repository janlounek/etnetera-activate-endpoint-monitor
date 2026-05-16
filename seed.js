/**
 * Seeds the database with CSOB sites and their marketing endpoint checks.
 * Sets up parent/child groupings for public portals and private zones.
 * All sites are assigned to the 'csob' client.
 */
const { initDb, createSite, getAllSites, updateSite, getDb, getClientBySlug, createClient } = require('./db/database');

initDb();

// Ensure the CSOB client exists (created automatically by the migration, but make sure here too)
let csobClient = getClientBySlug('csob');
if (!csobClient) {
  const id = createClient({ name: 'CSOB', slug: 'csob' });
  csobClient = { id };
  console.log(`Created 'CSOB' client (id=${id})`);
}
const csobClientId = csobClient.id;

// All check types for public sites
const defaultChecks = [
  { type: 'meta_pixel', config: {} },
  { type: 'google_ads', config: {} },
  { type: 'adform', config: {} },
  { type: 'adobe_analytics', config: { trackingDomain: 'tracking-secure.csob.cz', reportingSuite: 'kbcnvcsobczprod' } },
  { type: 'adobe_launch', config: { customDomain: 'statistics.csob.cz' } },
  { type: 'onetrust', config: {} },
  { type: 'sklik', config: {} },
  { type: 'exponea', config: { apiDomain: 'data-api.csob.cz' } },
];

// Private zones: no marketing endpoints (no Sklik, Google Ads, Adform, Facebook)
const privateChecks = [
  { type: 'adobe_analytics', config: { trackingDomain: 'tracking-secure.csob.cz', reportingSuite: 'kbcnvcsobczprod' } },
  { type: 'adobe_launch', config: { customDomain: 'statistics.csob.cz' } },
  { type: 'onetrust', config: {} },
  { type: 'exponea', config: { apiDomain: 'data-api.csob.cz' } },
];

// Public portals
const publicSites = [
  { name: 'CSOB.cz', url: 'https://www.csob.cz/' },
  { name: 'CSOB Penze', url: 'https://www.csob-penze.cz/' },
  { name: 'CSOB Stavebni', url: 'https://www.csobstavebni.cz/' },
  { name: 'CSOB Hypotecni', url: 'https://www.csobhypotecni.cz/' },
  { name: 'CSOB Leasing', url: 'https://www.csobleasing.cz/' },
  { name: 'CSOB Premium', url: 'https://www.csobpremium.cz/' },
  { name: 'CSOB Private Banking', url: 'https://www.csobpb.cz/' },
  { name: 'Platba Kartou CSOB', url: 'https://platbakartou.csob.cz/' },
  { name: 'CSOB Pojistovna', url: 'https://www.csobpoj.cz/' },
  { name: 'CSOB Asset Management', url: 'https://www.csobam.cz/' },
  { name: 'Pruvodce Podnikanim', url: 'https://www.pruvodcepodnikanim.cz/' },
];

// Private zones mapped to their parent's name
const privateZones = [
  { name: 'CSOB Identita', url: 'https://identita.csob.cz/', parent: 'CSOB.cz' },
  { name: 'CSOB Online', url: 'https://online.csob.cz/odhlaseni', parent: 'CSOB.cz' },
  { name: 'CSOB CEB', url: 'https://ceb.csob.cz/web/public/odhlaseni', parent: 'CSOB.cz' },
  { name: 'CSOB Penze Online', url: 'https://online.csob-penze.cz/', parent: 'CSOB Penze' },
  { name: 'Moje CSOB Stavebni', url: 'https://moje.csobstavebni.cz/', parent: 'CSOB Stavebni' },
  { name: 'Hypotecni Zona', url: 'https://hypotecnizona.csobhypotecni.cz/', parent: 'CSOB Hypotecni' },
  { name: 'Moje CSOB Pojistovna', url: 'https://moje.csobpoj.cz/', parent: 'CSOB Pojistovna' },
];

// Check if sites already exist
const existing = getAllSites();
if (existing.length > 0) {
  console.log(`Database already has ${existing.length} sites. Running migration...`);

  // Migration: set up groupings on existing data
  const siteMap = {};
  for (const s of existing) siteMap[s.name] = s;

  // Update existing private zones with parent_id
  const migrations = [
    { child: 'CSOB Identita', parent: 'CSOB.cz' },
    { child: 'CSOB Penze Online', parent: 'CSOB Penze' },
    { child: 'Moje CSOB Stavebni', parent: 'CSOB Stavebni' },
    { child: 'Hypotecni Zona', parent: 'CSOB Hypotecni' },
  ];

  for (const m of migrations) {
    const child = siteMap[m.child];
    const parent = siteMap[m.parent];
    if (child && parent) {
      updateSite(child.id, { parent_id: parent.id, site_type: 'private' });
      console.log(`  Linked: ${m.child} -> ${m.parent}`);
    }
  }

  // Add new sites if missing
  const newSites = [
    { name: 'CSOB Online', url: 'https://online.csob.cz/odhlaseni', site_type: 'private' },
    { name: 'CSOB CEB', url: 'https://ceb.csob.cz/web/public/odhlaseni', site_type: 'private' },
    { name: 'CSOB Pojistovna', url: 'https://www.csobpoj.cz/', site_type: 'public' },
    { name: 'Moje CSOB Pojistovna', url: 'https://moje.csobpoj.cz/', site_type: 'private' },
    { name: 'CSOB Asset Management', url: 'https://www.csobam.cz/', site_type: 'public' },
    { name: 'Pruvodce Podnikanim', url: 'https://www.pruvodcepodnikanim.cz/', site_type: 'public' },
  ];

  for (const s of newSites) {
    if (!siteMap[s.name]) {
      const checks = s.site_type === 'private' ? privateChecks : defaultChecks;
      const id = createSite({ name: s.name, url: s.url, checks: checks, site_type: s.site_type, client_id: csobClientId });
      console.log(`  Created: ${s.name} (ID: ${id})`);
    } else {
      console.log(`  Already exists: ${s.name}`);
    }
  }

  // Update Adobe Analytics config to include reporting suite on all sites
  const d = getDb();
  const updated = d.prepare(`
    UPDATE site_checks SET config = ? WHERE checker_type = 'adobe_analytics' AND
    config NOT LIKE '%reportingSuite%'
  `).run(JSON.stringify({ trackingDomain: 'tracking-secure.csob.cz', reportingSuite: 'kbcnvcsobczprod' }));
  if (updated.changes > 0) {
    console.log(`  Updated ${updated.changes} Adobe Analytics check(s) with reporting suite: kbcnvcsobczprod`);
  }

  // Remove marketing checks (Sklik, Google Ads, Adform, Facebook) from private zones
  const marketingChecks = ['sklik', 'google_ads', 'adform', 'meta_pixel'];
  const privateSiteIds = getAllSites().filter(s => s.site_type === 'private').map(s => s.id);
  if (privateSiteIds.length > 0) {
    for (const checkType of marketingChecks) {
      const del = d.prepare(
        `DELETE FROM site_checks WHERE checker_type = ? AND site_id IN (${privateSiteIds.join(',')})`
      ).run(checkType);
      if (del.changes > 0) console.log(`  Removed ${checkType} from ${del.changes} private zone(s)`);
    }
  }

  console.log('Migration complete.');
  process.exit(0);
}

// Fresh seed
console.log('Seeding fresh database...');

// Create public portals first
const parentIds = {};
for (const site of publicSites) {
  const id = createSite({ ...site, checks: defaultChecks, site_type: 'public', client_id: csobClientId });
  parentIds[site.name] = id;
  console.log(`  Created: ${site.name} (ID: ${id})`);
}

// Create private zones linked to parents
for (const zone of privateZones) {
  const parentId = parentIds[zone.parent];
  const id = createSite({ name: zone.name, url: zone.url, checks: privateChecks, parent_id: parentId, site_type: 'private', client_id: csobClientId });
  console.log(`  Created: ${zone.name} (ID: ${id}) -> ${zone.parent} (ID: ${parentId})`);
}

console.log(`\nSeeded ${publicSites.length} public sites + ${privateZones.length} private zones.`);
