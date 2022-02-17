// Simple module to create a new "subscription"-object to subscribe to events from streaming broker (via SignalR)
// It will add and init correct default properties for usage by StreamConnector
// Add overridden and/or custom props as the arg to extend()

import {StreamUtils} from './StreamUtils';

const defaultSubscriptionProps = {
	topic: '',
	fromEventId: null,
	subscribeInvocationId: -1,
	subscriberRef: null,
	lastReceivedEventId: -1,
	onDataReceived: function() {},
	onSubscriptionStart: null,
	onSubscriptionEnd: null
};

export default {
	extend: props => {
		return StreamUtils.extend({}, defaultSubscriptionProps, props);
	}
}
