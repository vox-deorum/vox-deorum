import type { NewspaperEvent } from '../../../../../mcp-server/dist/newspaper/evidence.js';
import { isRecord } from '../../../utils/guards.js';
import type { FactBuildContext } from './model.js';

const commerce = new Set(['Gold', 'GoldPerTurn', 'Resources']);
const established = new Set(['OpenBorders', 'DefensivePact', 'DeclarationOfFriendship', 'Vassalage',
  'VassalageRevoke', 'ThirdPartyWar', 'ThirdPartyPeace']);
const dealItems = new Set([...commerce, ...established, 'AllowEmbassy', 'ResearchAgreement', 'Maps', 'Techs',
  'Cities', 'VoteCommitment', 'PeaceTreaty']);

type DealItem = { type: string; giver: number; data1?: number; data2?: number };
type Direction = 'buy' | 'sell' | 'exchange' | 'gift-in' | 'gift-out' | 'grant' | 'receive';

/** Read a recorded term list; Lua writes an empty list as an empty object in some recordings. */
function dealTerms(value: unknown): string[] | undefined {
  if (isRecord(value) && !Object.keys(value).length) return [];
  if (Array.isArray(value) && value.every(term => typeof term === 'string' && term.trim().length)) return value;
  return undefined;
}

/** Identify the terms and the direction used by completed-deal stories. */
export function classifyDeal(event: NewspaperEvent, receiver: number) {
  if (event.type !== 'DealMade') return;
  const { FromPlayerID: from, ToPlayerID: to, TradedItems: raw } = event.values;
  if (typeof from !== 'number' || typeof to !== 'number' || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) ||
      from === to || !Array.isArray(raw) || !raw.length) return;
  const items: DealItem[] = [];
  for (const row of raw) {
    if (!isRecord(row) || typeof row.ItemType !== 'string' || !dealItems.has(row.ItemType) ||
        (row.FromPlayerID !== from && row.FromPlayerID !== to)) return;
    items.push({ type: row.ItemType, giver: row.FromPlayerID,
      data1: typeof row.Data1 === 'number' ? row.Data1 : undefined,
      data2: typeof row.Data2 === 'number' ? row.Data2 : undefined });
  }

  const types = new Set(items.map(item => item.type));
  const left = dealTerms(event.values.FromGives);
  const right = dealTerms(event.values.ToGives);
  const printable = left !== undefined && right !== undefined &&
    left.length === items.filter(item => item.giver === from).length &&
    right.length === items.filter(item => item.giver === to).length;
  const ours = receiver === from || receiver === to;
  const canReport = ours && printable;
  const base = { from, to, clauses: items };
  if (types.has('PeaceTreaty')) return { ...base, kind: 'peace-treaty' };
  if (!canReport) return base;

  const weGive = (receiver === from ? left : right).join(', ') || null;
  const weGet = (receiver === from ? right : left).join(', ') || null;
  const result = { ...base, weGive, weGet };
  if (items.every(item => commerce.has(item.type)))
    return { ...result, kind: weGive && weGet ? 'trade-deal' : 'trade-gift' };

  const nonCommercial = items.filter(item => !commerce.has(item.type));
  const kinds = new Set(nonCommercial.map(item => item.type === 'ThirdPartyWar' || item.type === 'ThirdPartyPeace'
    ? item.type + '/' + item.data1 : item.type));
  if (kinds.size === 1) {
    const type = nonCommercial[0].type;
    const give = nonCommercial.some(item => item.giver === receiver);
    const get = nonCommercial.some(item => item.giver !== receiver);
    const recurringOrGoods = types.has('GoldPerTurn') || types.has('Resources');
    if (type === 'Techs' || type === 'Maps') {
      // A payment from the recipient is part of a sale. Goods or recurring payments on the transfer side add a clause.
      const mixed = items.some(item => commerce.has(item.type) && item.type !== 'Gold' &&
        nonCommercial.some(transfer => transfer.giver === item.giver));
      if (!mixed) {
        const direction: Direction = give && get ? 'exchange' : give ? (weGet ? 'sell' : 'gift-out') :
          (weGive ? 'buy' : 'gift-in');
        return { ...result, kind: type === 'Techs' ? 'technology-deal' : 'map-deal', direction };
      }
    } else if (!recurringOrGoods) {
      if (type === 'AllowEmbassy') {
        const direction: Direction = give && get ? 'exchange' : give ? 'grant' : 'receive';
        return { ...result, kind: 'embassy-agreement', direction };
      }
      if (type === 'ResearchAgreement') return { ...result, kind: 'research-agreement' };
      return { ...result, kind: established.has(type) ? 'existing-agreement' : 'other-diplomatic-deal' };
    }
  }
  return { ...result, kind: 'comprehensive-agreement' };
}

const dealEffects = new WeakMap<FactBuildContext, Map<string, NewspaperEvent[]>>();

/** Match a recorded effect to the transaction that applied it, before DealMade was emitted. */
export function coveringDeal(event: NewspaperEvent, context: FactBuildContext): NewspaperEvent | undefined {
  const { Tech, TeamID, ChangeAmount, CityX, CityY, OldOwnerID, NewOwnerID, IsConquest } = event.values;
  let key: string;
  if (event.type === 'TeamTechResearched' && typeof Tech === 'string' && typeof TeamID === 'number' &&
      (ChangeAmount === undefined || typeof ChangeAmount === 'number' && ChangeAmount > 0)) {
    key = JSON.stringify([event.source.turn, 'tech', TeamID, Tech]);
  } else if (event.type === 'CityCaptureComplete' && (IsConquest === false || IsConquest === 0) &&
      [CityX, CityY, OldOwnerID, NewOwnerID].every(Number.isSafeInteger)) {
    key = JSON.stringify([event.source.turn, 'city', OldOwnerID, NewOwnerID, CityX, CityY]);
  } else return;
  const matches = (dealEffectIndex(context).get(key) ?? []).filter(deal => deal.source.id > event.source.id);
  return matches.length === 1 ? matches[0] : undefined;
}

/** Index only reportable effects with the recorded recipient and the specific technology or plot. */
function dealEffectIndex(context: FactBuildContext): Map<string, NewspaperEvent[]> {
  const existing = dealEffects.get(context);
  if (existing) return existing;
  const effects = new Map<string, NewspaperEvent[]>();
  dealEffects.set(context, effects);
  const allowed = new Set(['technology-deal', 'comprehensive-agreement', 'other-diplomatic-deal']);
  const visible = new Set(context.players.map(player => player.subjectID));
  for (const event of context.events) {
    const deal = classifyDeal(event, context.receiverId);
    if (!deal || !('kind' in deal) || !allowed.has(deal.kind) ||
        ![deal.from, deal.to].every(player => visible.has(player) && context.playerAt(player, event.source.turn))) continue;
    const partner = deal.from === context.receiverId ? deal.to : deal.from;
    if (!context.metadata.playerIdentities?.[partner]?.name) continue;
    const left = dealTerms(event.values.FromGives) ?? [];
    const right = dealTerms(event.values.ToGives) ?? [];
    let fromIndex = 0;
    let toIndex = 0;
    for (const clause of deal.clauses) {
      const giverIsFrom: boolean = clause.giver === deal.from;
      const label = giverIsFrom ? left[fromIndex++] : right[toIndex++];
      const recipient = giverIsFrom ? deal.to : deal.from;
      let detail: unknown[] | undefined;
      if (clause.type === 'Techs' && label?.startsWith('Technology: ')) {
        const team = context.metadata.playerIdentities?.[recipient]?.teamId;
        if (team !== undefined) detail = ['tech', team, label.slice('Technology: '.length)];
      } else if (clause.type === 'Cities' && Number.isSafeInteger(clause.data1) && Number.isSafeInteger(clause.data2)) {
        detail = ['city', clause.giver, recipient, clause.data1, clause.data2];
      }
      if (!detail) continue;
      const key = JSON.stringify([event.source.turn, ...detail]);
      const candidates = effects.get(key);
      if (!candidates) effects.set(key, [event]);
      else if (candidates.at(-1) !== event) candidates.push(event);
    }
  }
  return effects;
}
