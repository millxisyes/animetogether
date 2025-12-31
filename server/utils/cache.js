export class Cache {
    constructor() {
        this.cache = new Map();
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    set(key, value, ttlSeconds) {
        const expiry = Date.now() + ttlSeconds * 1000;
        this.cache.set(key, { value, expiry });
    }

    // Helper to generate keys consistently
    static generateKey(prefix, ...args) {
        return `${prefix}:${args.join(':')}`;
    }
}

export const cache = new Cache();
