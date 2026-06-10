/**
 * @format
 */

// Install the full Node.js-compatible Buffer polyfill before any library code runs.
// Hermes's built-in Buffer is missing methods like .copy(), .alloc(), .readUInt16BE()
// that @ngraveio/bc-ur (bytewords, cbor-sync) depend on.  Replacing it here ensures
// Buffer.isBuffer(), buffer.copy(), etc. all work uniformly across modules.
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
