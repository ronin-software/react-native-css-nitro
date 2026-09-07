//
// Created on October 15, 2025.
//

#include "StyleFunction.hpp"
#include "VariableContext.hpp"
#include "Environment.hpp"
#include <NitroModules/AnyMap.hpp>

#include <cmath>
    #include <cstdio>
#include <optional>

namespace margelo::nitro::cssnitro {

    // –
    // Calc
    // –
    // The compiler flattens CSS math functions into `["fn", name, ...args]`
    // tuples (see `calcArguments` in the compiler). Values inside those tuples
    // are plain numbers, "N%" percent strings, or nested fn tuples. Unit
    // tuples (vw/em/…) are not resolvable here and yield monostate, dropping
    // the declaration — same as upstream's JS runtime returning undefined.

    namespace calc {

        struct Value {
            double value;
            bool isPercent;
        };

        double round4(double v) {
            return std::round((v + 1e-9) * 10000) / 10000;
        }

        double round2(double v) {
            return std::round((v + 1e-9) * 100) / 100;
        }

        std::optional<Value> parse(const AnyValue &v) {
            if (std::holds_alternative<double>(v)) {
                return Value{std::get<double>(v), false};
            }
            if (std::holds_alternative<int64_t>(v)) {
                return Value{static_cast<double>(std::get<int64_t>(v)), false};
            }
            if (std::holds_alternative<std::string>(v)) {
                const std::string &s = std::get<std::string>(v);
                if (!s.empty() && s.back() == '%') {
                    try {
                        double pct = std::stod(s.substr(0, s.size() - 1));
                        return Value{pct / 100, true};
                    } catch (const std::exception &) {
                        return std::nullopt;
                    }
                }
                return std::nullopt;
            }
            return std::nullopt;
        }

        AnyValue toAny(const std::optional<Value> &v) {
            if (!v.has_value()) {
                return AnyValue();
            }
            char buf[32];
            std::snprintf(buf, sizeof(buf), "%.10g", round4(v->value * 100));
            if (v->isPercent) {
                return AnyValue(std::string(buf) + "%");
            }
            return AnyValue(round4(v->value));
        }

    } // namespace calc

    namespace {

        using calc::Value;

        // Resolve a single fn argument that may itself be a var() or nested fn
        AnyValue resolveStyleValueArg(const AnyValue &value,
                                      reactnativecss::Effect::GetProxy &get,
                                      const std::string &variableScope) {
            if (std::holds_alternative<AnyArray>(value)) {
                return StyleFunction::resolveStyleFn(std::get<AnyArray>(value), get,
                                                     variableScope);
            }
            return value;
        }

        std::optional<Value> calcArg(const AnyValue &v,
                                     reactnativecss::Effect::GetProxy &get,
                                     const std::string &variableScope);

        // Resolve fn args to calc values; nested fn tuples recurse
        std::optional<Value> calcArg(const AnyValue &v,
                                     reactnativecss::Effect::GetProxy &get,
                                     const std::string &variableScope) {
            if (std::holds_alternative<AnyArray>(v)) {
                AnyValue resolved = StyleFunction::resolveStyleFn(
                        std::get<AnyArray>(v), get, variableScope);
                if (std::holds_alternative<std::monostate>(resolved)) {
                    return std::nullopt;
                }
                return calc::parse(resolved);
            }
            return calc::parse(v);
        }

        // All-or-nothing: same percent-ness required unless allowMixed
        std::optional<std::vector<Value>> calcArgs(const AnyArray &fnArgs, size_t begin,
                                                   reactnativecss::Effect::GetProxy &get,
                                                   const std::string &variableScope,
                                                   bool allowMixed = false) {
            std::vector<Value> out;
            bool hasPercent = false;
            bool hasPlain = false;
            for (size_t i = begin; i < fnArgs.size(); i++) {
                auto v = calcArg(fnArgs[i], get, variableScope);
                if (!v.has_value()) {
                    return std::nullopt;
                }
                v->isPercent ? hasPercent = true : hasPlain = true;
                out.push_back(*v);
            }
            if (hasPercent && hasPlain && !allowMixed) {
                return std::nullopt;
            }
            return out;
        }

        // ["fn", "round", strategy, a, b]
        std::optional<Value> roundFn(const AnyArray &fnArgs,
                                     reactnativecss::Effect::GetProxy &get,
                                     const std::string &variableScope) {
            if (fnArgs.size() != 5 || !std::holds_alternative<std::string>(fnArgs[2])) {
                return std::nullopt;
            }
            auto args = calcArgs(fnArgs, 3, get, variableScope);
            if (!args.has_value() || args->size() != 2 || (*args)[1].value == 0) {
                return std::nullopt;
            }
            double a = (*args)[0].value;
            double b = (*args)[1].value;
            double q = a / b;
            const std::string &strategy = std::get<std::string>(fnArgs[2]);
            double result;
            if (strategy == "nearest") {
                q = std::floor(q + 0.5); // ties toward +∞ per CSS spec
            } else if (strategy == "up") {
                q = std::ceil(q);
            } else if (strategy == "down") {
                q = std::floor(q);
            } else if (strategy == "to-zero") {
                q = std::trunc(q);
            } else {
                return std::nullopt;
            }
            result = q * b;
            return Value{result, (*args)[0].isPercent};
        }

    } // namespace

    AnyValue StyleFunction::resolveStyleFn(
            const AnyArray &fnArgs,
            typename reactnativecss::Effect::GetProxy &get,
            const std::string &variableScope
    ) {
        if (fnArgs.size() < 2 ||
            !std::holds_alternative<std::string>(fnArgs[0]) ||
            std::get<std::string>(fnArgs[0]) != "fn" ||
            !std::holds_alternative<std::string>(fnArgs[1])) {
            return AnyValue();
        }

        const std::string &name = std::get<std::string>(fnArgs[1]);

        // var: ["fn", "var", name, fallback?]
        if (name == "var") {
            if (fnArgs.size() < 3 || !std::holds_alternative<std::string>(fnArgs[2])) {
                return AnyValue();
            }
            const std::string &varName = std::get<std::string>(fnArgs[2]);
            AnyValue fallback;
            if (fnArgs.size() >= 4) {
                fallback = fnArgs[3];
            }
            return resolveVar(varName, fallback, get, variableScope);
        }

        // calc/identity: ["fn", "calc", value] — the expression is already
        // flattened into sum/product trees by the compiler
        if (name == "calc") {
            if (fnArgs.size() != 3) {
                return AnyValue();
            }
            const AnyValue &value = fnArgs[2];
            if (std::holds_alternative<AnyArray>(value)) {
                return resolveStyleFn(std::get<AnyArray>(value), get, variableScope);
            }
            return value;
        }

        // Platform/display metrics, mirroring upstream's runtime resolvers
        // (hairlineWidth ≈ StyleSheet.hairlineWidth, pixelScale ≈ PixelRatio.get())
        if (name == "hairlineWidth" && fnArgs.size() >= 2) {
            double scale = get(reactnativecss::env::windowScale());
            return AnyValue(scale > 0 ? calc::round2(1 / scale) : 1.0);
        }
        if (name == "pixelScale" && fnArgs.size() >= 2) {
            return AnyValue(get(reactnativecss::env::windowScale()));
        }
        if (name == "fontScale" && fnArgs.size() >= 2) {
            return AnyValue(get(reactnativecss::env::windowFontScale()));
        }
        if (name == "getPixelSizeForLayoutSize" && fnArgs.size() == 3) {
            auto size = calc::parse(resolveStyleValueArg(fnArgs[2], get, variableScope));
            if (size.has_value() && !size->isPercent) {
                return AnyValue(calc::round2(size->value * get(reactnativecss::env::windowScale())));
            }
            return AnyValue();
        }
        if (name == "roundToNearestPixel" && fnArgs.size() == 3) {
            auto size = calc::parse(resolveStyleValueArg(fnArgs[2], get, variableScope));
            if (size.has_value() && !size->isPercent) {
                double scale = get(reactnativecss::env::windowScale());
                if (scale <= 0) {
                    return AnyValue();
                }
                return AnyValue(calc::round2(std::round(size->value * scale) / scale));
            }
            return AnyValue();
        }

        std::optional<Value> result;

        if (name == "sum" && fnArgs.size() == 4) {
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                result = Value{calc::round4((*args)[0].value + (*args)[1].value),
                               (*args)[0].isPercent};
            }
        } else if (name == "product" && fnArgs.size() == 4) {
            auto args = calcArgs(fnArgs, 2, get, variableScope, true);
            if (args.has_value() && !((*args)[0].isPercent && (*args)[1].isPercent)) {
                bool isPercent = (*args)[0].isPercent || (*args)[1].isPercent;
                // % / % → plain ratio, per upstream
                result = Value{calc::round4((*args)[0].value * (*args)[1].value),
                               isPercent};
            }
        } else if (name == "divide" && fnArgs.size() == 4) {
            auto args = calcArgs(fnArgs, 2, get, variableScope, true);
            if (args.has_value() && (*args)[1].value != 0) {
                bool isPercent = (*args)[0].isPercent; // % / % → plain ratio
                result = Value{calc::round4((*args)[0].value / (*args)[1].value),
                               isPercent};
            }
        } else if (name == "sign" && fnArgs.size() == 3) {
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                double v = (*args)[0].value;
                result = Value{v > 0 ? 1.0 : (v < 0 ? -1.0 : 0.0), false};
            }
        } else if (name == "abs" && fnArgs.size() == 3) {
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                result = Value{std::fabs((*args)[0].value), (*args)[0].isPercent};
            }
        } else if ((name == "min" || name == "max") && fnArgs.size() >= 4) {
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                double best = (*args)[0].value;
                for (size_t i = 1; i < args->size(); i++) {
                    best = name == "min" ? std::min(best, (*args)[i].value)
                                         : std::max(best, (*args)[i].value);
                }
                result = Value{best, (*args)[0].isPercent};
            }
        } else if (name == "clamp" && fnArgs.size() == 5) {
            // clamp(MIN, VAL, MAX) = max(MIN, min(VAL, MAX))
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                double v = std::max((*args)[0].value,
                                    std::min((*args)[1].value, (*args)[2].value));
                result = Value{v, (*args)[0].isPercent};
            }
        } else if (name == "hypot" && fnArgs.size() >= 4) {
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value()) {
                double sum = 0;
                for (const auto &arg: *args) {
                    sum += arg.value * arg.value;
                }
                result = Value{std::sqrt(sum), (*args)[0].isPercent};
            }
        } else if (name == "mod" && fnArgs.size() == 4) {
            // mod(a, b): result takes the sign of the divisor
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value() && (*args)[1].value != 0) {
                double a = (*args)[0].value;
                double b = (*args)[1].value;
                result = Value{a - b * std::floor(a / b), (*args)[0].isPercent};
            }
        } else if (name == "rem" && fnArgs.size() == 4) {
            // rem(a, b): result takes the sign of the dividend
            auto args = calcArgs(fnArgs, 2, get, variableScope);
            if (args.has_value() && (*args)[1].value != 0) {
                double a = (*args)[0].value;
                double b = (*args)[1].value;
                result = Value{std::fmod(a, b), (*args)[0].isPercent};
            }
        } else if (name == "round") {
            result = roundFn(fnArgs, get, variableScope);
        }

        return calc::toAny(result);
    }

    AnyValue StyleFunction::resolveVar(
            const std::string &name,
            const AnyValue &fallback,
            typename reactnativecss::Effect::GetProxy &get,
            const std::string &variableScope
    ) {
        auto result = VariableContext::getVariable(variableScope, name, get);

        if (result.has_value()) {
            return result.value();
        }

        return resolveAnyValue(fallback, get, variableScope);
    }

    AnyValue StyleFunction::resolveAnyValue(
            const AnyValue &value,
            typename reactnativecss::Effect::GetProxy &get,
            const std::string &variableScope
    ) {
        // Check if value is an array
        if (std::holds_alternative<AnyArray>(value)) {
            const auto &arr = std::get<AnyArray>(value);
            return resolveStyleFn(arr, get, variableScope);
        }

        // Return the value as-is if it's not an array
        return value;
    }

} // namespace margelo::nitro::cssnitro
