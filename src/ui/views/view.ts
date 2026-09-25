import type { AppState, TabId } from '../app';

export interface View {
  id: TabId;
  title: string;
  el: HTMLElement;
  update(s: AppState, changed: Set<keyof AppState>): void;
}
