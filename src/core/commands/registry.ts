import type { AnyCommand } from './types';

export class CommandRegistry {
  private readonly map = new Map<string, AnyCommand>();

  register(...cmds: AnyCommand[]): void {
    for (const c of cmds) {
      if (this.map.has(c.id)) throw new Error(`Duplicate command id: ${c.id}`);
      this.map.set(c.id, c);
    }
  }

  get(id: string): AnyCommand | undefined {
    return this.map.get(id);
  }

  require(id: string): AnyCommand {
    const c = this.map.get(id);
    if (!c) throw new Error(`Unknown command: ${id}`);
    return c;
  }

  all(): AnyCommand[] {
    return [...this.map.values()];
  }
}
