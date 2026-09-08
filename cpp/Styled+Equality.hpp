#pragma once

#include "Styled.hpp"

#include <NitroModules/AnyMap.hpp>

namespace margelo::nitro::cssnitro {

    // Deep equality on the resolved outputs — recomputes that produce an
    // identical result skip the React rerender / shadow write entirely
    inline bool mapsEqual(const std::optional<std::shared_ptr<AnyMap>> &a,
                          const std::optional<std::shared_ptr<AnyMap>> &b) {
        const auto &mapA = a.has_value() ? a.value()->getMap()
                                         : std::unordered_map<std::string, AnyValue>{};
        const auto &mapB = b.has_value() ? b.value()->getMap()
                                         : std::unordered_map<std::string, AnyValue>{};
        if (mapA.size() != mapB.size()) {
            return false;
        }
        for (const auto &kv: mapA) {
            auto it = mapB.find(kv.first);
            if (it == mapB.end() || !(kv.second == it->second)) {
                return false;
            }
        }
        return true;
    }

    inline bool operator==(const Styled &lhs, const Styled &rhs) {
        return mapsEqual(lhs.style, rhs.style) &&
               mapsEqual(lhs.importantStyle, rhs.importantStyle) &&
               mapsEqual(lhs.props, rhs.props) &&
               mapsEqual(lhs.importantProps, rhs.importantProps);
    }
} // namespace margelo::nitro::cssnitro
