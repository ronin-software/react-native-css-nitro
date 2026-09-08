///
/// ContainerContext.cpp
/// Container context management for layout tracking
///

#include "ContainerContext.hpp"

namespace margelo::nitro::cssnitro {

    // Static member initialization
    std::unordered_map<std::string, LayoutBounds> ContainerContext::_layoutMap;
    std::unordered_map<std::string, ScopeHierarchy> ContainerContext::_scopeMap;
    std::shared_ptr<reactnativecss::Observable<double>>
        ContainerContext::_scopeVersion =
            reactnativecss::Observable<double>::create(0.0);

    std::optional<std::string> ContainerContext::findInScope(const std::string &containerScope,
                                                             const std::optional<std::string> &name) {
        // If no name provided, return the container scope directly
        if (!name.has_value()) {
            return containerScope;
        }

        // Check if the scope exists
        auto scopeIt = _scopeMap.find(containerScope);
        if (scopeIt == _scopeMap.end()) {
            return std::nullopt;
        }

        const ScopeHierarchy &hierarchy = scopeIt->second;

        // Check if name exists in current scope
        if (hierarchy.names.find(name.value()) != hierarchy.names.end()) {
            return containerScope;
        }

        // If not found and parent is not "root", check parent scope
        if (!hierarchy.parent.empty() && hierarchy.parent != "root") {
            return findInScope(hierarchy.parent, name);
        }

        // Not found and we've reached root
        return std::nullopt;
    }

    void ContainerContext::setScope(const std::string &containerScope,
                                    const std::string &parent,
                                    const std::unordered_set<std::string> &names) {
        _scopeMap[containerScope] = ScopeHierarchy(parent, names);
        // Wake every effect with a pending (failed) container-query resolution
        _scopeVersion->set(_scopeVersion->get() + 1.0);
    }

    std::optional<double> ContainerContext::getX(const std::string &containerScope,
                                                 const std::optional<std::string> &name,
                                                 reactnativecss::Effect::GetProxy &get) {
        auto foundKey = findInScope(containerScope, name);
        if (!foundKey.has_value()) {
            return std::nullopt;
        }

        // Get layout bounds
        auto it = _layoutMap.find(foundKey.value());
        if (it == _layoutMap.end()) {
            return std::nullopt;
        }

        // Track the observable through the proxy
        return get(*it->second.x);
    }

    std::optional<double> ContainerContext::getY(const std::string &containerScope,
                                                 const std::optional<std::string> &name,
                                                 reactnativecss::Effect::GetProxy &get) {
        auto foundKey = findInScope(containerScope, name);
        if (!foundKey.has_value()) {
            return std::nullopt;
        }

        auto it = _layoutMap.find(foundKey.value());
        if (it == _layoutMap.end()) {
            return std::nullopt;
        }

        return get(*it->second.y);
    }

    std::optional<double> ContainerContext::getWidth(const std::string &containerScope,
                                                     const std::optional<std::string> &name,
                                                     reactnativecss::Effect::GetProxy &get) {
        auto foundKey = findInScope(containerScope, name);
        if (!foundKey.has_value()) {
            return std::nullopt;
        }

        // operator[] creates the bounds (0.0 defaults) so the first resolve
        // — before any layout event — still subscribes the effect to the
        // width observable; later setLayout values recompute the query
        LayoutBounds &bounds = _layoutMap[foundKey.value()];
        return get(*bounds.width);
    }

    std::optional<double> ContainerContext::getHeight(const std::string &containerScope,
                                                      const std::optional<std::string> &name,
                                                      reactnativecss::Effect::GetProxy &get) {
        auto foundKey = findInScope(containerScope, name);
        if (!foundKey.has_value()) {
            return std::nullopt;
        }

        // Subscription parity with getWidth (see comment there)
        LayoutBounds &bounds = _layoutMap[foundKey.value()];
        return get(*bounds.height);
    }

    void ContainerContext::setLayout(const std::string &key,
                                     double x, double y,
                                     double width, double height) {
        LayoutBounds &bounds = _layoutMap[key];
        bounds.x->set(x);
        bounds.y->set(y);
        bounds.width->set(width);
        bounds.height->set(height);
    }

} // namespace margelo::nitro::cssnitro
