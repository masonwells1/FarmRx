import { createContext, useContext, type ReactNode } from 'react'
import type { Farm } from '../data/fields'
import type { FarmAccessSource } from './farmContext'

export type FarmAccessContextValue = {
  farms: Farm[]
  activeFarm: Farm
  source: FarmAccessSource
  chooseFarm(farmId: string): Promise<void>
}

const FarmContext = createContext<FarmAccessContextValue | null>(null)

export function FarmAccessProvider({ value, children }: { value: FarmAccessContextValue; children: ReactNode }) { return <FarmContext.Provider value={value}>{children}</FarmContext.Provider> }
export function useFarmAccess() { const value = useContext(FarmContext); if (!value) throw new Error('useFarmAccess must be used inside FarmAccessProvider.'); return value }
