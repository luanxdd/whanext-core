export class TypedEventEmitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<(payload: never) => void | Promise<void>>>();

  on<Event extends keyof Events>(
    event: Event,
    listener: (payload: Events[Event]) => void | Promise<void>,
  ): () => void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener as (payload: never) => void | Promise<void>);
    this.#listeners.set(event, listeners);

    return () => listeners.delete(listener as (payload: never) => void | Promise<void>);
  }

  async emit<Event extends keyof Events>(event: Event, payload: Events[Event]): Promise<void> {
    const listeners = this.#listeners.get(event);

    if (!listeners) {
      return;
    }

    await Promise.all([...listeners].map((listener) => listener(payload as never)));
  }
}
