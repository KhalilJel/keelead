/** Registered-name discovery only: no guessed category, contact, website or consent. */
export async function searchRegistry(query, options, fetcher = globalThis.fetch) {
  const location = options.location?.trim() ?? '';
  const municipality = /^oslo$/i.test(location) ? '0301' : /^\d{4}$/.test(location) ? location : undefined;
  // An unsupported location is not silently searched across another country.
  if (!municipality) return { applicable: false, leads: [] };
  const escapedLocation = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = query.replace(new RegExp(`\\b${escapedLocation}\\b`, 'gi'), ' ')
    .replace(/\b(web)\s+(design)\b/gi, '$1$2')
    .replace(/\b(find|leads|businesses|business|companies|company|in|near)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!name) return { applicable: false, leads: [] };
  const url = new URL('https://data.brreg.no/enhetsregisteret/api/enheter');
  url.searchParams.set('navn', name);
  url.searchParams.set('forretningsadresse.kommunenummer', municipality);
  url.searchParams.set('organisasjonsform', 'AS,ASA');
  url.searchParams.set('size', String(Math.min(options.count, 50)));
  const response = await fetcher(url, { headers: { Accept: 'application/json', 'User-Agent': 'KeeLead/1.0' } });
  const data = await response.json();
  const leads = (data._embedded?.enheter ?? []).filter(unit =>
    /^\d{9}$/.test(unit.organisasjonsnummer) && typeof unit.navn === 'string' &&
    ['AS', 'ASA'].includes(unit.organisasjonsform?.kode) && !unit.konkurs &&
    !unit.underAvvikling && !unit.underTvangsavviklingEllerTvangsopplosning &&
    unit.forretningsadresse?.kommunenummer === municipality
  ).map(unit => {
    const sourceUrl = `https://data.brreg.no/enhetsregisteret/api/enheter/${unit.organisasjonsnummer}`;
    return { firstName: '', lastName: '', company: unit.navn, source: 'Brønnøysundregistrene',
      ...(unit.hjemmeside ? { website: unit.hjemmeside } : {}),
      location: unit.forretningsadresse?.poststed,
      metadata: { url: sourceUrl, organizationNumber: unit.organisasjonsnummer,
        municipalityNumber: municipality, registeredNameQuery: name, matchType: 'registered-name', qualified: false } };
  });
  return { applicable: true, leads };
}
