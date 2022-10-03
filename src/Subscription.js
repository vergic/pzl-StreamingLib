// Simple module to create a new "subscription"-object to subscribe to events from streaming broker (via SignalR)
// It will add and init correct default properties for usage by StreamConnector
// Add overridden and/or custom props as the arg to extend()

import { extend } from './StreamUtils';

const defaultSubscriptionProps = {
	// options added to support broker v3
	options: {
		topicProperty: 'topic',
		topicStartEventId: 1,
		eventIdProperty: 'id',
		getMethod: 'Get',
		streamMethod: 'Subscribe',
	},

	topic: '',
	fromEventId: null,
	subscribeInvocationId: -1,
	subscriberRef: null,
	lastReceivedEventId: -1,
	onDataReceived: function() {},
	onSubscriptionStart: null,
	onSubscriptionEnd: null,

	getSubscriptionId: function () {
		// Should generate a string that uniquely identifies this subscription/stream
		// Note: Two subscriptions for the same stream should result in the same "id" so we can compare and identify the same stream!!
		return this[this.options.topicProperty];
	},
	toString: function () {
		return this.getSubscriptionId();
	}
};

const subscriptionFactory = props => {
	return extend(true, {}, defaultSubscriptionProps, props); // Deep merge...
};

export default {
	create: subscriptionFactory,
	extend: subscriptionFactory
}
