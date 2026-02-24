import * as signalr from '@microsoft/signalr';
import { initBrokerConnectionFsm } from './BrokerFSM';
import { Stream } from './Stream';
import { promiseTimeout, noDebug, safeLocalStorageGet } from './StreamUtils';
import * as SubscriptionsStore from './SubscriptionsStore';
import { createTopicSubscriptionManager } from './TopicSubscriptionManager';

const resubscribeDelay = 1;
const reconnectMaxRetries = 60; // 60 = 1 minute if resubscribeDelay == 1

let debug = noDebug;

let options = {
    publishMethod: 'Publish',
    brokerUrl: null,
    brokerTransport: 'WebSockets',
    brokerLogLevel: 'none',
}
let brokerConnection = null;

/*******************************************************************************************
 ** Function for connecting (and maintaining connection) to broker
 *******************************************************************************************/
const _connect = () => {
    debug.log('_connect: Connecting to broker url: ' + options.brokerUrl);

    let brokerConnectionOptions;
    switch (options.brokerTransport) {
        case 'None':
        case 'Negotiate':
            brokerConnectionOptions = {};
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

    // If an accessTokenFactory()-function is supplied with options, use that.
    // ...else if "access_token" is supplied as a string, create an accessTokenFactory() returning it
    brokerConnectionOptions.accessTokenFactory = options.accessTokenFactory || options.access_token && (() => options.access_token) || null;

    const hubConnectionBuilder = new signalr.HubConnectionBuilder()
        .withUrl(options.brokerUrl, brokerConnectionOptions)
        .configureLogging(options.brokerLogLevel)
        .withAutomaticReconnect(options.reconnectRetryPolicy || [0, 500, 3000, 5000, 10000]);
    const connection = hubConnectionBuilder.build();

    connection.onreconnecting(err => {
        debug.warn('_connect: Broker connection onreconnecting:', err, connection.connectionState, connection.receivedHandshakeResponse);
        typeof options.brokerEventHandlers?.onReconnecting === 'function' && options.brokerEventHandlers.onReconnecting(err);
        unSubscribeAll();
    });

    connection.onreconnected(async (connectionId) => {
        debug.warn('_connect: Broker connection onreconnected:', connection.connectionState, connection.receivedHandshakeResponse);
        typeof options.brokerEventHandlers?.onReconnected === 'function' && options.brokerEventHandlers.onReconnected(connectionId);
        await reSubscribeAll().catch(() => {});
    });

    connection.onclose(err => {
        debug.log('_connect: Broker connection closed:', err, connection.connectionState, connection.receivedHandshakeResponse);
        brokerConnection.handle('connection_failed');
    });

    // Start the connection...
    connection.start()
        .then(() => {
            debug.log('_connect: Broker connection.start() successful:', connection, connection.connectionState, connection.receivedHandshakeResponse);
            brokerConnection.handle('connection_ok', connection);
        })
        .catch((err) => {
            debug.log('_connect: Broker connection.start() error: ', err, connection, connection.connectionState);
            brokerConnection.handle('connection_failed', err);
        });
}

const isConnected = () => brokerConnection?.getState() === 'connected';

const isDisconnected = () => !brokerConnection || brokerConnection.getState() === 'disconnected';

const connectToBroker = () => {
    return new Promise((resolve, reject) => {
        if (isConnected()) {
            resolve(brokerConnection.getConnection());
        } else {
            const transitionListener = brokerConnection.on('transition', (data) => {
                if (data.toState === 'connected') {
                    resolve(brokerConnection.getConnection());
                    transitionListener.off();
                } else if (data.toState === 'disconnected' || data.toState === 'reconnect_wait') {
                    reject();
                    transitionListener.off();
                }
            });
            brokerConnection.handle('connect');
        }
    });
};

const disconnectFromBroker = () => {
    return new Promise((resolve) => {
        if (isDisconnected()) {
            resolve();
        } else {
            const disconnectedTransitionListener = brokerConnection.on('transition', (data) => {
                if (data.toState === 'disconnected') {
                    resolve();
                    disconnectedTransitionListener.off();
                }
            });
            brokerConnection.handle('disconnect');
        }
    });
}

const reConnectToBroker = async () => {
    await disconnectFromBroker();
    const connection = await connectToBroker();
    reSubscribeAll().then((subscriptions) => {
        debug.log('reConnectToBroker: all topics re-subscribed:', subscriptions);
    }).catch(() => {});
    return connection;
};

const getConnection = () => connectToBroker();


/*******************************************************************************************
 ** Functions for adding and removing streamSubscriptions
 *******************************************************************************************/
const unsubscribe = (subscription) => {
    subscription = SubscriptionsStore.get(subscription);

    if (subscription?.subscriberRef) {
        subscription.onSubscriptionEnd?.();
        try {
            subscription.subscriberRef.dispose();
            debug.log('topic subscriber disposed');
        } catch (e) {
            debug.log('Exception disposing topic subscriber:', e);
        }
        subscription.subscriberRef = null;
    }
};

const topicManager = createTopicSubscriptionManager({
    getConnection,
    unsubscribe,
    getOptions: () => options,
    getDebug: () => debug,
    resubscribeDelay,
    reconnectMaxRetries
});

const addStreamSubscription = (subscription, timeout) => {
    debug.log('addStreamSubscription:', subscription, timeout);
    unsubscribe(subscription);
    SubscriptionsStore.add(subscription);

    if (timeout) {
        return promiseTimeout(topicManager.getAndStreamSubscription(subscription), timeout);
    }
    return topicManager.getAndStreamSubscription(subscription);
};

const removeStreamSubscription = (subscription) => {
    // Can either take a streamSubscription object, or a subscriptionId (returned from StreamSubscription.getSubscriptionId())
    debug.log('removeStreamSubscription:', subscription);

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
        disconnectFromBroker().catch(() => {});
    }
};

const reSubscribeAll = () => {
    const subscribePromises = [];
    SubscriptionsStore.getAll().forEach(subscription => {
        debug.log('reSubscribeAll: Re-subscribing to subscription: ', subscription);
        subscribePromises.push(topicManager.getAndStreamSubscription(subscription, true).catch(err => {
            // Catch any errors from _getAndStreamSubscription() to prevent Promise.all() below to "fail-fast" on errors...
            debug.warn('reSubscribeAll: Error re-subscribing to subscription: "' + subscription + '"', err);
        }));
    });
    return Promise.all(subscribePromises);
};

const unSubscribeAll = () => {
    // Unsubscribe any active subscription...
    SubscriptionsStore.getAll().forEach(unsubscribe);
};

const publishTopicWhenConnected = async (topic, data) => {
    const connection = await getConnection();
    try {
        return await Stream.publish(connection, topic, data, options);
    } catch (e) {
        debug.log('Exception in publishTopic: ', e);
        throw e;
    }
};

const publishTopicIfConnected = (topic, data) => {
    if (!isConnected()) {
        return Promise.reject('Not connected');
    }
    return publishTopicWhenConnected(topic, data);
};

const getStreamSubscriptions = () => SubscriptionsStore.getAll();


/*******************************************************************************************
 ** Init function to configure the StreamConnector
 *
 *   brokerUrl        = URL to CommSrv broker endpoint
 *
 *   initOptions      = Config object for signalR and related behavior
 *       initOptions.brokerTransport (optional, default 'WebSockets'):
 *          One of: 'None' | 'Negotiate' | 'WebSockets' | 'LongPolling' | 'ServerSentEvents'
 *       initOptions.brokerLogLevel (optional, default 'none'):
 *          One of: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical' | 'none'
 *       initOptions.streamingSubscribeOnly (optional, default false):
 *          If true, topic history/state is not fetched using 'Get' (i.e. everything is streamed using 'Subscribe' only)
 *       initOptions.reconnectRetryPolicy (optional, default [0, 500, 3000, 5000, 10000]):
 *          An array of retry intervals times in ms, or an object with more controlled retry policy
 *          (see "Automatically reconnect" on https://learn.microsoft.com/en-us/aspnet/core/signalr/javascript-client?view=aspnetcore-7.0&tabs=visual-studio)
 *
 *   eventHandlers    = Object containing (optional) event handler hook functions, e.g.
 *      {
 *    		onConnectionStarted = (connection) => { // Do something on broker connection started...  },
 *    		onConnectionFailed  = (error) => { // Do something on broker connection failed... },
 *    	    onDisconnected = () => { // Do something on broker disconnect (after auto reconnect failed... }
 *   	    onReconnecting = (error) => { // Do something on broker auto-reconnecting... }
 *  	    onReconnected = (connectionId) => { // Do something on successful broker auto-reconnect... }
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
const init = async (brokerUrl, initOptions = {}, brokerEventHandlers = {}, debugFns) => {
    const debugOverride = (safeLocalStorageGet('pzl-streaming-debug') === 'true');
    debug = debugOverride && console || debugFns || noDebug;
    const brokerLogLevelOverride = safeLocalStorageGet('pzl-broker-log-level') || debugOverride && 'info' || null;

    if (!brokerConnection) {
        brokerConnection = initBrokerConnectionFsm({
            _connect,
            reSubscribeAll,
            unSubscribeAll
        }, brokerEventHandlers, debug);
    }

    initOptions.brokerTransport = initOptions.brokerTransport || 'WebSockets';
    initOptions.brokerLogLevel = brokerLogLevelOverride || initOptions.brokerLogLevel || 'none';
    initOptions.streamingSubscribeOnly = !!initOptions.streamingSubscribeOnly || false;     // default false
    initOptions.streamingSubscribeOnResume = (initOptions.streamingSubscribeOnResume === false ? false : true); // default true
    initOptions.access_token = initOptions.access_token || (await initOptions.accessTokenFactory?.()) || null;

    if (brokerUrl && brokerUrl !== options.brokerUrl ||
        initOptions.access_token !== options.access_token ||
        initOptions.brokerTransport !== options.brokerTransport ||
        initOptions.brokerLogLevel !== options.brokerLogLevel)
    {
        options = {
            ...options,
            brokerUrl,
            ...initOptions,
            brokerEventHandlers
        }

        brokerConnection.setEventCallbacks(brokerEventHandlers);

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

const updateAccessToken = async (new_access_token) => {
    // Call when access_token has changed.
    // Will re-connect broker and re-subscribe if connected and token has changed
    // (just like on init() above, but will not require re-register options and handlers)
    // If "new_access_token" is empty/false/null, options.accessTokenFactory?.() will be called instead
    // I.e. if an accessTokenFactory()-function has been supplied in options,
    // this function can be called without options to force a token re-check using accessTokenFactory()

    if (!brokerConnection) {
        throw new Error('StreamConnection not initialized. This function can only be called after init')
    }

    new_access_token = new_access_token || (await options.accessTokenFactory?.()) || null;

    if (new_access_token !== options.access_token) {
        options.access_token = new_access_token;
        debug.log('StreamConnector.updateAccessToken(): new access_token');
        if (!isDisconnected()) {
            // If we have an active connection: Re-connect to broker with the new brokerUrl, access_token or changed options...
            try {
                const connection = await reConnectToBroker();
                debug.log('StreamConnector.updateAccessToken(): Successfully re-connected to broker', connection);
                return 're-connected';
            } catch (err) {
                debug.error('StreamConnector.updateAccessToken(): Error re-connecting to broker', err);
                throw ('Error re-connecting');
            }
        }
    } else {
        debug.log('StreamConnector.updateAccessToken(): access_token not changed => Do nothing');
    }
};

export default {
    _signalr: signalr,	// Expose the signalr lib  - mainly for debugging...
    init,
    updateAccessToken,
    getStreamSubscriptions,
    addStreamSubscription,
    removeStreamSubscription,
    publishTopicIfConnected
}
