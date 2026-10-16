type Bounds = { x: number; y: number; width: number; height: number };
type Snapshot = { active: boolean; url: string; refresh: string; bounds: Bounds };
type Invoke = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export type NativeWebPageState = {
  url: string;
  loading: boolean | null;
  canGoBack: boolean;
  canGoForward: boolean;
};

// Serialize per tab, including across unmount/remount (StrictMode or pane moves).
// A late create must finish before its destroy and a replacement's create.
const pending = new Map<string, Promise<void>>();

export class NativeWebTabSession {
  private disposed = false;
  private created = false;
  private visible = false;
  private previous: Snapshot | undefined;
  private revision = 0;

  get ready() {
    return this.created && !this.disposed;
  }

  constructor(
    private id: string,
    private invoke: Invoke,
    private onLoading: () => void,
    private onError: (error: unknown) => void,
  ) {}

  private enqueue(action: () => Promise<void>) {
    const task = (pending.get(this.id) ?? Promise.resolve()).then(action).catch((error) => {
      if (!this.disposed) this.onError(error);
    });
    pending.set(this.id, task);
    void task.then(() => {
      if (pending.get(this.id) === task) pending.delete(this.id);
    });
    return task;
  }

  sync(snapshot: Snapshot) {
    const revision = ++this.revision;
    return this.enqueue(async () => {
      if (this.disposed || revision !== this.revision) return;
      const { active, url, refresh, bounds } = snapshot;
      if (!active || bounds.width < 1 || bounds.height < 1) {
        if (this.created && this.visible) {
          await this.invoke('web_tab_visibility', { id: this.id, visible: false });
          this.visible = false;
        }
        return;
      }
      if (!this.created) {
        this.onLoading();
        await this.invoke('web_tab_create', { id: this.id, url, ...bounds });
        this.created = true;
        this.visible = true;
      } else {
        if (url !== this.previous?.url) {
          this.onLoading();
          await this.invoke('web_tab_navigate', { id: this.id, url });
        } else if (refresh !== this.previous?.refresh) {
          this.onLoading();
          await this.invoke('web_tab_reload', { id: this.id });
        }
        const last = this.previous?.bounds;
        if (
          !last ||
          Object.keys(bounds).some(
            (key) => bounds[key as keyof Bounds] !== last[key as keyof Bounds],
          )
        ) {
          await this.invoke('web_tab_bounds', { id: this.id, ...bounds });
        }
        if (!this.visible) {
          await this.invoke('web_tab_visibility', { id: this.id, visible: true });
          this.visible = true;
        }
      }
      this.previous = snapshot;
    });
  }

  dispose() {
    this.disposed = true;
    return this.enqueue(async () => {
      if (this.created) await this.invoke('web_tab_destroy', { id: this.id });
      this.created = false;
    });
  }
}
