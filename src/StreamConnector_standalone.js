define(['require'], function(require) {
	const machina = require('machina'),
		StreamConnector_WithDependencyInjection = require('./StreamConnector');

	const dependencyLibs = {
		machina: machina
	}

	return {
		_signalr: StreamConnector_WithDependencyInjection._signalr,	// Expose the signalr lib  - mainly for debugging...
		init: (brokerUrl, streamOptions, eventHandlers, initDebug) => {
			return StreamConnector_WithDependencyInjection.init(brokerUrl, streamOptions, eventHandlers, dependencyLibs, initDebug);
		},
		getSubscriptions: StreamConnector_WithDependencyInjection.getSubscriptions,
		addSubscription: StreamConnector_WithDependencyInjection.addSubscription,
		removeTopicSubscription: StreamConnector_WithDependencyInjection.removeTopicSubscription,
		publishTopicIfConnected: StreamConnector_WithDependencyInjection.publishTopicIfConnected
	}
});
