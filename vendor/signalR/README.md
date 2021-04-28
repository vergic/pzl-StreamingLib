## SignalR for Vergic
As long as we don't use a ECMAScript module loader/bundler (like webpack) in the visitor project, the SignalR client needs to be manually copied here from:
"/node_modules/@microsoft/signalr/dist/browser" 

<br>

#### Important!
The SignalR-client module we use is a slightly modified Vergic version!

The original SignalR-module is automatically polyfilling "window.Promise" if it's missing or shimmed.

But to avoid conflict with any mokey-patched windows.Promise on customer websites, our version does *NOT* polyfill the global window.Promise.
Instead it creates a locally scoped "Promise"-variable that will be used internally (isolated from the global scope)

Diff or search for comments containing "Vergic/vngage" in the module to find all modifications
