import {StreamConnector} from './StreamConnector';
import machina from 'machina';

const dependencyLibs = {
	machina: machina
}

export default {
	_signalr: StreamConnector._signalr,	// Expose the signalr lib  - mainly for debugging...
	init: (brokerUrl, streamOptions, eventHandlers, initDebug) => {
		// Include and inject "machina" npm as dependency lib when init:ing StreamConnector
		// If the project that uses this lib is already using the "machina" lib (e.g. Vergic visitor),
		// use "StreamConnector_deps" instead and inject "machina" manually (will make this bundle a lot smaller)
		//
		// Note: "machina" also bundles "lodash" as a dependency, so if the project is already using "lodash",
		// it may also be a good idea to manually include "machina" in it and inject it manually here.
		// (otherwise "lodash" may be included twice, maybe.
		// Or is webpack smart enough to remove it from this bundle if it already exists in main project?
		// Some experimentation is needed...)
		return StreamConnector.init(brokerUrl, streamOptions, eventHandlers, dependencyLibs, initDebug);
	},
	getSubscriptions: StreamConnector.getSubscriptions,
	addSubscription: StreamConnector.addSubscription,
	removeTopicSubscription: StreamConnector.removeTopicSubscription,
	publishTopicIfConnected: StreamConnector.publishTopicIfConnected
}
