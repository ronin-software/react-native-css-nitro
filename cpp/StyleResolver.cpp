//
// Created on October 19, 2025.
//

#include "StyleResolver.hpp"
#include "StyleFunction.hpp"
#include "Animations.hpp"
#include "Environment.hpp"
#include "VariableContext.hpp"
#include <cmath>
#include <variant>
#include <unordered_set>

namespace margelo::nitro::cssnitro {

    using AnyObject = ::margelo::nitro::AnyObject;

    AnyValue StyleResolver::resolveStyle(
            const AnyValue &value,
            const std::string &variableScope,
            typename reactnativecss::Effect::GetProxy &get
    ) {
        // Check if value is an array
        if (std::holds_alternative<AnyArray>(value)) {
            const auto &arr = std::get<AnyArray>(value);

            // ["fn", name, ...args] — math/var functions
            if (!arr.empty() &&
                std::holds_alternative<std::string>(arr[0]) &&
                std::get<std::string>(arr[0]) == "fn") {

                // Resolve the function
                return StyleFunction::resolveStyleFn(arr, get, variableScope);
            }

            // [{}, kind, ...args] — marker tuples emitted by the compiler for
            // var() references (e.g. currentcolor) and relative units.
            // Unknown markers (e.g. animation "steps") pass through untouched.
            if (arr.size() >= 3 &&
                std::holds_alternative<AnyObject>(arr[0]) &&
                std::holds_alternative<std::string>(arr[1])) {
                const std::string &kind = std::get<std::string>(arr[1]);
                if (kind == "var" || kind == "vw" || kind == "vh" ||
                    kind == "em" || kind == "rem") {
                    return resolveMarkerTuple(arr, variableScope, get);
                }
            }

            // The compiler wraps single function/marker values in a one-element
            // list (e.g. [["fn", "hairlineWidth"]]) — unwrap and resolve
            if (arr.size() == 1 && std::holds_alternative<AnyArray>(arr[0])) {
                const auto &inner = std::get<AnyArray>(arr[0]);
                bool isFn = !inner.empty() &&
                            std::holds_alternative<std::string>(inner[0]) &&
                            std::get<std::string>(inner[0]) == "fn";
                bool isMarker = inner.size() >= 3 &&
                                std::holds_alternative<AnyObject>(inner[0]) &&
                                std::holds_alternative<std::string>(inner[1]);
                if (isFn || isMarker) {
                    return resolveStyle(arr[0], variableScope, get);
                }
            }
        }

        // Otherwise return the value as-is
        return value;
    }

    AnyValue StyleResolver::resolveMarkerTuple(
            const AnyArray &arr,
            const std::string &variableScope,
            typename reactnativecss::Effect::GetProxy &get
    ) {
        const std::string &kind = std::get<std::string>(arr[1]);

        // [{}, "var", name, fallback?]
        if (kind == "var") {
            if (!std::holds_alternative<std::string>(arr[2])) {
                return AnyValue();
            }
            const std::string &name = std::get<std::string>(arr[2]);
            AnyValue fallback;
            if (arr.size() >= 4) {
                fallback = arr[3];
            }
            return StyleFunction::resolveVar(name, fallback, get, variableScope);
        }

        // Relative units: [{}, unit, value, flag?]
        return resolveUnit(kind, arr[2], variableScope, get);
    }

    AnyValue StyleResolver::resolveUnit(
            const std::string &unit,
            const AnyValue &valueArg,
            const std::string &variableScope,
            typename reactnativecss::Effect::GetProxy &get
    ) {
        // The value is a number; line-height emits it wrapped in an array
        double value = 0;
        if (std::holds_alternative<double>(valueArg)) {
            value = std::get<double>(valueArg);
        } else if (std::holds_alternative<AnyArray>(valueArg) &&
                   std::get<AnyArray>(valueArg).size() == 1 &&
                   std::holds_alternative<double>(std::get<AnyArray>(valueArg)[0])) {
            value = std::get<double>(std::get<AnyArray>(valueArg)[0]);
        } else {
            return AnyValue();
        }

        double result = 0;

        if (unit == "vw") {
            result = get(reactnativecss::env::windowWidth()) * (value / 100);
        } else if (unit == "vh") {
            result = get(reactnativecss::env::windowHeight()) * (value / 100);
        } else {
            // em falls back to rem, matching upstream
            std::string varName = "__rn-css-" + unit;
            if (unit == "em") {
                auto em = VariableContext::getVariable(variableScope, "__rn-css-em", get);
                if (em.has_value() && std::holds_alternative<double>(em.value())) {
                    result = value * std::get<double>(em.value());
                    return AnyValue(round2(result));
                }
                varName = "__rn-css-rem";
            }
            auto rem = VariableContext::getVariable(variableScope, varName, get);
            if (rem.has_value() && std::holds_alternative<double>(rem.value())) {
                result = value * std::get<double>(rem.value());
            } else {
                return AnyValue();
            }
        }

        return AnyValue(round2(result));
    }

    double StyleResolver::round2(double v) {
        return std::round((v + 1e-9) * 100) / 100;
    }

    std::shared_ptr<AnyMap> StyleResolver::applyStyleMapping(
            const std::unordered_map<std::string, AnyValue> &inputMap,
            const std::string &variableScope,
            typename reactnativecss::Effect::GetProxy &get,
            bool processAnimations
    ) {
        static const std::unordered_set<std::string> transformProps = {
                "translateX", "translateY", "translateZ",
                "rotate", "rotateX", "rotateY", "rotateZ",
                "scaleX", "scaleY", "scaleZ",
                "skewX", "skewY",
                "perspective"
        };

        auto anyMap = AnyMap::make(inputMap.size());

        // Transform props are aggregated across the loop and written once,
        // because AnyMap::setArray uses emplace and silently no-ops on
        // an existing key
        AnyArray transformArray;

        for (const auto &kv: inputMap) {
            // Handle animationName property only if processAnimations is true
            if (processAnimations && kv.first == "animationName") {
                // animationName can be a string or a vector of strings
                if (std::holds_alternative<std::string>(kv.second)) {
                    // Single animation name
                    const std::string &animName = std::get<std::string>(kv.second);
                    auto keyframes = reactnativecss::animations::getKeyframes(animName,
                                                                              variableScope, get);

                    // Set animationName to the resolved keyframes object
                    anyMap->setObject("animationName", keyframes->getMap());
                } else if (std::holds_alternative<AnyArray>(kv.second)) {
                    // Array of animation names
                    const AnyArray &animNames = std::get<AnyArray>(kv.second);
                    AnyArray keyframesArray;

                    for (const auto &animNameValue: animNames) {
                        if (std::holds_alternative<std::string>(animNameValue)) {
                            const std::string &animName = std::get<std::string>(animNameValue);
                            auto keyframes = reactnativecss::animations::getKeyframes(animName,
                                                                                      variableScope,
                                                                                      get);
                            keyframesArray.push_back(keyframes->getMap());
                        }
                    }

                    // Set animationName to the array of resolved keyframes
                    anyMap->setArray("animationName", keyframesArray);
                } else {
                    // Invalid type for animationName, just pass through as-is
                    anyMap->setAny("animationName", kv.second);
                }
                continue;
            }

            // Handle transform properties
            if (transformProps.count(kv.first) > 0) {
                // Scale props take numeric factors in RN transforms; the
                // compiler emits CSS percentages ("50%") — convert here
                AnyValue value = kv.second;
                static const std::unordered_set<std::string> scaleProps = {
                        "scale", "scaleX", "scaleY", "scaleZ"};
                if (scaleProps.count(kv.first) > 0 &&
                    std::holds_alternative<std::string>(value)) {
                    const std::string &s = std::get<std::string>(value);
                    if (!s.empty() && s.back() == '%') {
                        value = AnyValue(std::atof(s.c_str()) / 100.0);
                    }
                }

                // Find the value in the array with the key matching kv.first and set it to kv.second
                bool foundTransform = false;
                for (size_t i = 0; i < transformArray.size(); i++) {
                    if (std::holds_alternative<AnyObject>(transformArray[i])) {
                        auto obj = std::get<AnyObject>(transformArray[i]);
                        if (obj.count(kv.first) > 0) {
                            obj[kv.first] = value;
                            transformArray[i] = obj;
                            foundTransform = true;
                            break;
                        }
                    }
                }

                // If transform property not found in array, add a new transform object
                if (!foundTransform) {
                    AnyObject transformObj;
                    transformObj[kv.first] = value;
                    transformArray.emplace_back(transformObj);
                }
                continue;
            }

            // For all other properties, just pass through as-is
            anyMap->setAny(kv.first, kv.second);
        }

        if (!transformArray.empty()) {
            anyMap->setArray("transform", transformArray);
        }

        return anyMap;
    }

} // namespace margelo::nitro::cssnitro
