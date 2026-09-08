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

        // Parse hex/rgb/rgba strings and the common named colors into
        // {r, g, b, a} components in [0,1]. Colors beyond this set are
        // handled at compile time (colorjs.io inlining).
        bool parseColorString(const std::string &input, std::array<double, 4> &out) {
            static const std::unordered_map<std::string, std::array<double, 4>> named = {
                {"black", {0, 0, 0, 1}},     {"white", {1, 1, 1, 1}},
                {"red", {1, 0, 0, 1}},       {"green", {0, 0.502, 0, 1}},
                {"blue", {0, 0, 1, 1}},      {"yellow", {1, 1, 0, 1}},
                {"orange", {1, 0.647, 0, 1}}, {"purple", {0.502, 0, 0.502, 1}},
                {"pink", {1, 0.753, 0.796, 1}}, {"gray", {0.502, 0.502, 0.502, 1}},
                {"grey", {0.502, 0.502, 0.502, 1}}, {"brown", {0.647, 0.165, 0.165, 1}},
                {"transparent", {0, 0, 0, 0}},
            };

            auto hexValue = [](char c) -> int {
                if (c >= '0' && c <= '9') return c - '0';
                if (c >= 'a' && c <= 'f') return c - 'a' + 10;
                if (c >= 'A' && c <= 'F') return c - 'A' + 10;
                return -1;
            };

            std::string s = input;
            std::transform(s.begin(), s.end(), s.begin(),
                           [](unsigned char c) { return std::tolower(c); });

            if (!s.empty() && s[0] == '#') {
                std::string hex = s.substr(1);
                if (hex.size() == 3 || hex.size() == 4) {
                    std::string expanded;
                    for (char c: hex) {
                        int v = hexValue(c);
                        if (v < 0) return false;
                        expanded += char('0' + v);
                        expanded += char('0' + v);
                    }
                    hex = expanded;
                }
                if (hex.size() != 6 && hex.size() != 8) return false;
                auto byte = [&](size_t i) -> double {
                    int hi = hexValue(hex[i]);
                    int lo = hexValue(hex[i + 1]);
                    return (hi * 16 + lo) / 255.0;
                };
                out = {byte(0), byte(2), byte(4),
                       hex.size() == 8 ? byte(6) : 1.0};
                return true;
            }

            if (named.count(s) > 0) {
                out = named.at(s);
                return true;
            }

            // rgb()/rgba()
            if (s.rfind("rgb", 0) == 0) {
                size_t open = s.find('(');
                size_t close = s.rfind(')');
                if (open == std::string::npos || close == std::string::npos) {
                    return false;
                }
                std::string body = s.substr(open + 1, close - open - 1);
                std::array<double, 4> parts = {0, 0, 0, 1};
                size_t idx = 0;
                size_t pos = 0;
                while (idx < 4 && pos < body.size()) {
                    size_t next = body.find(',', pos);
                    std::string part = body.substr(
                        pos, next == std::string::npos ? std::string::npos : next - pos);
                    // Percentage form
                    if (!part.empty() && part.back() == '%') {
                        parts[idx] = std::atof(part.c_str()) / 100.0;
                    } else {
                        parts[idx] = std::atof(part.c_str()) / 255.0;
                    }
                    if (idx == 3) {
                        // Alpha is 0-1, not 0-255
                        parts[3] = std::atof(part.c_str());
                    }
                    if (next == std::string::npos) break;
                    pos = next + 1;
                    idx++;
                }
                out = parts;
                return true;
            }

            return false;
        }

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

        // box-shadow from runtime variables:
        // ["fn", "boxShadow", parts...] where parts is a (possibly nested)
        // list of ["inset"?, offsetX, offsetY, blurRadius, spreadDistance?,
        // color?]. Fully transparent shadows are filtered out.
        if (name == "boxShadow" && fnArgs.size() >= 3) {
            AnyArray shadows;

            auto isTransparent = [](const std::string &c) {
                if (c == "transparent") return true;
                if (c.size() == 5) return c.substr(3) == "00";   // #RGBA
                if (c.size() == 9) return c.substr(7) == "00";   // #RRGGBBAA
                return false;
            };

            // Parse one parts list; nested arrays are separate shadows.
            // Color may precede or follow the lengths.
            std::function<void(const AnyArray &, bool)> parseParts =
                    [&](const AnyArray &parts, bool inset) {
                bool curInset = inset;
                std::vector<double> nums;
                std::string pendingColor;
                bool hasPendingColor = false;

                auto flush = [&](const std::string &color) {
                    if (nums.size() >= 3) {
                        if (!isTransparent(color)) {
                            AnyObject shadow;
                            shadow["offsetX"] = AnyValue(nums[0]);
                            shadow["offsetY"] = AnyValue(nums[1]);
                            shadow["blurRadius"] = AnyValue(nums[2]);
                            if (nums.size() > 3) {
                                shadow["spreadDistance"] = AnyValue(nums[3]);
                            }
                            if (!color.empty()) {
                                shadow["color"] = AnyValue(color);
                            }
                            if (curInset) {
                                shadow["inset"] = AnyValue(true);
                            }
                            shadows.push_back(AnyValue(std::move(shadow)));
                        }
                        // Reset even when filtered — leftovers must not leak
                        // into the next shadow
                        nums.clear();
                        curInset = false;
                    }
                };

                for (const auto &part: parts) {
                    if (std::holds_alternative<std::string>(part)) {
                        const std::string &s = std::get<std::string>(part);
                        if (s == "inset") {
                            curInset = true;
                        } else if (hasPendingColor || nums.size() >= 3) {
                            // color after lengths: closes this shadow
                            flush(s);
                            hasPendingColor = false;
                        } else {
                            // color before lengths
                            pendingColor = s;
                            hasPendingColor = true;
                        }
                    } else if (std::holds_alternative<double>(part)) {
                        nums.push_back(std::get<double>(part));
                    } else if (std::holds_alternative<int64_t>(part)) {
                        nums.push_back(static_cast<double>(std::get<int64_t>(part)));
                    } else if (std::holds_alternative<AnyArray>(part)) {
                        flush(pendingColor);
                        pendingColor.clear();
                        hasPendingColor = false;
                        parseParts(std::get<AnyArray>(part), curInset);
                    }
                }
                flush(hasPendingColor ? pendingColor : "");
            };

            // Args mix: resolved var arrays, null markers for unresolved
            // vars, and flat parts from inlined variables. A null is a
            // boundary between variable groups.
            std::vector<AnyValue> buffer;
            for (size_t i = 2; i < fnArgs.size(); i++) {
                AnyValue resolved = resolveStyleValueArg(fnArgs[i], get, variableScope);
                if (std::holds_alternative<AnyArray>(resolved)) {
                    parseParts(std::get<AnyArray>(resolved), false);
                } else if (std::holds_alternative<std::monostate>(resolved)) {
                    parseParts(buffer, false);
                    buffer.clear();
                } else {
                    buffer.push_back(resolved);
                }
            }
            if (!buffer.empty()) {
                parseParts(buffer, false);
            }
            return AnyValue(std::move(shadows));
        }

        // drop-shadow from runtime variables:
        // ["fn", "dropShadow", <tokens>] where tokens are the
        // whitespace-separated shadow parts (offsetX offsetY blur? color?).
        // The compiler flattens nested fn tuples, so drop-shadow(var(--x))
        // arrives as ["fn","dropShadow","fn","var","x"] — resolve through.
        if (name == "dropShadow" && fnArgs.size() >= 3) {
            AnyArray tokens;

            for (size_t i = 2; i < fnArgs.size(); i++) {
                // Compiler flattens nested fns — drop-shadow(var(--x)) arrives
                // as ["fn","dropShadow","fn","var","x"]. Rebuild + resolve.
                if (std::holds_alternative<std::string>(fnArgs[i]) &&
                    std::get<std::string>(fnArgs[i]) == "fn" &&
                    i + 2 < fnArgs.size() &&
                    std::holds_alternative<std::string>(fnArgs[i + 1]) &&
                    std::get<std::string>(fnArgs[i + 1]) == "var") {
                    AnyArray varFn = {"fn", "var", fnArgs[i + 2]};
                    AnyValue resolved = resolveStyleFn(varFn, get, variableScope);
                    if (std::holds_alternative<AnyArray>(resolved)) {
                        for (const auto &token: std::get<AnyArray>(resolved)) {
                            tokens.push_back(token);
                        }
                    }
                    i += 2;
                    continue;
                }

                // A non-fn array is a raw token list (inlined variable value)
                if (std::holds_alternative<AnyArray>(fnArgs[i])) {
                    const auto &arr = std::get<AnyArray>(fnArgs[i]);
                    bool isFn = !arr.empty() &&
                                std::holds_alternative<std::string>(arr[0]) &&
                                std::get<std::string>(arr[0]) == "fn";
                    if (!isFn) {
                        for (const auto &token: arr) {
                            tokens.push_back(token);
                        }
                        continue;
                    }
                }

                AnyValue resolved = resolveStyleValueArg(fnArgs[i], get, variableScope);
                if (std::holds_alternative<AnyArray>(resolved)) {
                    for (const auto &token: std::get<AnyArray>(resolved)) {
                        AnyValue inner = resolveStyleValueArg(token, get, variableScope);
                        if (!std::holds_alternative<std::monostate>(inner)) {
                            tokens.push_back(std::move(inner));
                        }
                    }
                } else if (!std::holds_alternative<std::monostate>(resolved)) {
                    tokens.push_back(std::move(resolved));
                }
            }

            std::vector<double> nums;
            AnyValue color;
            for (const auto &token: tokens) {
                if (std::holds_alternative<double>(token)) {
                    nums.push_back(std::get<double>(token));
                } else if (std::holds_alternative<int64_t>(token)) {
                    nums.push_back(static_cast<double>(std::get<int64_t>(token)));
                } else {
                    // color string or PlatformColor object
                    color = token;
                }
            }

            AnyObject dropShadow;
            dropShadow["offsetX"] = AnyValue(nums.size() > 0 ? nums[0] : 0.0);
            dropShadow["offsetY"] = AnyValue(nums.size() > 1 ? nums[1] : 0.0);
            dropShadow["standardDeviation"] = AnyValue(nums.size() > 2 ? nums[2] : 0.0);
            if (!std::holds_alternative<std::monostate>(color)) {
                dropShadow["color"] = std::move(color);
            }

            AnyArray filter;
            AnyObject wrapper;
            wrapper["dropShadow"] = std::move(dropShadow);
            filter.push_back(AnyValue(std::move(wrapper)));
            return AnyValue(std::move(filter));
        }

        // text-shadow from runtime variables:
        // ["fn", "textShadow", <tokens>] where tokens are the
        // whitespace-separated shadow parts, matched against upstream's
        // shorthand patterns: [w,h,blur,color], [color,w,h,blur],
        // [w,h,color], [color,w,h], [w,h].
        if (name == "textShadow" && fnArgs.size() >= 3) {
            AnyArray tokens;

            for (size_t i = 2; i < fnArgs.size(); i++) {
                // Compiler flattens nested fns — text-shadow(var(--x)) arrives
                // as ["fn","textShadow","fn","var","x"]. Rebuild + resolve.
                if (std::holds_alternative<std::string>(fnArgs[i]) &&
                    std::get<std::string>(fnArgs[i]) == "fn" &&
                    i + 2 < fnArgs.size() &&
                    std::holds_alternative<std::string>(fnArgs[i + 1]) &&
                    std::get<std::string>(fnArgs[i + 1]) == "var") {
                    AnyArray varFn = {"fn", "var", fnArgs[i + 2]};
                    AnyValue resolved = resolveStyleFn(varFn, get, variableScope);
                    if (std::holds_alternative<AnyArray>(resolved)) {
                        for (const auto &token: std::get<AnyArray>(resolved)) {
                            tokens.push_back(token);
                        }
                    }
                    i += 2;
                    continue;
                }

                // A non-fn array is a raw token list (inlined variable value)
                if (std::holds_alternative<AnyArray>(fnArgs[i])) {
                    const auto &arr = std::get<AnyArray>(fnArgs[i]);
                    bool isFn = !arr.empty() &&
                                std::holds_alternative<std::string>(arr[0]) &&
                                std::get<std::string>(arr[0]) == "fn";
                    if (!isFn) {
                        for (const auto &token: arr) {
                            tokens.push_back(token);
                        }
                        continue;
                    }
                }

                AnyValue resolved = resolveStyleValueArg(fnArgs[i], get, variableScope);
                if (std::holds_alternative<AnyArray>(resolved)) {
                    for (const auto &token: std::get<AnyArray>(resolved)) {
                        AnyValue inner = resolveStyleValueArg(token, get, variableScope);
                        if (!std::holds_alternative<std::monostate>(inner)) {
                            tokens.push_back(std::move(inner));
                        }
                    }
                } else if (!std::holds_alternative<std::monostate>(resolved)) {
                    tokens.push_back(std::move(resolved));
                }
            }

            auto isColor = [](const AnyValue &v) {
                return std::holds_alternative<std::string>(v) ||
                       std::holds_alternative<AnyObject>(v);
            };
            auto asNumber = [](const AnyValue &v) -> double {
                if (std::holds_alternative<double>(v)) return std::get<double>(v);
                if (std::holds_alternative<int64_t>(v))
                    return static_cast<double>(std::get<int64_t>(v));
                return 0.0;
            };

            double width = 0;
            double height = 0;
            AnyValue blur = AnyValue(0.0);
            AnyValue color;

            if (tokens.size() >= 2) {
                if (isColor(tokens[0])) {
                    // [color, w, h, (blur)]
                    color = tokens[0];
                    width = asNumber(tokens[1]);
                    height = tokens.size() > 2 ? asNumber(tokens[2]) : 0;
                    blur = tokens.size() > 3 ? tokens[3] : AnyValue(0.0);
                } else {
                    // [w, h] / [w, h, blur] / [w, h, blur, color]
                    width = asNumber(tokens[0]);
                    height = asNumber(tokens[1]);
                    if (tokens.size() > 2 && !isColor(tokens[2])) {
                        blur = tokens[2];
                    }
                    if (tokens.size() > 3 && isColor(tokens[3])) {
                        color = tokens[3];
                    } else if (tokens.size() > 2 && isColor(tokens[2])) {
                        color = tokens[2];
                    }
                }
            }

            if (std::holds_alternative<std::monostate>(color)) {
                // Default color is currentcolor → the platform label color
                color = resolveVar("__rn-css-color", AnyValue(), get, variableScope);
            }

            AnyObject offset;
            offset["width"] = AnyValue(width);
            offset["height"] = AnyValue(height);

            AnyObject textShadow;
            textShadow["textShadowColor"] = std::move(color);
            textShadow["textShadowOffset"] = AnyValue(std::move(offset));
            textShadow["textShadowRadius"] = std::move(blur);

            return AnyValue(std::move(textShadow));
        }

        // color-mix from runtime variables:
        // ["fn","colorMix", space, left, leftPct?, right?, rightPct?] — the
        // compiler folds a `transparent` right side into the 3-arg form, the
        // dominant Tailwind opacity-modifier pattern. Mixing two runtime
        // colors in non-sRGB spaces is not supported C++-side (compile-time
        // inlining covers static cases).
        if (name == "colorMix" && fnArgs.size() >= 5) {
            const auto space = fnArgs[2];
            const std::string *spaceStr = std::get_if<std::string>(&space);
            if (!spaceStr) {
                return AnyValue();
            }
            AnyValue left = resolveStyleValueArg(fnArgs[3], get, variableScope);
            const std::string *leftStr = std::get_if<std::string>(&left);
            if (!leftStr) {
                return AnyValue();
            }
            const std::string *leftPct = fnArgs.size() > 4
                                             ? std::get_if<std::string>(&fnArgs[4])
                                             : nullptr;

            // Right side present with a non-transparent color — unsupported
            if (fnArgs.size() > 5) {
                AnyValue right = resolveStyleValueArg(fnArgs[5], get, variableScope);
                const std::string *rightStr = std::get_if<std::string>(&right);
                if (rightStr && *rightStr != "transparent") {
                    return AnyValue();
                }
            }

            std::array<double, 4> rgba;
            if (!parseColorString(*leftStr, rgba)) {
                return AnyValue();
            }
            double alpha = rgba[3];
            if (leftPct && leftPct->size() > 1 && leftPct->back() == '%') {
                alpha = std::atof(leftPct->c_str()) / 100.0;
            }
            // Trim trailing zeros so the alpha serializes like JS does
            char alphaBuf[16];
            snprintf(alphaBuf, sizeof(alphaBuf), "%g", alpha);
            std::string out = "rgba(" + std::to_string((int) std::round(rgba[0] * 255)) + ", " +
                              std::to_string((int) std::round(rgba[1] * 255)) + ", " +
                              std::to_string((int) std::round(rgba[2] * 255)) + ", " +
                              alphaBuf + ")";
            return AnyValue(out);
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
