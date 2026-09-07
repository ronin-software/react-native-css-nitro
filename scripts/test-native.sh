#!/bin/bash
# Build and run the native (C++) test suite
set -euo pipefail
cd "$(dirname "$0")/.."

# The C++ tests include nitrogen-generated spec headers
yarn nitrogen

cmake -B cpp/tests/build -S cpp/tests
cmake --build cpp/tests/build
./cpp/tests/build/css_tests
