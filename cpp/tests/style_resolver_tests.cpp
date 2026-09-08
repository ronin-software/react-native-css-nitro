// doctest-based tests for StyleResolver — the pure C++ style core
// (doctest main lives in computed_tests.cpp)
#include <doctest/doctest.h>

#include "../StyleResolver.hpp"
#include "../VariableContext.hpp"
#include "../Environment.hpp"

using namespace margelo::nitro;
using namespace margelo::nitro::cssnitro;
using reactnativecss::Effect;

namespace {

    // Root/universal variables are stored as [{v: value, m?: media}] arrays
    AnyValue rootVar(double value) {
        return AnyValue(AnyArray{AnyObject{{"v", AnyValue(value)}}});
    }

    AnyValue rootVar(const std::string &value) {
        return AnyValue(AnyArray{AnyObject{{"v", AnyValue(value)}}});
    }

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

// –
// Marker tuples: [{}, kind, ...args] — var() references and relative units
// –

TEST_CASE("marker var tuple resolves from the variable context") {
    auto get = makeGet();

    VariableContext::setTopLevelVariable("root", "--brand", rootVar("#f00"));

    AnyArray varTuple = {AnyObject {}, AnyValue(std::string("var")),
                         AnyValue(std::string("--brand"))};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(varTuple)), "root", get);

    CHECK(std::get<std::string>(resolved) == "#f00");
}

TEST_CASE("rem resolves against the __rn-css-rem root variable") {
    auto get = makeGet();

    VariableContext::setTopLevelVariable("root", "__rn-css-rem", rootVar(14.0));

    AnyArray remTuple = {AnyObject {}, AnyValue(std::string("rem")), AnyValue(2.0)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(remTuple)), "root", get);

    CHECK(std::get<double>(resolved) == 28.0);
}

TEST_CASE("em prefers __rn-css-em and falls back to rem") {
    auto get = makeGet();

    VariableContext::setTopLevelVariable("root", "__rn-css-rem", rootVar(14.0));

    AnyArray emTuple = {AnyObject {}, AnyValue(std::string("em")), AnyValue(2.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(emTuple), "root", get)) == 28.0);

    VariableContext::setTopLevelVariable("root", "__rn-css-em", rootVar(10.0));
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(emTuple), "root", get)) == 20.0);
}

TEST_CASE("em resolves the line-height array-wrapped variant") {
    auto get = makeGet();

    // Note: earlier test cases may have set __rn-css-em, so pin it here
    VariableContext::setTopLevelVariable("root", "__rn-css-em", rootVar(14.0));

    // line-height: 2 emits [{}, "em", [2], 1]
    AnyArray lhTuple = {AnyObject {}, AnyValue(std::string("em")),
                        AnyValue(AnyArray{AnyValue(2.0)}), AnyValue(1.0)};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(lhTuple)), "root", get);

    CHECK(std::get<double>(resolved) == 28.0);
}

TEST_CASE("vw/vh resolve against window dimensions reactively") {
    auto get = makeGet();

    reactnativecss::env::setWindowDimensions(400, 800, 2.0, 1.0);

    AnyArray vwTuple = {AnyObject {}, AnyValue(std::string("vw")), AnyValue(50.0),
                        AnyValue(1.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(vwTuple), "root", get)) == 200.0);

    AnyArray vhTuple = {AnyObject {}, AnyValue(std::string("vh")), AnyValue(100.0),
                        AnyValue(1.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(vhTuple), "root", get)) == 800.0);
}

TEST_CASE("unknown marker tuples pass through untouched") {
    auto get = makeGet();

    // animation timing steps() — not resolvable here
    AnyArray stepsTuple = {AnyObject {}, AnyValue(std::string("steps")),
                           AnyValue(AnyArray{AnyValue(3.0)})};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(stepsTuple)), "root", get);

    REQUIRE(std::holds_alternative<AnyArray>(resolved));
    CHECK(std::get<AnyArray>(resolved).size() == 3);
}

// –
// Platform/display functions
// –

TEST_CASE("pixelScale, fontScale and hairlineWidth read the environment") {
    auto get = makeGet();

    reactnativecss::env::setWindowDimensions(400, 800, 2.0, 1.5);

    AnyArray scale = {"fn", "pixelScale"};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(scale)), "", get)) ==
          2.0);

    AnyArray fontScale = {"fn", "fontScale"};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(fontScale)), "", get)) ==
          1.5);

    AnyArray hairline = {"fn", "hairlineWidth"};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(hairline)), "", get)) ==
          0.5);
}

TEST_CASE("list-wrapped fn values are unwrapped before resolution") {
    auto get = makeGet();

    reactnativecss::env::setWindowDimensions(400, 800, 2.0, 1.0);

    // declarations store single fn values as [["fn", ...]]
    AnyArray wrapped = {AnyValue(AnyArray{"fn", "hairlineWidth"})};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(wrapped)), "", get);

    CHECK(std::get<double>(resolved) == 0.5);
}

TEST_CASE("getPixelSizeForLayoutSize and roundToNearestPixel use the scale") {
    auto get = makeGet();

    reactnativecss::env::setWindowDimensions(400, 800, 2.0, 1.0);

    AnyArray size = {"fn", "getPixelSizeForLayoutSize", AnyValue(10.0)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(size)), "", get)) ==
          20.0);

    // roundToNearestPixel(10.4) at scale 2 → 10.5 (10.4 * 2 = 20.8 → 21 → 10.5)
    AnyArray rounded = {"fn", "roundToNearestPixel", AnyValue(10.4)};
    CHECK(std::get<double>(StyleResolver::resolveStyle(AnyValue(std::move(rounded)), "", get)) ==
          10.5);
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

TEST_CASE("component-scope v-rules still resolve root-level vars") {
    // Device regression: a tailwind rule like .text-green-500 carries BOTH a
    // declaration referencing var(--color-green-500) AND a v block (inline
    // variable). The v block flips the component's variable scope to the
    // component id — the var must still resolve from the root scope.
    auto get = makeGet();

    VariableContext::setTopLevelVariable(
        "root", "color-green-500",
        AnyValue(AnyArray{AnyObject{{"v", AnyValue(AnyArray{"#00c758"})}}}));

    AnyArray fnValue = {"fn", "var", AnyValue(std::string("color-green-500"))};
    AnyValue resolved = StyleResolver::resolveStyle(
        AnyValue(std::move(fnValue)), "component-1", get);

    // Resolves to the hex string, which downstream processColor handles
    CHECK(std::get<std::string>(resolved) == "#00c758");
}

// –
// drop-shadow from runtime variables
// –

TEST_CASE("dropShadow resolves var holding whitespace-separated tokens") {
    auto get = makeGet();

    // tailwind pattern: --my-shadow: 0 4px 6px #000; filter: drop-shadow(var(--my-shadow))
    VariableContext::setTopLevelVariable(
        "root", "my-shadow",
        AnyValue(AnyArray{AnyValue(AnyObject{
            {"v", AnyValue(AnyArray{
                AnyValue(0.0), AnyValue(4.0), AnyValue(6.0),
                AnyValue(std::string("#000")),
            })},
        })}));

    // Compiler flattens nested fns: ["fn","dropShadow","fn","var","my-shadow"]
    AnyArray fnValue = {"fn", "dropShadow", AnyValue(std::string("fn")),
                        AnyValue(std::string("var")), AnyValue(std::string("my-shadow"))};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    fprintf(stderr, "DBG index=%zu\n", resolved.index());
    auto filter = std::get<AnyArray>(resolved);
    REQUIRE(filter.size() == 1);
    fprintf(stderr, "DBG f0=%zu\n", filter[0].index());
    auto shadow = std::get<AnyObject>(filter[0]);
    fprintf(stderr, "DBG shadow keys=%zu\n", shadow.size());
    auto innerV = shadow["dropShadow"];
    fprintf(stderr, "DBG inner=%zu\n", innerV.index());
    auto inner = std::get<AnyObject>(innerV);
    CHECK(std::get<double>(inner["offsetX"]) == 0.0);
    CHECK(std::get<double>(inner["offsetY"]) == 4.0);
    CHECK(std::get<double>(inner["standardDeviation"]) == 6.0);
    CHECK(std::get<std::string>(inner["color"]) == "#000");
}

TEST_CASE("dropShadow with missing blur defaults to 0 and omits color") {
    auto get = makeGet();

    AnyArray fnValue = {"fn", "dropShadow", AnyValue(AnyArray{
        AnyValue(2.0), AnyValue(3.0),
    })};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    auto filter = std::get<AnyArray>(resolved);
    auto inner = std::get<AnyObject>(std::get<AnyObject>(filter[0])["dropShadow"]);
    CHECK(std::get<double>(inner["offsetX"]) == 2.0);
    CHECK(std::get<double>(inner["offsetY"]) == 3.0);
    CHECK(std::get<double>(inner["standardDeviation"]) == 0.0);
    CHECK(inner.find("color") == inner.end());
}

TEST_CASE("textShadow resolves var holding tokens with trailing color") {
    auto get = makeGet();

    // --my-shadow: 1px 1px 2px #000; text-shadow: var(--my-shadow)
    VariableContext::setTopLevelVariable(
        "root", "my-shadow",
        AnyValue(AnyArray{AnyValue(AnyObject{
            {"v", AnyValue(AnyArray{
                AnyValue(1.0), AnyValue(1.0), AnyValue(2.0),
                AnyValue(std::string("#000")),
            })},
        })}));

    // Compiler emits the nested form: ["fn","textShadow",["fn","var","my-shadow"]]
    AnyArray fnValue = {"fn", "textShadow",
                        AnyValue(AnyArray{"fn", AnyValue(std::string("var")),
                                          AnyValue(std::string("my-shadow"))})};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    auto shadow = std::get<AnyObject>(resolved);
    auto offset = std::get<AnyObject>(shadow["textShadowOffset"]);
    CHECK(std::get<std::string>(shadow["textShadowColor"]) == "#000");
    CHECK(std::get<double>(offset["width"]) == 1.0);
    CHECK(std::get<double>(offset["height"]) == 1.0);
    CHECK(std::get<double>(shadow["textShadowRadius"]) == 2.0);
}

TEST_CASE("textShadow with no color defaults to the platform label color") {
    auto get = makeGet();

    // --my-var: 10px 10px; text-shadow: var(--my-var)
    VariableContext::setTopLevelVariable(
        "root", "my-var",
        AnyValue(AnyArray{AnyValue(AnyObject{
            {"v", AnyValue(AnyArray{AnyValue(10.0), AnyValue(10.0)})},
        })}));

    VariableContext::setTopLevelVariable(
        "root", "__rn-css-color",
        AnyValue(AnyArray{AnyValue(AnyObject{
            {"v", AnyValue(AnyObject{{"semantic",
                                      AnyValue(AnyArray{AnyValue(std::string("label")),
                                                       AnyValue(std::string("labelColor"))})}})},
        })}));

    AnyArray fnValue = {"fn", "textShadow",
                        AnyValue(AnyArray{"fn", AnyValue(std::string("var")),
                                          AnyValue(std::string("my-var"))})};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    auto shadow = std::get<AnyObject>(resolved);
    auto color = std::get<AnyObject>(shadow["textShadowColor"]);
    CHECK(color.count("semantic") == 1);
    CHECK(std::get<double>(std::get<AnyObject>(shadow["textShadowOffset"])["width"]) == 10.0);
}

TEST_CASE("colorMix with transparent right applies the percentage as alpha") {
    auto get = makeGet();

    // bg-red-500/50 → color-mix(in oklab, var(--bg) 50%, transparent)
    // The compiler folds the transparent side into the 3-arg form
    VariableContext::setTopLevelVariable(
        "root", "bg",
        AnyValue(AnyArray{AnyValue(AnyObject{
            {"v", AnyValue(AnyArray{AnyValue(std::string("#e7000b"))})},
        })}));

    AnyArray fnValue = {
        "fn", AnyValue(std::string("colorMix")), AnyValue(std::string("oklab")),
        AnyValue(AnyArray{"fn", AnyValue(std::string("var")), AnyValue(std::string("bg"))}),
        AnyValue(std::string("50%"))};
    AnyValue resolved = StyleResolver::resolveStyle(AnyValue(std::move(fnValue)), "", get);

    CHECK(std::get<std::string>(resolved) == "rgba(231, 0, 11, 0.5)");
}
