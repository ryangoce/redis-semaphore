export default class Semaphore {
    // key, limit, createClient
    constructor(key: string, limit:number, createClient:Function)
    acquire(): Promise<string>;
    release(token: string): Promise;
    destroy(): Promise;
}