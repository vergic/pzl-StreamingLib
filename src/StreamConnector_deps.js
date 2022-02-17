import {StreamConnector} from './StreamConnector';

export default {
    _signalr: StreamConnector._signalr,	// Expose the signalr lib  - mainly for debugging...
    init: StreamConnector.init,
    getSubscriptions: StreamConnector.getSubscriptions,
    addSubscription: StreamConnector.addSubscription,
    removeTopicSubscription: StreamConnector.removeTopicSubscription,
    publishTopicIfConnected: StreamConnector.publishTopicIfConnected
}
