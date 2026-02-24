import Stately from 'stately.js';
import { noDebug } from './StreamUtils';

const reconnectRetryDelay = 10;
const reconnectMaxRetries = 12; // 12 retries á 10 sec = 2 minutes

export const initBrokerConnectionFsm = (externals, brokerEventCallbacks = {}, debug) => {
    /*******************************************************************************************
     ** brokerConnection state machine
     * Using https://github.com/fschaefer/Stately.js
     *******************************************************************************************/
    debug = debug || noDebug;
    debug.log('initBrokerConnectionFsm');

    const fsm_state = {
        fsm: null,
        connection: null,
        reconnectCounter: 0,
        eventListeners: {},
        brokerEventCallbacks
    };

    const handle = (action, ...args) => fsm_state.fsm[action](...args);
    const on = (eventName, callback) => {
        fsm_state.eventListeners[eventName] = (fsm_state.eventListeners[eventName] || []).concat(callback);
        return {
            eventName: eventName,
            callback: callback,
            off: () => {
                off(eventName, callback);
            }
        }
    }
    const off = (eventName, callback) => {
        fsm_state.eventListeners[eventName] = (fsm_state.eventListeners[eventName] || []).filter(cb => callback && cb !== callback);
    }
    const emitEvent = (eventName, ...args) => {
        (fsm_state.eventListeners[eventName] || []).forEach(function (callback) {
            callback.call(this, ...args);
        }.bind(this));
    }

    const fsmStates = {
        disconnected: {
            _onEnter: function () {
                debug.log('FSM: disconnected._onEnter()');
                fsm_state.connection = null;
            },
            connect: function () {
                return this.connecting;
            }
        },
        connecting: {
            _onEnter: function () {
                debug.log('FSM: connecting._onEnter()');
                externals._connect();
            },
            connection_ok: function (connection) {
                fsm_state.connection = connection;
                return this.connected;
            },
            connection_failed: function (err) {
                return this.disconnected;
            },
            disconnect: function () {
                return this.disconnecting;
            }
        },
        connected: {
            _onEnter: function (action, prevState) {
                debug.log('FSM: connected._onEnter()', action, prevState);
                if (prevState === 'reconnecting') {
                    // If coming here from 'reconnecting', we should resubscribe all subscriptions
                    // (can't be done in 'reconnecting', since reSubscribeAll() will only work in state 'connected'!)
                    externals.reSubscribeAll?.()?.catch(() => {});
                }
                typeof fsm_state?.brokerEventCallbacks?.onConnectionStarted === 'function' && fsm_state.brokerEventCallbacks.onConnectionStarted(fsm_state.connection);
            },
            connection_failed: function () {
                // Broker connection closed in "connected"-state - try to auto-reconnect to broker...
                typeof fsm_state?.brokerEventCallbacks?.onConnectionFailed === 'function' && fsm_state.brokerEventCallbacks.onConnectionFailed('connection failed');
                fsm_state.connection = null;
                fsm_state.reconnectCounter = 0;
                return this.reconnect_wait;
            },
            disconnect: function () {
                return this.disconnecting;
            }
        },
        reconnect_wait: {
            _onEnter: function () {
                debug.log('FSM: reconnect_wait._onEnter()');
                if (fsm_state.reconnectCounter < reconnectMaxRetries) {
                    handle('schedule_reconnect');
                } else { // i.e. don't try to reconnect even once if reconnectMaxRetries <= 0
                    handle('reconnection_failed');
                }
            },
            schedule_reconnect: function () {
                debug.log('FSM reconnect_wait.schedule_reconnect(): Reconnecting to broker in ' + reconnectRetryDelay + ' sec...');
                clearTimeout(fsm_state.reconnectTimer);	// Just make sure no other reconnects are already scheduled (should not happen, but maybe SignalR's connection.onclose() *could* be fired twice in that case we'd end up here twice before handling the 'reconnect'-action...)
                fsm_state.reconnectTimer = setTimeout(function () {
                    handle('connect');
                }.bind(this), reconnectRetryDelay * 1000);
            },
            connect: function () {
                return this.reconnecting;
            },
            disconnect: function () {
                return this.disconnecting;
            },
            reconnection_failed: function () {
                return this.disconnected;
            },
            _onExit: function () {
                clearTimeout(fsm_state.reconnectTimer);
            }
        },
        reconnecting: {
            _onEnter: function () {
                debug.log('FSM: reconnecting._onEnter()');
                fsm_state.reconnectCounter++;
                externals._connect();
            },
            connection_ok: function (connection) {
                fsm_state.connection = connection;
                // After successful re-connect, transition to 'connected'
                // After the transition, all existing subscriptions will be re-subscribed
                // (but reSubscribeAll() can only be done *AFTER* the transition because it needs to be 'connected')!
                return this.connected;
            },
            connection_failed: function (err) {
                typeof fsm_state?.brokerEventCallbacks?.onConnectionFailed === 'function' && fsm_state.brokerEventCallbacks.onConnectionFailed(err);
                return this.reconnect_wait;
            },
            disconnect: function () {
                return this.disconnecting;
            }
        },
        disconnecting: {
            _onEnter: function () {
                debug.log('FSM: disconnecting._onEnter()', this);
                externals.unSubscribeAll();

                if (fsm_state.connection) {
                    // Stop connection, ignore errors, then go to "disconnected"
                    fsm_state.connection.stop()
                        .catch(() => {})
                        .finally(() => {
                            handle('disconnect_ok');
                        });
                } else {
                    // No connection to stop: Go directly to "disconnected"
                    handle('disconnect_ok');
                }
            },
            disconnect_ok: function () {
                typeof fsm_state?.brokerEventCallbacks?.onDisconnected === 'function' && fsm_state.brokerEventCallbacks.onDisconnected();
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

                emitEvent('transition', { fromState: prevState, toState: newState });

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
        }
    });

    fsm_state.fsm = new Stately(fsmStates, 'disconnected');

    return {
        handle,
        on,
        off,
        getState: () => fsm_state.fsm.getMachineState(),
        getConnection: () => fsm_state.connection,
        setEventCallbacks: brokerEventCallbacks => fsm_state.brokerEventCallbacks = brokerEventCallbacks,
    }
}
