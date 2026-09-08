#pragma once

#include <functional>
#include "AttributeQuery.hpp"
#include <memory>
#include <unordered_map>
#include <utility>
#include <type_traits>
#include <vector>
#include <string>
#include <optional>
#include <algorithm>
#include <cctype>
#include <cmath>

#include "Effect.hpp"
#include "HybridStyleRule.hpp"
#include "Environment.hpp"
#include "Helpers.hpp"
#include "PseudoClasses.hpp"
#include "ContainerContext.hpp"
#include <NitroModules/AnyMap.hpp>

namespace margelo::nitro::cssnitro {

    using AnyMap = ::margelo::nitro::AnyMap;
    using AnyArray = ::margelo::nitro::AnyArray;
    using AnyValue = ::margelo::nitro::AnyValue;

    class Rules {
    public:
        using ContainerAqEvaluator =
                std::function<bool(const AttributeQuery &)>;

        static bool testRule(const HybridStyleRule &rule, reactnativecss::Effect::GetProxy &get,
                             const std::string &componentId, const std::string &containerScope,
                             const std::vector<std::string> &validAttributeQueries,
                             const ContainerAqEvaluator &containerAqEvaluator = {});

        /** Port of native/attributeQuery.ts — evaluates attribute queries
         * against a component's props (className/disabled/dataSet) */
        static bool testAttributeQuery(const AttributeQuery &query,
                                       const std::unordered_map<std::string, AnyValue> &props);

        static bool
        testVariableMedia(const std::shared_ptr<AnyMap> &mediaMap,
                          reactnativecss::Effect::GetProxy &get);

    private:
        static bool
        testPseudoClasses(const PseudoClass &pseudoClass, const std::string &componentId,
                          reactnativecss::Effect::GetProxy &get);

        static bool testMediaMap(const AnyMap &mediaMap, reactnativecss::Effect::GetProxy &get);

        static bool
        testMediaQuery(const std::string &key, const std::string &op, const AnyValue &value,
                       reactnativecss::Effect::GetProxy &get);

        static bool testContainerQueries(const std::vector<HybridContainerQuery> &containerQueries,
                                         reactnativecss::Effect::GetProxy &get,
                                         const std::string &containerScope);

        static bool testContainerQuery(const HybridContainerQuery &containerQuery,
                                       reactnativecss::Effect::GetProxy &get,
                                       const std::string &containerScope);

        static bool testContainerMediaMap(const AnyMap &containerMediaMap,
                                          reactnativecss::Effect::GetProxy &get,
                                          const std::string &containerScope);

        static bool testContainerMediaQuery(const std::string &key, const std::string &op,
                                            const AnyValue &value,
                                            reactnativecss::Effect::GetProxy &get,
                                            const std::string &containerScope);
    };

} // namespace margelo::nitro::cssnitro

