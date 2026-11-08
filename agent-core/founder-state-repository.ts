import type { MayaPersistentState } from "./persistent-store.ts";

export interface FounderStateRepository {
  load<TTask, TMemory, TPersona>(founderId: string, defaults: MayaPersistentState<TTask, TMemory, TPersona>): Promise<MayaPersistentState<TTask, TMemory, TPersona>>;
  save<TTask, TMemory, TPersona>(founderId: string, state: MayaPersistentState<TTask, TMemory, TPersona>): Promise<void>;
}
