const get = (connection, subscription, fromId) => {
    const method = subscription.options.getMethod || 'Get';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: Math.max(0, fromId - 1) || undefined,
        ...(subscription.extraProps || {})
    });
}

const getReverse = (connection, subscription, take, skip = 0) => {
    const method = subscription.options.getReverseMethod || 'GetReverse';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: Math.max(0, skip) || undefined,
        take, // No of events to 'Get' from "latest"
        ...(subscription.extraProps || {})
    });
}

const stream = (connection, subscription, fromId) => {
    const method = subscription.options.streamMethod || 'Subscribe';
    const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
    return connection.stream(method, {
        type,
        [subscription.options.topicProperty]: topic,
        skip: Math.max(0, fromId - 1) || undefined,
        ...(subscription.extraProps || {})
    });
}

const publish = (connection, topic, data, options, extraProps = {}) => {
    // NOTE: Publish is not yet implemented in OnePlatform broker...
    const method = options.publishMethod || 'Publish';
    return connection.invoke(method, {
        topic,
        data,
        ...extraProps
    });
}

export const Stream = {
    get,
    getReverse,
    stream,
    publish
};
