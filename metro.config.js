const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;

const config = {
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
    ],
    // Honour package.json "exports" fields so Metro resolves subpath imports
    // (e.g. @noble/hashes/crypto) through the declared map rather than falling
    // back to file-based resolution and emitting spurious "not listed in exports" warnings.
    unstable_enablePackageExports: true,
    // @env is a virtual module whose imports are replaced by react-native-dotenv's
    // Babel plugin at transform time. Metro must resolve it to a real file first;
    // envStub.js is that placeholder — its exports are never actually used.
    extraNodeModules: {
      '@env': path.resolve(projectRoot, 'envStub.js'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
