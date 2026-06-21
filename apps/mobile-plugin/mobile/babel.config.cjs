module.exports = function moxxyMobileBabelConfig(api) {
  const isNodeModule = api.caller((caller) => caller?.isNodeModule === true);

  if (isNodeModule) {
    return {
      presets: [],
    };
  }

  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
