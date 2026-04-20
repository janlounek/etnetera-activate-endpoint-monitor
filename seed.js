/**
 * Seeds the database with CSOB sites and their marketing endpoint checks.
 * Sets up parent/child groupings for public portals and private zones.
 */
const { initDb, createSite, getAllSites, updateSite, getDb } = require('./db/database');

initDb();

// All check types to enable on each site
const defaultChecks = [
  { type: 'meta_pixel', config: {} },
  { type: 'google_ads', config: {} },
  { type: 'adform', config: {} },
  { type: 'adobe_analytics', config: { trackingDomain: 'tracking-secure.csob.cz' } },
  { type: 'adobe_launch', config: { customDomain: 'statistics.csob.cz' } },
  { type: 'onetrust', config: {} },
  { type: 'sklik', config: {} },
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
  ];
  const newZones = newSites;

  for (const zone of newZones) {
    if (!siteMap[zone.name]) {
      const id = createSite({ name: zone.name, url: zone.url, checks: defaultChecks, site_type: zone.site_type || 'public' });
      console.log(`  Created: ${zone.name} (ID: ${id})`);
    } else {
      console.log(`  Already exists: ${zone.name}`);
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
  const id = createSite({ ...site, checks: defaultChecks, site_type: 'public' });
  parentIds[site.name] = id;
  console.log(`  Created: ${site.name} (ID: ${id})`);
}

// Create private zones linked to parents
for (const zone of privateZones) {
  const parentId = parentIds[zone.parent];
  const id = createSite({ name: zone.name, url: zone.url, checks: defaultChecks, parent_id: parentId, site_type: 'private' });
  console.log(`  Created: ${zone.name} (ID: ${id}) -> ${zone.parent} (ID: ${parentId})`);
}

console.log(`\nSeeded ${publicSites.length} public sites + ${privateZones.length} private zones.`);
