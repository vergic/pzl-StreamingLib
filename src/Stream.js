const get = (connection, subscription, fromId) => {
    const method = subscription.options.getMethod || 'Get';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: Math.max(0, fromId - 1),
        take: 100000,
    });
}

const getReverse = (connection, subscription, take, skip = 0) => {
    const method = subscription.options.getReverseMethod || 'GetReverse';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: skip, // Skip from "latest" event = usually 0
        take: take, // No of events to 'Get' from "latest"
    });
}

const stream = (connection, subscription, fromId) => {
    const method = subscription.options.streamMethod || 'Subscribe';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: Math.max(0, fromId - 1),
        take: 100000,
    });
}

const publish = (connection, topic, data, options) => {
    // NOTE: Publish is not yet implemented in OnePlatform broker...
    const method = options.publishMethod || 'Publish';
    return connection.invoke(method, {
        topic,
        data
    });
}

export const Stream = {
    get,
    getReverse,
    stream,
    publish
};
