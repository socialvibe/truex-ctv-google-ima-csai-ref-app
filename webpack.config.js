const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const path = require('path');

const generateConfig = require('./generate-config');

module.exports = function(env) {
    // Generate the config module that exposes the build configuration to the runtime code base.
    generateConfig(env);

    return {
        mode: 'development',
        entry: {
            simple: [
                './src/simple/simple.js',
                './src/simple/simple.scss'
            ],
            videojs: [
                './src/videojs/videojs-demo.js',
                './src/videojs/videojs-demo.scss'
            ],
        },
        output: {
            filename: '[name].[hash].js',
            path: path.resolve(__dirname, 'dist'),
        },
        module: {
            rules: [
                {
                    test: /\.scss$/,
                    use: ['style-loader', 'css-loader', 'sass-loader']
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                },
                {
                    test: /\.html$/,
                    exclude: /node_modules/,
                    use: [{
                        loader: 'html-loader',
                        options: {
                            minimize: false
                        },
                    },],
                },
                {
                    test: /\.(jpeg|.jpg|gif|png)$/i,
                    exclude: /node_modules/,
                    use: 'file-loader',
                },
                {
                    test: /\.svg$/i,
                    exclude: /node_modules/,
                    use: 'svg-inline-loader',
                },
                {
                    test: /\.xml$/i,
                    exclude: /node_modules/,
                    use: 'raw-loader',
                },
                {
                    test: /\.js$/,
                    use: 'babel-loader',
                    include: [
                        path.resolve(__dirname, 'src'),
                        path.resolve(__dirname, 'node_modules/truex-shared/src'),
                    ],
                },
            ],
        },
        resolve: {
            alias: {
                'truex-shared': path.resolve(__dirname, './node_modules/truex-shared/src/'),
            },
        },
        plugins: [
            new HtmlWebpackPlugin({
                filename: 'index.html',
                template: './src/index.html',
                chunks: ['simple'],
            }),
            new HtmlWebpackPlugin({
                filename: 'videojs-demo.html',
                template: './src/index.html',
                chunks: ['videojs'],
            })
        ],
        devtool: 'cheap-module-source-map'
    };
};
