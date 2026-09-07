// Benchmark: react-native-css-nitro C++ style-resolution core.
// Mirrors src/__benchmarks__/js-runtime.bench.test.ts workload-for-workload:
// same values, same operations, through this repo's real classes.
//
// Build: cmake -B cpp/tests/build -S cpp/tests && cmake --build cpp/tests/build --target css_bench
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <random>
#include <string>
#include <unordered_map>
#include <vector>

#include "../StyleFunction.hpp"
#include "../StyleResolver.hpp"
#include "../Specificity.hpp"
#include "../VariableContext.hpp"
#include "../Rules.hpp"

using namespace margelo::nitro;
using namespace margelo::nitro::cssnitro;
using reactnativecss::Effect;
using Clock = std::chrono::steady_clock;

namespace {

    Effect::GetProxy makeGet() {
        static Effect effect([](Effect::GetProxy &) {});
        return Effect::GetProxy{&effect};
    }

    AnyValue rootVarItem(const AnyValue &value) {
        return AnyValue(AnyArray{AnyObject{{"v", value}}});
    }

    AnyValue varFn(const AnyValue &name) {
        return AnyValue(AnyArray{"fn", "var", name});
    }

    double bench(const std::string &name, size_t iterations,
                 const std::function<void()> &fn) {
        for (size_t i = 0; i < std::min<size_t>(100, iterations); i++) {
            fn();
        }
        auto start = Clock::now();
        for (size_t i = 0; i < iterations; i++) {
            fn();
        }
        double ms = std::chrono::duration_cast<std::chrono::microseconds>(
                            Clock::now() - start)
                            .count() /
                    1000.0;
        double opsPerSec = iterations / ms * 1000.0;
        std::printf("BENCH %s: %zu iters in %.1fms → %.0f ops/s\n",
                    name.c_str(), iterations, ms, opsPerSec);
        return opsPerSec;
    }

} // namespace

int main() {
    auto get = makeGet();

    // Variable seeding — same values as the JS bench
    VariableContext::setTopLevelVariable("root", "brand",
                                         rootVarItem(AnyValue(std::string("#3490dc"))));
    VariableContext::setTopLevelVariable("root", "spacing",
                                         rootVarItem(AnyValue(4.0)));
    VariableContext::setTopLevelVariable("root", "b",
                                         rootVarItem(AnyValue(std::string("#00ff00"))));
    VariableContext::setTopLevelVariable("root", "a",
                                         rootVarItem(varFn(AnyValue(std::string("b")))));

    // –
    // 1. Specificity sort — 200 rules, same distribution
    // –

    std::vector<SpecificityArray> sortRules;
    {
        std::mt19937 rng(42);
        auto rand = [&rng]() { return std::uniform_real_distribution<>(0, 1)(rng); };
        for (int i = 0; i < 200; i++) {
            SpecificityArray s = {
                rand() > 0.9 ? 1.0 : 0.0,
                0,
                0,
                (double)(int)(rand() * 3),
                (double)(int)(rand() * 400),
            };
            sortRules.push_back(s);
        }
    }

    bench("sort200", 500, [&]() {
        auto copy = sortRules;
        std::sort(copy.begin(), copy.end(), Specificity::sort);
    });

    // –
    // 2. Declaration merge + resolve — 15 rules / 60 declarations
    // –

    std::vector<std::shared_ptr<AnyMap>> mergeRules;
    for (int i = 0; i < 15; i++) {
        auto d = AnyMap::make();
        d->setAny("color", AnyValue(std::string("#123456")));
        d->setAny("opacity", AnyValue(0.5));
        d->setAny("padding", AnyValue(2.0));
        mergeRules.push_back(std::move(d));
    }

    bench("merge15rules", 2000, [&]() {
        for (const auto &d : mergeRules) {
            for (const auto &kv : d->getMap()) {
                StyleResolver::resolveStyle(kv.second, "root", get);
            }
        }
    });

    // –
    // 3. var() resolution
    // –

    AnyValue brandTuple = varFn(AnyValue(std::string("brand")));
    AnyValue chainTuple = varFn(AnyValue(std::string("a")));

    bench("varSimple", 20000, [&]() {
        StyleResolver::resolveStyle(brandTuple, "root", get);
    });

    bench("varChain", 20000, [&]() {
        StyleResolver::resolveStyle(chainTuple, "root", get);
    });

    // –
    // 4. calc() evaluation
    // –

    AnyArray calcArgs = {"fn", "calc",
                         AnyValue(AnyArray{"fn", "product",
                                           varFn(AnyValue(std::string("spacing"))),
                                           AnyValue(2.0)})};
    AnyValue calcTuple = AnyValue(std::move(calcArgs));

    bench("calc", 20000, [&]() {
        StyleResolver::resolveStyle(calcTuple, "root", get);
    });

    // –
    // 5. Composite: sort + merge + var + calc for one component
    // –

    bench("composite", 1000, [&]() {
        auto copy = sortRules;
        std::sort(copy.begin(), copy.end(), Specificity::sort);
        for (const auto &d : mergeRules) {
            for (const auto &kv : d->getMap()) {
                StyleResolver::resolveStyle(kv.second, "root", get);
            }
        }
        StyleResolver::resolveStyle(brandTuple, "root", get);
        StyleResolver::resolveStyle(calcTuple, "root", get);
    });

    return 0;
}
