let subscriptions = [];

export const findById = subscriptionId => {
    return subscriptionId && subscriptions.find(s => s.getSubscriptionId() === subscriptionId) || null;
}
export const exists = subscription => {
    return !!get(subscription);
}

export const add = subscription => {
    remove(get(subscription));
    subscriptions.push(subscription);
}

export const get = subscription => {
    return subscription && subscriptions.find(s => s.getSubscriptionId() === subscription.getSubscriptionId()) || null;
}
export const getAll = () => {
    return subscriptions;
}

export const remove = subscription => {
    if (subscription && typeof subscription === 'object') {
        subscriptions = subscriptions.filter(s => s.getSubscriptionId() !== subscription.getSubscriptionId());
        return true;
    }
    return false;
}
export const removeAll = () => {
    subscriptions = [];
}

