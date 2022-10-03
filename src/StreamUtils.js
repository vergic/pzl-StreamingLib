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
            wait(ms).then(reject.bind(null, 'timeout'))
        })
    ])
}

// From: https://gomakethings.com/merging-objects-with-vanilla-javascript/
export const extend = (...args) => {
    const extended = {};
    let deep = false;

    // Merge obj into extended
    const merge = obj => {
        for (const prop in obj) {
            if (obj.hasOwnProperty(prop)) {
                if (deep && Object.prototype.toString.call(obj[prop]) === '[object Object]') {
                    // If we're doing a deep merge and the property is an object
                    extended[prop] = extend(true, extended[prop], obj[prop]);
                } else {
                    // Otherwise, do a regular merge
                    extended[prop] = obj[prop];
                }
            }
        }
    };

    args.forEach((arg, i) => {
        if (i === 0 && typeof (arg) === 'boolean') {
            // First arg controls "deep merge" if its type is boolean
            deep = arg;
        } else {
            merge(arg);
        }
    })

    return extended;
};

export const noDebug = {
    log: () => {},
    warn: () => {},
    error: () => {},
    info: () => {}
};
