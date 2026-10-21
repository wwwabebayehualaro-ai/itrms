// The API bundle (code-structure.md §5.5): Nest's webpack builder with swc-loader, decorator metadata on. The @itrms/*
// workspace packages are TypeScript source and are bundled in; npm packages stay external and load from node_modules.
// One bundle per process: main (HTTP), worker, migrate and seed. CommonJS output (.cjs): the package itself is an ES module.
const path = require('node:path');

const swc = {
    loader: 'swc-loader',
    options: {
        jsc: {
            parser: { syntax: 'typescript', decorators: true },
            transform: { legacyDecorator: true, decoratorMetadata: true },
            target: 'es2023'
        },
        module: { type: 'es6' },
        sourceMaps: true
    }
};

/** Everything that is not ours (a relative path, or an @itrms/* package) is required at run time. */
function externals({ request }, callback) {
    if (!request || request.startsWith('.') || path.isAbsolute(request) || request.startsWith('@itrms/'))
        return callback();
    return callback(null, `commonjs ${request}`);
}

module.exports = (defaults) => ({
    ...defaults,
    // openapi: writes the contract (pnpm openapi); not part of the image's processes
    entry: {
        main: './src/main.ts',
        worker: './src/worker.ts',
        migrate: './src/migrate.ts',
        seed: './src/seed.ts',
        openapi: './src/openapi-cli.ts'
    },
    output: { path: path.join(__dirname, 'dist'), filename: '[name].cjs', clean: true },
    devtool: 'source-map',
    externals: [externals],
    module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: swc }] },
    resolve: { extensions: ['.ts', '.js', '.json'] },
    // Nest's lazy-import guard only; type checking is the typecheck task's job, not the bundle's
    plugins: defaults.plugins.filter((p) => p.constructor.name === 'IgnorePlugin')
});
