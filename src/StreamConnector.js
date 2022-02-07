define(['require'], function(require) {
	'use strict';

	var signalr = require('@microsoft/signalr/dist/browser/signalr'),
		StreamErrors = require('./StreamErrors'),
		StreamUtils = require('./StreamUtils'),
		StreamEventTypes = require('./StreamEventTypes');

	var machina = null;

	var reconnectRetryDelay = 3;
	var resubscribeDelay = 1;
	var reconnectMaxRetries = 60; // 60 = 3 minutes if reconnectRetryDelay == 3
	var topicStartId = 1;

	var noop = function() {};
	var noDebug = {
		log: noop,
		warn: noop,
		error: noop,
		info: noop
	}

	var debug = noDebug;
	var options = {
		brokerUrl: null,
		brokerTransport: 'WebSockets',
		brokerLogLevel: 'none'
	}
	var brokerEventCallbacks = {};
	var subscriptions = {};
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
			if (brokerConnection.state === 'disconnected') {
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
		unsubscribeToTopic(subscription.topic);
		subscriptions[subscription.topic] = subscription;

		// Subscribe to topic, skip retrying on failures (better to reject and let caller handle it)...
		// If a "timeout" is specified, reject if it's taking too long...
		if (timeout) {
			return StreamUtils.promiseTimeout(getAndSubscribeToTopic(subscription.topic), timeout);
		} else {
			return getAndSubscribeToTopic(subscription.topic);
		}
	}
	function removeTopicSubscription(topic) {
		debug.log('removeTopicSubscription:',topic);
		if (subscriptions[topic]) {
			unsubscribeToTopic(topic);
			delete subscriptions[topic];
		}

		if (StreamUtils.isEmpty(subscriptions)) {
			// No more active subscriptions - disconnect from broker
			debug.log('No more subscriptions - disconnecting from broker');
			disconnectFromBroker();
		}
	}
	function reSubscribeAll() {
		var subscribePromises = [];
		Object.keys(subscriptions).forEach(function (topic) {
			debug.log('reSubscribeAll: Re-subscribing to topic: ', topic);

			subscribePromises.push(getAndSubscribeToTopic(topic, true).catch(function (err) {
				// Catch any errors from _getAndSubscribeToTopic() to prevent Promise.all() below to "fail-fast" on errors...
				debug.warn('reSubscribeAll: Error re-subscribing to topic: "'+topic+'"',err);
			}));
		});
		return Promise.all(subscribePromises);
	}
	function unSubscribeAll() {
		// Unsubscribe any active subscription...
		Object.keys(subscriptions).forEach(function (topic) {
			unsubscribeToTopic(topic);
		});
	}





	/*******************************************************************************************
	 ** Functions for getting and subscribing/unsubscribing to any topic
	 *******************************************************************************************/
	function getTopic(connection, topic, fromId) {
		// debug.log('getTopic:', topic, 'from:', fromId);
		var resultArray = [];
		return new Promise(function (resolve, reject) {
			connection.stream('Get', topic, fromId)
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
							connection.invoke('Get', topic, fromId).then(resolve, reject);
						}
					}
				});
		});
	}
	function getAndSubscribeToTopic(topic, keepRetrying) {
		if (keepRetrying) {
			return StreamUtils.retryPromiseFunc(_getAndSubscribeToTopic.bind(null, topic), resubscribeDelay * 1000, reconnectMaxRetries, 'abort');
		} else {
			return _getAndSubscribeToTopic(topic);
		}
	}
	function _getAndSubscribeToTopic(topic) {
		debug.log('_getAndSubscribeToTopic:', topic);

		return new Promise(function (resolve, reject) {

			// Unsubscribe if already subscribing...
			unsubscribeToTopic(topic);

			var subscription = subscriptions[topic];
			if (!subscription) {
				return reject('abort');	// Reject with reason 'abort' to skip retrying...
			}

			// Track invocations to _getAndSubscribeToTopic() by subscription.subscribeInvocationId
			var currentSubscribeInvocationId = ++lastSubscribeInvocationId;
			subscription.subscribeInvocationId = currentSubscribeInvocationId;
			debug.log('_getAndSubscribeToTopic currentSubscribeInvocationId:', currentSubscribeInvocationId);

			getConnection().then(function (connection) {
				debug.log('_getAndSubscribeToTopic: gotConnection:', connection);

				// Important: Look up the subscription for this topic again - it may have changed while waiting for connection!
				subscription = subscriptions[topic];
				if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
					debug.log('_getAndSubscribeToTopic: A newer subscription to this topic has been invoked while waiting for connection - abort this one...');
					return reject('abort');	// Reject with reason 'abort' to skip retrying...
				}
				if (subscription.subscriberRef) {
					// Stop any existing subscription on this topic if exists (should not happen, as we have already called unsubscribeToTopic() before connecting, and if we get here we should be in the same invocation)
					unsubscribeToTopic(topic);
				}

				var getFullTopicState = (subscription.lastReceivedEventId < 0  && (typeof subscription.fromEventId !== 'number' || subscription.fromEventId === topicStartId)); // No events received yet, and no "fromEventId" specified (different from "topicStartId") => We want the full topic state!
				var fromEventId = (getFullTopicState ? topicStartId : (subscription.lastReceivedEventId >= 0 ? subscription.lastReceivedEventId + 1 : subscription.fromEventId));
				var getTopicPromise;
				if (options.streamingSubscribeOnly) {
					getTopicPromise = Promise.resolve([]);
				} else {
					debug.log('_getAndSubscribeToTopic: \'Get\' topic: ', topic, ' from: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);
					getTopicPromise = getTopic(connection, subscription.topic, fromEventId);
				}

				getTopicPromise.then(function(eventsArray) {

					// Important: Look up the subscription for this topic again - it may have changed while waiting for connection!
					subscription = subscriptions[topic];
					if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
						debug.log('_getAndSubscribeToTopic: A newer subscription to this topic has been invoked while waiting for getTopic() - abort this one...');
						return reject('abort');	// Reject with reason 'abort' to skip retrying...
					}

					if (eventsArray && Array.isArray(eventsArray) && eventsArray.length) {
						// Handle events from broker 'Get' (if any exists)
						debug.log('_getAndSubscribeToTopic: Got topic eventsArray:', eventsArray, 'invocationId:', currentSubscribeInvocationId);

						try {
							// Filter eventsArray to remove duplicates (which is a recoverable error condition)
							// Or throw a StreamErrors.TOPIC_STREAM_OUT_OF_ORDER if expected event(s) are missing (which is an unrecoverable error)
							eventsArray = eventsArray.filter(function (event) {
								if (event.id < subscription.lastReceivedEventId + 1) {
									debug.error('Error: Broker event id in response-array from \'Get\' out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + event.id, event, 'invocationId:', currentSubscribeInvocationId);
									debug.log('Skipping event...');
									return false;	// return false to skip by filter
								} else if (subscription.lastReceivedEventId != -1 && event.id > subscription.lastReceivedEventId + 1) {
									debug.error('Error: Broker event id in response-array from \'Get\' out of order (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + event.id, event, 'invocationId:', currentSubscribeInvocationId);
									throw StreamErrors.TOPIC_STREAM_OUT_OF_ORDER;	// throw exception to abort (unrecoverable error)
								}
								subscription.lastReceivedEventId = event.id;
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
							getAndSubscribeToTopic(topic).then(resolve, reject); // Try to resubscribe, but skip retrying on failures...
							return;
						}
						fromEventId = subscription.lastReceivedEventId + 1;
					}

					try {
						debug.log('_getAndSubscribeToTopic: \'Subscribe\' to topic: ', topic, ' from id: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);

						subscription.subscriberRef = connection.stream('Subscribe', topic, fromEventId)
						// subscription.subscriberRef = connection.stream('Subscribe', '1'+topic, fromEventId) // Test invalid topic
							.subscribe({
								next: function(event) {
									// Handle events from broker 'Subscribe'
									if (event.id < subscription.lastReceivedEventId + 1) {
										debug.error('Error: Broker event id in \'Subscribe\'-stream out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + event.id, event, 'invocationId:', currentSubscribeInvocationId);
										debug.log('Skipping event...');
										return;
									} else if (subscription.lastReceivedEventId != -1 && event.id > subscription.lastReceivedEventId + 1) {
										debug.error('Error: Broker event id in \'Subscribe\'-stream out of order: (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + event.id, event, 'invocationId:', currentSubscribeInvocationId);
										debug.log('Re-subscribing to topic...');
										getAndSubscribeToTopic(topic, true).catch(function (err) {
											debug.log('Error resubscribing to topic (subscribe, stream out of order, gap)', err);
										});
										return;
									}

									var preparedEventsData = _prepareEventsData(event, StreamEventTypes.STREAM, 'invocationId: ' + currentSubscribeInvocationId);
									subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
									subscription.lastReceivedEventId = event.id;
								},
								complete: function () {
									debug.log('Stream completed on topic "' + topic + '"', 'invocationId:', currentSubscribeInvocationId);
								},
								error: function (err) {
									debug.error('Stream error on topic "' + topic + '":', err, connection, connection.connectionState, 'invocationId:', currentSubscribeInvocationId);
/*
									if (useSignalRv3) {
										// SignalRv3 detected: Do nothing (let auto-reconnect take care of the business)
										// TODO: SOME stream errors should be handled here on signalr v3, e.g. "slow consumer", etc
*/
										debug.log('SignalR v3: Do nothing (let auto-reconnect take care of business)');
/*
										return;
									}
									debug.log('Re-subscribing...');
									setTimeout(function() {
										getAndSubscribeToTopic(topic, true).catch(function (err) {
											debug.log('Error resubscribing to topic (subscribe, error)', err, connection, connection.connectionState);
										});
									}, resubscribeDelay * 1000);
*/
								}
							});

						// After successful subscription: Call onSubscriptionStart()-hook in the subscription, if it exists
						if (subscription.onSubscriptionStart) {
							subscription.onSubscriptionStart();
						}

						resolve(subscription.subscriberRef);
					} catch (err) {
						debug.error('Exception subscribing to topic "' + topic + '":', err, 'invocationId:', currentSubscribeInvocationId, connection, connection.connectionState);
						reject({
							errorCode: StreamErrors.TOPIC_SUBSCRIBE_ERROR,
							errorMessage: 'Error subscribing to topic: '+ topic,
							err: err
						});
					}
				}).catch(function (err) {
					// getTopic() rejected or unrecoverable reSubscribe from eventsArray array out of order
					debug.error('_getAndSubscribeToTopic: Exception from getTopic("' + subscription.topic + '"):', err, 'invocationId:', currentSubscribeInvocationId, connection, connection.connectionState);
					reject({
						errorCode: StreamErrors.TOPIC_GET_ERROR,
						errorMessage: 'Error getting topic: '+ subscription.topic,
						err: err
					});
				});
			}, function (err) {
				debug.error('_getAndSubscribeToTopic: Exception from getConnection("' + subscription.topic + '"):', err, 'invocationId:', currentSubscribeInvocationId);
				reject({
					errorCode: StreamErrors.BROKER_CONNECT_ERROR,
					errorMessage: 'Could not connect to broker (from _getAndSubscribeToTopic)',
					err: err
				});
			});
		});
	}
	function unsubscribeToTopic(topic) {
		var subscription = subscriptions[topic];
		if (subscription) {
			if (subscription.subscriberRef) {
				debug.log('unsubscribeToTopic:', topic);

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
	}
	function publishTopicWhenConnected(topic, data) {
		return getConnection().then(function (connection) {
			try {
				return connection.invoke('Publish', topic, data);
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
		return subscriptions;
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
			debugData.push('conversationData STREAM-event:', events.data.type + (events.data.type === 'conversationMessage' ? ' ('+events.data.messageType+')' : ''));
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
	 ** Init function to configure StreamConnector
	 *
	 *   brokerUrl 		= URL to CommSrv broker endpoint (Note: Should include sessionId as query parameter!)
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
	 *	 	This library needs to be injected at runtime (Visitor already uses it, so we don't want to include it twice)
	 *
	 *	 initDebug		= Optional object containing debug functions, e.g.
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

		if (brokerUrl && brokerUrl !== options.brokerUrl || streamOptions.brokerTransport !== options.brokerTransport || streamOptions.brokerLogLevel !== options.brokerLogLevel) {
			debug = initDebug;
			options.brokerUrl = brokerUrl;
			options.brokerTransport = streamOptions.brokerTransport;
			options.brokerLogLevel = streamOptions.brokerLogLevel;
			options.streamingSubscribeOnly = streamOptions.streamingSubscribeOnly;

			brokerEventCallbacks = eventHandlers;

			debug.log('Initializing StreamConnector');
			debug.log('SignalR client lib version:', signalr.VERSION);

			if (!isDisconnected()) {
				// If we have an active connection: Re-connect to broker with the new brokerUrl...
				reConnectToBroker().then(function (connection) {
					debug.log('StreamConnector: broker config changed: Successfully re-connected to broker', connection);
				}, function (err) {
					debug.error('StreamConnector: broker config changed: Error re-connecting to broker', err);
				});
			}
		}
	};

	return {
		_signalr: signalr,	// Expose the signalr lib  - mainly for debugging...
		init: init,
		getSubscriptions: getSubscriptions,
		addSubscription: addSubscription,
		removeTopicSubscription: removeTopicSubscription,
		publishTopicIfConnected: publishTopicIfConnected
	}
});
