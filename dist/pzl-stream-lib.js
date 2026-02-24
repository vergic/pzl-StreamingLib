import * as __WEBPACK_EXTERNAL_MODULE__microsoft_signalr_e3fad43b__ from "@microsoft/signalr";
/******/ var __webpack_modules__ = ({

/***/ "./src/BrokerFSM.js"
/*!**************************!*\
  !*** ./src/BrokerFSM.js ***!
  \**************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   initBrokerConnectionFsm: () => (/* binding */ initBrokerConnectionFsm)
/* harmony export */ });
/* harmony import */ var stately_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! stately.js */ "./node_modules/stately.js/Stately.js");
/* harmony import */ var stately_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(stately_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _StreamUtils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./StreamUtils */ "./src/StreamUtils.js");
var _this = undefined;


const reconnectRetryDelay = 10;
const reconnectMaxRetries = 12; // 12 retries á 10 sec = 2 minutes

const initBrokerConnectionFsm = function initBrokerConnectionFsm(externals) {
  let brokerEventCallbacks = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  let debug = arguments.length > 2 ? arguments[2] : undefined;
  /*******************************************************************************************
   ** brokerConnection state machine
   * Using https://github.com/fschaefer/Stately.js
   *******************************************************************************************/
  debug = debug || _StreamUtils__WEBPACK_IMPORTED_MODULE_1__.noDebug;
  debug.log('initBrokerConnectionFsm');
  const fsm_state = {
    fsm: null,
    connection: null,
    reconnectCounter: 0,
    eventListeners: {},
    brokerEventCallbacks
  };
  const handle = function handle(action) {
    for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
      args[_key - 1] = arguments[_key];
    }
    return fsm_state.fsm[action](...args);
  };
  const on = (eventName, callback) => {
    fsm_state.eventListeners[eventName] = (fsm_state.eventListeners[eventName] || []).concat(callback);
    return {
      eventName: eventName,
      callback: callback,
      off: () => {
        _off(eventName, callback);
      }
    };
  };
  const _off = (eventName, callback) => {
    fsm_state.eventListeners[eventName] = (fsm_state.eventListeners[eventName] || []).filter(cb => callback && cb !== callback);
  };
  const emitEvent = function emitEvent(eventName) {
    for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
      args[_key2 - 1] = arguments[_key2];
    }
    (fsm_state.eventListeners[eventName] || []).forEach(function (callback) {
      callback.call(this, ...args);
    }.bind(_this));
  };
  const fsmStates = {
    disconnected: {
      _onEnter: function _onEnter() {
        debug.log('FSM: disconnected._onEnter()');
        fsm_state.connection = null;
      },
      connect: function connect() {
        return this.connecting;
      }
    },
    connecting: {
      _onEnter: function _onEnter() {
        debug.log('FSM: connecting._onEnter()');
        externals._connect();
      },
      connection_ok: function connection_ok(connection) {
        fsm_state.connection = connection;
        return this.connected;
      },
      connection_failed: function connection_failed(err) {
        return this.disconnected;
      },
      disconnect: function disconnect() {
        return this.disconnecting;
      }
    },
    connected: {
      _onEnter: function _onEnter(action, prevState) {
        var _fsm_state$brokerEven;
        debug.log('FSM: connected._onEnter()', action, prevState);
        if (prevState === 'reconnecting') {
          // If coming here from 'reconnecting', we should resubscribe all subscriptions
          // (can't be done in 'reconnecting', since reSubscribeAll() will only work in state 'connected'!)
          externals.reSubscribeAll();
        }
        typeof (fsm_state === null || fsm_state === void 0 || (_fsm_state$brokerEven = fsm_state.brokerEventCallbacks) === null || _fsm_state$brokerEven === void 0 ? void 0 : _fsm_state$brokerEven.onConnectionStarted) === 'function' && fsm_state.brokerEventCallbacks.onConnectionStarted(fsm_state.connection);
      },
      connection_failed: function connection_failed() {
        var _fsm_state$brokerEven2;
        // Broker connection closed in "connected"-state - try to auto-reconnect to broker...
        typeof (fsm_state === null || fsm_state === void 0 || (_fsm_state$brokerEven2 = fsm_state.brokerEventCallbacks) === null || _fsm_state$brokerEven2 === void 0 ? void 0 : _fsm_state$brokerEven2.onConnectionFailed) === 'function' && fsm_state.brokerEventCallbacks.onConnectionFailed('connection failed');
        fsm_state.connection = null;
        fsm_state.reconnectCounter = 0;
        return this.reconnect_wait;
      },
      disconnect: function disconnect() {
        return this.disconnecting;
      }
    },
    reconnect_wait: {
      _onEnter: function _onEnter() {
        debug.log('FSM: reconnect_wait._onEnter()');
        if (fsm_state.reconnectCounter < reconnectMaxRetries) {
          handle('schedule_reconnect');
        } else {
          // i.e. don't try to reconnect even once if reconnectMaxRetries <= 0
          handle('reconnection_failed');
        }
      },
      schedule_reconnect: function schedule_reconnect() {
        debug.log('FSM reconnect_wait.schedule_reconnect(): Reconnecting to broker in ' + reconnectRetryDelay + ' sec...');
        clearTimeout(fsm_state.reconnectTimer); // Just make sure no other reconnects are already scheduled (should not happen, but maybe SignalR's connection.onclose() *could* be fired twice in that case we'd end up here twice before handling the 'reconnect'-action...)
        fsm_state.reconnectTimer = setTimeout(function () {
          handle('connect');
        }.bind(this), reconnectRetryDelay * 1000);
      },
      connect: function connect() {
        return this.reconnecting;
      },
      disconnect: function disconnect() {
        return this.disconnecting;
      },
      reconnection_failed: function reconnection_failed() {
        return this.disconnected;
      },
      _onExit: function _onExit() {
        clearTimeout(fsm_state.reconnectTimer);
      }
    },
    reconnecting: {
      _onEnter: function _onEnter() {
        debug.log('FSM: reconnecting._onEnter()');
        fsm_state.reconnectCounter++;
        externals._connect();
      },
      connection_ok: function connection_ok(connection) {
        fsm_state.connection = connection;
        // After successful re-connect, transition to 'connected'
        // After the transition, all existing subscriptions will be re-subscribed
        // (but reSubscribeAll() can only be done *AFTER* the transition because it needs to be 'connected')!
        return this.connected;
      },
      connection_failed: function connection_failed(err) {
        var _fsm_state$brokerEven3;
        typeof (fsm_state === null || fsm_state === void 0 || (_fsm_state$brokerEven3 = fsm_state.brokerEventCallbacks) === null || _fsm_state$brokerEven3 === void 0 ? void 0 : _fsm_state$brokerEven3.onConnectionFailed) === 'function' && fsm_state.brokerEventCallbacks.onConnectionFailed(err);
        return this.reconnect_wait;
      },
      disconnect: function disconnect() {
        return this.disconnecting;
      }
    },
    disconnecting: {
      _onEnter: function _onEnter() {
        debug.log('FSM: disconnecting._onEnter()', this);
        externals.unSubscribeAll();
        if (fsm_state.connection) {
          // Stop connection, ignore errors, then go to "disconnected"
          fsm_state.connection.stop().catch(() => {}).finally(() => {
            handle('disconnect_ok');
          });
        } else {
          // No connection to stop: Go directly to "disconnected"
          handle('disconnect_ok');
        }
      },
      disconnect_ok: function disconnect_ok() {
        var _fsm_state$brokerEven4;
        typeof (fsm_state === null || fsm_state === void 0 || (_fsm_state$brokerEven4 = fsm_state.brokerEventCallbacks) === null || _fsm_state$brokerEven4 === void 0 ? void 0 : _fsm_state$brokerEven4.onDisconnected) === 'function' && fsm_state.brokerEventCallbacks.onDisconnected();
        return this.disconnected;
      }
    }
  };
  Object.keys(fsmStates).forEach(function (state) {
    // Push some "global" events to all states (_onEnter(), _onExit()),
    // as proposed by the author (https://github.com/fschaefer/Stately.js/issues/11)

    // First save a ref to any existing onEnter()-event in the original state definition...
    const ___onEnter = fsmStates[state].onEnter;

    // Inject a re-defined onEnter() into each state that will capture state transitions.
    // The new onEnter() will also call prev state's _onExit() and new state's _onEnter()
    // (if they exist and if (and only if!) we actually did a transition - i.e. mimic machina.js behaviour!)
    // And also call any registered state-transition-listeners...
    // NOTE: There is one subtle difference from machina.js: When _onExit() is called, the state-transition has actually already occurred!!!
    // (so this.getMachineState() and this.getMachineEvents() will be in the context of newState, if called from prevState's _onExit()-handler)
    fsmStates[state].onEnter = function onEnter(action, prevState, newState) {
      let _onEnterAction = null;
      if (prevState !== newState) {
        // console.log('state transition:', action, prevState, newState, this, fsm_state.fsm, fsmStates)
        if (typeof fsmStates[prevState]._onExit === 'function') {
          // Call prev state's _onExit() if exists...
          fsmStates[prevState]._onExit.call(this, action, prevState, newState);
        }
        emitEvent('transition', {
          fromState: prevState,
          toState: newState
        });
        if (typeof fsmStates[newState]._onEnter === 'function') {
          // Call new state's _onEnter() if exists...
          // Remember the return value to support state transition from _onEnter()
          _onEnterAction = fsmStates[newState]._onEnter.call(this, action, prevState, newState);
        }
      }
      if (typeof ___onEnter === 'function') {
        // If there was also an original onEnter()-hook in new state, call it!
        // Do this, even if no actual transition occurred - i.e. preserve Stately's weird behaviour!
        ___onEnter.call(this, action, prevState, newState);
      }
      if (_onEnterAction) {
        // Allow state transition from _onEnter()
        // (but only transition *AFTER* original onEnter()-hook has been executed)
        this.setMachineState(_onEnterAction, '_onEnter');
      }
    };
  });
  fsm_state.fsm = new (stately_js__WEBPACK_IMPORTED_MODULE_0___default())(fsmStates, 'disconnected');
  return {
    handle,
    on,
    off: _off,
    getState: () => fsm_state.fsm.getMachineState(),
    getConnection: () => fsm_state.connection,
    setEventCallbacks: brokerEventCallbacks => fsm_state.brokerEventCallbacks = brokerEventCallbacks
  };
};

/***/ },

/***/ "./src/Stream.js"
/*!***********************!*\
  !*** ./src/Stream.js ***!
  \***********************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Stream: () => (/* binding */ Stream)
/* harmony export */ });
/* harmony import */ var _babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @babel/runtime/helpers/esm/defineProperty */ "./node_modules/@babel/runtime/helpers/esm/defineProperty.js");

function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { (0,_babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_0__["default"])(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }
const get = (connection, subscription, fromId) => {
  const method = subscription.options.getMethod || 'Get';
  const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
  return connection.stream(method, _objectSpread({
    type,
    [subscription.options.topicProperty]: topic,
    skip: Math.max(0, fromId - 1) || undefined
  }, subscription.extraProps || {}));
};
const getReverse = function getReverse(connection, subscription, take) {
  let skip = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : 0;
  const method = subscription.options.getReverseMethod || 'GetReverse';
  const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
  return connection.stream(method, _objectSpread({
    type,
    [subscription.options.topicProperty]: topic,
    skip: Math.max(0, skip) || undefined,
    take
  }, subscription.extraProps || {}));
};
const stream = (connection, subscription, fromId) => {
  const method = subscription.options.streamMethod || 'Subscribe';
  const [topic, type] = subscription[subscription.options.topicProperty].split('::').reverse();
  return connection.stream(method, _objectSpread({
    type,
    [subscription.options.topicProperty]: topic,
    skip: Math.max(0, fromId - 1) || undefined
  }, subscription.extraProps || {}));
};
const publish = function publish(connection, topic, data, options) {
  let extraProps = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : {};
  // NOTE: Publish is not yet implemented in OnePlatform broker...
  const method = options.publishMethod || 'Publish';
  return connection.invoke(method, _objectSpread({
    topic,
    data
  }, extraProps));
};
const Stream = {
  get,
  getReverse,
  stream,
  publish
};

/***/ },

/***/ "./src/StreamConnector.js"
/*!********************************!*\
  !*** ./src/StreamConnector.js ***!
  \********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @babel/runtime/helpers/esm/defineProperty */ "./node_modules/@babel/runtime/helpers/esm/defineProperty.js");
/* harmony import */ var _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @microsoft/signalr */ "@microsoft/signalr");
/* harmony import */ var _BrokerFSM__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./BrokerFSM */ "./src/BrokerFSM.js");
/* harmony import */ var _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StreamEventTypes */ "./src/StreamEventTypes.js");
/* harmony import */ var _StreamErrors__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./StreamErrors */ "./src/StreamErrors.js");
/* harmony import */ var _Stream__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./Stream */ "./src/Stream.js");
/* harmony import */ var _StreamUtils__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ./StreamUtils */ "./src/StreamUtils.js");
/* harmony import */ var _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./SubscriptionsStore */ "./src/SubscriptionsStore.js");

function ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }
function _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { (0,_babel_runtime_helpers_esm_defineProperty__WEBPACK_IMPORTED_MODULE_0__["default"])(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }







const resubscribeDelay = 1;
const reconnectMaxRetries = 60; // 60 = 1 minute if resubscribeDelay == 1

let debug = _StreamUtils__WEBPACK_IMPORTED_MODULE_6__.noDebug;
let options = {
  publishMethod: 'Publish',
  brokerUrl: null,
  brokerTransport: 'WebSockets',
  brokerLogLevel: 'none'
};
let lastSubscribeInvocationId = 0;
let brokerConnection = null;

/*******************************************************************************************
 ** Function for connecting (and maintaining connection) to broker
 *******************************************************************************************/
function _connect() {
  debug.log('_connect: Connecting to broker url: ' + options.brokerUrl);
  let brokerConnectionOptions;
  switch (options.brokerTransport) {
    case 'None':
    case 'Negotiate':
      brokerConnectionOptions = {};
      break;
    case 'LongPolling':
      brokerConnectionOptions = {
        transport: _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__.HttpTransportType.LongPolling
      };
      break;
    case 'ServerSentEvents':
      brokerConnectionOptions = {
        transport: _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__.HttpTransportType.ServerSentEvents
      };
      break;
    default:
      // Use WebSockets without negotiation by default... Is this ok? Do we ever want WebSockets *WITH* negotiation?
      brokerConnectionOptions = {
        skipNegotiation: true,
        transport: _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__.HttpTransportType.WebSockets
      };
  }

  // If an accessTokenFactory()-function is supplied with options, use that.
  // ...else if "access_token" is supplied as a string, create an accessTokenFactory() returning it
  brokerConnectionOptions.accessTokenFactory = options.accessTokenFactory || options.access_token && (() => options.access_token) || null;
  const hubConnectionBuilder = new _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__.HubConnectionBuilder().withUrl(options.brokerUrl, brokerConnectionOptions).configureLogging(options.brokerLogLevel).withAutomaticReconnect(options.reconnectRetryPolicy || [0, 500, 3000, 5000, 10000]);
  const connection = hubConnectionBuilder.build();
  connection.onreconnecting(err => {
    var _options$brokerEventH;
    debug.warn('_connect: Broker connection onreconnecting:', err, connection.connectionState, connection.receivedHandshakeResponse);
    typeof ((_options$brokerEventH = options.brokerEventHandlers) === null || _options$brokerEventH === void 0 ? void 0 : _options$brokerEventH.onReconnecting) === 'function' && options.brokerEventHandlers.onReconnecting(err);
    unSubscribeAll();
  });
  connection.onreconnected(async connectionId => {
    var _options$brokerEventH2;
    debug.warn('_connect: Broker connection onreconnected:', connection.connectionState, connection.receivedHandshakeResponse);
    typeof ((_options$brokerEventH2 = options.brokerEventHandlers) === null || _options$brokerEventH2 === void 0 ? void 0 : _options$brokerEventH2.onReconnected) === 'function' && options.brokerEventHandlers.onReconnected(connectionId);
    await reSubscribeAll();
  });
  connection.onclose(err => {
    debug.log('_connect: Broker connection closed:', err, connection.connectionState, connection.receivedHandshakeResponse);
    brokerConnection.handle('connection_failed');
  });

  // Start the connection...
  connection.start().then(() => {
    debug.log('_connect: Broker connection.start() successful:', connection, connection.connectionState, connection.receivedHandshakeResponse);
    brokerConnection.handle('connection_ok', connection);
  }, err => {
    debug.log('_connect: Broker connection.start() error: ', err, connection, connection.connectionState);
    brokerConnection.handle('connection_failed', err);
  });
}
function isConnected() {
  return brokerConnection && brokerConnection.getState() === 'connected';
}
function isDisconnected() {
  return !brokerConnection || brokerConnection.getState() === 'disconnected';
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
 ** Functions for adding and removing streamSubscriptions
 *******************************************************************************************/
function addStreamSubscription(subscription, timeout) {
  debug.log('addStreamSubscription:', subscription, timeout);
  unsubscribe(subscription);
  _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.add(subscription);

  // Subscribe to topic, skip retrying on failures (better to reject and let caller handle it)...
  // If a "timeout" is specified, reject if it's taking too long...
  if (timeout) {
    return (0,_StreamUtils__WEBPACK_IMPORTED_MODULE_6__.promiseTimeout)(getAndStreamSubscription(subscription), timeout);
  } else {
    return getAndStreamSubscription(subscription);
  }
}
function removeStreamSubscription(subscription) {
  // Can either take a streamSubscription object, or a subscriptionId (returned from StreamSubscription.getSubscriptionId())
  debug.log('removeStreamSubscription:', subscription);
  if (typeof subscription === 'string') {
    subscription = _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.findById(subscription);
  }
  if (subscription) {
    unsubscribe(subscription);
    _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.remove(subscription);
  }
  if (_SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.getAll().length < 1) {
    // No more active subscriptions - disconnect from broker
    debug.log('No more subscriptions - disconnecting from broker');
    disconnectFromBroker();
  }
}
function reSubscribeAll() {
  var subscribePromises = [];
  _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.getAll().forEach(subscription => {
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
  _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.getAll().forEach(unsubscribe);
}

/*******************************************************************************************
 ** Functions for getting and subscribing/unsubscribing to any topic
 *******************************************************************************************/
function getTopic(connection, subscription, fromId) {
  // debug.log('getTopic:', topic, 'from:', fromId);
  return new Promise(function (resolve, reject) {
    const resultArray = [];
    const reverse = fromId < 0;
    const handlers = {
      next: function next(event) {
        // debug.log('getTopic Get stream next:', event);
        resultArray.push(event);
      },
      complete: function complete() {
        // debug.log('getTopic Get stream complete:', resultArray);
        resolve(reverse ? resultArray.reverse() : resultArray);
      },
      error: function error(err) {
        debug.error('getTopic(): Get stream error:', err);
        reject(err);
      }
    };
    if (reverse) {
      // A negative "fromId" can be used to fetch events from "latest" and back
      _Stream__WEBPACK_IMPORTED_MODULE_5__.Stream.getReverse(connection, subscription, -fromId).subscribe(handlers);
    } else {
      _Stream__WEBPACK_IMPORTED_MODULE_5__.Stream.get(connection, subscription, fromId).subscribe(handlers);
    }
  });
}
function getAndStreamSubscription(subscription, keepRetrying) {
  if (keepRetrying) {
    return (0,_StreamUtils__WEBPACK_IMPORTED_MODULE_6__.retryPromiseFunc)(_getAndStreamSubscription.bind(null, subscription), resubscribeDelay * 1000, reconnectMaxRetries, 'abort');
  } else {
    return _getAndStreamSubscription(subscription);
  }
}
function _getAndStreamSubscription(subscription) {
  debug.log('_getAndStreamSubscription:', subscription);
  return new Promise(function (resolve, reject) {
    // Unsubscribe if already subscribing...
    unsubscribe(subscription);
    subscription = _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.get(subscription);
    if (!subscription) {
      return reject('abort'); // Reject with reason 'abort' to skip retrying...
    }

    // Track invocations to _getAndStreamSubscription() by subscription.subscribeInvocationId
    var currentSubscribeInvocationId = ++lastSubscribeInvocationId;
    subscription.subscribeInvocationId = currentSubscribeInvocationId;
    debug.log('_getAndStreamSubscription currentSubscribeInvocationId:', currentSubscribeInvocationId);
    getConnection().then(function (connection) {
      debug.log('_getAndStreamSubscription: gotConnection:', connection);

      // Important: Look up the subscription again - it may have changed while waiting for connection!
      subscription = _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.get(subscription);
      if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
        debug.log('_getAndStreamSubscription: A newer subscription has been invoked while waiting for connection - abort this one...');
        return reject('abort'); // Reject with reason 'abort' to skip retrying...
      }
      if (subscription.subscriberRef) {
        // Stop any existing subscription if exists (should not happen, as we have already called unsubscribe() before connecting, and if we get here we should be in the same invocation)
        unsubscribe(subscription);
      }
      var getFullTopicState = subscription.lastReceivedEventId < 0 && (typeof subscription.fromEventId !== 'number' || subscription.fromEventId === subscription.options.topicStartEventId); // No events received yet, and no "fromEventId" specified (different from "topicStartEventId") => We want the full topic state!
      var fromEventId = getFullTopicState ? subscription.options.topicStartEventId : subscription.lastReceivedEventId >= 0 ? subscription.lastReceivedEventId + 1 : subscription.fromEventId;
      var getTopicPromise;

      // Decide if we should do invoke 'Get' before start streaming the topic or not.
      // Streaming a large state with many events will be inefficient, so usually when
      // getting a topic from start (full topic history/state), we want to invoke 'Get' first.
      // But when only subscribing for incremental (real-time) events,
      // we want to start streaming directly from last received eventId, without first invoking 'Get' (which causes an extra db lookup in BE)

      // Merge settings from subscription and global option (settings on the individual subscriptions have priority!)
      const streamingSubscribeOnly = typeof subscription.streamingSubscribeOnly === 'boolean' ? subscription.streamingSubscribeOnly : options.streamingSubscribeOnly;
      const streamingSubscribeOnResume = typeof subscription.streamingSubscribeOnResume === 'boolean' ? subscription.streamingSubscribeOnResume : options.streamingSubscribeOnResume;
      if (streamingSubscribeOnly || streamingSubscribeOnResume && !getFullTopicState) {
        // Skip invoking an initial 'Get' for this topic if settings say: streamingSubscribeOnly or streamingSubscribeOnResume and we are not fetching the full topic state
        getTopicPromise = Promise.resolve([]);
      } else {
        debug.log('_getAndStreamSubscription: \'Get\': ', subscription, ' from: ', fromEventId, 'invocationId:', currentSubscribeInvocationId);
        getTopicPromise = getTopic(connection, subscription, fromEventId);
      }
      getTopicPromise.then(function (eventsArray) {
        // Important: Look up the subscription for this topic again - it may have changed while waiting for connection!
        subscription = _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.get(subscription);
        if (subscription.subscribeInvocationId !== currentSubscribeInvocationId) {
          debug.log('_getAndStreamSubscription: A newer subscription to this topic has been invoked while waiting for getTopic() - abort this one...');
          return reject('abort'); // Reject with reason 'abort' to skip retrying...
        }
        if (eventsArray && Array.isArray(eventsArray) && eventsArray.length) {
          // Handle events from broker 'Get' (if any exists)
          debug.log('_getAndStreamSubscription: Got topic eventsArray:', eventsArray, 'invocationId:', currentSubscribeInvocationId);
          try {
            // Filter eventsArray to remove duplicates (which is a recoverable error condition)
            // Or throw a StreamErrors.TOPIC_STREAM_OUT_OF_ORDER if expected event(s) are missing (which is an unrecoverable error)
            // NOTE: This check assumes that events in eventsArray are in correct time order (even if fetched in reverse, i.e. from "latest" using a negative "fromEventId")
            eventsArray = eventsArray.filter(function (event) {
              const eventId = event[subscription.options.eventIdProperty];
              if (eventId < subscription.lastReceivedEventId + 1) {
                debug.error('Error: Broker event id in response-array from \'Get\' out of order (old event received). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                debug.log('Skipping event...');
                return false; // return false to skip by filter
              } else if (subscription.lastReceivedEventId != -1 && eventId > subscription.lastReceivedEventId + 1) {
                debug.error('Error: Broker event id in response-array from \'Get\' out of order (gap - event(s) missing). Expected ' + (subscription.lastReceivedEventId + 1) + ', received ' + eventId, event, 'invocationId:', currentSubscribeInvocationId);
                throw _StreamErrors__WEBPACK_IMPORTED_MODULE_4__["default"].TOPIC_STREAM_OUT_OF_ORDER; // throw exception to abort (unrecoverable error)
              }
              subscription.lastReceivedEventId = eventId;
              return true; // All ok, return true to include event
            });
            var receivedAs = getFullTopicState ? _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STATE : _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STREAMED_CHUNK;
            var preparedEventsData = _prepareEventsData(eventsArray, receivedAs, 'invocationId: ' + currentSubscribeInvocationId);
            subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
          } catch (e) {
            if (e === _StreamErrors__WEBPACK_IMPORTED_MODULE_4__["default"].TOPIC_STREAM_OUT_OF_ORDER) {
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
          subscription.subscriberRef = _Stream__WEBPACK_IMPORTED_MODULE_5__.Stream.stream(connection, subscription, fromEventId, options)
          // subscription.subscriberRef = connection.stream('Subscribe', '1'+topic, fromEventId) // Test invalid topic
          .subscribe({
            next: function next(event) {
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
                const preparedEventsData = _prepareEventsData(event, _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STREAM, 'invocationId: ' + currentSubscribeInvocationId);
                subscription.onDataReceived(preparedEventsData.eventsArray, preparedEventsData.receivedAs);
                subscription.lastReceivedEventId = eventId;
              }
            },
            complete: function complete() {
              debug.log('Stream completed on "' + subscription + '"', 'invocationId:', currentSubscribeInvocationId);
              subscription.onSubscriptionStreamComplete && subscription.onSubscriptionStreamComplete();
            },
            error: function error(err) {
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
            errorCode: _StreamErrors__WEBPACK_IMPORTED_MODULE_4__["default"].TOPIC_SUBSCRIBE_ERROR,
            errorMessage: 'Error subscribing to topic: ' + subscription,
            err: err
          });
        }
      }).catch(function (err) {
        // getTopic() rejected or unrecoverable reSubscribe from eventsArray array out of order
        debug.error('_getAndStreamSubscription: Exception from getTopic("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId, connection, connection && connection.connectionState);
        reject({
          errorCode: _StreamErrors__WEBPACK_IMPORTED_MODULE_4__["default"].TOPIC_GET_ERROR,
          errorMessage: 'Error getting topic: ' + subscription,
          err: err
        });
      });
    }, function (err) {
      debug.error('_getAndStreamSubscription: Exception from getConnection("' + subscription + '"):', err, 'invocationId:', currentSubscribeInvocationId);
      reject({
        errorCode: _StreamErrors__WEBPACK_IMPORTED_MODULE_4__["default"].BROKER_CONNECT_ERROR,
        errorMessage: 'Could not connect to broker (from _getAndStreamSubscription)',
        err: err
      });
    });
  });
}
function unsubscribe(subscription) {
  subscription = _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.get(subscription);
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
      return _Stream__WEBPACK_IMPORTED_MODULE_5__.Stream.publish(connection, topic, data, options);
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
function getStreamSubscriptions() {
  return _SubscriptionsStore__WEBPACK_IMPORTED_MODULE_7__.getAll();
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

  if (debug && !debug.debugDisabled) {
    // Assemble debug data (if enabled)...
    const debugData = [];
    if (receivedAs === _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STREAM) {
      const eventType = events.data && events.data.type || events.type;
      const messageType = events.data && events.data.messageType || events.messageType;
      debugData.push('conversationData STREAM-event:', eventType + (eventType === 'conversationMessage' ? ' (' + messageType + ')' : ''));
    } else if (receivedAs === _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STREAMED_CHUNK) {
      debugData.push('conversationData STREAMED_CHUNK-array:');
    } else if (receivedAs === _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STATE) {
      debugData.push('conversationData STATE-array:');
    } else {
      debugData.push('conversationData (receivedAs = unknown)):');
    }
    debugData.push(events, extraLoggingArg);
    debug.log.apply(null, debugData);
  }
  return {
    eventsArray: receivedAs === _StreamEventTypes__WEBPACK_IMPORTED_MODULE_3__["default"].STREAM ? [events] : events,
    receivedAs: receivedAs
  };
}

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
const init = async function init(brokerUrl) {
  var _initOptions$accessTo;
  let initOptions = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
  let brokerEventHandlers = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
  let debugFns = arguments.length > 3 ? arguments[3] : undefined;
  const debugOverride = (0,_StreamUtils__WEBPACK_IMPORTED_MODULE_6__.safeLocalStorageGet)('pzl-streaming-debug') === 'true';
  debug = debugOverride && console || debugFns || _StreamUtils__WEBPACK_IMPORTED_MODULE_6__.noDebug;
  const brokerLogLevelOverride = (0,_StreamUtils__WEBPACK_IMPORTED_MODULE_6__.safeLocalStorageGet)('pzl-broker-log-level') || debugOverride && 'info' || null;
  if (!brokerConnection) {
    brokerConnection = (0,_BrokerFSM__WEBPACK_IMPORTED_MODULE_2__.initBrokerConnectionFsm)({
      _connect,
      reSubscribeAll,
      unSubscribeAll
    }, brokerEventHandlers, debug);
  }
  initOptions.brokerTransport = initOptions.brokerTransport || 'WebSockets';
  initOptions.brokerLogLevel = brokerLogLevelOverride || initOptions.brokerLogLevel || 'none';
  initOptions.streamingSubscribeOnly = !!initOptions.streamingSubscribeOnly || false; // default false
  initOptions.streamingSubscribeOnResume = initOptions.streamingSubscribeOnResume === false ? false : true; // default true
  initOptions.access_token = initOptions.access_token || (await ((_initOptions$accessTo = initOptions.accessTokenFactory) === null || _initOptions$accessTo === void 0 ? void 0 : _initOptions$accessTo.call(initOptions))) || null;
  if (brokerUrl && brokerUrl !== options.brokerUrl || initOptions.access_token !== options.access_token || initOptions.brokerTransport !== options.brokerTransport || initOptions.brokerLogLevel !== options.brokerLogLevel) {
    options = _objectSpread(_objectSpread(_objectSpread({}, options), {}, {
      brokerUrl
    }, initOptions), {}, {
      brokerEventHandlers
    });
    brokerConnection.setEventCallbacks(brokerEventHandlers);
    debug.log('Initializing StreamConnector');
    debug.log('SignalR client lib version:', _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__.VERSION);
    if (!isDisconnected()) {
      // If we have an active connection: Re-connect to broker with the new brokerUrl, access_token or changed options...
      try {
        const connection = await reConnectToBroker();
        debug.log('StreamConnector: broker config changed: Successfully re-connected to broker', connection);
        return 're-connected';
      } catch (err) {
        debug.error('StreamConnector: broker config changed: Error re-connecting to broker', err);
        throw 'Error re-connecting';
      }
    } else {
      return 'disconnected';
    }
  } else {
    return 'no change';
  }
};
const updateAccessToken = async new_access_token => {
  var _options$accessTokenF, _options;
  // Call when access_token has changed.
  // Will re-connect broker and re-subscribe if connected and token has changed
  // (just like on init() above, but will not require re-register options and handlers)
  // If "new_access_token" is empty/false/null, options.accessTokenFactory?.() will be called instead
  // I.e. if an accessTokenFactory()-function has been supplied in options,
  // this function can be called without options to force a token re-check using accessTokenFactory()

  if (!brokerConnection) {
    throw new Error('StreamConnection not initialized. This function can only be called after init');
  }
  new_access_token = new_access_token || (await ((_options$accessTokenF = (_options = options).accessTokenFactory) === null || _options$accessTokenF === void 0 ? void 0 : _options$accessTokenF.call(_options))) || null;
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
        throw 'Error re-connecting';
      }
    }
  } else {
    debug.log('StreamConnector.updateAccessToken(): access_token not changed => Do nothing');
  }
};
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
  _signalr: _microsoft_signalr__WEBPACK_IMPORTED_MODULE_1__,
  // Expose the signalr lib  - mainly for debugging...
  init,
  updateAccessToken,
  getStreamSubscriptions,
  addStreamSubscription,
  removeStreamSubscription,
  publishTopicIfConnected
});

/***/ },

/***/ "./src/StreamErrors.js"
/*!*****************************!*\
  !*** ./src/StreamErrors.js ***!
  \*****************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
  BROKER_DISCONNECTED: 0,
  BROKER_CONNECT_ERROR: 1,
  BROKER_RECONNECT_ATTEMPT_ERROR: 2,
  BROKER_RECONNECT_FATAL_ERROR: 3,
  BROKER_INVALID_CONNECTION_ERROR: 4,
  TOPIC_GET_ERROR: 5,
  TOPIC_SUBSCRIBE_ERROR: 6,
  TOPIC_STREAM_OUT_OF_ORDER: 7
});

/***/ },

/***/ "./src/StreamEventTypes.js"
/*!*********************************!*\
  !*** ./src/StreamEventTypes.js ***!
  \*********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({
  STATE: 'state',
  STREAM: 'stream',
  STREAMED_CHUNK: 'chunk'
});

/***/ },

/***/ "./src/StreamSubscription.js"
/*!***********************************!*\
  !*** ./src/StreamSubscription.js ***!
  \***********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _StreamUtils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./StreamUtils */ "./src/StreamUtils.js");
// Simple module to create a new "subscription"-object to subscribe to events from streaming broker (via SignalR)
// It will add and init correct default properties for usage by StreamConnector
// Add overridden and/or custom props as the arg to Subscription constructor


class DefaultSubscription {
  // options added to support broker v3
  constructor() {
    this.options = {
      topicProperty: 'topic',
      topicStartEventId: 1,
      eventIdProperty: 'id',
      getMethod: 'Get',
      streamMethod: 'Subscribe'
    };
    this.topic = '';
    this.fromEventId = null;
    this.subscribeInvocationId = -1;
    this.subscriberRef = null;
    this.lastReceivedEventId = -1;
    this.onDataReceived = function () {};
    this.onSubscriptionStart = null;
    this.onSubscriptionEnd = null;
    this.getSubscriptionId = function () {
      // Should generate a string that uniquely identifies this subscription/stream
      // Note: Two subscriptions for the same stream should result in the same "id" so we can compare and identify the same stream!!
      return this[this.options.topicProperty];
    };
    this.toString = function () {
      return this.getSubscriptionId();
    };
  }
}
class StreamSubscription extends DefaultSubscription {
  constructor(props) {
    super();
    for (const [prop, value] of Object.entries(props)) {
      this[prop] = (0,_StreamUtils__WEBPACK_IMPORTED_MODULE_0__.mergeDeep)(this[prop], value); // Deep merge each prop...
    }
  }
}
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (StreamSubscription);

/***/ },

/***/ "./src/StreamUtils.js"
/*!****************************!*\
  !*** ./src/StreamUtils.js ***!
  \****************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   mergeDeep: () => (/* binding */ _mergeDeep),
/* harmony export */   noDebug: () => (/* binding */ noDebug),
/* harmony export */   promiseTimeout: () => (/* binding */ promiseTimeout),
/* harmony export */   retryPromiseFunc: () => (/* binding */ retryPromiseFunc),
/* harmony export */   safeLocalStorageGet: () => (/* binding */ safeLocalStorageGet)
/* harmony export */ });
const wait = ms => {
  return new Promise(function (r) {
    return setTimeout(r, ms);
  });
};
const retryPromiseFunc = (promisedFunction, delay, maxRetries, abortReason) => {
  // This function retries "promisedFunction" (a function which is expected to return a Promise) until it's reloved, or until retried "maxRetries" number of times or until rejected with reason == "abortReason"...
  return new Promise(function (resolve, reject) {
    return promisedFunction().then(resolve).catch(function (reason) {
      if (maxRetries - 1 > 0 && reason !== abortReason) {
        return wait(delay).then(retryPromiseFunc.bind(null, promisedFunction, delay, maxRetries - 1, abortReason)).then(resolve).catch(reject);
      }
      return reject(reason);
    });
  });
};
const promiseTimeout = (promise, ms) => {
  // Create a promise that rejects in <ms> milliseconds
  // Returns a race between our timeout and the passed in promise
  return Promise.race([promise, new Promise(function (resolve, reject) {
    wait(ms).then(reject.bind(null, new Error('timeout')));
  })]);
};
const _mergeDeep = function mergeDeep() {
  // Deep merge from: https://stackoverflow.com/a/48218209 (modified for unique arrays as suggested in comments)
  // Also modified to handle primitives and differing types
  const isObject = obj => obj && typeof obj === 'object';
  for (var _len = arguments.length, objects = new Array(_len), _key = 0; _key < _len; _key++) {
    objects[_key] = arguments[_key];
  }
  return objects.reduce(function () {
    let prev = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    let obj = arguments.length > 1 ? arguments[1] : undefined;
    if (isObject(obj)) {
      Object.keys(obj).forEach(key => {
        const pVal = prev[key];
        const oVal = obj[key];
        if (Array.isArray(oVal) && Array.isArray(pVal)) {
          // Merging arrays is a bit tricky: Concatenate or only keep unique elements?
          // prev[key] = pVal.concat(...oVal);
          prev[key] = [...new Set([...oVal, ...pVal])];
        } else if (isObject(oVal) && isObject(pVal)) {
          prev[key] = _mergeDeep(pVal, oVal);
        } else {
          // Values are primitives or of different types
          if (isObject(pVal)) {
            prev[key] = oVal;
          } else {
            // prev[key] not an object! => Simply overwrite prev!
            prev = obj;
          }
        }
      });
      return prev;
    } else {
      return obj;
    }
  }, {});
};

const safeLocalStorageGet = key => {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch (e) {
    // Node or sandboxed env — ignore
  }
};
const noDebug = {
  debugDisabled: true,
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {}
};

/***/ },

/***/ "./src/SubscriptionsStore.js"
/*!***********************************!*\
  !*** ./src/SubscriptionsStore.js ***!
  \***********************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   add: () => (/* binding */ add),
/* harmony export */   exists: () => (/* binding */ exists),
/* harmony export */   findById: () => (/* binding */ findById),
/* harmony export */   get: () => (/* binding */ get),
/* harmony export */   getAll: () => (/* binding */ getAll),
/* harmony export */   remove: () => (/* binding */ remove),
/* harmony export */   removeAll: () => (/* binding */ removeAll)
/* harmony export */ });
let subscriptions = [];
const findById = subscriptionId => {
  return subscriptionId && subscriptions.find(s => s.getSubscriptionId() === subscriptionId) || null;
};
const exists = subscription => {
  return !!get(subscription);
};
const add = subscription => {
  remove(get(subscription));
  subscriptions.push(subscription);
};
const get = subscription => {
  return subscription && subscriptions.find(s => s.getSubscriptionId() === subscription.getSubscriptionId()) || null;
};
const getAll = () => {
  return subscriptions;
};
const remove = subscription => {
  if (subscription && typeof subscription === 'object') {
    subscriptions = subscriptions.filter(s => s.getSubscriptionId() !== subscription.getSubscriptionId());
    return true;
  }
  return false;
};
const removeAll = () => {
  subscriptions = [];
};

/***/ },

/***/ "./node_modules/stately.js/Stately.js"
/*!********************************************!*\
  !*** ./node_modules/stately.js/Stately.js ***!
  \********************************************/
(module) {

/*
 * Stately.js: A JavaScript based finite-state machine (FSM) engine.
 *
 * Copyright (c) 2012 Florian Schäfer (florian.schaefer@gmail.com)
 * Released under MIT license.
 *
 * Version: 2.0.0
 *
 */
(function (root, factory) {
    if (true) {
        module.exports = factory();
    } else // removed by dead control flow
{}
})(this, function () {

    var
        toString = Object.prototype.toString,

        InvalidStateError = (function () {

            function InvalidStateError(message) {

                this.name = 'InvalidStateError';

                this.message = message;
            }

            InvalidStateError.prototype = new Error();

            InvalidStateError.prototype.constructor = InvalidStateError;

            return InvalidStateError;
        })();

    function Stately(statesObject, initialStateName) {

        if (typeof statesObject === 'function') {

            statesObject = statesObject();
        }

        if (toString.call(statesObject) !== '[object Object]') {

            throw new InvalidStateError('Stately.js: Invalid states object: `' + statesObject + '`.');
        }

        function resolveSpecialEventFn(stateName, fnName) {

            for (var property in stateStore[stateName]) {

                if (stateStore[stateName].hasOwnProperty(property)) {

                    if (property.toLowerCase() === fnName.toLowerCase()) {

                        return stateStore[stateName][property];

                    }
                }
            }
        }

        var
            currentState,

            stateStore = {

                getMachineState: function getMachineState() {

                    return currentState.name;
                },

                setMachineState: function setMachineState(nextState /*, eventName */) {

                    var
                        eventName = arguments[1],

                        onEnterState,

                        onLeaveState,

                        lastState = currentState;

                    if (typeof nextState === 'string') {

                        nextState = stateStore[nextState];

                    }

                    if (!nextState || !nextState.name || !stateStore[nextState.name]) {

                        throw new InvalidStateError('Stately.js: Transitioned into invalid state: `' + setMachineState.caller + '`.');
                    }

                    currentState = nextState;

                    onLeaveState = resolveSpecialEventFn(lastState.name, "onLeave");

                    if (onLeaveState && typeof onLeaveState === 'function') {

                        onLeaveState.call(stateStore, eventName, lastState.name, currentState.name);
                    }

                    onEnterState = resolveSpecialEventFn(currentState.name, "onEnter");

                    if (onEnterState && typeof onEnterState === 'function') {

                        onEnterState.call(stateStore, eventName, lastState.name, nextState.name);
                    }

                    return this;
                },

                getMachineEvents: function getMachineEvents() {

                    var events = [];

                    for (var property in currentState) {

                        if (currentState.hasOwnProperty(property)) {

                            if (typeof currentState[property] === 'function') {

                                events.push(property);
                            }
                        }
                    }

                    return events;
                }

            },

            stateMachine = {

                getMachineState: stateStore.getMachineState,

                getMachineEvents: stateStore.getMachineEvents

            },

            transition = function transition(stateName, eventName, nextEvent) {

                return function event() {

                    var
                        onBeforeEvent,

                        onAfterEvent,

                        nextState,

                        eventValue = stateMachine;

                    if (stateStore[stateName] !== currentState) {

                        if (nextEvent) {

                            eventValue = nextEvent.apply(stateStore, arguments);
                        }

                        return eventValue;
                    }

                    onBeforeEvent = resolveSpecialEventFn(currentState.name, "onBefore" + eventName);

                    if (onBeforeEvent && typeof onBeforeEvent === 'function') {

                        onBeforeEvent.call(stateStore, eventName, currentState.name, currentState.name);
                    }

                    eventValue = stateStore[stateName][eventName].apply(stateStore, arguments);

                    if (typeof eventValue === 'undefined') {

                        nextState = currentState;

                        eventValue = stateMachine;

                    } else if (typeof eventValue === 'string') {

                        nextState = stateStore[eventValue];

                        eventValue = stateMachine;

                    } else if (toString.call(eventValue) === '[object Object]') {

                        nextState = (eventValue === stateStore ? currentState : eventValue);

                        eventValue = stateMachine;

                    } else if (toString.call(eventValue) === '[object Array]' && eventValue.length >= 1) {

                        if (typeof eventValue[0] === 'string') {

                            nextState = stateStore[eventValue[0]];

                        } else {

                            nextState = eventValue[0];

                        }

                        eventValue = eventValue[1];
                    }

                    onAfterEvent = resolveSpecialEventFn(currentState.name, "onAfter" + eventName);

                    if (onAfterEvent && typeof onAfterEvent === 'function') {

                        onAfterEvent.call(stateStore, eventName, currentState.name, nextState.name);
                    }

                    stateStore.setMachineState(nextState, eventName);

                    return eventValue;
                };
            };

        for (var stateName in statesObject) {

            if (statesObject.hasOwnProperty(stateName)) {

                stateStore[stateName] = statesObject[stateName];

                for (var eventName in stateStore[stateName]) {

                    if (stateStore[stateName].hasOwnProperty(eventName)) {

                        if (typeof stateStore[stateName][eventName] === 'string') {

                            stateStore[stateName][eventName] = (function (stateName) {

                                return function event() {

                                    return this[stateName];
                                };

                            })(stateStore[stateName][eventName]);
                        }

                        if (
                            typeof stateStore[stateName][eventName] === 'function'
                                && !/^onEnter$/i.test(eventName)
                                && !/^onLeave$/i.test(eventName)
                                && !/^onBefore/i.test(eventName)
                                && !/^onAfter/i.test(eventName)
                        ) {

                            stateMachine[eventName] = transition(stateName, eventName, stateMachine[eventName]);
                        }
                    }
                }

                stateStore[stateName].name = stateName;

                if (!currentState) {

                    currentState = stateStore[stateName];
                }
            }
        }

        if (typeof stateStore[initialStateName] !== 'undefined') {
            currentState = stateStore[initialStateName];
        }

        if (!currentState) {

            throw new InvalidStateError('Stately.js: Invalid initial state.');
        }

        return stateMachine;
    }

    Stately.machine = function machine(statesObject, initialStateName) {
        return new Stately(statesObject, initialStateName);
    };

    Stately.InvalidStateError = InvalidStateError;

    return Stately;

});


/***/ },

/***/ "@microsoft/signalr"
/*!*************************************!*\
  !*** external "@microsoft/signalr" ***!
  \*************************************/
(module) {

module.exports = __WEBPACK_EXTERNAL_MODULE__microsoft_signalr_e3fad43b__;

/***/ },

/***/ "./node_modules/@babel/runtime/helpers/esm/defineProperty.js"
/*!*******************************************************************!*\
  !*** ./node_modules/@babel/runtime/helpers/esm/defineProperty.js ***!
  \*******************************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ _defineProperty)
/* harmony export */ });
/* harmony import */ var _toPropertyKey_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./toPropertyKey.js */ "./node_modules/@babel/runtime/helpers/esm/toPropertyKey.js");

function _defineProperty(e, r, t) {
  return (r = (0,_toPropertyKey_js__WEBPACK_IMPORTED_MODULE_0__["default"])(r)) in e ? Object.defineProperty(e, r, {
    value: t,
    enumerable: !0,
    configurable: !0,
    writable: !0
  }) : e[r] = t, e;
}


/***/ },

/***/ "./node_modules/@babel/runtime/helpers/esm/toPrimitive.js"
/*!****************************************************************!*\
  !*** ./node_modules/@babel/runtime/helpers/esm/toPrimitive.js ***!
  \****************************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ toPrimitive)
/* harmony export */ });
/* harmony import */ var _typeof_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./typeof.js */ "./node_modules/@babel/runtime/helpers/esm/typeof.js");

function toPrimitive(t, r) {
  if ("object" != (0,_typeof_js__WEBPACK_IMPORTED_MODULE_0__["default"])(t) || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || "default");
    if ("object" != (0,_typeof_js__WEBPACK_IMPORTED_MODULE_0__["default"])(i)) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
}


/***/ },

/***/ "./node_modules/@babel/runtime/helpers/esm/toPropertyKey.js"
/*!******************************************************************!*\
  !*** ./node_modules/@babel/runtime/helpers/esm/toPropertyKey.js ***!
  \******************************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ toPropertyKey)
/* harmony export */ });
/* harmony import */ var _typeof_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./typeof.js */ "./node_modules/@babel/runtime/helpers/esm/typeof.js");
/* harmony import */ var _toPrimitive_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./toPrimitive.js */ "./node_modules/@babel/runtime/helpers/esm/toPrimitive.js");


function toPropertyKey(t) {
  var i = (0,_toPrimitive_js__WEBPACK_IMPORTED_MODULE_1__["default"])(t, "string");
  return "symbol" == (0,_typeof_js__WEBPACK_IMPORTED_MODULE_0__["default"])(i) ? i : i + "";
}


/***/ },

/***/ "./node_modules/@babel/runtime/helpers/esm/typeof.js"
/*!***********************************************************!*\
  !*** ./node_modules/@babel/runtime/helpers/esm/typeof.js ***!
  \***********************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ _typeof)
/* harmony export */ });
function _typeof(o) {
  "@babel/helpers - typeof";

  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}


/***/ }

/******/ });
/************************************************************************/
/******/ // The module cache
/******/ var __webpack_module_cache__ = {};
/******/ 
/******/ // The require function
/******/ function __webpack_require__(moduleId) {
/******/ 	// Check if module is in cache
/******/ 	var cachedModule = __webpack_module_cache__[moduleId];
/******/ 	if (cachedModule !== undefined) {
/******/ 		return cachedModule.exports;
/******/ 	}
/******/ 	// Check if module exists (development only)
/******/ 	if (__webpack_modules__[moduleId] === undefined) {
/******/ 		var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 		e.code = 'MODULE_NOT_FOUND';
/******/ 		throw e;
/******/ 	}
/******/ 	// Create a new module (and put it into the cache)
/******/ 	var module = __webpack_module_cache__[moduleId] = {
/******/ 		// no module.id needed
/******/ 		// no module.loaded needed
/******/ 		exports: {}
/******/ 	};
/******/ 
/******/ 	// Execute the module function
/******/ 	__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 
/******/ 	// Return the exports of the module
/******/ 	return module.exports;
/******/ }
/******/ 
/************************************************************************/
/******/ /* webpack/runtime/compat get default export */
/******/ (() => {
/******/ 	// getDefaultExport function for compatibility with non-harmony modules
/******/ 	__webpack_require__.n = (module) => {
/******/ 		var getter = module && module.__esModule ?
/******/ 			() => (module['default']) :
/******/ 			() => (module);
/******/ 		__webpack_require__.d(getter, { a: getter });
/******/ 		return getter;
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/define property getters */
/******/ (() => {
/******/ 	// define getter functions for harmony exports
/******/ 	__webpack_require__.d = (exports, definition) => {
/******/ 		for(var key in definition) {
/******/ 			if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 				Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 			}
/******/ 		}
/******/ 	};
/******/ })();
/******/ 
/******/ /* webpack/runtime/hasOwnProperty shorthand */
/******/ (() => {
/******/ 	__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ })();
/******/ 
/******/ /* webpack/runtime/make namespace object */
/******/ (() => {
/******/ 	// define __esModule on exports
/******/ 	__webpack_require__.r = (exports) => {
/******/ 		if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 		}
/******/ 		Object.defineProperty(exports, '__esModule', { value: true });
/******/ 	};
/******/ })();
/******/ 
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!**************************!*\
  !*** ./src/PzlStream.js ***!
  \**************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   StreamConnector: () => (/* reexport safe */ _StreamConnector__WEBPACK_IMPORTED_MODULE_0__["default"]),
/* harmony export */   StreamErrors: () => (/* reexport safe */ _StreamErrors__WEBPACK_IMPORTED_MODULE_2__["default"]),
/* harmony export */   StreamEventTypes: () => (/* reexport safe */ _StreamEventTypes__WEBPACK_IMPORTED_MODULE_1__["default"]),
/* harmony export */   StreamSubscription: () => (/* reexport safe */ _StreamSubscription__WEBPACK_IMPORTED_MODULE_3__["default"])
/* harmony export */ });
/* harmony import */ var _StreamConnector__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./StreamConnector */ "./src/StreamConnector.js");
/* harmony import */ var _StreamEventTypes__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./StreamEventTypes */ "./src/StreamEventTypes.js");
/* harmony import */ var _StreamErrors__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./StreamErrors */ "./src/StreamErrors.js");
/* harmony import */ var _StreamSubscription__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./StreamSubscription */ "./src/StreamSubscription.js");





})();

const __webpack_exports__StreamConnector = __webpack_exports__.StreamConnector;
const __webpack_exports__StreamErrors = __webpack_exports__.StreamErrors;
const __webpack_exports__StreamEventTypes = __webpack_exports__.StreamEventTypes;
const __webpack_exports__StreamSubscription = __webpack_exports__.StreamSubscription;
export { __webpack_exports__StreamConnector as StreamConnector, __webpack_exports__StreamErrors as StreamErrors, __webpack_exports__StreamEventTypes as StreamEventTypes, __webpack_exports__StreamSubscription as StreamSubscription };

//# sourceMappingURL=pzl-stream-lib.js.map