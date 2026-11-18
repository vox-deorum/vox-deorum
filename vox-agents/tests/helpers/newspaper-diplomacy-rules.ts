/** Trigger overlays using the expressions from the newspaper authoring guide. */
export const vassalsJoinWar = {
  id: 'vassals-join-war', subject: 'incident',
  when: ["incident.kind == 'war'", "incident.participants.some(p => p.reason == 'vassal')"],
  values: {
    vassals: "incident.participants.filter(p => p.reason == 'vassal').map(p => p.player.name).join(', ')",
    initiator: 'incident.initiator.name', target: 'incident.target.name',
  },
  importance: "incident.role == 'none' ? 45 : 80",
  urgent: "incident.role == 'target'",
};

export const warAdvantageStalls = {
  id: 'war-advantage-stalls', subject: 'pair', window: 'long',
  when: [
    'pair.involvesSelf && pair.atWar',
    'pair.history.some(s => s.warScore >= 25)',
    'held(pair, s => Math.abs(s.warScore - pair.warScore) <= 5, short)',
  ],
  values: { opponent: 'pair.other.name', score: 'pair.warScore' },
  importance: 50, repeat: 'medium',
};
