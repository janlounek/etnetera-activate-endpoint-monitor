/**
 * Seeds the database with CSOB sites and their marketing endpoint checks.
 */
const { initDb, createSite, getAllSites } = require('./db/database');

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

const sites = [
  { name: 'CSOB.cz', url: 'https://www.csob.cz/' },
  { name: 'CSOB Identita', url: 'https://identita.csob.cz/' },
  { name: 'CSOB Penze', url: 'https://www.csob-penze.cz/' },
  { name: 'CSOB Stavebni', url: 'https://www.csobstavebni.cz/' },
  { name: 'CSOB Hypotecni', url: 'https://www.csobhypotecni.cz/' },
  { name: 'CSOB Leasing', url: 'https://www.csobleasing.cz/' },
  { name: 'CSOB Premium', url: 'https://www.csobpremium.cz/' },
  { name: 'CSOB Private Banking', url: 'https://www.csobpb.cz/' },
  { name: 'Platba Kartou CSOB', url: 'https://platbakartou.csob.cz/' },
  { name: 'Moje CSOB Stavebni', url: 'https://moje.csobstavebni.cz/' },
  { name: 'Hypotecni Zona', url: 'https://hypotecnizona.csobhypotecni.cz/' },
  { name: 'CSOB Penze Online', url: 'https://online.csob-penze.cz/' },
];

// Check if sites already exist
const existing = getAllSites();
if (existing.length > 0) {
  console.log(`Database already has ${existing.length} sites. Skipping seed.`);
  console.log('To re-seed, delete marketing-monitor.db first.');
  process.exit(0);
}

for (const site of sites) {
  const id = createSite({ ...site, checks: defaultChecks });
  console.log(`  Created: ${site.name} (ID: ${id}) with ${defaultChecks.length} checks`);
}

console.log(`\nSeeded ${sites.length} sites with ${defaultChecks.length} checks each.`);
