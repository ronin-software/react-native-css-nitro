// doctest-based tests for StyleResolver — the pure C++ style core
// (doctest main lives in computed_tests.cpp)
#include <doctest/doctest.h>

#include "../StyleResolver.hpp"
#include "../VariableContext.hpp"

using namespace margelo::nitro;
using namespace margelo::nitro::cssnitro;
using reactnativecss::Effect;

namespace {

    // Variable resolution touches real observables, which subscribe through
    // the Effect — so tests need a live Effect, not a null pointer
    Effect::GetProxy makeGet() {
        static Effect effect([](Effect::GetProxy &) {});
        return Effect::GetProxy{&effect};
    }

} // namespace

TEST_CASE("resolveStyle passes plain values through") {
    auto get = makeGet();

    CHECK(std::get<std::string>(StyleResolver::resolveStyle(AnyValue(std::string("red")), "", get)) == "red");
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(42.0), "", get)) == 42.0);
}

TEST_CASE("resolveStyle resolves var() with fallback") {
    auto get = makeGet();

    // ["fn", "var", "--missing", "red"] → unregistered variable → fallback
    AnyArray fnValue = {"fn", "var", "--missing", AnyValue(std::string("red"))};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<std::string>(resolved) == "red");
}

// –
// CSS math functions — compiler emits ["fn", name, ...args] tuples
// –

TEST_CASE("min resolves to the smallest argument") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "min", AnyValue(1.0), AnyValue(2.0), AnyValue(0.5)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<double>(resolved) == 0.5);
}

TEST_CASE("max resolves to the largest argument") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "max", AnyValue(1.0), AnyValue(2.0)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<double>(resolved) == 2.0);
}

TEST_CASE("sum adds two values") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "sum", AnyValue(10.0), AnyValue(5.5)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<double>(resolved) == 15.5);
}

TEST_CASE("product multiplies two values") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "product", AnyValue(4.0), AnyValue(2.5)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<double>(resolved) == 10.0);
}

TEST_CASE("nested fns resolve recursively") {
    auto get = makeGet();

    // min(sum(10, 5), 20) → 15
    AnyArray sum = {"fn", "sum", AnyValue(10.0), AnyValue(5.0)};
    AnyArray fnValue = {"fn", "min", AnyValue(std::move(sum)), AnyValue(20.0)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<double>(resolved) == 15.0);
}

TEST_CASE("clamp clamps between min and max") {
    auto get = makeGet();

    AnyArray over = {"fn", "clamp", AnyValue(0.0), AnyValue(50.0), AnyValue(100.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(over), "", get)) == 50.0);

    AnyArray under = {"fn", "clamp", AnyValue(10.0), AnyValue(5.0), AnyValue(100.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(under), "", get)) == 10.0);
}

TEST_CASE("percent strings stay percent and refuse invalid mixing") {
    auto get = makeGet();

    // sum("50%", "25%") → "75%"
    AnyArray pcts = {"fn", "sum", AnyValue(std::string("50%")),
                     AnyValue(std::string("25%"))};
    CHECK(std::get<std::string>(StyleResolver::resolveStyle(AnyValue(std::move(pcts)), "", get)) ==
          "75%");

    // sum(10, "25%") → mixed → monostate (declaration dropped)
    AnyArray mixed = {"fn", "sum", AnyValue(10.0), AnyValue(std::string("25%"))};
    CHECK(std::holds_alternative<std::monostate>(
            StyleResolver::resolveStyle(AnyValue(std::move(mixed)), "", get)));
}

TEST_CASE("round supports all four strategies") {
    auto get = makeGet();

    // round(nearest, 13, 5) → 15
    AnyArray nearest = {"fn", "round", AnyValue(std::string("nearest")), AnyValue(13.0),
                        AnyValue(5.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(nearest)), "", get)) ==
          15.0);

    // round(down, 13, 5) → 10
    AnyArray down = {"fn", "round", AnyValue(std::string("down")), AnyValue(13.0),
                     AnyValue(5.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(down)), "", get)) ==
          10.0);

    // round(up, 13, 5) → 15
    AnyArray up = {"fn", "round", AnyValue(std::string("up")), AnyValue(13.0), AnyValue(5.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(up)), "", get)) == 15.0);

    // round(to-zero, -7, 5) → -5
    AnyArray toZero = {"fn", "round", AnyValue(std::string("to-zero")), AnyValue(-7.0),
                       AnyValue(5.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(toZero)), "", get)) ==
          -5.0);
}

TEST_CASE("mod and rem follow CSS sign rules") {
    auto get = makeGet();

    // mod(-7, 3) → 2 (sign of divisor)
    AnyArray mod = {"fn", "mod", AnyValue(-7.0), AnyValue(3.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(mod)), "", get)) == 2.0);

    // rem(-7, 3) → -1 (sign of dividend)
    AnyArray rem = {"fn", "rem", AnyValue(-7.0), AnyValue(3.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(rem)), "", get)) == -1.0);
}

TEST_CASE("abs and sign") {
    auto get = makeGet();

    AnyArray abs = {"fn", "abs", AnyValue(-3.5)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(abs)), "", get)) == 3.5);

    AnyArray sign = {"fn", "sign", AnyValue(-3.5)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(sign)), "", get)) ==
          -1.0);
}

TEST_CASE("division by zero in round yields monostate") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "round", AnyValue(std::string("nearest")), AnyValue(10.0),
                        AnyValue(0.0)};
    CHECK(std::holds_alternative<std::monostate>(
            StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get)));
}

TEST_CASE("end-to-end: compiler calc tuple resolves against registered variable") {
    auto get = makeGet();

    // calc(var(--a) - 10px) compiles to this tuple (see css-functions compiler test)
    AnyArray tuple = {
            "fn", "calc",
            AnyValue(AnyArray{
                    "fn", "sum",
                    AnyValue(AnyArray{"fn", "var", "a"}),
                    AnyValue(AnyArray{"fn", "product", -1, 10.0}),
            })};

    // Unregistered variable → monostate → declaration dropped
    CHECK(std::holds_alternative<std::monostate>(
            StyleResolver::resolveStyle(AnyValue(std::move(tuple)), "root", get)));

    // Registered variable → resolves to 40 (50 - 10)
    VariableContext::setVariable("root", "a", AnyValue(50.0));
    AnyArray tuple2 = {
            "fn", "calc",
            AnyValue(AnyArray{
                    "fn", "sum",
                    AnyValue(AnyArray{"fn", "var", "a"}),
                    AnyValue(AnyArray{"fn", "product", -1, 10.0}),
            })};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(tuple2)), "root", get);

    CHECK(std::get<double>(resolved) == 40.0);
}

TEST_CASE("divide") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "divide", AnyValue(10.0), AnyValue(4.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get)) ==
          2.5);

    // division by zero → monostate
    AnyArray zero = {"fn", "divide", AnyValue(10.0), AnyValue(0.0)};
    CHECK(std::holds_alternative<std::monostate>(
            StyleResolver::resolveStyle(AnyValue(std::move(zero)), "", get)));
}

TEST_CASE("applyStyleMapping aggregates transform props into a transform array") {
    auto get = makeGet();

    std::unordered_map<std::string, AnyValue> input;
    input["translateX"] = AnyValue(std::string("10px"));
    input["rotate"] = AnyValue(std::string("45deg"));

    auto style = StyleResolver::applyStyleMapping(input, "", get, false);

    REQUIRE(style->contains("transform"));
    auto transform = style->getArray("transform");
    CHECK(transform.size() == 2);
    // Order is map-dependent; just verify both props landed as objects in the array
    bool hasTranslateX = false;
    bool hasRotate = false;
    for (const auto &entry: transform) {
        if (std::holds_alternative<AnyObject>(entry)) {
            const auto &obj = std::get<AnyObject>(entry);
            hasTranslateX = hasTranslateX || obj.count("translateX") > 0;
            hasRotate = hasRotate || obj.count("rotate") > 0;
        }
    }
    CHECK(hasTranslateX);
    CHECK(hasRotate);
    CHECK_FALSE(style->contains("translateX"));
}

TEST_CASE("applyStyleMapping passes non-transform props through") {
    auto get = makeGet();

    std::unordered_map<std::string, AnyValue> input;
    input["color"] = AnyValue(std::string("#f00"));
    input["opacity"] = AnyValue(0.5);

    auto style = StyleResolver::applyStyleMapping(input, "", get, false);

    CHECK(style->getString("color") == "#f00");
    CHECK(style->getDouble("opacity") == 0.5);
    CHECK_FALSE(style->contains("transform"));
}
