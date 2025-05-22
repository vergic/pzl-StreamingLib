const wait = (ms) => {
    return new Promise(function (r) {
        return setTimeout(r, ms)
    });
}

export const retryPromiseFunc = (promisedFunction, delay, maxRetries, abortReason) => {
    // This function retries "promisedFunction" (a function which is expected to return a Promise) until it's reloved, or until retried "maxRetries" number of times or until rejected with reason == "abortReason"...
    return new Promise(function (resolve, reject) {
        return promisedFunction()
            .then(resolve)
            .catch(function (reason) {
                if (maxRetries - 1 > 0 && reason !== abortReason) {
                    return wait(delay)
                        .then(retryPromiseFunc.bind(null, promisedFunction, delay, maxRetries - 1, abortReason))
                        .then(resolve)
                        .catch(reject);
                }
                return reject(reason);
            });
    });
}

export const promiseTimeout = (promise, ms) => {
    // Create a promise that rejects in <ms> milliseconds
    // Returns a race between our timeout and the passed in promise
    return Promise.race([
        promise,
        new Promise(function (resolve, reject) {
            wait(ms).then(reject.bind(null, new Error('timeout')))
        })
    ])
}

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
