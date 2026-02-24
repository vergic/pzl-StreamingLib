import { Stream } from './Stream';
import StreamEventTypes from './StreamEventTypes';
import StreamErrors from './StreamErrors';
import { prepareEventsData, retryPromiseFunc } from './StreamUtils';
import * as SubscriptionsStore from './SubscriptionsStore';

/**
 * Creates a topic subscription manager with injected dependencies.
 * Handles Get + Subscribe flow for a single subscription.
 * @param {Object} deps
 * @param {() => Promise} deps.getConnection
 * @param {(sub) => void} deps.unsubscribe
 * @param {() => Object} deps.getOptions - Returns current StreamConnector options (streamingSubscribeOnly, streamingSubscribeOnResume, publishMethod, etc.)
 * @param {() => Object} deps.getDebug - Returns current debug logger
 * @param {number} [deps.resubscribeDelay=1]
 * @param {number} [deps.reconnectMaxRetries=60]
 */
export function createTopicSubscriptionManager(deps) {
    const {
        getConnection,
        unsubscribe,
        getOptions,
        getDebug,
        resubscribeDelay = 1,
        reconnectMaxRetries = 60
    } = deps;

    let lastSubscribeInvocationId = 0;

    const getTopic = (connection, subscription, fromId) => {
        const debug = getDebug();
        return new Promise((resolve, reject) => {
            const resultArray = [];
            const reverse = fromId < 0;
            const handlers = {
                next: (event) => resultArray.push(event),
                complete: () => resolve(reverse ? resultArray.reverse() : resultArray),
                error: (err) => {
                    debug.error('getTopic(): Get stream error:', err);
                    reject(err);
                }
            };
            const stream = reverse
                ? Stream.getReverse(connection, subscription, -fromId)
                : Stream.get(connection, subscription, fromId);
            stream.subscribe(handlers);
        });
    };

    async function _getAndStreamSubscription(subscription) {
        const debug = getDebug();
        debug.log('_getAndStreamSubscription:', subscription);

        unsubscribe(subscription);
        subscription = SubscriptionsStore.get(subscription);
        if (!subscription) {
            throw 'abort';
        }

        const currentSubscribeInvocationId = ++lastSubscribeInvocationId;
        subscription.subscribeInvocationId = currentSubscribeInvocationId;
        debug.log('_getAndStreamSubscription currentSubscribeInvocationId:', currentSubscribeInvocationId);

        let connection;
        try {
            connection = await getConnection();
        } catch (err) {
            debug.error('_getAndStreamSubscription: Exception from getConnection("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId);
            throw {
                errorCode: StreamErrors.BROKER_CONNECT_ERROR,
                errorMessage: 'Could not connect to broker (from _getAndStreamSubscription)',
                err
            };
        }

        debug.log('_getAndStreamSubscription: gotConnection:', connection);
        subscription = SubscriptionsStore.get(subscription);
        if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
            debug.log('_getAndStreamSubscription: A newer subscription has been invoked while waiting for connection - abort this one...');
            throw 'abort';
        }
        if (subscription.subscriberRef) {
            unsubscribe(subscription);
        }

        let getFullTopicState = subscription.lastReceivedEventId < 0 && (typeof subscription.fromEventId !== 'number' || subscription.fromEventId === subscription.options.topicStartEventId);
        let fromEventId = getFullTopicState ? subscription.options.topicStartEventId : (subscription.lastReceivedEventId >= 0 ? subscription.lastReceivedEventId + 1 : subscription.fromEventId);

        const options = getOptions();
        const streamingSubscribeOnly = typeof subscription.streamingSubscribeOnly === 'boolean' ? subscription.streamingSubscribeOnly : options.streamingSubscribeOnly;
        const streamingSubscribeOnResume = typeof subscription.streamingSubscribeOnResume === 'boolean' ? subscription.streamingSubscribeOnResume : options.streamingSubscribeOnResume;
        const skipInitialGet = streamingSubscribeOnly || (streamingSubscribeOnResume && !getFullTopicState);
        const getTopicPromise = skipInitialGet
            ? Promise.resolve([])
            : (debug.log('_getAndStreamSubscription: \'Get\': ', subscription, ' from: ', fromEventId, 'invocationId:', currentSubscribeInvocationId), getTopic(connection, subscription, fromEventId));

        let eventsArray;
        try {
            eventsArray = await getTopicPromise;
        } catch (err) {
            debug.error('_getAndStreamSubscription: Exception from getTopic("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId, connection, connection?.connectionState);
            throw {
                errorCode: StreamErrors.TOPIC_GET_ERROR,
                errorMessage: 'Error getting topic: ' + subscription,
                err
            };
        }

        subscription = SubscriptionsStore.get(subscription);
        if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
            debug.log('_getAndStreamSubscription: A newer subscription to this topic has been invoked while waiting for getTopic() - abort this one...');
            throw 'abort';
        }

        if (eventsArray && Array.isArray(eventsArray) && eventsArray.length) {
            debug.log('_getAndStreamSubscription: Got topic eventsArray:', eventsArray, 'invocationId:', currentSubscribeInvocationId);
            try {
                eventsArray = eventsArray.filter((event) => {
                    const eventId = event[subscription.options.eventIdProperty];
                    if (eventId < subscription.lastReceivedEventId + 1) {
                        debug.error('Error: Broker event id in response-array from \'Get\' out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                        debug.log('Skipping event...');
                        return false;
                    }
                    if (subscription.lastReceivedEventId !== -1 && eventId > subscription.lastReceivedEventId + 1) {
                        debug.error('Error: Broker event id in response-array from \'Get\' out of order (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                        throw StreamErrors.TOPIC_STREAM_OUT_OF_ORDER;
                    }
                    subscription.lastReceivedEventId = eventId;
                    return true;
                });
                const receivedAs = getFullTopicState ? StreamEventTypes.STATE : StreamEventTypes.STREAMED_CHUNK;
                const preparedEventsData = prepareEventsData(eventsArray, receivedAs, 'invocationId: ' + currentSubscribeInvocationId, debug);
                subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
            } catch (e) {
                if (e === StreamErrors.TOPIC_STREAM_OUT_OF_ORDER) {
                    debug.log('Unrecoverable error: Re-subscribing to topic...');
                } else {
                    debug.log('Unknown error:', e);
                }
                return getAndStreamSubscription(subscription);
            }
            fromEventId = subscription.lastReceivedEventId + 1;
        }

        try {
            debug.log('_getAndStreamSubscription: \'Subscribe\': ', subscription, ' from id: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);

            subscription.subscriberRef = Stream.stream(connection, subscription, fromEventId)
                .subscribe({
                    next: (event) => {
                        const eventId = event[subscription.options.eventIdProperty];
                        if (eventId < subscription.lastReceivedEventId + 1) {
                            debug.error('Error: Broker event id in \'Subscribe\'-stream out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                            debug.log('Skipping event...');
                        } else if (subscription.lastReceivedEventId !== -1 && eventId > subscription.lastReceivedEventId + 1) {
                            debug.error('Error: Broker event id in \'Subscribe\'-stream out of order: (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                            debug.log('Re-subscribing to topic...');
                            getAndStreamSubscription(subscription, true).catch((err) => {
                                debug.log('Error resubscribing to topic (subscribe, stream out of order, gap)', err);
                            });
                        } else {
                            const preparedEventsData = prepareEventsData(event, StreamEventTypes.STREAM, 'invocationId: ' + currentSubscribeInvocationId, debug);
                            subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
                            subscription.lastReceivedEventId = eventId;
                        }
                    },
                    complete: () => {
                        debug.log('Stream completed on "' + subscription + '"', 'invocationId:', currentSubscribeInvocationId);
                        subscription.onSubscriptionStreamComplete?.();
                    },
                    error: (err) => {
                        debug.error('Stream error on "' + subscription + '":', err, connection, connection.connectionState, 'invocationId:', currentSubscribeInvocationId);
                        subscription.onSubscriptionError?.(err);
                    }
                });

            subscription.onSubscriptionStart?.();
            return subscription.subscriberRef;
        } catch (err) {
            debug.error('Exception subscribing to topic "' + subscription + '":', err, 'invocationId:', currentSubscribeInvocationId, connection, connection.connectionState);
            throw {
                errorCode: StreamErrors.TOPIC_SUBSCRIBE_ERROR,
                errorMessage: 'Error subscribing to topic: ' + subscription,
                err
            };
        }
    }

    const getAndStreamSubscription = (subscription, keepRetrying) => {
        if (keepRetrying) {
            return retryPromiseFunc(() => _getAndStreamSubscription(subscription), resubscribeDelay * 1000, reconnectMaxRetries, 'abort');
        }
        return _getAndStreamSubscription(subscription);
    };

    return {
        getTopic,
        getAndStreamSubscription
    };
}
