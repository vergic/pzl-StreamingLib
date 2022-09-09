const get = (connection, subscription, fromId, options) => {
    const args = [subscription.options.getMethod || 'Get'];
    const topic = subscription[subscription.options.topicProperty];
    if (options.brokerVersion === 2) {
        args.push({
            sessionId: options.sessionId,
            topic: topic,
            fromId: fromId
        });
    } else if (options.brokerVersion === 3) {
        args.push({
            type: subscription.options.type,
            [subscription.options.topicProperty]: subscription[subscription.options.topicProperty],
            skip: Math.max(0, fromId - 1),
            take: 100000,
        });
    } else {
        args.push(...[topic, fromId]);
    }
    return connection.stream(...args);
}

const getInvoke = (connection, subscription, fromId, options) => {
    // NOTE: Used only for backwards compatibility with older CommSrv versions (broker<v1)
    // For newer CommSrv versions (broker >= v1), the regular get() is to be used...
    if (options.brokerVersion > 1) {
        return Promise.reject('getInvoke not supported in broker version');
    } else {
        const args = [subscription.options.getMethod || 'Get'];
        const topic = subscription[subscription.options.topicProperty];
        args.push(...[topic, fromId]);
        return connection.invoke(...args);
    }
}

const getReverse = (connection, subscription, fromId, options) => {
    if (options.brokerVersion !== 3) {
        return Promise.reject('getReverse not supported in broker version');
    } else {
        const args = [subscription.options.getReverseMethod || 'GetReverse'];
        args.push({
            type: subscription.options.type,
            [subscription.options.topicProperty]: subscription[subscription.options.topicProperty],
            skip: Math.max(0, fromId - 1),
            take: 100000,
        });
        return connection.stream(...args);
    }
}

const stream = (connection, subscription, fromId, options) => {
    const args = [subscription.options.streamMethod || 'Subscribe'];
    const topic = subscription[subscription.options.topicProperty];
    if (options.brokerVersion === 2) {
        args.push({
            sessionId: options.sessionId,
            topic: topic,
            fromId: fromId
        });
    } else if (options.brokerVersion === 3) {
        args.push({
            type: subscription.options.type,
            [subscription.options.topicProperty]: subscription[subscription.options.topicProperty],
            skip: Math.max(0, fromId - 1),
            take: 100000,
        })
    } else {
        args.push(...[topic, fromId]);
    }
    return connection.stream(...args);
}

const publish = (connection, topic, data, options) => {
    const args = [options.publishMethod || 'Publish'];
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
    getReverse,
    stream,
    publish
};
