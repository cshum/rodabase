#!/bin/bash
set -e

# npm install -g browserify es3ify uglify-js bundle-collapser

rm -rf dist
mkdir dist

browserify lib/roda.js -s rodabase -p bundle-collapser/plugin | derequire > dist/rodabase.js
# browserify lib/roda.js -s rodabase  > dist/rodabase.js
uglifyjs dist/rodabase.js -mc > dist/rodabase.min.js
