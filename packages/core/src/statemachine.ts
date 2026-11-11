/** The shared state machine: one reviewable map of every allowed transition; anything not in it is structurally impossible. States without out-edges are terminal. */
export class StateMachineError extends Error { constructor(public code: 'unknown-state' | 'forbidden-transition', m: string) { super(m); } }
export class StateMachine<S extends string> {
  constructor(private map: Readonly<Record<S, readonly S[]>>) {
    for (const [from, tos] of Object.entries<readonly S[]>(map)) for (const t of tos) if (!(t in map)) throw new StateMachineError('unknown-state', `${from} -> ${t}: ${t} is not declared`);
  }
  states(): S[] { return Object.keys(this.map) as S[]; }
  next(from: S): readonly S[] { return this.map[from] ?? []; }
  can(from: S, to: S): boolean { return (this.map[from] ?? []).includes(to); }
  assert(from: S, to: S): void { if (!(from in this.map)) throw new StateMachineError('unknown-state', `unknown state ${from}`); if (!this.can(from, to)) throw new StateMachineError('forbidden-transition', `${from} -> ${to} is not allowed`); }
  /** No way out (a reviewed correction edge out of a final state makes it non-terminal here: list it in `final` if you want the business meaning instead). */
  isTerminal(s: S): boolean { return this.next(s).length === 0; }
}
