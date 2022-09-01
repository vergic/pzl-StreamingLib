const get = (connection, topic, fromId, options) => {
    const args = ['Get'];
    if (options.brokerVersion === 2) {
        args.push({
            sessionId: options.sessionId,
            topic: topic,
            fromId: fromId
        });
    } else if (options.brokerVersion === 3) {
        args.push({
            id: topic,
            skip: fromId,
            take: 10000,
            stream: false,
            reverse: false,
            visibleInTenant: false
        });
    } else {
        args.push(...[topic, fromId]);
    }
    return connection.stream(...args);
}

const getInvoke = (connection, topic, fromId, options) => {
    // NOTE: Used only for backwards compatibility with older CommSrv versions (broker<v1)
    // For newer CommSrv versions (broker >= v1), the regular get() is to be used...
    const args = ['Get'];
    if (options.brokerVersion === 2) {
        args.push({
            sessionId: options.sessionId,
            topic: topic,
            fromId: fromId
        })
    } else if (options.brokerVersion === 3) {
        args.push({
            id: topic,
            skip: fromId,
            take: 10000,
            stream: false,
            reverse: false,
            visibleInTenant: false
        });
    } else {
        args.push(...[topic, fromId]);
    }
    return connection.invoke(...args);
}

const subscribe = (connection, topic, fromId, options) => {
    const args = ['Get'];
    if (options.brokerVersion === 2) {
        args.push({
            sessionId: options.sessionId,
            topic: topic,
            fromId: fromId
        });
    } else if (options.brokerVersion === 3) {
        args.push({
            id: topic,
            skip: fromId,
            take: 10000,
            stream: true,
            reverse: false,
            visibleInTenant: false
        })
    } else {
        args.push(...[topic, fromId]);
    }
    return connection.stream(...args);
}

const publish = (connection, topic, data, options) => {
    const args = ['Publish'];
    if (options.brokerVersion === 1) {
        args.push(...[topic, data]);
    } else {
        args.push({
            sessionId: options.sessionId,
            topic,
            data
        })
    }
    return connection.invoke(...args);
}

export const Stream = {
    get,
    getInvoke,
    subscribe,
    publish
};
