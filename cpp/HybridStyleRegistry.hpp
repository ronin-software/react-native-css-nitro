#pragma once

#include "HybridStyleRegistrySpec.hpp"
#include "Observable.hpp"
#include "HybridStyleRule+Equality.hpp"
#include "Styled+Equality.hpp"

#include <cstddef>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <variant>
#include <vector>

namespace reactnativecss {
    template<typename T>
    class Computed;
}

namespace margelo::nitro::cssnitro {

    class ShadowTreeUpdateManager;

    class HybridStyleRegistry : public HybridStyleRegistrySpec {
    public:
        HybridStyleRegistry();

        ~HybridStyleRegistry() override;

        using PropValue = std::variant<std::string, double, bool>;
        using PropPath = std::vector<std::string>;
        using SelectorAndArgs = std::tuple<std::string, std::vector<std::string>>;

        void setClassname(const std::string &className,
                          const std::vector<HybridStyleRule> &styleRule) override;

        void addStyleSheet(const HybridStyleSheet &stylesheet) override;

        void setRootVariables(const std::shared_ptr<AnyMap> &variables) override;

        void setUniversalVariables(const std::shared_ptr<AnyMap> &variables) override;

        Declarations getDeclarations(const std::string &componentId, const std::string &classNames,
                                     const std::string &variableScope,
                                     const std::string &containerScope) override;

        Styled
        registerComponent(const std::string &componentId, const std::function<void()> &rerender,
                          const std::string &classNames, const std::string &variableScope,
                          const std::string &containerScope,
                          const std::vector<std::string> &validAttributeQueries) override;

        void deregisterComponent(const std::string &componentId) override;

        void updateComponentState(const std::string &componentId, PseudoClassType type,
                                  bool value) override;

        void updateComponentLayout(const std::string &componentId,
                                   const LayoutRectangle &value) override;

        void updateComponentAttributes(
                const std::string &componentId,
                const std::shared_ptr<::margelo::nitro::AnyMap> &attributes) override;

        void unlinkComponent(const std::string &componentId) override;

        void updateComponentInlineStyleKeys(const std::string &componentId,
                                            const std::vector<std::string> &inlineStyleKeys) override;

        void updateComponentInlineVariables(
            const std::string &componentId,
            const std::shared_ptr<::margelo::nitro::AnyMap> &variables) override;

        void
        setWindowDimensions(double width, double height, double scale, double fontScale) override;

        void setPlatform(const std::string &platform) override;

        void setColorScheme(const std::string &scheme) override;

        void
        setKeyframes(const std::string &name, const std::shared_ptr<AnyMap> &keyframes) override;

    protected:
        void loadHybridMethods() override;

    private:
        // Class names referenced as container-query targets anywhere in the
        // registered stylesheets — carrying such a class makes a component a
        // group container (covers group/item, .a.b .c descendant selectors)
        // Global: the JS side can create multiple hybrid objects (one per
        // module-copy resolution path) — group naming must be process-wide
        static std::unordered_set<std::string> referencedContainers_;
        std::unordered_map<
                std::string,
                std::shared_ptr<reactnativecss::Observable<std::shared_ptr<::margelo::nitro::AnyMap>>>>
                componentAttributes_;
        std::unordered_map<
            std::string,
            std::shared_ptr<reactnativecss::Observable<
                std::shared_ptr<::margelo::nitro::AnyMap>>>>
                componentVariables_;
        jsi::Value linkComponent(jsi::Runtime &runtime,
                                 const jsi::Value &thisValue,
                                 const jsi::Value *args, size_t count);

        jsi::Value registerExternalMethods(jsi::Runtime &runtime,
                                           const jsi::Value &thisValue,
                                           const jsi::Value *args, size_t count);

        // Struct to hold computed with its associated parameters
        struct ComputedEntry {
            std::shared_ptr<reactnativecss::Computed<Styled *>> computed;
            std::string classNames;
            std::string variableScope;
            std::string containerScope;
        };

        // Static shared state
        static std::unique_ptr<ShadowTreeUpdateManager> shadowUpdates_;
        static std::unordered_map<std::string, ComputedEntry> computedMap_;
        static std::unordered_map<std::string, std::shared_ptr<reactnativecss::Observable<std::vector<HybridStyleRule>>>> styleRuleMap_;
        static std::atomic<uint64_t> nextStyleRuleId_;
    };

} // namespace margelo::nitro::cssnitro
