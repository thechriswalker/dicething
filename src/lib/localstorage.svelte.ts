export default class LocalStorageState<T> {
  value = $state<T>() as T;
  key: string;
  constructor(key: string, value: T) {
    this.key = key;
    this.value = value;

    // use a value from localstorage if we have one.
    const persisted = localStorage.getItem(this.key);
    if (persisted) {
      try {
        const v = JSON.parse(persisted) as T;
        this.value = v;
      } catch {
        // JSON error, just empty the storage
        localStorage.removeItem(this.key);
      }
    }

    // persist on change
    $effect(() => {
      localStorage.setItem(this.key, JSON.stringify(this.value));
    });
  }
}
