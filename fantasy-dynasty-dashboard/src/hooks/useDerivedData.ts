import { useMemo } from 'react';
import type { PlayersMap } from '../types';
import { buildConsensusAdp, buildTradeValues } from '../lib/consensusData';
import { computeThreeDValuesForPool } from '../lib/valueCalculator';

export function useDerivedData(players: PlayersMap | undefined) {
  return useMemo(() => {
    if (!players) return null;
    const consensusAdp = buildConsensusAdp(players);
    const tradeValues = buildTradeValues(players);
    const threeDValues = computeThreeDValuesForPool(consensusAdp);
    const tradeValueMap = new Map(tradeValues.map((t) => [t.playerId, t]));
    return { consensusAdp, tradeValues, tradeValueMap, threeDValues };
  }, [players]);
}
