// Simple module to create a new "subscription"-object to subscribe to events from streaming broker (via SignalR)
// It will add and init correct default properties for usage by StreamConnector
// Add overridden and/or custom props as the arg to Subscription constructor

import { mergeDeep } from './StreamUtils';

class DefaultSubscription {
	// options added to support broker v3
	constructor() {
		this.options = {
			topicProperty: 'topic',
			topicStartEventId: 1,
			eventIdProperty: 'id',
			getMethod: 'Get',
			streamMethod: 'Subscribe',
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
		}
	}
}

class StreamSubscription extends DefaultSubscription {
	constructor(props) {
		super();
		for (const [prop, value] of Object.entries(props)) {
			this[prop] = mergeDeep(this[prop], value); // Deep merge each prop...
		}
	}
}

export default StreamSubscription;
