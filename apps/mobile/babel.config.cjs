function stripReactDevMetadataPlugin({ types: t }) {
  return {
    name: 'moxxy-strip-react-dev-metadata',
    visitor: {
      JSXAttribute(path) {
        const name = path.node.name;
        if (t.isJSXIdentifier(name) && (name.name === '__self' || name.name === '__source')) {
          path.remove();
        }
      },
      ObjectProperty(path) {
        const key = path.node.key;
        if (t.isIdentifier(key) && (key.name === '__self' || key.name === '__source')) {
          path.remove();
        }
        if (t.isStringLiteral(key) && (key.value === '__self' || key.value === '__source')) {
          path.remove();
        }
      },
    },
  };
}

module.exports = function moxxyMobileBabelConfig(api) {
  const isNodeModule = api.caller((caller) => caller?.isNodeModule === true);

  if (isNodeModule) {
    return {
      presets: [],
    };
  }

  return {
    plugins: [stripReactDevMetadataPlugin],
    presets: [['babel-preset-expo', { jsxRuntime: 'classic' }]],
  };
};
