#include <sstream>
#include <variant>

#include "Rules.hpp"
#include "Environment.hpp"
#include "Helpers.hpp"
#include "PseudoClasses.hpp"
#include "ContainerContext.hpp"

#include <utility>
#include <type_traits>
#include <algorithm>
#include <cctype>
#include <cmath>

namespace margelo::nitro::cssnitro {

    bool Rules::testRule(const HybridStyleRule &rule, reactnativecss::Effect::GetProxy &get,
                         const std::string &componentId, const std::string &containerScope,
                         const std::vector<std::string> &validAttributeQueries,
                         const ContainerAqEvaluator &containerAqEvaluator) {
        // Check attribute queries (rule.aq). The query may describe the
        // component's own attributes (validated JS-side and passed in via
        // validAttributeQueries) or its group container's (`.a.b .c` → the
        // child rule carries the container's query, evaluated here against
        // the container's published attributes)
        if (rule.aq.has_value()) {
            if (!rule.id.has_value()) {
                return false;
            }

            const std::string &ruleId = rule.id.value();

            const bool ownValid =
                    std::find(validAttributeQueries.begin(), validAttributeQueries.end(),
                              ruleId) != validAttributeQueries.end();
            if (!ownValid) {
                const bool isContainer = containerScope != componentId &&
                                         containerScope != "root";
                if (!isContainer || !containerAqEvaluator ||
                    !containerAqEvaluator(rule.aq.value())) {
                    return false;
                }
            }
        }

        // Check pseudo-classes (rule.pq)
        if (rule.pq.has_value()) {
            if (!testPseudoClasses(rule.pq.value(), componentId, get)) {
                return false;
            }
        }

        // Check media queries (rule.mq)
        if (rule.mq.has_value() && rule.mq.value()) {
            auto &mediaMap = *rule.mq.value();
            if (!testMediaMap(mediaMap, get)) {
                return false;
            }
        }

        // Check container queries (rule.cq)
        if (rule.cq.has_value()) {
            const auto &containerQueryMap = rule.cq.value();
            if (!testContainerQueries(containerQueryMap, get, containerScope)) {
                return false;
            }
        }

        return true;
    }

    bool Rules::testVariableMedia(const std::shared_ptr<AnyMap> &mediaMap,
                                  reactnativecss::Effect::GetProxy &get) {
        if (!mediaMap) {
            return true;
        }
        return testMediaMap(*mediaMap, get);
    }

    bool Rules::testPseudoClasses(const PseudoClass &pseudoClass, const std::string &componentId,
                                  reactnativecss::Effect::GetProxy &get) {
        // Check active state
        if (pseudoClass.a.has_value()) {
            bool expectedActive = pseudoClass.a.value();
            bool actualActive = PseudoClasses::get(componentId, PseudoClassType::ACTIVE, get);
            if (actualActive != expectedActive) {
                return false;
            }
        }

        // Check hover state
        if (pseudoClass.h.has_value()) {
            bool expectedHover = pseudoClass.h.value();
            bool actualHover = PseudoClasses::get(componentId, PseudoClassType::HOVER, get);
            if (actualHover != expectedHover) {
                return false;
            }
        }

        // Check focus state
        if (pseudoClass.f.has_value()) {
            bool expectedFocus = pseudoClass.f.value();
            bool actualFocus = PseudoClasses::get(componentId, PseudoClassType::FOCUS, get);
            if (actualFocus != expectedFocus) {
                return false;
            }
        }

        return true;
    }

    bool Rules::testMediaMap(const AnyMap &mediaMap, reactnativecss::Effect::GetProxy &get) {
        // Get all keys to check if empty
        auto keys = mediaMap.getAllKeys();
        if (keys.empty()) {
            return true;
        }

        // Check for $$op to determine logic mode
        std::string logicOp = "and"; // default is "and"
        bool negate = false;

        if (mediaMap.contains("$$op")) {
            if (mediaMap.isString("$$op")) {
                logicOp = mediaMap.getString("$$op");
                if (logicOp == "not") {
                    negate = true;
                    logicOp = "and"; // "not" just negates the result, logic is still "and"
                }
            }
        }

        // Track test results
        std::vector<bool> results;

        // Loop over all keys
        for (const auto &key: keys) {
            // Skip the $$op key
            if (key == "$$op") {
                continue;
            }

            // Nested logic conditions: {"and": [...]}, {"or": [...]}, {"not": {...}}
            if (key == "and" || key == "or" || key == "not") {
                if (mediaMap.isArray(key)) {
                    std::vector<bool> sub;
                    for (const auto &item: mediaMap.getArray(key)) {
                        if (std::holds_alternative<AnyObject>(item)) {
                            auto subMap = AnyMap::make();
                            for (const auto &kv: std::get<AnyObject>(item)) {
                                subMap->setAny(kv.first, kv.second);
                            }
                            sub.push_back(testMediaMap(*subMap, get));
                        }
                    }
                    bool subResult = key == "or"
                                         ? std::any_of(sub.begin(), sub.end(), [](bool b) { return b; })
                                         : std::all_of(sub.begin(), sub.end(), [](bool b) { return b; });
                    results.push_back(key == "not" ? !subResult : subResult);
                } else if (mediaMap.contains(key)) {
                    // "not" wraps a single condition object
                    const AnyObject &item = mediaMap.getObject(key);
                    auto subMap = AnyMap::make(item.size());
                    for (const auto &kv: item) {
                        subMap->setAny(kv.first, kv.second);
                    }
                    bool subResult = testMediaMap(*subMap, get);
                    results.push_back(key == "not" ? !subResult : subResult);
                }
                continue;
            }

            // Value should be an array with [operator, expectedValue]
            if (!mediaMap.isArray(key)) {
                continue;
            }

            AnyArray valueArray = mediaMap.getArray(key);
            if (valueArray.size() < 2) {
                continue;
            }

            // Extract operator and expected value
            std::string op;
            if (std::holds_alternative<std::string>(valueArray[0])) {
                op = std::get<std::string>(valueArray[0]);
            }

            bool testResult = testMediaQuery(key, op, valueArray[1], get);
            results.push_back(testResult);
        }

        // If no tests were run, return true
        if (results.empty()) {
            return true;
        }

        // Apply logic
        bool finalResult;
        if (logicOp == "or") {
            // "or" - at least one must pass
            finalResult = false;
            for (bool result: results) {
                if (result) {
                    finalResult = true;
                    break;
                }
            }
        } else {
            // "and" - all must pass (default)
            finalResult = true;
            for (bool result: results) {
                if (!result) {
                    finalResult = false;
                    break;
                }
            }
        }

        // Apply negation if needed
        if (negate) {
            finalResult = !finalResult;
        }

        return finalResult;
    }

    bool Rules::testMediaQuery(const std::string &key, const std::string &op, const AnyValue &value,
                               reactnativecss::Effect::GetProxy &get) {
        // String features
        if (op == "=") {
            if (key == "platform") {
                if (std::holds_alternative<std::string>(value)) {
                    return get(reactnativecss::env::platform()) ==
                           std::get<std::string>(value);
                }
                return false;
            }
            if (key == "prefers-color-scheme") {
                if (std::holds_alternative<std::string>(value)) {
                    return get(reactnativecss::env::colorScheme()) ==
                           std::get<std::string>(value);
                }
                return false;
            }
        }

        if (op == "=") {
            if (key == "min-width") {
                if (std::holds_alternative<double>(value)) {
                    double vw = get(reactnativecss::env::windowWidth());
                    return vw >= std::get<double>(value);
                }
                return false;
            }
            if (key == "max-width") {
                if (std::holds_alternative<double>(value)) {
                    double vw = get(reactnativecss::env::windowWidth());
                    return vw <= std::get<double>(value);
                }
                return false;
            }
            if (key == "min-height") {
                if (std::holds_alternative<double>(value)) {
                    double vh = get(reactnativecss::env::windowHeight());
                    return vh >= std::get<double>(value);
                }
                return false;
            }
            if (key == "max-height") {
                if (std::holds_alternative<double>(value)) {
                    double vh = get(reactnativecss::env::windowHeight());
                    return vh <= std::get<double>(value);
                }
                return false;
            }
            if (key == "orientation") {
                if (std::holds_alternative<std::string>(value)) {
                    std::string orientation = std::get<std::string>(value);
                    double vw = get(reactnativecss::env::windowWidth());
                    double vh = get(reactnativecss::env::windowHeight());
                    if (orientation == "landscape") {
                        return vh < vw;
                    } else {
                        return vh >= vw;
                    }
                }
                return false;
            }
        }

        // For other operators, value must be a number
        if (!std::holds_alternative<double>(value)) {
            return false;
        }

        double right = std::get<double>(value);
        double left = 0.0;

        // Determine left value based on key and fetch only what's needed
        if (key == "width") {
            left = get(reactnativecss::env::windowWidth());
        } else if (key == "height") {
            left = get(reactnativecss::env::windowHeight());
        } else if (key == "resolution") {
            // dppx == PixelRatio.get() == window scale
            left = get(reactnativecss::env::windowScale());
        } else {
            return false;
        }

        // Apply operator — the compiler emits gt/gte/lt/lte
        // (see mapMediaQueryOperator); accept the symbol forms too
        if (op == "=" || op == "eq") {
            return left == right;
        } else if (op == ">" || op == "gt") {
            return left > right;
        } else if (op == ">=" || op == "gte") {
            return left >= right;
        } else if (op == "<" || op == "lt") {
            return left < right;
        } else if (op == "<=" || op == "lte") {
            return left <= right;
        }

        return false;
    }

    bool Rules::testContainerQueries(const std::vector<HybridContainerQuery> &containerQueries,
                                     reactnativecss::Effect::GetProxy &get,
                                     const std::string &containerScope) {
        // Loop over all container queries and return false if any fail
        for (const auto &containerQuery: containerQueries) {
            if (!testContainerQuery(containerQuery, get, containerScope)) {
                return false;
            }
        }
        return true;
    }

    bool Rules::testContainerQuery(const HybridContainerQuery &containerQuery,
                                   reactnativecss::Effect::GetProxy &get,
                                   const std::string &containerScope) {
        std::optional<std::string> containerName = std::nullopt;

        // Access the 'n' field directly if it exists
        if (containerQuery.n.has_value()) {
            containerName = containerQuery.n.value();
        }

        // Resolve the actual container scope using findInScope
        auto resolvedScope = ContainerContext::findInScope(containerScope, containerName);

        // If we can't resolve the scope, the query fails
        if (!resolvedScope.has_value()) {
            return false;
        }

        // Test pseudo-classes if containerQuery.p is set
        if (containerQuery.p.has_value()) {
            if (!testPseudoClasses(containerQuery.p.value(), resolvedScope.value(), get)) {
                return false;
            }
        }

        // Only test media queries if containerQuery.m is set
        if (containerQuery.m.has_value()) {
            return testContainerMediaMap(*containerQuery.m.value(), get, resolvedScope.value());
        }

        // If no media queries, the container query passes
        return true;
    }

    bool Rules::testContainerMediaMap(const AnyMap &containerMediaMap,
                                      reactnativecss::Effect::GetProxy &get,
                                      const std::string &containerScope) {
        // Get all keys to check if empty
        auto keys = containerMediaMap.getAllKeys();
        if (keys.empty()) {
            return true;
        }

        // Check for $$op to determine logic mode
        std::string logicOp = "and"; // default is "and"
        bool negate = false;

        if (containerMediaMap.contains("$$op")) {
            if (containerMediaMap.isString("$$op")) {
                logicOp = containerMediaMap.getString("$$op");
                if (logicOp == "not") {
                    negate = true;
                    logicOp = "and"; // "not" just negates the result, logic is still "and"
                }
            }
        }

        // Track test results
        std::vector<bool> results;

        // Loop over all keys
        for (const auto &key: keys) {
            // Skip the $$op key
            if (key == "$$op") {
                continue;
            }

            // Value should be an array with [operator, expectedValue]
            if (!containerMediaMap.isArray(key)) {
                continue;
            }

            AnyArray valueArray = containerMediaMap.getArray(key);
            if (valueArray.size() < 2) {
                continue;
            }

            // Extract operator and expected value
            std::string op;
            if (std::holds_alternative<std::string>(valueArray[0])) {
                op = std::get<std::string>(valueArray[0]);
            }

            bool testResult = testContainerMediaQuery(key, op, valueArray[1], get, containerScope);
            results.push_back(testResult);
        }

        // If no tests were run, return true
        if (results.empty()) {
            return true;
        }

        // Apply logic
        bool finalResult;
        if (logicOp == "or") {
            // "or" - at least one must pass
            finalResult = false;
            for (bool result: results) {
                if (result) {
                    finalResult = true;
                    break;
                }
            }
        } else {
            // "and" - all must pass (default)
            finalResult = true;
            for (bool result: results) {
                if (!result) {
                    finalResult = false;
                    break;
                }
            }
        }

        // Apply negation if needed
        if (negate) {
            finalResult = !finalResult;
        }

        return finalResult;
    }

    bool Rules::testContainerMediaQuery(const std::string &key, const std::string &op,
                                        const AnyValue &value,
                                        reactnativecss::Effect::GetProxy &get,
                                        const std::string &containerScope) {
        // String features
        if (op == "=") {
            if (key == "platform") {
                if (std::holds_alternative<std::string>(value)) {
                    return get(reactnativecss::env::platform()) ==
                           std::get<std::string>(value);
                }
                return false;
            }
            if (key == "prefers-color-scheme") {
                if (std::holds_alternative<std::string>(value)) {
                    return get(reactnativecss::env::colorScheme()) ==
                           std::get<std::string>(value);
                }
                return false;
            }
        }

        if (op == "=") {
            if (key == "min-width") {
                if (std::holds_alternative<double>(value)) {
                    auto cw = ContainerContext::getWidth(containerScope, std::nullopt, get);
                    if (!cw.has_value()) return false;
                    return cw.value() >= std::get<double>(value);
                }
                return false;
            }
            if (key == "max-width") {
                if (std::holds_alternative<double>(value)) {
                    auto cw = ContainerContext::getWidth(containerScope, std::nullopt, get);
                    if (!cw.has_value()) return false;
                    return cw.value() <= std::get<double>(value);
                }
                return false;
            }
            if (key == "min-height") {
                if (std::holds_alternative<double>(value)) {
                    auto ch = ContainerContext::getHeight(containerScope, std::nullopt, get);
                    if (!ch.has_value()) return false;
                    return ch.value() >= std::get<double>(value);
                }
                return false;
            }
            if (key == "max-height") {
                if (std::holds_alternative<double>(value)) {
                    auto ch = ContainerContext::getHeight(containerScope, std::nullopt, get);
                    if (!ch.has_value()) return false;
                    return ch.value() <= std::get<double>(value);
                }
                return false;
            }
            if (key == "orientation") {
                if (std::holds_alternative<std::string>(value)) {
                    std::string orientation = std::get<std::string>(value);
                    auto cw = ContainerContext::getWidth(containerScope, std::nullopt, get);
                    auto ch = ContainerContext::getHeight(containerScope, std::nullopt, get);
                    if (!cw.has_value() || !ch.has_value()) return false;
                    if (orientation == "landscape") {
                        return ch.value() < cw.value();
                    } else {
                        return ch.value() >= cw.value();
                    }
                }
                return false;
            }
        }

        // For other operators, value must be a number
        if (!std::holds_alternative<double>(value)) {
            return false;
        }

        double right = std::get<double>(value);
        std::optional<double> leftOpt;

        // Determine left value based on key and fetch only what's needed
        if (key == "width") {
            leftOpt = ContainerContext::getWidth(containerScope, std::nullopt, get);
        } else if (key == "height") {
            leftOpt = ContainerContext::getHeight(containerScope, std::nullopt, get);
        } else {
            return false;
        }

        // Check if we got a value
        if (!leftOpt.has_value()) {
            return false;
        }

        double left = leftOpt.value();

        // Apply operator — the compiler emits gt/gte/lt/lte
        // (see mapMediaQueryOperator); accept the symbol forms too
        if (op == "=" || op == "eq") {
            return left == right;
        } else if (op == ">" || op == "gt") {
            return left > right;
        } else if (op == ">=" || op == "gte") {
            return left >= right;
        } else if (op == "<" || op == "lt") {
            return left < right;
        } else if (op == "<=" || op == "lte") {
            return left <= right;
        }

        return false;
    }

    bool Rules::testAttributeQuery(
            const AttributeQuery &query,
            const std::unordered_map<std::string, AnyValue> &props) {
        using RuleVariant = std::variant<
                std::tuple<AttrSelectorBooleanOperator, std::string>,
                std::tuple<AttrSelectorOperator, std::string,
                           std::variant<std::string, double>,
                           std::optional<AttrCaseFlag>>>;

        auto findValue = [&props](const std::string &key) -> std::optional<std::string> {
            auto it = props.find(key);
            if (it == props.end()) return std::nullopt;
            if (const auto *s = std::get_if<std::string>(&it->second)) return *s;
            if (const auto *d = std::get_if<double>(&it->second))
                return std::to_string(*d);
            if (const auto *b = std::get_if<bool>(&it->second))
                return *b ? "true" : "false";
            return std::nullopt;
        };

        auto testRule = [&](const RuleVariant &rule) -> bool {
            if (const auto *boolean =
                        std::get_if<std::tuple<AttrSelectorBooleanOperator, std::string>>(&rule)) {
                // present/absent
                const bool present =
                        std::get<0>(*boolean) == AttrSelectorBooleanOperator::PRESENT;
                auto v = findValue(std::get<1>(*boolean));
                return present ? (v.has_value() && !v->empty())
                               : (!v.has_value() || v->empty());
            }

            const auto &tuple = std::get<std::tuple<AttrSelectorOperator, std::string,
                                                    std::variant<std::string, double>,
                                                    std::optional<AttrCaseFlag>>>(rule);
            const auto op = std::get<0>(tuple);
            const std::string &key = std::get<1>(tuple);
            const auto &valueVariant = std::get<2>(tuple);

            std::string expected;
            if (const auto *s = std::get_if<std::string>(&valueVariant)) {
                expected = *s;
            } else if (const auto *d = std::get_if<double>(&valueVariant)) {
                expected = std::to_string(*d);
            }

            const auto &flagOpt = std::get<3>(tuple);
            std::optional<std::string> sourceValue = findValue(key);
            if (flagOpt.has_value() && sourceValue.has_value()) {
                std::string lowered = *sourceValue;
                std::transform(lowered.begin(), lowered.end(), lowered.begin(),
                               [](unsigned char c) { return std::tolower(c); });
                std::transform(expected.begin(), expected.end(), expected.begin(),
                               [](unsigned char c) { return std::tolower(c); });
                sourceValue = lowered;
            }
            const std::string actual = sourceValue.value_or("");

            switch (op) {
                case AttrSelectorOperator::PRESENT:
                    return sourceValue.has_value() && !actual.empty();
                case AttrSelectorOperator::ABSENT:
                    return !sourceValue.has_value() || actual.empty();
                case AttrSelectorOperator::EQ:
                    return actual == expected;
                case AttrSelectorOperator::TILDE: {
                    std::istringstream iss(actual);
                    std::string word;
                    while (iss >> word) {
                        if (word == expected) return true;
                    }
                    return false;
                }
                case AttrSelectorOperator::PIPE:
                    return actual.rfind(expected + "-", 0) == 0;
                case AttrSelectorOperator::CARAT:
                    return actual.rfind(expected, 0) == 0;
                case AttrSelectorOperator::DOLLAR:
                    return actual.size() >= expected.size() &&
                           actual.compare(actual.size() - expected.size(),
                                          expected.size(), expected) == 0;
                case AttrSelectorOperator::STAR:
                    return actual.find(expected) != std::string::npos;
            }
            return false;
        };

        auto testList = [&](const auto &rules) -> bool {
            for (const auto &rule: rules) {
                if (!testRule(rule)) return false;
            }
            return true;
        };

        if (query.a.has_value() && !testList(query.a.value())) {
            return false;
        }
        if (query.d.has_value() && !testList(query.d.value())) {
            return false;
        }
        return true;
}

} // namespace margelo::nitro::cssnitro
