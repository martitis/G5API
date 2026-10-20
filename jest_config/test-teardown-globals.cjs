// Open handles (DB pool, sessions) are closed by jest's --forceExit (see package.json test:* scripts),
// which keeps the real exit code. Calling process.exit(0) here used to hide failing tests.
module.exports = () => {};
