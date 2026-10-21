import { EventEmitter } from "events";

class GlobalEmitter extends EventEmitter {
    constructor() {
        super();
        // Every open SSE stream (one per viewer per match page) adds a listener; the default cap of 10 only warns.
        this.setMaxListeners(0);
    }
}

export default new GlobalEmitter();
