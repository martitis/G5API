import { EventEmitter } from "events";

class GlobalEmitter extends EventEmitter {
    constructor() {
        super();
        // Every open SSE stream (one per viewer per match page) adds a listener; the default cap of 10 only warns.
        this.setMaxListeners(0);
    }
}

/**
 * A listener for one match's stream. Events emitted with a match id (`emit("matchUpdate", matchId)`) only reach
 * that match's streams; events emitted without one still reach every stream.
 */
export function forMatch(
    matchId: string | number,
    listener: () => unknown
): (eventMatchId?: string | number | null) => void {
    return (eventMatchId?: string | number | null) => {
        if (eventMatchId == null || String(eventMatchId) === String(matchId)) void listener();
    };
}

export default new GlobalEmitter();
