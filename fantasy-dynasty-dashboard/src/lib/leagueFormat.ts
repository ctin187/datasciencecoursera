import type { IdpPosition, Position } from '../types';

const IDP_POSITIONS: IdpPosition[] = ['DL', 'LB', 'DB'];

export interface LeagueFormat {
  usesKicker: boolean;
  usesTeamDefense: boolean;
  usesIDP: boolean;
  idpPositions: Set<IdpPosition>;
  /** Positions a plain offensive FLEX slot makes interchangeable (RB/WR/TE, or empty if the league has no such slot). */
  offenseFlexPositions: Set<Position>;
  /** Positions an IDP_FLEX-style slot makes interchangeable (DL/LB/DB, or empty if the league has no such slot). */
  idpFlexPositions: Set<Position>;
  /** Every position this league actually rosters, offense + special teams + IDP, in display order. Drives every position-iterating loop (grading, free-agent pools, tables) instead of a hardcoded skill-position array. */
  activePositions: Position[];
}

/**
 * Reads a league's roster_positions (the one place Sleeper tells you what a
 * given league actually starts) into a single canonical format description.
 * Every part of the app that filters or iterates by position should derive
 * that list from here rather than assuming every league is QB/RB/WR/TE-only -
 * that assumption made kickers, team defenses, and IDP players (DL/LB/DB)
 * invisible everywhere: Waivers' free-agent pool, Roster Health's grading,
 * Draft Assistant's board, Aging Curves.
 */
export function detectLeagueFormat(rosterPositions: string[]): LeagueFormat {
  const upper = rosterPositions.map((p) => p.toUpperCase());

  const usesKicker = upper.includes('K');
  const usesTeamDefense = upper.includes('DEF');
  const idpPositions = new Set<IdpPosition>(IDP_POSITIONS.filter((p) => upper.includes(p)));
  const usesIDP = idpPositions.size > 0 || upper.some((p) => p.includes('IDP'));
  // A league can start IDP without ever listing 'DL'/'LB'/'DB' individually
  // (e.g. only an IDP_FLEX slot) - default to all three in that case, since
  // any of them could show up in that flex spot.
  if (upper.some((p) => p.includes('IDP')) && idpPositions.size === 0) {
    IDP_POSITIONS.forEach((p) => idpPositions.add(p));
  }

  const offenseFlexPositions = new Set<Position>();
  if (upper.some((p) => p.includes('FLEX') && !p.includes('SUPER') && !p.includes('IDP'))) {
    offenseFlexPositions.add('RB');
    offenseFlexPositions.add('WR');
    offenseFlexPositions.add('TE');
  }

  const idpFlexPositions = new Set<Position>();
  if (upper.some((p) => p.includes('IDP') && p.includes('FLEX'))) {
    IDP_POSITIONS.forEach((p) => idpFlexPositions.add(p));
  }

  const activePositions: Position[] = ['QB', 'RB', 'WR', 'TE'];
  if (usesTeamDefense) activePositions.push('DEF');
  if (usesKicker) activePositions.push('K');
  IDP_POSITIONS.forEach((p) => {
    if (idpPositions.has(p)) activePositions.push(p);
  });

  return { usesKicker, usesTeamDefense, usesIDP, idpPositions, offenseFlexPositions, idpFlexPositions, activePositions };
}
