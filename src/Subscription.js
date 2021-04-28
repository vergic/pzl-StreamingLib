// Simple module to create a new "subscription"-object to subscribe to events from streaming broker (via SignalR)
// It will add and init correct default properties for usage by StreamConnector
// Add overridden and/or custom props as the arg to extend()

define(function (require) {
	'use strict';

	var StreamUtils = require('./StreamUtils');

	var defaultSubscriptionProps = {
		topic: '',
		fromEventId: null,
		subscribeInvocationId: -1,
		subscriberRef: null,
		lastReceivedEventId: -1,
		onDataReceived: function() {},
		onSubscriptionStart: null,
		onSubscriptionEnd: null
	};

	return {
		extend: function (props) {
			return StreamUtils.extend({}, defaultSubscriptionProps, props);
		}
	}
});
