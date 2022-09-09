import * as signalr from '@microsoft/signalr';
import StreamEventTypes from './StreamEventTypes';
import StreamErrors from './StreamErrors';
import {Stream} from './Stream';
import {StreamUtils} from './StreamUtils';
import * as SubscriptionsStore from './SubscriptionsStore';

const default_broker_version = 1;
const reconnectRetryDelay = 3;
const resubscribeDelay = 1;
const reconnectMaxRetries = 60; // 60 = 3 minutes if reconnectRetryDelay == 3

const noDebug = {
	log: () => {},
	warn: () => {},
	error: () => {},
	info: () => {}
}

let machina = null;
let debug = noDebug;

const options = {
	brokerVersion: default_broker_version,
	publishMethod: 'Publish',
	brokerUrl: null,
	brokerTransport: 'WebSockets',
	brokerLogLevel: 'none',
	sessionId: null,
}
var brokerEventCallbacks = {};
var lastSubscribeInvocationId = 0;
var brokerConnection = null;

function initBrokerConnectionFsm(machina) {
	/*******************************************************************************************
	 ** brokerConnection state machine
	 * Should probably be broken out from this module...
	 *******************************************************************************************/
	brokerConnection = new machina.Fsm({
		initialize: function() {
			this.connection = null;
			this.reconnectCounter = 0;
		},

		initialState: 'disconnected',

		states: {
			disconnected: {
				_onEnter: function() {
					debug.log('FSM: disconnected._onEnter()');
					this.connection = null;
				},
				connect: function () {
					this.transition('connecting');
				}
			},
			connecting: {
				_onEnter: function() {
					debug.log('FSM: connecting._onEnter()');
					_connect();
				},
				connection_ok: function (connection) {
					this.connection = connection;
					this.transition('connected');
				},
				connection_failed: function (err) {
					this.transition('disconnected');
				},
				disconnect: function () {
					this.transition('disconnecting');
				}
			},
			connected: {
				_onEnter: function() {
					debug.log('FSM: connected._onEnter()');
				},
				connection_failed: function () {
					// Broker connection closed in "connected"-state - try to auto-reconnect to broker...
					if (brokerEventCallbacks && typeof brokerEventCallbacks.onConnectionFailed === 'function') {
						brokerEventCallbacks.onConnectionFailed('connection failed');
					}
					this.connection = null;
					this.reconnectCounter = 0;
					this.transition('reconnect_wait');
				},
				disconnect: function () {
					this.transition('disconnecting');
				}
			},
			reconnect_wait: {
				_onEnter: function () {
					debug.log('FSM: reconnect_wait._onEnter()');
					if (this.reconnectCounter < reconnectMaxRetries) {
						this.handle('schedule_reconnect');
					} else { // i.e. don't try to reconnect even once if reconnectMaxRetries <= 0
						this.handle('reconnection_failed');
					}
				},
				schedule_reconnect: function () {
					debug.log('FSM reconnect_wait.schedule_reconnect(): Reconnecting to broker in ' + reconnectRetryDelay + ' sec...');
					clearTimeout(this.reconnectTimer);	// Just make sure no other reconnects are already scheduled (should not happen, but maybe SignalR's connection.onclose() *could* be fired twice in that case we'd end up here twice before handling the 'reconnect'-action...)
					this.reconnectTimer = setTimeout(function () {
						this.handle('connect');
					}.bind(this), reconnectRetryDelay * 1000);
				},
				connect: function () {
					this.transition('reconnecting');
				},
				disconnect: function () {
					this.transition('disconnecting');
				},
				reconnection_failed: function () {
					this.transition('disconnected');
				},
				_onExit: function () {
					clearTimeout(this.reconnectTimer);
				}
			},
			reconnecting: {
				_onEnter: function() {
					debug.log('FSM: reconnecting._onEnter()');
					this.reconnectCounter++;
					_connect();
				},
				connection_ok: function (connection) {
					this.connection = connection;
					this.transition('connected');
					reSubscribeAll();	// After successful re-connect, also re-subscribe to all topics! (i.e. different from "connection_ok" in the state "connecting")
				},
				connection_failed: function (err) {
					if (brokerEventCallbacks && typeof brokerEventCallbacks.onConnectionFailed === 'function') {
						brokerEventCallbacks.onConnectionFailed(err);
					}
					this.transition('reconnect_wait');
				},
				disconnect: function () {
					this.transition('disconnecting');
				}
			},
			disconnecting: {
				_onEnter: function() {
					debug.log('FSM: disconnecting._onEnter()');
					unSubscribeAll();

					if (!this.connection) {
						// No connection to stop - fire "disconnect_ok"-action at once
						this.handle('disconnect_ok');
					} else {
						this.connection.stop().catch(function() {}).finally(function() {
							debug.log('connection stopped');
							this.handle('disconnect_ok');
						}.bind(this));
					}
				},
				disconnect_ok: function () {
					this.transition('disconnected');
				}
			}
		}
	});
}




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

		if (brokerEventCallbacks && typeof brokerEventCallbacks.onConnectionStarted === 'function') {
			brokerEventCallbacks.onConnectionStarted(connection);
		}

		brokerConnection.handle('connection_ok', connection);
/*			setTimeout(function() {
			// Due to SignalR-lib stupidity: Do not try to handle "connection_ok" immediately, but in a setTimeout() (in antoher thread)
			// The broker will accept the connection but immediately disconnect on e.g. an invalid session
			// If we handle "connection_ok" immediately, the brokerConnection-FSM will think we're properly connected...
			// But if brokerConnection.handle('connection_ok', connection) is called in a setTimeout(), the connection.onclose()-handler will be called first.
			// CAN WE RELY ON THIS?!?
			brokerConnection.handle('connection_ok', connection);
		}, 0);*/
	}, function (err) {
		debug.log('_connect: Broker connection.start() error: ', err, connection, connection.connectionState);
		brokerConnection.handle('connection_failed', err);
	});
}
function isConnected() {
	return (brokerConnection.state === 'connected');
}
function isDisconnected() {
	return (brokerConnection.state === 'disconnected');
}
function connectToBroker() {
	return new Promise(function (resolve, reject) {
		if (isConnected()) {
			// Already connected. Resolve with brokerConnection.connection
			resolve(brokerConnection.connection);
		} else {
			// Not connected. Hook up a state transition-listener to monitor brokerConnection state changes...
			var transitionListener = brokerConnection.on('transition', function (data) {
				if (data.toState === 'connected') {
					// Succesfully connected: Resolve and stop listening
					resolve(brokerConnection.connection);
					transitionListener.off();
				} else if (data.toState === 'disconnected' || data.toState === 'reconnect_wait') {
					// Transitioned to "disconnected": Reject and stop listening
					reject();
					transitionListener.off();
				}
			});

			// Try to connect...
			// Note: The "connect"-action will only be effective in states "disconnected" and "reconnect_wait".
			// In all other states, we should soon end up in either "connected", "disconnected" or "reconnect_wait" very soon anyway
			brokerConnection.handle('connect');
		}
	});
}
function disconnectFromBroker() {
	return new Promise(function (resolve, reject) {
		if (!brokerConnection || brokerConnection.state === 'disconnected') {
			// Already disconnected. Resolve
			resolve();
		}

		// Not disconnected. Hook up a state transition-listener to monitor brokerConnection state changes...
		var disconnectedTransitionListener = brokerConnection.on('transition', function (data) {
			if (data.toState === 'disconnected') {
				// Succesfully disconnected: Resolve and stop listening
				resolve();
				disconnectedTransitionListener.off();
			}
		});

		// Try to disconnect...
		brokerConnection.handle('disconnect');
	});
}
function reConnectToBroker() {
	return disconnectFromBroker().then(function () {
		return connectToBroker().then(function (connection) {
			reSubscribeAll().then(function (subscriptions) {
				// Don't care about the result of this...
				debug.log('reConnectToBroker: all topics re-subscribed:',subscriptions);
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
	debug.log('addSubscription:',subscription, timeout);
	unsubscribe(subscription);
	SubscriptionsStore.add(subscription);

	// Subscribe to topic, skip retrying on failures (better to reject and let caller handle it)...
	// If a "timeout" is specified, reject if it's taking too long...
	if (timeout) {
		return StreamUtils.promiseTimeout(getAndStreamSubscription(subscription), timeout);
	} else {
		return getAndStreamSubscription(subscription);
	}
}
function removeSubscription(subscription) {
	// Can either take a subscription object, or a subscriptionId (returned from Subscription.getSubscriptionId())
	debug.log('removeSubscription:',subscription);

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
				next: function(event) {
					// debug.log('getTopic Get stream next:', event);
					resultArray.push(event);
				},
				complete: function () {
					// debug.log('getTopic Get stream complete:', resultArray);
					resolve(resultArray);
				},
				error: function (err) {
					debug.error('getTopic(): Get stream error:', err);
					if (err && typeof err.message === 'string' && err.message.indexOf('HubException: Unauthorized') !== -1) {
						// Unathorized: Nothing to do but to reject...
						reject(err);
					} else {
						// Other error from hub, try to "connection.invoke()" instead of "connection.stream()" for backwards compatibility with legacy CommSrv (.NET Core 2)
						debug.log('getTopic(): Retrying with connection.invoke(\'Get\', topic, fromId)');
						Stream.getInvoke(connection, subscription, fromId, options).then(resolve, (err) => {
							subscription.onSubscriptionError && subscription.onSubscriptionError(err);
							reject(err);
						});
					}
				}
			});
	});
}
function getAndStreamSubscription(subscription, keepRetrying) {
	if (keepRetrying) {
		return StreamUtils.retryPromiseFunc(_getAndStreamSubscription.bind(null, subscription), resubscribeDelay * 1000, reconnectMaxRetries, 'abort');
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

			var getFullTopicState = (subscription.lastReceivedEventId < 0  && (typeof subscription.fromEventId !== 'number' || subscription.fromEventId === subscription.options.topicStartEventId)); // No events received yet, and no "fromEventId" specified (different from "topicStartEventId") => We want the full topic state!
			var fromEventId = (getFullTopicState ? subscription.options.topicStartEventId : (subscription.lastReceivedEventId >= 0 ? subscription.lastReceivedEventId + 1 : subscription.fromEventId));
			var getTopicPromise;
			if (options.streamingSubscribeOnly) {
				getTopicPromise = Promise.resolve([]);
			} else {
				debug.log('_getAndStreamSubscription: \'Get\': ', subscription, ' from: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);
				getTopicPromise = getTopic(connection, subscription, fromEventId);
			}

			getTopicPromise.then(function(eventsArray) {

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
							debug.log('Unknown error:',e);
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
							next: function(event) {
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
						errorMessage: 'Error subscribing to topic: '+ subscription,
						err: err
					});
				}
			}).catch(function (err) {
				// getTopic() rejected or unrecoverable reSubscribe from eventsArray array out of order
				debug.error('_getAndStreamSubscription: Exception from getTopic("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId, connection, connection.connectionState);
				reject({
					errorCode: StreamErrors.TOPIC_GET_ERROR,
					errorMessage: 'Error getting topic: '+ subscription,
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
	if (subscription && subscription.subscriberRef) {

		// Before unsubscribing an active subscription: Call onSubscriptionEnd()-hooks in the subscription, if it exists
		if (subscription.onSubscriptionEnd) {
			subscription.onSubscriptionEnd();
		}

		try {
			subscription.subscriberRef.dispose();
			debug.log('topic subscriber disposed');
		} catch (e) {
			debug.log('Exception disposing topic subscriber:',e);
		}
		subscription.subscriberRef = null;
	}
}
function publishTopicWhenConnected(topic, data) {
	return getConnection().then(function (connection) {
		try {
			return Stream.publish(connection, topic, data, options);
		} catch (e) {
			debug.log('Exception in publishTopic: ',e);
			return Promise.reject(e);
		}
	});
}
function publishTopicIfConnected(topic, data) {
	if (!isConnected()) {
		return Promise.reject('Not connetced');
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
		debugData.push('conversationData STREAM-event:', eventType + (eventType === 'conversationMessage' ? ' ('+messageType+')' : ''));
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
 *   brokerUrl 		= URL to CommSrv broker endpoint
 *   	Note: It should include sessionId as query parameter (will probably be re-designed in the future)
 *
 *   streamOptions	= Config object for signalR and related behavior
 *    	streamOptions.brokerTransport (optional, default 'WebSockets'):
 *      	One of: 'None' | 'Negotiate' | 'WebSockets' | 'LongPolling' | 'ServerSentEvents'
 *      streamOptions.brokerLogLevel (optional, default 'none'):
 *        	One of: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'critical' | 'none'
 *      streamOptions.streamingSubscribeOnly (optional, default false):
 *      	If true, topic history/state is not fetched using 'Get' (i.e. everything is streamed using 'Subscribe' only)
 *
 *   eventHandlers	= Object containing (optional) event handler hook functions, e.g.
 *    	{
 *    		onConnectionStarted = function (connection) { // Do something on broker connection started...  },
 *    		onConnectionFailed = function (connection) { // Do something on broker connection failed... },
 *		}
 *
 *	 dependencyLibs	= Object containing dependency libraries (for now, only 'machina')
 *	 	The "machina" library needs to be injected at runtime (Visitor already uses it, so we don't want to bundle it twice)
 *		{
 * 			machina: <required "machina" npm-module>
 * 		}
 *
 *	 initDebug		= Optional object containing debug functions (default will be noop()), e.g.:
 *	 	{
 * 			log: function () { ... },
 * 			warn: function () { ... },
 * 			error: function () { ... },
 * 			info: function () { ... },
 *	 	}
 *******************************************************************************************/
var init = function init(brokerUrl, streamOptions, eventHandlers, dependencyLibs, initDebug) {

	if (!machina) {
		machina = dependencyLibs.machina;
		initBrokerConnectionFsm(machina);
	}

	streamOptions = streamOptions || {};
	initDebug = initDebug || noDebug;
	streamOptions.brokerTransport = streamOptions.brokerTransport || 'WebSockets';
	streamOptions.brokerLogLevel = streamOptions.brokerLogLevel || 'none';
	streamOptions.streamingSubscribeOnly = streamOptions.streamingSubscribeOnly || false;
	if (typeof streamOptions.brokerVersion === 'number') {
		options.brokerVersion = parseInt(streamOptions.brokerVersion, 10);
	}


	if (brokerUrl && brokerUrl !== options.brokerUrl ||
		streamOptions.sessionId !== options.sessionId ||
		streamOptions.access_token !== options.access_token ||
		streamOptions.brokerTransport !== options.brokerTransport ||
		streamOptions.brokerLogLevel !== options.brokerLogLevel)
	{
		debug = initDebug;
		options.brokerUrl = brokerUrl;
		options.sessionId = streamOptions.sessionId;
		options.access_token = streamOptions.access_token;
		options.brokerTransport = streamOptions.brokerTransport;
		options.brokerLogLevel = streamOptions.brokerLogLevel;
		options.streamingSubscribeOnly = streamOptions.streamingSubscribeOnly;

		brokerEventCallbacks = eventHandlers;

		debug.log('Initializing StreamConnector');
		debug.log('SignalR client lib version:', signalr.VERSION);

		if (!isDisconnected()) {
			// If we have an active connection: Re-connect to broker with the new brokerUrl, sessionId or changed options...
			reConnectToBroker().then(function (connection) {
				debug.log('StreamConnector: broker config changed: Successfully re-connected to broker', connection);
			}, function (err) {
				debug.error('StreamConnector: broker config changed: Error re-connecting to broker', err);
			});
		}
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
