/** Dated contact, agreements, research, civic and religious developments. */
import type { NewspaperEvent, NewspaperSnapshot, NewspaperSourceReference } from '../../../../mcp-server/dist/newspaper/evidence.js';
import type { DevelopmentEnvironment } from './development-facts.js';
import { number, identity } from './development-facts.js';

/** Bundle related dated events using their semantic identities and supporting observations. */
export function detectEventDevelopments(env: DevelopmentEnvironment): void {
  const { evidence, definition, context, cutoff, previous, receiver, tuning, maxGap, own, result, add, playerName } = env;
  if (definition.detector === 'cityReligion') { detectReligionChanges(env); return; }
  // Event groups use semantic identities, so duplicate representations become one development.
  const groups = new Map<string, { subject: number; events: NewspaperEvent[]; values: Record<string, string | number>; topic: string; support: NewspaperSnapshot[] }>();
  for (const event of [...evidence.events].sort((a, b) => a.source.turn - b.source.turn || a.source.createdAt - b.source.createdAt || a.source.id - b.source.id)) {
    if (event.source.turn <= previous || event.source.turn > cutoff) continue;
    const value = event.values;
    let subject: number | undefined;
    let topic: string = definition.detector;
    let key: string | undefined;
    let values: Record<string, string | number> = {};
    let support: NewspaperSnapshot[] = [];
    if (definition.detector === 'firstContact' && event.type === 'TeamMeet' && context.receiverTeamId !== undefined) {
      const other = value.CurrentTeamID === context.receiverTeamId ? value.OtherTeamID : value.OtherTeamID === context.receiverTeamId ? value.CurrentTeamID : undefined;
      const members = Object.entries(context.playerTeamIds ?? {}).filter(([, team]) => team === other);
      if (typeof other === 'number' && other !== context.receiverTeamId && members.length) {
        subject = Number(members[0][0]); key = `team/${other}`;
        values = { partners: members.map(([id]) => playerName(Number(id))).join(', ') };
      }
    } else if (definition.detector === 'tradePlunder' && event.type === 'PlayerPlunderedTradeRoute' &&
      (value.OriginOwnerID === receiver || value.DestinationOwnerID === receiver)) {
      subject = receiver; key = `plunder/${receiver}`;
    } else if (definition.detector === 'deal' && event.type === 'DealMade') {
      const partner = value.FromPlayerID === receiver ? value.ToPlayerID : value.ToPlayerID === receiver ? value.FromPlayerID : undefined;
      const items = Array.isArray(value.TradedItems) ? value.TradedItems.filter(item => item && typeof item === 'object') as Record<string, unknown>[] : [];
      if (typeof partner === 'number' && items.length) {
        const treaties = items.filter(item => ['OpenBorders', 'DefensivePact', 'ResearchAgreement', 'DeclarationOfFriendship', 'Vassalage', 'VassalageRevoke'].includes(String(item.ItemType)));
        const economy = own && own.source.turn <= event.source.turn ? own : evidence.comparisons.players.filter(row => row.subjectID === receiver && row.source.turn <= event.source.turn).sort((a, b) => a.source.turn - b.source.turn).at(-1);
        const gold = economy ? number(economy, 'Gold') : undefined;
        const income = economy ? number(economy, 'GoldPerTurn') : undefined;
        const economic = items.filter(item => economy && event.source.turn - economy.source.turn <= maxGap && typeof item.Data1 === 'number' && item.Data1 > 0 &&
          (item.ItemType === 'Gold' && gold !== undefined && item.Data1 >= (tuning.absolute ?? 50) && item.Data1 >= Math.abs(gold) * (tuning.relative ?? 0.25) ||
           item.ItemType === 'GoldPerTurn' && income !== undefined && item.Data1 >= (tuning.reserve ?? 10) && item.Data1 >= Math.abs(income) * (tuning.relative ?? 0.25)));
        const selected = [...treaties, ...economic];
        if (selected.length && (treaties.length || economy && event.source.turn - economy.source.turn <= maxGap)) {
          subject = partner; key = `deal/${event.source.table}/${event.source.id}`;
          values = { terms: [...new Set(selected.map(item => String(item.ItemType)))].join(', '), significantTerms: selected.length };
          if (economic.length && economy) support = [economy];
        }
      }
    } else if (definition.detector === 'era' && event.type === 'TeamSetEra' && typeof value.TeamID === 'number') {
      const members = Object.entries(context.playerTeamIds ?? {}).filter(([, team]) => team === value.TeamID);
      subject = value.TeamID === context.receiverTeamId ? receiver : members.length ? Number(members[0][0]) : undefined;
      if (subject !== undefined) {
        key = `era/${value.TeamID}`;
        const observed = [...evidence.players, ...evidence.comparisons.players].find(row => row.subjectID === subject && row.source.turn === event.source.turn && identity(row.values.Era));
        values = { era: identity(value.NewEra) ?? identity(observed?.values.Era) ?? 'a new era', eraIdentity: String(value.NewEra), eraTeam: value.TeamID };
        topic = 'research';
        if (observed) support = [observed];
      }
    } else if (definition.detector === 'technology' && ['TeamTechResearched', 'TeamSetHasTech'].includes(event.type) &&
      context.receiverTeamId !== undefined && value.TeamID === context.receiverTeamId && (event.type !== 'TeamSetHasTech' || value.HasTech === true || value.HasTech === 1) &&
      (event.type !== 'TeamTechResearched' || typeof value.ChangeAmount === 'number' && value.ChangeAmount > 0)) {
      const technology = typeof value.TechID === 'string' ? value.TechID : context.technologyIdentities?.[String(value.TechID)]?.name;
      const type = context.technologyIdentities?.[String(value.TechID)]?.type;
      if (technology && (tuning.identities ?? []).some(name => name === technology || name === type)) {
        subject = receiver; key = `technology/${technology}`; values = { technology }; topic = 'research';
      }
    } else if (definition.detector === 'policy' && ['PlayerAdoptPolicy', 'PlayerAdoptPolicyBranch'].includes(event.type) && value.PlayerID === receiver) {
      const policy = identity(event.type === 'PlayerAdoptPolicyBranch' ? value.BranchType : value.PolicyID);
      if (policy) { subject = receiver; key = 'policies'; values = { policies: policy }; }
    } else if (definition.detector === 'ideology' && event.type === 'IdeologySwitched' && value.PlayerID === receiver) {
      const old = identity(value.OldBranchType); const current = identity(value.NewBranchType);
      if (old && current && old !== current) { subject = receiver; key = 'ideology'; values = { previousIdeology: old, ideology: current }; }
    } else if (definition.detector === 'religionMilestone' && event.type === definition.stage && typeof value.PlayerID === 'number') {
      const religion = identity(value.ReligionID ?? value.ReligionType) ?? (event.type === 'PantheonFounded' ? 'a pantheon' : undefined);
      if (religion) { subject = value.PlayerID; key = `${event.type}/${subject}/${religion}`; values = { religion }; topic = 'religion'; }
    }
    if (subject === undefined || key === undefined) continue;
    const old = groups.get(key);
    if (old) {
      old.events.push(event);
      old.support.push(...support);
      if (definition.detector === 'era' || definition.detector === 'ideology') old.values = values;
      if (definition.detector === 'policy') old.values.policies = [...new Set([String(old.values.policies), String(values.policies)])].join(', ');
    } else groups.set(key, { subject, events: [event], values, topic, support });
  }
  for (const group of groups.values()) {
    const { subject, events, values, topic } = group;
    if (definition.detector === 'policy') values.policies = [...new Set(events.map(event => identity(event.values.PolicyID ?? event.values.BranchType)).filter(Boolean))].join(', ');
    if (definition.detector === 'tradePlunder') {
      const incidents = [...new Map(events.map(event => [`${event.source.table}/${event.source.id}`, event])).values()];
      values.plunderEvents = incidents.length;
      const amounts = incidents.map(event => event.values.PlunderGoldValue);
      values.plunderGold = amounts.every(amount => typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) ?
        (amounts as number[]).reduce((sum, amount) => sum + amount, 0) : 'not recorded for every event';
    }
    add(`civilization/${subject}`, definition.detector === 'deal' ? `diplomacy/${receiver}/${subject}/exchange` : `civilization/${subject}/${topic}`,
      definition.detector === 'deal' ? Number(values.significantTerms) : definition.detector === 'policy' ?
        new Set(events.map(event => identity(event.values.PolicyID ?? event.values.BranchType))).size :
        definition.detector === 'tradePlunder' ? Number(values.plunderEvents) : 1,
      { partnerId: subject, partner: playerName(subject), scope: subject === receiver ? 'domestic' : 'international',
        eventTurn: Math.max(...[...events, ...group.support].map(event => event.source.turn)), ...values }, [...events, ...group.support],
      `${definition.detector}: ${JSON.stringify(values)}.`);
    if (['technology', 'era', 'firstContact', 'religionMilestone'].includes(definition.detector)) {
      result.at(-1)!.fingerprint = definition.detector === 'era' ? `${definition.id}/team/${values.eraTeam}/${values.eraIdentity}` :
        `${definition.id}/${subject}/${values.technology ?? values.religion ?? values.partners}`;
    }
  }
}
/** Require an observed majority transition because follower changes also produce conversion events. */
function detectReligionChanges(env: DevelopmentEnvironment): void {
  const { evidence, cutoff, previous, window, receiver, add, playerName } = env;
  if (evidence.limitations?.length) return;
  type Observation = { religion?: string; owner: number; source: NewspaperSourceReference; seen: Set<string> };
  const states = new Map<string, Observation>();
  const changes = new Map<number, { cities: Set<string>; religions: Set<string>; reversals: Set<string>; rows: { source: NewspaperSourceReference }[]; count: number }>();
  const events = evidence.events.filter(event => event.type === 'CityConvertsReligion' && event.source.turn > previous && event.source.turn <= cutoff)
    .sort((a, b) => a.source.turn - b.source.turn || a.source.createdAt - b.source.createdAt || a.source.id - b.source.id);
  for (const event of events) {
    const { CityX: x, CityY: y, OwnerID: owner } = event.values;
    const religion = identity(event.values.ReligionID);
    if (typeof x !== 'number' || typeof y !== 'number' || typeof owner !== 'number' || !religion) continue;
    const key = `${x}/${y}`;
    let state = states.get(key);
    const matchingCities = [...evidence.comparisons.cities, ...evidence.cities].filter(row => row.values.X === x && row.values.Y === y);
    const cityIds = new Set(matchingCities.map(row => row.subjectID));
    const before = matchingCities.filter(row =>
      row.source.turn >= event.source.turn - window && (row.source.turn < event.source.turn || row.source.turn === event.source.turn && row.source.createdAt < event.source.createdAt))
      .sort((a, b) => a.source.turn - b.source.turn || a.source.createdAt - b.source.createdAt || a.source.id - b.source.id).at(-1);
    if (before && (!state || before.source.turn > state.source.turn || before.source.turn === state.source.turn && before.source.createdAt > state.source.createdAt)) {
      const known = before.values.Owner === playerName(owner) ? identity(before.values.MajorityReligion) : undefined;
      state = { religion: known, owner, source: before.source, seen: new Set(known ? [known] : []) };
    }
    const lifecycle = state && evidence.events.some(change => ['CityCaptureComplete', 'CityFlipped', 'PlayerLiberated', 'CityRazed'].includes(change.type) &&
      (change.source.turn > state!.source.turn || change.source.turn === state!.source.turn && change.source.createdAt >= state!.source.createdAt) &&
      (change.source.turn < event.source.turn || change.source.turn === event.source.turn && change.source.createdAt <= event.source.createdAt) &&
      (change.values.CityX === x && change.values.CityY === y || typeof change.values.CityID === 'number' &&
        (cityIds.has(change.values.CityID) || cityIds.size === 0 && change.values.CityX === undefined)));
    if (state && state.owner === owner && state.religion && !lifecycle && state.religion !== religion) {
      const group = changes.get(owner) ?? { cities: new Set<string>(), religions: new Set<string>(), reversals: new Set<string>(), rows: [], count: 0 };
      group.cities.add(key); group.religions.add(religion); group.count++;
      if (state.seen.has(religion)) group.reversals.add(key);
      group.rows.push({ source: state.source }, event); changes.set(owner, group);
    }
    const seen = state && state.owner === owner && !lifecycle ? state.seen : new Set<string>();
    seen.add(religion); states.set(key, { religion, owner, source: event.source, seen });
  }
  for (const [owner, group] of changes) add(`civilization/${owner}`, `civilization/${owner}/religion`, group.cities.size,
    { partnerId: owner, partner: playerName(owner), scope: owner === receiver ? 'domestic' : 'international', conversions: group.cities.size,
      changes: group.count, religions: [...group.religions].join(', '), reversals: group.reversals.size }, group.rows,
    `Observed majority religion changed in ${group.cities.size} cities, with ${group.reversals.size} observed returns to an earlier majority.`);
}
