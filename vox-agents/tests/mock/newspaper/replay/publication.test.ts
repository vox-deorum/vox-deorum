import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { queryNewspaperEvidence } from '../../../../../mcp-server/dist/newspaper/queries.js';
import { ReplaySession } from '../../../../src/newspaper/replay/session.js';
import { runEditorialCheck } from '../../../../src/newspaper/editorial/check.js';
import { loadEditorialConfig } from '../../../../src/newspaper/editorial/config/load.js';
import { ReplayStore } from '../../../../src/newspaper/replay/store.js';
import { replaySourceIdentity } from '../../../../src/newspaper/replay/database.js';
import {
  addReplayBriefs, createReplayRecording, replaySettings, writeReplayPublicationCatalogue,
} from '../../../helpers/newspaper-replay.js';
import { editionBriefRule, editionBriefTemplate } from '../../../helpers/newspaper-briefs.js';

describe('durable replay publication', () => {
  let recording: Awaited<ReturnType<typeof createReplayRecording>>;
  let session: ReplaySession;
  let outputPath: string;
  let catalogue: string;
  beforeEach(async () => {
    recording = await createReplayRecording('Epic', [6]);
    outputPath = path.join(path.dirname(recording.filename), 'newspaper.sqlite');
    catalogue = await writeReplayPublicationCatalogue(recording.filename);
    session = new ReplaySession();
  });
  afterEach(async () => { await session.close(); await recording.cleanup(); });

  /** Start a window containing the event used by the controlled catalogue. */
  function settings() {
    return { ...replaySettings(recording.filename), fromTurn: 6, toTurn: 40, outputPath, runId: 'main', editorialConfigDirectory: catalogue };
  }

  it('should keep stories across a skipped check and apply the stock edition and front page limits', async () => {
    const sqlite = new Database(recording.filename);
    try {
      sqlite.prepare('UPDATE GameMetadata SET Value = ? WHERE Key = ?').run('Standard', 'gameSpeed');
      const insert = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
      let id = 200;
      for (const [turn, count] of [[100, 5], [103, 2], [108, 3], [114, 11]]) {
        for (let i = 0; i < count; i++) {
          insert.run(id, turn, 10_000 + id, 1, 'PlayerAdoptPolicyBranch', JSON.stringify({ PlayerID: 0, BranchType: `Branch ${id}` }));
          id++;
        }
      }
    } finally { sqlite.close(); }
    const stock = await loadEditorialConfig();
    await Promise.all([
      writeFile(path.join(catalogue, 'defaults.json'), '{}'),
      writeFile(path.join(catalogue, 'triggers.json'), JSON.stringify([
        ...stock.triggers.map(rule => ({ id: rule.id, enabled: false })),
        { id: 'fixture-branch', subject: 'event', event: 'PlayerAdoptPolicyBranch', when: 'true', repeat: 'once' },
      ])),
      writeFile(path.join(catalogue, 'templates.json'), JSON.stringify([{
        id: 'fixture-branch-report', triggers: ['fixture-branch'], tags: ['economy'], weight: { base: 1 },
        variants: [{ id: 'notice', headline: 'New policy branch', body: ['The council has adopted a policy branch.'], weight: { base: 1 } }],
      }])),
    ]);
    const configured = { ...settings(), fromTurn: 100, toTurn: 115 };
    await session.configure(configured);
    const first = await session.advance();
    expect(first.check?.issue?.items).toHaveLength(5);
    const skipped = await session.advance();
    expect(skipped.check).toMatchObject({ status: 'skipped', decision: { cutoffTurn: 105 } });
    expect(skipped.evidence.events.map(event => event.source.turn)).toEqual([103, 103]);

    await session.close();
    session = new ReplaySession();
    await session.configure({ ...configured, mode: 'resume' });
    const next = await session.advance();
    expect(next.evidence.request).toMatchObject({ previousCheckTurn: 100, cutoffTurn: 110 });
    expect(next.check?.issue?.items).toHaveLength(5);
    const { articles } = await session.getIssue(next.check!.issue!.issueId);
    const sourceIds = articles.flatMap(article => article.sources.filter(source => source.table === 'GameEvents').map(source => source.id));
    expect(sourceIds.sort((a, b) => a - b)).toEqual([205, 206, 207, 208, 209]);

    const full = await session.advance();
    expect(full.evidence.request).toMatchObject({ previousCheckTurn: 110, cutoffTurn: 115 });
    expect(full.check?.decision.candidateScores).toHaveLength(11);
    expect(full.check?.decision.candidateScores.filter(score => score.selected)).toHaveLength(8);
    const pages = full.check!.issue!.pages;
    expect(pages.map(page => [page.id, page.itemIds.length])).toEqual([['front', 5], ['economy', 3]]);
    expect(new Set(pages.flatMap(page => page.itemIds)).size).toBe(8);
    const archived = await session.getIssue(full.check!.issue!.issueId);
    expect(archived.articles).toHaveLength(8);
  });

  it('should publish unwitnessed research by a met civilization using the configured ideology names', async () => {
    const sqlite = new Database(recording.filename);
    try {
      sqlite.prepare('UPDATE PlayerSummaries SET PolicyBranches = ? WHERE ID = 1').run('{"Ordre":[]}');
      sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)')
        .run(104, 6, 2007, 0, 'TeamTechResearched', '{"TeamID":1,"TechID":"Printing Press","ChangeAmount":1}');
    } finally { sqlite.close(); }
    await Promise.all([
      writeFile(path.join(catalogue, 'constants.json'), JSON.stringify({ types: { ideologies: ['Ordre'] } })),
      writeFile(path.join(catalogue, 'triggers.json'), JSON.stringify([{
        id: 'fixture-research', subject: 'event', event: 'TeamTechResearched',
        when: "self.ideology === 'Ordre' && event.tech === 'Printing Press'",
        values: { technology: 'event.tech', civilization: 'event.player.name' },
      }, editionBriefRule])),
      writeFile(path.join(catalogue, 'templates.json'), JSON.stringify([{
        id: 'fixture-research-article', triggers: ['fixture-research'], tags: ['foreign'], weight: { base: 1 },
        variants: [{ id: 'notice', headline: '{{civilization}} gains a technology', body: ['{{technology}}'], weight: { base: 1 } }],
      }, editionBriefTemplate])),
    ]);
    await session.configure(settings());
    const result = await session.advance();
    expect(result.check?.status).toBe('published');
    const { articles } = await session.getIssue(result.check!.issue!.issueId);
    const article = articles.find(item => item.templateIds.includes('fixture-research-article'));
    expect(article?.sources).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 104 }));
  });

  it('should replay a stock foreign report with civilization vocabulary and with neutral wording', async () => {
    const sqlite = new Database(recording.filename);
    try {
      sqlite.prepare('UPDATE PlayerSummaries SET PolicyBranches = ? WHERE ID = 6').run('{"Order":["Policy A"]}');
      sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)')
        .run(104, 6, 2007, 1, 'IdeologySwitched', '{"PlayerID":1,"OldBranchType":"Freedom","NewBranchType":"Order"}');
    } finally { sqlite.close(); }

    const stock = await loadEditorialConfig();
    const id = 'ideology-switched-report';
    const template = stock.templates.find(entry => entry.variants.some(variant => variant.id === id))!;
    await Promise.all([
      writeFile(path.join(catalogue, 'triggers.json'), JSON.stringify(
        [...stock.triggers.filter(rule => rule.id !== 'ideology-switched').map(rule => ({ id: rule.id, enabled: false })), editionBriefRule],
      )),
      writeFile(path.join(catalogue, 'templates.json'), JSON.stringify([{
        id: template.id,
        variants: template.variants.filter(variant => variant.id !== id).map(variant => ({ id: variant.id, weight: { base: 0 } })),
      }, editionBriefTemplate])),
      writeFile(path.join(catalogue, 'civic-terms.json'), JSON.stringify({
        civilizations: { Civ1: { ideologies: { Order: { government: 'workers’ hall' } } } },
      })),
    ]);
    await session.configure(settings());
    const styled = await session.advance();

    await writeFile(path.join(catalogue, 'civic-terms.json'), '{"ideologies":{"Order":null}}');
    await session.configure({ ...settings(), runId: 'neutral' });
    const neutral = await session.advance();
    for (const [replay, term] of [[styled, 'workers’ hall'], [neutral, 'government']] as const) {
      expect(replay.check?.status).toBe('published');
      const articleId = Object.entries(replay.check!.decision.selectedVariants).find(([, variant]) => variant === id)?.[0];
      expect(replay.check?.issue?.items.find(item => item.id === articleId)?.body.flat()).toContainEqual({ type: 'text', text: term });
      expect(replay.check?.decision.evidence).toContainEqual(expect.objectContaining({ table: 'PlayerSummaries', id: 6 }));
    }
  });

  it('should print a foreign birth without its location and one obituary when a great person is used', async () => {
    const sqlite = new Database(recording.filename);
    try {
      const insert = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
      const unit = { GreatPerson: 'Hypatia' };
      insert.run(104, 6, 2007, 0, 'UnitCreated', JSON.stringify({ PlayerID: 1, UnitID: 19, Unit: unit, PlotX: 4, PlotY: 5 }));
      insert.run(105, 6, 2008, 1, 'GreatPersonExpended', JSON.stringify({ PlayerID: 1, UnitID: 19, Unit: unit, CityX: 4, CityY: 5 }));
      insert.run(106, 6, 2009, 1, 'UnitPrekill', JSON.stringify({ OwnerID: 1, UnitID: 19, Unit: unit, DelayKill: true }));
      insert.run(107, 6, 2010, 1, 'UnitPrekill', JSON.stringify({ OwnerID: 1, UnitID: 19, Unit: unit, DelayKill: false }));
    } finally { sqlite.close(); }
    const probes = fileURLToPath(new URL('../../../../newspaper/probes/', import.meta.url));
    const probeConfig = await loadEditorialConfig(probes);
    await Promise.all([
      writeFile(path.join(catalogue, 'triggers.json'), JSON.stringify([...probeConfig.triggers, editionBriefRule])),
      writeFile(path.join(catalogue, 'templates.json'), JSON.stringify([...probeConfig.templates, editionBriefTemplate])),
    ]);
    await session.configure(settings());
    const result = await session.advance();
    expect(result.check?.status).toBe('published');
    expect(result.evidence.events.find(event => event.source.id === 104)?.values).toEqual({ PlayerID: 1, Person: 'Hypatia' });
    expect(result.evidence.events.filter(event => event.type === 'UnitPrekill')).toEqual([]);
    const { articles } = await session.getIssue(result.check!.issue!.issueId);
    const births = articles.filter(article => article.templateIds.some(id => id.startsWith('probe-foreign-birth')));
    const obituaries = articles.filter(article => article.templateIds.some(id => id.startsWith('probe-obituary')));
    expect(births).toHaveLength(1);
    expect(births[0].sources).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 104 }));
    expect(obituaries).toHaveLength(1);
    expect(obituaries[0].sources).toContainEqual(expect.objectContaining({ table: 'GameEvents', id: 105 }));
  });

  it('should replace votes, reject stale scopes, reschedule frequency and resume immutable history', async () => {
    const state = await session.configure(settings());
    expect(state).toMatchObject({ runId: 'main', preferences: { frequencyStandardTurns: 5, llmEnabled: false }, publicationIntervalTurns: 8 });
    const first = await session.advance();
    expect(first.check?.status).toBe('published');
    const issueId = first.check!.issue!.issueId;
    const itemId = first.check!.issue!.items[0].id;
    const scope = { runId: 'main', receiverPlayerID: 0 };
    const original = await session.getIssue(issueId, scope);
    await session.setVote({ ...scope, itemId, value: 1 });
    await session.setVote({ ...scope, itemId, value: 1 });
    expect((await session.getIssue(issueId)).votes[itemId]).toBe(1);
    await session.setVote({ ...scope, itemId, value: -1 });
    expect((await session.getIssue(issueId)).votes[itemId]).toBe(-1);
    await session.setVote({ ...scope, itemId, value: 0 });
    expect((await session.getIssue(issueId)).votes[itemId]).toBe(0);
    await expect(session.setVote({ ...scope, runId: 'other', itemId, value: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(session.setVote({ ...scope, receiverPlayerID: 1, itemId, value: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(session.advance({ ...scope, runId: 'other' })).rejects.toMatchObject({ status: 409 });
    await expect(session.getIssue(issueId, { receiverPlayerID: 1 })).rejects.toMatchObject({ status: 409 });
    await session.setVote({ ...scope, itemId, value: 1 });
    await session.setVote({ ...scope, itemId, value: 1 });
    await session.setPreferences({ ...scope, frequencyStandardTurns: 2, llmEnabled: true });
    const next = await session.advance(scope);
    expect(next.evidence.request).toMatchObject({ previousCheckTurn: 6, cutoffTurn: 9 });
    expect(next.check!.decision.feedback.votes[itemId]).toBe(1);
    expect(next.check!.decision.feedback.windowItemIds.filter(id => id === itemId)).toHaveLength(1);
    expect(Object.values(next.check!.decision.feedback.seriesAdjustments).some(value => value > 0)).toBe(true);
    const article = (await session.getIssue(issueId)).articles.find(item => item.id === itemId)!;
    expect(article.sources).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'GameEvents', id: 101, turn: 6 })]));
    expect(article.evidenceSummary).toMatch(/\b6\b/);
    expect(article.evidenceSummary).not.toContain('fixture-war-report');
    expect((await session.getIssue(issueId)).issue).toEqual(original.issue);
    expect((await session.getIssue(issueId)).decision).toEqual(original.decision);
    const before = await session.getState();
    await session.close();
    session = new ReplaySession();
    const resumed = await session.configure({ ...settings(), mode: 'resume', frequencyStandardTurns: 99, llmEnabled: false });
    expect(resumed).toEqual(before);
    expect((await session.getIssue(issueId)).issue).toEqual(original.issue);
    const continued = await session.advance();
    expect(continued.evidence.request).toMatchObject({ previousCheckTurn: 6, cutoffTurn: 12 });
    const sqlite = new Database(outputPath, { readonly: true });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM OfflineReplayChecks WHERE Cutoff = 6').get()).toEqual({ count: 1 });
    sqlite.close();
    expect(await readFile(recording.filename)).toEqual(recording.originalBytes);
  });

  it('should restore the saved catalogue when the configured files change or disappear', async () => {
    const directory = path.join(path.dirname(recording.filename), 'catalogue');
    await mkdir(directory);
    await writeFile(path.join(directory, 'defaults.json'), JSON.stringify({ frequencyStandardTurns: 3 }));
    await session.configure({ ...settings(), editorialConfigDirectory: directory });
    const first = await session.advance();
    await session.close();
    await rm(directory, { recursive: true });
    const check = vi.fn(runEditorialCheck);
    session = new ReplaySession({ check });
    await session.configure({ ...settings(), mode: 'resume' });
    const continued = await session.advance();
    expect(check.mock.calls[0][0].config.defaults.frequencyStandardTurns).toBe(3);
    expect(continued.check!.decision.configurationId).toBe(first.check!.decision.configurationId);
  });

  it('should resume the masthead choice and preserve earlier copy after an ideology switch', async () => {
    const sqlite = new Database(recording.filename);
    try {
      const setIdeology = sqlite.prepare('UPDATE PlayerSummaries SET PolicyBranches = ? WHERE ID = ?');
      for (const id of [1, 2, 3]) setIdeology.run('{"Fixture Order":[]}', id);
      setIdeology.run('{"Fixture Freedom":[]}', 4);
      const insert = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
      for (const turn of [14, 22]) {
        insert.run(200 + turn, turn, 2000 + turn, 1, 'DeclareWar', '{"OriginatingPlayerID":1,"TargetTeamID":0,"IsAggressor":false}');
      }
      addReplayBriefs(sqlite, [14, 22]);
    } finally { sqlite.close(); }
    const mastheadPath = path.join(catalogue, 'mastheads', 'ideology.json');
    await mkdir(path.dirname(mastheadPath));
    const orderRules = ['a', 'b'].map(suffix => ({
      id: `fixture-order-${suffix}`, when: "self.ideology === 'Fixture Order'", weight: { base: 2 },
      title: `Order paper ${suffix}`, motto: `Order motto ${suffix}`, pageLabels: { front: `Order front ${suffix}` },
    }));
    const freedom = {
      id: 'fixture-freedom', when: "self.ideology === 'Fixture Freedom'", weight: { base: 2 },
      title: 'Freedom paper', motto: 'Freedom motto', pageLabels: { front: 'Freedom front' },
    };
    await Promise.all([
      writeFile(path.join(catalogue, 'constants.json'), JSON.stringify({ types: { ideologies: ['Fixture Order', 'Fixture Freedom'] } })),
      writeFile(mastheadPath, JSON.stringify([...orderRules, freedom])),
    ]);
    await session.configure(settings());
    const first = (await session.advance()).check!;
    const selected = orderRules.find(rule => rule.id === first.decision.mastheadRuleId)!;
    expect(selected).toBeDefined();
    const firstIssue = first.issue!;
    expect(firstIssue.publication).toMatchObject({ title: selected.title, motto: selected.motto });
    expect(firstIssue.pages[0].label).toBe(selected.pageLabels.front);

    await session.close();
    await writeFile(mastheadPath, JSON.stringify([{ ...selected, when: 'false' }]));
    session = new ReplaySession();
    await session.configure({ ...settings(), mode: 'resume' });
    const continued = (await session.advance()).check!;
    expect(continued.decision.mastheadRuleId).toBe(selected.id);
    expect(continued.issue?.publication).toEqual(firstIssue.publication);
    expect(continued.issue?.pages[0].label).toBe(selected.pageLabels.front);

    const switched = (await session.advance()).check!;
    expect(switched.decision.mastheadRuleId).toBe(freedom.id);
    expect(switched.issue?.publication).toMatchObject({ title: freedom.title, motto: freedom.motto, designId: firstIssue.publication.designId });
    expect(switched.issue?.pages[0].label).toBe(freedom.pageLabels.front);
    expect((await session.getIssue(firstIssue.issueId)).issue).toEqual(firstIssue);
  });

  it('should restore a design run across a skip and resume with the same choices', async () => {
    const sqlite = new Database(recording.filename);
    try {
      const insert = sqlite.prepare('INSERT INTO GameEvents (ID, Turn, CreatedAt, Player0, Type, Payload) VALUES (?, ?, ?, ?, ?, ?)');
      for (const turn of [22, 30, 38, 46])
        insert.run(200 + turn, turn, 2000 + turn, 1, 'DeclareWar', '{"OriginatingPlayerID":1,"TargetTeamID":0,"IsAggressor":false}');
      addReplayBriefs(sqlite, [22, 30, 38, 46]);
    } finally { sqlite.close(); }
    const config = await loadEditorialConfig(catalogue);
    const opening = config.designs.find(design => design.id === 'oral-accounts')!;
    const triggerPath = path.join(catalogue, 'triggers.json');
    const triggers = JSON.parse(await readFile(triggerPath, 'utf8'));
    await Promise.all([
      writeFile(path.join(catalogue, 'designs.json'), JSON.stringify([
        { ...opening, id: 'fixture-alternate', title: 'Another paper', civilizationTitles: null },
      ])),
      writeFile(triggerPath, JSON.stringify([
        ...config.triggers.filter(rule => !['fixture-war-report', editionBriefRule.id].includes(rule.id)).map(rule => ({ id: rule.id, enabled: false })),
        ...triggers,
      ])),
    ]);
    const configured = { ...settings(), toTurn: 46 };
    await session.configure(configured);
    const first = (await session.advance()).check!;
    expect(first.status).toBe('published');
    expect((await session.advance()).check?.status).toBe('skipped');
    expect((await session.advance()).check?.decision).toMatchObject({
      designId: first.decision.designId, designSelection: { priorRunLength: 1 },
    });
    expect((await session.advance()).check?.decision).toMatchObject({
      designId: first.decision.designId, designSelection: { priorRunLength: 2 },
    });
    await session.close();
    session = new ReplaySession();
    await session.configure({ ...configured, mode: 'resume' });
    const resumed = [(await session.advance()).check, (await session.advance()).check];
    expect(resumed[0]?.decision.designSelection?.priorRunLength).toBe(3);
    expect((await session.getIssue(first.issue!.issueId)).issue).toEqual(first.issue);

    await session.configure({ ...configured, outputPath: path.join(path.dirname(outputPath), 'uninterrupted.sqlite') });
    for (let check = 0; check < 4; check++) await session.advance();
    const uninterrupted = [(await session.advance()).check, (await session.advance()).check];
    expect(uninterrupted.map(check => check?.issue)).toEqual(resumed.map(check => check?.issue));
    expect(uninterrupted.map(check => check?.decision.designSelection)).toEqual(resumed.map(check => check?.decision.designSelection));
  });

  it('should reject a checkpoint with a pre-slot catalogue', async () => {
    const initialized = await session.configure(settings());
    await session.close();
    const identity = await replaySourceIdentity(recording.filename);
    const legacy = { ...await loadEditorialConfig(catalogue), version: 1 };

    const store = new ReplayStore(outputPath);
    try {
      const checkpoint = store.load('main', 0, identity);
      store.create(identity, { ...checkpoint, session: { ...initialized, runId: 'legacy' }, configuration: legacy });
    } finally { store.close(); }

    session = new ReplaySession();
    await expect(session.configure({ ...settings(), runId: 'legacy', mode: 'resume' })).rejects.toMatchObject({ status: 400 });
  });

  it('should rebuild older newspaper output in place when generating a new run', async () => {
    await session.configure(settings());
    const original = await session.advance();
    expect(original.check?.status).toBe('published');
    await session.close();
    const source = await readFile(recording.filename);
    const sqlite = new Database(outputPath);
    try {
      sqlite.exec('CREATE TABLE unrelated (value INTEGER); INSERT INTO unrelated VALUES (42)');
      sqlite.pragma('user_version = 5');
    } finally { sqlite.close(); }
    session = new ReplaySession();
    const rebuilt = await session.configure({ ...settings(), mode: 'new' });
    expect(rebuilt.outputPath).toBe(outputPath);
    expect(rebuilt.cursor.cutoffTurn).toBeNull();
    expect((await session.listIssues()).issues).toEqual([]);
    expect((await session.advance()).check?.status).toBe('published');
    expect((await session.listIssues()).issues).toHaveLength(1);
    expect(await readFile(recording.filename)).toEqual(source);
    const reopened = new Database(outputPath, { readonly: true });
    try { expect(reopened.prepare('SELECT value FROM unrelated').get()).toEqual({ value: 42 }); }
    finally { reopened.close(); }
  });

  it.each([
    { file: 'pages', entries: [{ id: 'front', when: 'self.era === "Modern Era"' }] },
    { file: 'designs', entries: [{ id: 'oral-accounts', layouts: [{ id: 'account', weight: { base: 10, adjustments: [{ when: 'true', add: -10 }] } }] }] },
    { file: 'designs', entries: [{ id: 'oral-accounts', layouts: [{ id: 'urgent-account', when: 'self.era === "Modern Era"' }] }] },
  ])('should reject an overlay with an unavailable publication foundation before creating a run: %j', async ({ file, entries }) => {
    const directory = path.join(path.dirname(recording.filename), 'invalid-catalogue');
    await mkdir(directory);
    await writeFile(path.join(directory, `${file}.json`), JSON.stringify(entries));
    await expect(session.configure({ ...settings(), editorialConfigDirectory: directory })).rejects.toMatchObject({ status: 400 });
    const sqlite = new Database(outputPath, { readonly: true });
    try { expect(sqlite.prepare('SELECT COUNT(*) AS count FROM OfflineReplayRuns').get()).toEqual({ count: 0 }); }
    finally { sqlite.close(); }
  });

  it('should create fresh explicit comparison branches and keep parent votes isolated', async () => {
    await session.configure(settings());
    const first = await session.advance();
    const itemId = first.check!.issue!.items[0].id;
    await session.setVote({ runId: 'main', receiverPlayerID: 0, itemId, value: 1 });
    await session.configure({ ...settings(), mode: 'branch', branchFromRunId: 'main', runId: 'comparison', llmEnabled: true });
    expect((await session.listIssues()).issues).toEqual([]);
    await expect(session.setVote({ runId: 'comparison', receiverPlayerID: 0, itemId, value: 1 })).rejects.toMatchObject({ status: 404 });
    const comparison = await session.advance();
    expect(comparison.check!.issue!.issueId).not.toBe(first.check!.issue!.issueId);
    await session.configure({ ...settings(), mode: 'resume' });
    expect((await session.getIssue(first.check!.issue!.issueId)).votes[itemId]).toBe(1);
  });

  it('should reject competing sessions until they resume without rolling back advances or losing votes', async () => {
    const scope = { runId: 'main', receiverPlayerID: 0 };
    await session.configure(settings());
    const first = await session.advance();
    const issueId = first.check!.issue!.issueId;
    const itemId = first.check!.issue!.items[0].id;
    const competitor = new ReplaySession();
    try {
      await competitor.configure({ ...settings(), mode: 'resume' });
      await session.advance();
      await expect(competitor.setVote({ ...scope, itemId, value: -1 })).rejects.toMatchObject({ status: 409 });
      await competitor.configure({ ...settings(), mode: 'resume' });
      expect((await competitor.getState()).cursor.cutoffTurn).toBe(14);
      await session.setVote({ ...scope, itemId, value: 1 });
      await expect(competitor.setVote({ ...scope, itemId, value: -1 })).rejects.toMatchObject({ status: 409 });
      await expect(competitor.advance()).rejects.toMatchObject({ status: 409 });
      await competitor.configure({ ...settings(), mode: 'resume' });
      expect((await competitor.getIssue(issueId)).votes[itemId]).toBe(1);
      const advanced = await competitor.advance();
      expect(advanced.evidence.request.cutoffTurn).toBe(22);
      await session.configure({ ...settings(), mode: 'resume' });
      expect((await session.getState()).cursor.cutoffTurn).toBe(22);
      expect((await session.getIssue(issueId)).votes[itemId]).toBe(1);
      const sqlite = new Database(outputPath, { readonly: true });
      expect(sqlite.prepare('SELECT COUNT(*) AS count FROM OfflineReplayChecks WHERE Cutoff = 22').get()).toEqual({ count: 1 });
      sqlite.close();
    } finally { await competitor.close(); }
  });

  it('should report an existing run as a conflict and preserve the active session', async () => {
    await session.configure(settings());
    await session.advance();
    await expect(session.configure(settings())).rejects.toMatchObject({ status: 409 });
    expect((await session.getState()).cursor.cutoffTurn).toBe(6);
    await session.configure({ ...settings(), mode: 'resume' });
    expect((await session.getState()).cursor.cutoffTurn).toBe(6);
  });

  it('should ignore a stale branch parent when starting an ordinary new run', async () => {
    await session.configure({ ...settings(), mode: 'new', branchFromRunId: 'unrelated-or-missing' });
    const sqlite = new Database(outputPath, { readonly: true });
    expect(sqlite.prepare('SELECT ParentRunID FROM OfflineReplayRuns WHERE RunID = ?').get('main')).toEqual({ ParentRunID: null });
    sqlite.close();
    expect((await session.getState()).cursor.cutoffTurn).toBeNull();
    expect((await session.listIssues()).issues).toEqual([]);
  });

  it('should preserve its in-memory checkpoint when another store commits the same cutoff during editing', async () => {
    await session.configure(settings());
    await session.advance();
    await session.close();
    const competitor = new ReplayStore(outputPath);
    try {
      const saved = competitor.load('main', 0, await replaySourceIdentity(recording.filename));
      session = new ReplaySession({ check: async input => {
        const result = await runEditorialCheck(input);
        const winning = structuredClone(result);
        winning.state.preferences.llmEnabled = true;
        const competitorSession = structuredClone(saved.session);
        competitorSession.preferences = winning.state.preferences;
        competitorSession.cursor = {
          cutoffTurn: input.evidence.request.cutoffTurn,
          previousCheckTurn: input.evidence.request.previousCheckTurn,
          finished: false,
        };
        competitor.commit({ session: competitorSession, publication: winning.state, configuration: input.config }, winning);
        return result;
      } });
      await session.configure({ ...settings(), mode: 'resume' });
      const before = await session.getState();
      await expect(session.advance()).rejects.toMatchObject({ status: 409 });
      expect(await session.getState()).toEqual(before);
      const committed = competitor.load('main', 0, await replaySourceIdentity(recording.filename));
      expect(committed.session.cursor.cutoffTurn).toBe(14);
      expect(committed.publication.preferences.llmEnabled).toBe(true);
      await session.configure({ ...settings(), mode: 'resume' });
      expect((await session.getState()).cursor.cutoffTurn).toBe(14);
      expect((await session.getState()).preferences?.llmEnabled).toBe(true);
    } finally { competitor.close(); }
  });

  it('should read one history window and reconsider an unpublished once-only rule after resume', async () => {
    const directory = path.join(path.dirname(recording.filename), 'repeat-catalogue');
    await mkdir(directory);
    const base = await loadEditorialConfig();
    await writeFile(path.join(directory, 'triggers.json'), JSON.stringify([
      ...base.triggers.map(rule => ({ id: rule.id, enabled: false })),
      { id: 'recorded-player', subject: 'player', window: 60, repeat: 'once', when: 'player.self' },
    ]));
    const query = vi.fn(queryNewspaperEvidence);
    session = new ReplaySession({ query });
    const configured = { ...settings(), fromTurn: 100, toTurn: 120, editorialConfigDirectory: directory };
    await session.configure(configured);
    const first = await session.advance();
    expect(query).toHaveBeenCalledOnce();
    expect(first.evidence.request.historyFromTurn).toBe(10); // 60 Standard turns at Epic speed.
    expect(first.evidence).not.toHaveProperty('history');
    expect((await session.evidence()).evidence).toEqual(first.evidence);
    expect(first.check?.status).toBe('skipped');
    expect(first.check?.decision.triggerAudit.find(audit => audit.rule === 'recorded-player')?.subjects)
      .toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'player/0', outcome: 'fired' })]));
    await session.close();
    session = new ReplaySession();
    await session.configure({ ...configured, mode: 'resume' });
    const next = await session.advance();
    expect(next.evidence.request).toMatchObject({ previousCheckTurn: 99, cutoffTurn: 108 });
    expect(next.check?.decision.triggerAudit.find(audit => audit.rule === 'recorded-player')?.subjects)
      .toEqual(expect.arrayContaining([expect.objectContaining({ subject: 'player/0', outcome: 'fired' })]));
  });
});
