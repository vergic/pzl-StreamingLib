import * as signalr from '@microsoft/signalr';
import { initBrokerConnectionFsm } from './BrokerFSM';
import StreamEventTypes from './StreamEventTypes';
import StreamErrors from './StreamErrors';
import { Stream } from './Stream';
import { promiseTimeout, retryPromiseFunc, noDebug } from './StreamUtils';
import * as SubscriptionsStore from './SubscriptionsStore';

const resubscribeDelay = 1;
const reconnectMaxRetries = 60; // 60 = 3 minutes if reconnectRetryDelay == 3

let debug = noDebug;

const options = {
    publishMethod: 'Publish',
    brokerUrl: null,
    brokerTransport: 'WebSockets',
    brokerLogLevel: 'none',
}
let lastSubscribeInvocationId = 0;
let brokerConnection = null;

/*******************************************************************************************
 ** Function for connecting (and maintaining connection) to broker
 *******************************************************************************************/
function _connect() {

    debug.log('_connect: Connecting to broker url: ' + options.brokerUrl);

    var brokerConnectionOptions;
    switch (options.brokerTransport) {
        case 'None':
        case 'Negotiate':
            brokerConnectionOptions = null;
            break;
        case 'LongPolling':
            brokerConnectionOptions = {
                transport: signalr.HttpTransportType.LongPolling
            }
            break;
        case 'ServerSentEvents':
            brokerConnectionOptions = {
                transport: signalr.HttpTransportType.ServerSentEvents
            }
            break;
        default:
            // Use WebSockets without negotiation by default... Is this ok? Do we ever want WebSockets *WITH* negotiation?
            brokerConnectionOptions = {
                skipNegotiation: true,
                transport: signalr.HttpTransportType.WebSockets
            }
    }

    if (options.access_token) {
        brokerConnectionOptions.accessTokenFactory = () => {
            return options.access_token
        }
    }

    var hubConnectionBuilder = new signalr.HubConnectionBuilder()
        .withUrl(options.brokerUrl, brokerConnectionOptions)
        .configureLogging(options.brokerLogLevel)
        .withAutomaticReconnect([0, 500, 3000, 5000, 10000]);
    var connection = hubConnectionBuilder.build();

    connection.onreconnecting(function (err) {
        debug.warn('_connect: Broker connection onreconnecting:', err, connection.connectionState, connection.receivedHandshakeResponse);
        unSubscribeAll();
    });

    connection.onreconnected(function () {
        debug.warn('_connect: Broker connection onreconnected:', connection.connectionState, connection.receivedHandshakeResponse);
        reSubscribeAll();
    });

    connection.onclose(function (err) {
        debug.log('_connect: Broker connection closed:', err, connection.connectionState, connection.receivedHandshakeResponse);
        brokerConnection.handle('connection_failed');
    });

    // Start the connection...
    connection.start().then(function () {
        debug.log('_connect: Broker connection.start() successful:', connection, connection.connectionState, connection.receivedHandshakeResponse);
        brokerConnection.handle('connection_ok', connection);
    }, function (err) {
        debug.log('_connect: Broker connection.start() error: ', err, connection, connection.connectionState);
        brokerConnection.handle('connection_failed', err);
    });
}

function isConnected() {
    return (brokerConnection && brokerConnection.getState() === 'connected');
}

function isDisconnected() {
    return (!brokerConnection || brokerConnection.getState() === 'disconnected');
}

function connectToBroker() {
    return new Promise(function (resolve, reject) {
        if (isConnected()) {
            // Already connected. Resolve with brokerConnection.connection
            resolve(brokerConnection.getConnection());
        } else {
            // Not connected. Hook up a state transition-listener to monitor brokerConnection state changes...
            const transitionListener = brokerConnection.on('transition', function (data) {
                if (data.toState === 'connected') {
                    // Successfully connected: Resolve and stop listening
                    resolve(brokerConnection.getConnection());
                    transitionListener.off();
                } else if (data.toState === 'disconnected' || data.toState === 'reconnect_wait') {
                    // Transitioned to "disconnected": Reject and stop listening
                    reject();
                    transitionListener.off();
                }
            });

            // And try to connect...
            // Note: The "connect"-action will only be effective in states "disconnected" and "reconnect_wait".
            // In all other states, we should end up in either "connected", "disconnected" or "reconnect_wait" soon anyway
            brokerConnection.handle('connect');
        }
    });
}

function disconnectFromBroker() {
    return new Promise(function (resolve, reject) {
        if (isDisconnected()) {
            // Already disconnected: Resolve
            resolve();
        } else {
            // Not disconnected. Hook up a state transition-listener to monitor brokerConnection state changes...
            const disconnectedTransitionListener = brokerConnection.on('transition', function (data) {
                if (data.toState === 'disconnected') {
                    // Successfully disconnected: Resolve and stop listening
                    resolve();
                    disconnectedTransitionListener.off();
                }
            });

            // And try to disconnect...
            brokerConnection.handle('disconnect');
        }
    });
}

function reConnectToBroker() {
    return disconnectFromBroker().then(function () {
        return connectToBroker().then(function (connection) {
            reSubscribeAll().then(function (subscriptions) {
                // Don't care about the result of this...
                debug.log('reConnectToBroker: all topics re-subscribed:', subscriptions);
            });
            return Promise.resolve(connection); // Resolve with connection (reSubscribeAll() resolves with subscriptions, and that's probably not what the caller of reConnectToBroker() expects)
        });
    });
}

function getConnection() {
    // Todo: Do we need more checks that connection is in the right state?
    return connectToBroker();
}


/*******************************************************************************************
 ** Functions for addig and remoing topic subscriptions
 *******************************************************************************************/
function addSubscription(subscription, timeout) {
    debug.log('addSubscription:', subscription, timeout);
    unsubscribe(subscription);
    SubscriptionsStore.add(subscription);

    // Subscribe to topic, skip retrying on failures (better to reject and let caller handle it)...
    // If a "timeout" is specified, reject if it's taking too long...
    if (timeout) {
        return promiseTimeout(getAndStreamSubscription(subscription), timeout);
    } else {
        return getAndStreamSubscription(subscription);
    }
}

function removeSubscription(subscription) {
    // Can either take a subscription object, or a subscriptionId (returned from Subscription.getSubscriptionId())
    debug.log('removeSubscription:', subscription);

    if (typeof subscription === 'string') {
        subscription = SubscriptionsStore.findById(subscription);
    }

    if (subscription) {
        unsubscribe(subscription);
        SubscriptionsStore.remove(subscription);
    }

    if (SubscriptionsStore.getAll().length < 1) {
        // No more active subscriptions - disconnect from broker
        debug.log('No more subscriptions - disconnecting from broker');
        disconnectFromBroker();
    }
}

function reSubscribeAll() {
    var subscribePromises = [];
    SubscriptionsStore.getAll().forEach(subscription => {
        debug.log('reSubscribeAll: Re-subscribing to subscription: ', subscription);
        subscribePromises.push(getAndStreamSubscription(subscription, true).catch(err => {
            // Catch any errors from _getAndStreamSubscription() to prevent Promise.all() below to "fail-fast" on errors...
            debug.warn('reSubscribeAll: Error re-subscribing to subscription: "' + subscription + '"', err);
        }));
    });
    return Promise.all(subscribePromises);
}

function unSubscribeAll() {
    // Unsubscribe any active subscription...
    SubscriptionsStore.getAll().forEach(unsubscribe);
}


/*******************************************************************************************
 ** Functions for getting and subscribing/unsubscribing to any topic
 *******************************************************************************************/
function getTopic(connection, subscription, fromId) {
    // debug.log('getTopic:', topic, 'from:', fromId);
    var resultArray = [];
    return new Promise(function (resolve, reject) {
        Stream.get(connection, subscription, fromId, options)
            .subscribe({
                next: function (event) {
                    // debug.log('getTopic Get stream next:', event);
                    resultArray.push(event);
                },
                complete: function () {
                    // debug.log('getTopic Get stream complete:', resultArray);
                    resolve(resultArray);
                },
                error: function (err) {
                    debug.error('getTopic(): Get stream error:', err);
                    reject(err);
                }
            });
    });
}

function getAndStreamSubscription(subscription, keepRetrying) {
    if (keepRetrying) {
        return retryPromiseFunc(_getAndStreamSubscription.bind(null, subscription), resubscribeDelay * 1000, reconnectMaxRetries, 'abort');
    } else {
        return _getAndStreamSubscription(subscription);
    }
}

function _getAndStreamSubscription(subscription) {
    debug.log('_getAndStreamSubscription:', subscription);

    return new Promise(function (resolve, reject) {

        // Unsubscribe if already subscribing...
        unsubscribe(subscription);

        subscription = SubscriptionsStore.get(subscription);
        if (!subscription) {
            return reject('abort');	// Reject with reason 'abort' to skip retrying...
        }

        // Track invocations to _getAndStreamSubscription() by subscription.subscribeInvocationId
        var currentSubscribeInvocationId = ++lastSubscribeInvocationId;
        subscription.subscribeInvocationId = currentSubscribeInvocationId;
        debug.log('_getAndStreamSubscription currentSubscribeInvocationId:', currentSubscribeInvocationId);

        getConnection().then(function (connection) {
            debug.log('_getAndStreamSubscription: gotConnection:', connection);

            // Important: Look up the subscription again - it may have changed while waiting for connection!
            subscription = SubscriptionsStore.get(subscription);
            if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
                debug.log('_getAndStreamSubscription: A newer subscription has been invoked while waiting for connection - abort this one...');
                return reject('abort');	// Reject with reason 'abort' to skip retrying...
            }
            if (subscription.subscriberRef) {
                // Stop any existing subscription if exists (should not happen, as we have already called unsubscribe() before connecting, and if we get here we should be in the same invocation)
                unsubscribe(subscription);
            }

            var getFullTopicState = (subscription.lastReceivedEventId < 0 && (typeof subscription.fromEventId !== 'number' || subscription.fromEventId === subscription.options.topicStartEventId)); // No events received yet, and no "fromEventId" specified (different from "topicStartEventId") => We want the full topic state!
            var fromEventId = (getFullTopicState ? subscription.options.topicStartEventId : (subscription.lastReceivedEventId >= 0 ? subscription.lastReceivedEventId + 1 : subscription.fromEventId));
            var getTopicPromise;
            if (options.streamingSubscribeOnly) {
                getTopicPromise = Promise.resolve([]);
            } else {
                debug.log('_getAndStreamSubscription: \'Get\': ', subscription, ' from: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);
                getTopicPromise = getTopic(connection, subscription, fromEventId);
            }

            getTopicPromise.then(function (eventsArray) {

                // Important: Look up the subscription for this topic again - it may have changed while waiting for connection!
                subscription = SubscriptionsStore.get(subscription);
                if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
                    debug.log('_getAndStreamSubscription: A newer subscription to this topic has been invoked while waiting for getTopic() - abort this one...');
                    return reject('abort');	// Reject with reason 'abort' to skip retrying...
                }

                if (eventsArray && Array.isArray(eventsArray) && eventsArray.length) {
                    // Handle events from broker 'Get' (if any exists)
                    debug.log('_getAndStreamSubscription: Got topic eventsArray:', eventsArray, 'invocationId:', currentSubscribeInvocationId);

                    try {
                        // Filter eventsArray to remove duplicates (which is a recoverable error condition)
                        // Or throw a StreamErrors.TOPIC_STREAM_OUT_OF_ORDER if expected event(s) are missing (which is an unrecoverable error)
                        eventsArray = eventsArray.filter(function (event) {
                            const eventId = event[subscription.options.eventIdProperty];
                            if (eventId < subscription.lastReceivedEventId + 1) {
                                debug.error('Error: Broker event id in response-array from \'Get\' out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                                debug.log('Skipping event...');
                                return false;	// return false to skip by filter
                            } else if (subscription.lastReceivedEventId != -1 && eventId > subscription.lastReceivedEventId + 1) {
                                debug.error('Error: Broker event id in response-array from \'Get\' out of order (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                                throw StreamErrors.TOPIC_STREAM_OUT_OF_ORDER;	// throw exception to abort (unrecoverable error)
                            }
                            subscription.lastReceivedEventId = eventId;
                            return true;	// All ok, return true to include event
                        });

                        var receivedAs = (getFullTopicState ? StreamEventTypes.STATE : StreamEventTypes.STREAMED_CHUNK);
                        var preparedEventsData = _prepareEventsData(eventsArray, receivedAs, 'invocationId: ' + currentSubscribeInvocationId);
                        subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);

                    } catch (e) {
                        if (e === StreamErrors.TOPIC_STREAM_OUT_OF_ORDER) {
                            debug.log('Unrecoverable error: Re-subscribing to topic...');
                        } else {
                            debug.log('Unknown error:', e);
                        }
                        getAndStreamSubscription(subscription).then(resolve, reject); // Try to resubscribe, but skip retrying on failures... Warning: Does not work!!! This loops forever if getAndStreamSubscription() constantly fails!
                        return;
                    }
                    fromEventId = subscription.lastReceivedEventId + 1;
                }

                try {
                    debug.log('_getAndStreamSubscription: \'Subscribe\': ', subscription, ' from id: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);

                    subscription.subscriberRef = Stream.stream(connection, subscription, fromEventId, options)
                        // subscription.subscriberRef = connection.stream('Subscribe', '1'+topic, fromEventId) // Test invalid topic
                        .subscribe({
                            next: function (event) {
                                // Handle events from broker 'Subscribe'
                                const eventId = event[subscription.options.eventIdProperty];
                                if (eventId < subscription.lastReceivedEventId + 1) {
                                    debug.error('Error: Broker event id in \'Subscribe\'-stream out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                                    debug.log('Skipping event...');
                                } else if (subscription.lastReceivedEventId != -1 && eventId > subscription.lastReceivedEventId + 1) {
                                    debug.error('Error: Broker event id in \'Subscribe\'-stream out of order: (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                                    debug.log('Re-subscribing to topic...');
                                    getAndStreamSubscription(subscription, true).catch(function (err) {
                                        debug.log('Error resubscribing to topic (subscribe, stream out of order, gap)', err);
                                    });
                                } else {
                                    const preparedEventsData = _prepareEventsData(event, StreamEventTypes.STREAM, 'invocationId: ' + currentSubscribeInvocationId);
                                    subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
                                    subscription.lastReceivedEventId = eventId;
                                }
                            },
                            complete: function () {
                                debug.log('Stream completed on "' + subscription + '"', 'invocationId:', currentSubscribeInvocationId);
                                subscription.onSubscriptionStreamComplete && subscription.onSubscriptionStreamComplete();
                            },
                            error: function (err) {
                                debug.error('Stream error on "' + subscription + '":', err, connection, connection.connectionState, 'invocationId:', currentSubscribeInvocationId);
                                subscription.onSubscriptionError && subscription.onSubscriptionError(err);
                            }
                        });

                    // After successful subscription: Call onSubscriptionStart()-hook in the subscription, if it exists
                    subscription.onSubscriptionStart && subscription.onSubscriptionStart();

                    resolve(subscription.subscriberRef);
                } catch (err) {
                    debug.error('Exception subscribing to topic "' + subscription + '":', err, 'invocationId:', currentSubscribeInvocationId, connection, connection.connectionState);
                    reject({
                        errorCode: StreamErrors.TOPIC_SUBSCRIBE_ERROR,
                        errorMessage: 'Error subscribing to topic: ' + subscription,
                        err: err
                    });
                }
            }).catch(function (err) {
                // getTopic() rejected or unrecoverable reSubscribe from eventsArray array out of order
                debug.error('_getAndStreamSubscription: Exception from getTopic("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId, connection, connection?.connectionState);
                reject({
                    errorCode: StreamErrors.TOPIC_GET_ERROR,
                    errorMessage: 'Error getting topic: ' + subscription,
                    err: err
                });
            });
        }, function (err) {
            debug.error('_getAndStreamSubscription: Exception from getConnection("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId);
            reject({
                errorCode: StreamErrors.BROKER_CONNECT_ERROR,
                errorMessage: 'Could not connect to broker (from _getAndStreamSubscription)',
                err: err
            });
        });
    });
}

function unsubscribe(subscription) {
    subscription = SubscriptionsStore.get(subscription);

    if (subscription && subscription.subscriberRef) {

        // Before unsubscribing an active subscription: Call onSubscriptionEnd()-hooks in the subscription, if it exists
        subscription.onSubscriptionEnd && subscription.onSubscriptionEnd();

        try {
            subscription.subscriberRef.dispose();
            debug.log('topic subscriber disposed');
        } catch (e) {
            debug.log('Exception disposing topic subscriber:', e);
        }
        subscription.subscriberRef = null;
    }
}

function publishTopicWhenConnected(topic, data) {
    return getConnection().then(function (connection) {
        try {
            return Stream.publish(connection, topic, data, options);
        } catch (e) {
            debug.log('Exception in publishTopic: ', e);
            return Promise.reject(e);
        }
    });
}

function publishTopicIfConnected(topic, data) {
    if (!isConnected()) {
        return Promise.reject('Not connected');
    }
    return publishTopicWhenConnected(topic, data);
}


function getSubscriptions() {
    return SubscriptionsStore.getAll();
}


/*******************************************************************************************
 ** Util-function to prepare the received events before calling the subscription.onDataReceived() hook
 *******************************************************************************************/
function _prepareEventsData(events, receivedAs, extraLoggingArg) {
    // Incoming data from broker
    // "events" contains the actual event data
    // 		It can be an array (from 'Get' topic, together with "receivedAs" = StreamEventTypes.STATE or StreamEventTypes.STREAMED_CHUNK)
    // 		or a single event object (together with "receivedAs" = StreamEventTypes.STREAM)
    // "receivedAs" can be StreamEventTypes.STATE, StreamEventTypes.STREAM or StreamEventTypes.STREAMED_CHUNK depending on how the data was received
    //		StreamEventTypes.STATE means than "events" contains the full topic state as an array
    // 		StreamEventTypes.STREAMED_CHUNK means than "events" contains an events-array, but it does not begin with topic start, so it's not a full state (but rather a "chunk" of streamed data in the middle of the topic)
    // 		StreamEventTypes.STREAM means than "events" contains a single, streamed event object (from connection.stream('Subscribe', ...)
    // "extraLoggingArg" (optional) will be added to the debug log

    // Assemble debug data...
    var debugData = [];
    if (receivedAs === StreamEventTypes.STREAM) {
        const eventType = (events.data && events.data.type || events.type);
        const messageType = (events.data && events.data.messageType || events.messageType);
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

    return {
        eventsArray: (receivedAs === StreamEventTypes.STREAM ? [events] : events),
        receivedAs: receivedAs
    }
}


/*******************************************************************************************
 ** Init function to configure the StreamConnector
 *
 *   brokerUrl        = URL to CommSrv broker endpoint
 *
 *   streamOptions    = Config object for signalR and related behavior
 *        streamOptions.brokerTransport (optional, default 'WebSockets'):
 *        One of: 'None' | 'Negotiate' | 'WebSockets' | 'LongPolling' | 'ServerSentEvents'
 *      streamOptions.brokerLogLevel (optional, default 'none'):
 *            One of: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical' | 'none'
 *      streamOptions.streamingSubscribeOnly (optional, default false):
 *        If true, topic history/state is not fetched using 'Get' (i.e. everything is streamed using 'Subscribe' only)
 *
 *   eventHandlers    = Object containing (optional) event handler hook functions, e.g.
 *      {
 *    		onConnectionStarted = function (connection) { // Do something on broker connection started...  },
 *    		onConnectionFailed = function (connection) { // Do something on broker connection failed... },
 *		}
 *
 *   debugFns        = Optional object containing debug functions (default will be noop), e.g.:
 *      {
 * 			log: (...args) => { ... },
 * 			warn: (...args) => { ... },
 * 			error: (...args) => { ... },
 * 			info: (...args) => { ... },
 *	 	}
 *******************************************************************************************/
const init = async (brokerUrl, streamOptions = {}, eventHandlers = {}, debugFns = noDebug) => {
    if (!brokerConnection) {
        brokerConnection = initBrokerConnectionFsm({
            _connect,
            reSubscribeAll,
            unSubscribeAll
        }, eventHandlers, debugFns);
    }

    streamOptions.brokerTransport = streamOptions.brokerTransport || 'WebSockets';
    streamOptions.brokerLogLevel = streamOptions.brokerLogLevel || 'none';
    streamOptions.streamingSubscribeOnly = streamOptions.streamingSubscribeOnly || false;

    if (brokerUrl && brokerUrl !== options.brokerUrl ||
        streamOptions.access_token !== options.access_token ||
        streamOptions.brokerTransport !== options.brokerTransport ||
        streamOptions.brokerLogLevel !== options.brokerLogLevel)
    {
        debug = debugFns;
        options.brokerUrl = brokerUrl;
        options.access_token = streamOptions.access_token;
        options.brokerTransport = streamOptions.brokerTransport;
        options.brokerLogLevel = streamOptions.brokerLogLevel;
        options.streamingSubscribeOnly = streamOptions.streamingSubscribeOnly;

        brokerConnection.setEventCallbacks(eventHandlers);

        debug.log('Initializing StreamConnector');
        debug.log('SignalR client lib version:', signalr.VERSION);

        if (!isDisconnected()) {
            // If we have an active connection: Re-connect to broker with the new brokerUrl, access_token or changed options...
            try {
                const connection = await reConnectToBroker();
                debug.log('StreamConnector: broker config changed: Successfully re-connected to broker', connection);
                return 're-connected';
            } catch (err) {
                debug.error('StreamConnector: broker config changed: Error re-connecting to broker', err);
                throw ('Error re-connecting');
            }
        } else {
            return 'disconnected';
        }
    } else {
        return 'no change';
    }
};

export default {
    _signalr: signalr,	// Expose the signalr lib  - mainly for debugging...
    init: init,
    getSubscriptions: getSubscriptions,
    addSubscription: addSubscription,
    removeSubscription: removeSubscription,
    publishTopicIfConnected: publishTopicIfConnected
}
