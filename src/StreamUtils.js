import StreamEventTypes from './StreamEventTypes';

/**
 * Prepares broker events for the subscription.onDataReceived() hook.
 * @param {Array|Object} events - Array from 'Get' or single event from 'Subscribe' stream
 * @param {string} receivedAs - StreamEventTypes.STATE | STREAM | STREAMED_CHUNK
 * @param {string} [extraLoggingArg] - Optional arg for debug log
 * @param {Object} [debug] - Debug logger (log, debugDisabled)
 * @returns {{ eventsArray: Array, receivedAs: string }}
 */
export const prepareEventsData = (events, receivedAs, extraLoggingArg, debug = {}) => {
    if (debug && !debug.debugDisabled) {
        const debugData = [];
        if (receivedAs === StreamEventTypes.STREAM) {
            const eventType = events.data?.type || events.type;
            const messageType = events.data?.messageType || events.messageType;
            debugData.push('conversationData STREAM-event:', eventType + (eventType === 'conversationMessage' ? ' (' + messageType + ')' : ''));
        } else if (receivedAs === StreamEventTypes.STREAMED_CHUNK) {
            debugData.push('conversationData STREAMED_CHUNK-array:');
        } else if (receivedAs === StreamEventTypes.STATE) {
            debugData.push('conversationData STATE-array:');
        } else {
            debugData.push('conversationData (receivedAs = unknown)):');
        }
        debugData.push(events, extraLoggingArg);
        debug.log.apply(null, debugData);
    }
    return {
        eventsArray: receivedAs === StreamEventTypes.STREAM ? [events] : events,
        receivedAs
    };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


export const retryPromiseFunc = async (promisedFunction, delay, maxRetries, abortReason) => {
    // This function retries "promisedFunction" (a function which is expected to return a Promise) until it's resolved, or until retried "maxRetries" number of times or until rejected with reason == "abortReason"...
    try {
        return await promisedFunction();
    } catch (reason) {
        if (maxRetries - 1 > 0 && reason !== abortReason) {
            await wait(delay);
            return retryPromiseFunc(promisedFunction, delay, maxRetries - 1, abortReason);
        }
        throw reason;
    }
};

export const promiseTimeout = (promise, ms) => {
    // Create a promise that rejects in <ms> milliseconds
    // Returns a race between our timeout and the passed in promise
    return Promise.race([
        promise,
        wait(ms).then(() => { throw new Error('timeout'); })
    ]);
};

export const mergeDeep = (...objects) => {
    // Deep merge from: https://stackoverflow.com/a/48218209 (modified for unique arrays as suggested in comments)
    // Also modified to handle primitives and differing types
    const isObject = obj => obj && typeof obj === 'object';
    return objects.reduce((prev = {}, obj) => {
        if (isObject(obj)) {
            Object.keys(obj).forEach(key => {
                const pVal = prev[key];
                const oVal = obj[key];
                if (Array.isArray(oVal) && Array.isArray(pVal)) {
                    // Merging arrays is a bit tricky: Concatenate or only keep unique elements?
                    // prev[key] = pVal.concat(...oVal);
                    prev[key] = [...new Set([...oVal, ...pVal])];
                } else if (isObject(oVal) && isObject(pVal)) {
                    prev[key] = mergeDeep(pVal, oVal);
                } else {
                    // Values are primitives or of different types
                    if (isObject(pVal)) {
                        prev[key] = oVal;
                    } else {
                        // prev[key] not an object! => Simply overwrite prev!
                        prev = obj;
                    }
                }
            });
            return prev;
        } else {
            return obj;
        }
    }, {});
};

export const safeLocalStorageGet = key => {
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(key);
        }
    } catch (e) {
        // Node or sandboxed env — ignore
    }
}

export const noDebug = {
    debugDisabled: true,
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {}
};
